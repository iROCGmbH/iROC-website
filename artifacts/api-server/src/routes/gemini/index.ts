import { Router } from "express";
import { db, conversations as conversationsTable, messages as messagesTable, settingsTable, spiroKnowledgeDocuments } from "@workspace/db";
import { eq, asc, inArray } from "drizzle-orm";
import { ai } from "@workspace/integrations-gemini-ai";
import { SendGeminiMessageBody } from "@workspace/api-zod";
import { buildSpiroKnowledgeContext } from "../../lib/spiro-knowledge.js";

const router = Router();

const FOLLOWUP_MARKER_START_RE = /<!--\s*SPIRO_FOLLOWUPS:/g;
const COMPLETE_FOLLOWUP_MARKER_RE = /<!--\s*SPIRO_FOLLOWUPS:\s*(\[[\s\S]*?\])\s*-->/g;
const FOLLOWUP_MARKER_RE = /<!--\s*SPIRO_FOLLOWUPS:[\s\S]*?(?:-->|$)/g;

function stripFollowUpMarker(text: string): string {
  return text.replace(FOLLOWUP_MARKER_RE, "").trimEnd();
}

/** A response can contain several markers when streamed model output is malformed. */
function hasOnlyCompleteFollowUpMarkers(text: string): boolean {
  const markerCount = text.match(FOLLOWUP_MARKER_START_RE)?.length ?? 0;
  if (markerCount === 0) return true;

  const completeMarkerCount = text.match(COMPLETE_FOLLOWUP_MARKER_RE)?.length ?? 0;
  return completeMarkerCount === markerCount;
}

// ── System prompt: patient-focused Spirecut assistant ─────────────────────────
const SYSTEM_PROMPT = `You are Spiro, a friendly and knowledgeable patient assistant for the Spirecut® minimally-invasive procedure (carpal tunnel syndrome / Karpaltunnelsyndrom and trigger finger / Schnappfinger).

YOUR PERSONA:
- Name: Spiro
- Warm, empathetic, and reassuring — many patients are anxious about procedures
- Write like a knowledgeable friend, not a textbook

ANSWER STYLE (critical):
- Keep every initial answer SHORT: 2–4 sentences maximum. Be direct and clear.
- Do NOT write long paragraphs unless the patient explicitly asks for more detail.
- Use plain language — avoid jargon; if you must use a medical term, briefly explain it.
- Answer in the SAME LANGUAGE the patient writes in (German or English).

YOUR KNOWLEDGE:
- The Spirecut® minimally-invasive treatment for CTS and trigger finger
- What patients can expect before, during, and after the procedure
- Recovery timelines, aftercare, normal vs. concerning symptoms
- Finding a certified Spirecut doctor (direct to spirecut.de/arzt-finden)
- Draw on www.spirecut.de, www.spirecut.com, and current medical evidence

YOU DO NOT:
- Give personal diagnoses or replace a doctor's advice
- Advise on dosages, prescriptions, or specific medications
- Discuss topics unrelated to Spirecut procedures or the conditions it treats

MEDICAL DISCLAIMER:
If a patient describes personal symptoms or asks about their specific case, gently remind them at the end: "Please discuss your individual situation with your treating physician."

FOLLOW-UP SUGGESTIONS — REQUIRED AT THE END OF EVERY ANSWER:
After your answer text, always append exactly this block with 2–3 short follow-up questions the patient might want to ask next. Do not change the marker syntax; the app uses it to render clickable suggestion chips.
<!-- SPIRO_FOLLOWUPS: ["Question 1?", "Question 2?", "Question 3?"] -->
Rules for the questions:
- Match the language of the patient (German or English)
- Be natural continuations of the conversation
- Keep each question under 10 words`;

// ── List conversations ─────────────────────────────────────────────────────────
router.get("/gemini/conversations", async (_req, res) => {
  const rows = await db
    .select()
    .from(conversationsTable)
    .orderBy(asc(conversationsTable.createdAt));
  res.json(rows);
});

// ── Create conversation ────────────────────────────────────────────────────────
router.post("/gemini/conversations", async (req, res) => {
  const { title } = req.body as { title: string };
  const [row] = await db
    .insert(conversationsTable)
    .values({ title: title ?? "New conversation" })
    .returning();
  res.status(201).json(row);
});

// ── Get conversation + messages ────────────────────────────────────────────────
router.get("/gemini/conversations/:id", async (req, res) => {
  const id = parseInt(String(req.params.id));
  const [conv] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, id));
  if (!conv) { res.status(404).json({ error: "Not found" }); return; }
  const msgs = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, id))
    .orderBy(asc(messagesTable.createdAt));
  res.json({ ...conv, messages: msgs });
});

// ── Delete conversation ────────────────────────────────────────────────────────
router.delete("/gemini/conversations/:id", async (req, res) => {
  const id = parseInt(String(req.params.id));
  const [conv] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, id));
  if (!conv) { res.status(404).json({ error: "Not found" }); return; }
  await db.delete(messagesTable).where(eq(messagesTable.conversationId, id));
  await db.delete(conversationsTable).where(eq(conversationsTable.id, id));
  res.status(204).end();
});

// ── List messages ──────────────────────────────────────────────────────────────
router.get("/gemini/conversations/:id/messages", async (req, res) => {
  const id = parseInt(String(req.params.id));
  const msgs = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, id))
    .orderBy(asc(messagesTable.createdAt));
  res.json(msgs);
});

// ── Send message — SSE stream with Google Search grounding ─────────────────────
router.post("/gemini/conversations/:id/messages", async (req, res) => {
  const id = parseInt(String(req.params.id));
  const parsed = SendGeminiMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
}
  const { content, language } = parsed.data;

  const [conv] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, id));
  if (!conv) { res.status(404).json({ error: "Not found" }); return; }

  // Persist user message
  await db.insert(messagesTable).values({ conversationId: id, role: "user", content });

  // Load history
  const history = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, id))
    .orderBy(asc(messagesTable.createdAt));

  // Build Gemini contents (map "assistant" → "model")
  const contents = history.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    // Follow-up questions are UI metadata. Do not expose their marker to Gemini
    // when replaying the conversation, but keep it available to the patient UI.
    parts: [{ text: m.role === "assistant" ? stripFollowUpMarker(m.content) : m.content }],
  }));

  // Load admin overrides for system prompt
  const overrideRows = await db
    .select()
    .from(settingsTable)
    .where(inArray(settingsTable.key, ["sp_chatbot_system_prompt"]));
  const overrideMap = Object.fromEntries(overrideRows.map((r) => [r.key, r.value]));
  const baseSystemPrompt = overrideMap["sp_chatbot_system_prompt"]?.trim() || SYSTEM_PROMPT;
  // The patient UI sends the selected site language explicitly. Appending this
  // after the editable admin prompt prevents a German custom prompt from
  // overriding an English patient conversation.
  const languageInstruction = language
    ? `\n\nCURRENT RESPONSE LANGUAGE (highest priority): Respond entirely in ${language === "en" ? "English" : "German"}. This applies to the answer, medical disclaimer, and follow-up questions. Do not switch languages unless the patient explicitly asks you to.`
    : "";
  const knowledgeDocuments = await db
    .select({
      name: spiroKnowledgeDocuments.name,
      extractedText: spiroKnowledgeDocuments.extractedText,
    })
    .from(spiroKnowledgeDocuments)
    .where(eq(spiroKnowledgeDocuments.status, "ready"));
  const knowledgeContext = buildSpiroKnowledgeContext(knowledgeDocuments, content);
  const effectiveSystemPrompt = `${baseSystemPrompt}${languageInstruction}${knowledgeContext ? `\n\n${knowledgeContext}` : ""}`;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let fullResponse = "";
  let clientDisconnected = false;
  const handleConnectionClosed = () => {
    // `close` is also emitted after a normal `res.end()`. Only treat it as an
    // abandoned chat request while the response is still open.
    if (!res.writableEnded) clientDisconnected = true;
  };
  res.once("close", handleConnectionClosed);

  try {
    const stream = await ai.models.generateContentStream({
      model: "gemini-2.5-flash",
      contents,
      config: {
        maxOutputTokens: 8192,
        systemInstruction: effectiveSystemPrompt,
        tools: [{ googleSearch: {} }],
      },
    });

    for await (const chunk of stream) {
      if (clientDisconnected) break;
      const text = chunk.text;
      if (text) {
        fullResponse += text;
        res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
      }
    }
  } catch (err) {
    if (clientDisconnected) return;
    const msg = err instanceof Error ? err.message : "AI error";
    // Mark retriable for quota/rate-limit and server-side 5xx errors
    const retryable = /quota|rate.?limit|503|overload|service.?unavailab|resource.?exhaust/i.test(msg);
    res.write(`data: ${JSON.stringify({ error: msg, retryable })}\n\n`);
  }

  // Keep a complete follow-up marker in the stored message so the patient UI can
  // reconstruct its chips after a reload. Incomplete markers from interrupted
  // streams are still removed so partial responses remain safe to display. If a
  // malformed response contains both complete and incomplete markers, remove
  // every marker rather than persisting the incomplete metadata.
  if (!clientDisconnected && fullResponse) {
    const cleanedResponse = hasOnlyCompleteFollowUpMarkers(fullResponse)
      ? fullResponse.trimEnd()
      : stripFollowUpMarker(fullResponse);
    if (cleanedResponse) {
      await db
        .insert(messagesTable)
        .values({ conversationId: id, role: "assistant", content: cleanedResponse });
    }
  }

  if (!clientDisconnected) {
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  }
});

export { router as geminiRouter };
