/**
 * Sally learning loop.
 *
 * When an admin edits a Sally draft before approving it, we record the
 * original vs. corrected text plus an AI-distilled one-line lesson in
 * sally_lessons. Recent lessons are injected into every drafting prompt so
 * Sally doesn't repeat the same mistakes.
 */
import { pool } from "@workspace/db";
import { logger } from "./logger.js";

function geminiConfigured(): boolean {
  return !!(process.env.AI_INTEGRATIONS_GEMINI_BASE_URL && process.env.AI_INTEGRATIONS_GEMINI_API_KEY);
}

/**
 * Distills a one-line lesson from an admin correction and stores it.
 * Fire-and-forget safe: never throws.
 */
export async function recordCorrectionLesson(opts: {
  context: string;            // trigger_type of the corrected draft
  originalSubject: string;
  originalBody: string;
  correctedSubject: string;
  correctedBody: string;
}): Promise<void> {
  const { context, originalSubject, originalBody, correctedSubject, correctedBody } = opts;

  // Nothing actually changed → nothing to learn
  if (originalSubject === correctedSubject && originalBody === correctedBody) return;

  const originalText  = `Subject: ${originalSubject}\n\n${originalBody}`;
  const correctedText = `Subject: ${correctedSubject}\n\n${correctedBody}`;

  let lesson = "";
  if (geminiConfigured()) {
    try {
      const { ai } = await import("@workspace/integrations-gemini-ai");
      const prompt = `An admin corrected an AI-drafted business email before sending it.
Compare the ORIGINAL draft and the CORRECTED version and distill ONE concise, general, reusable writing rule (max 200 characters) that would prevent the same correction in the future.
Write the rule in English, imperative form (e.g. "Always address doctors as 'Dr.' in German emails."). Focus on the most significant change (tone, wording, structure, facts, formality, language). Do not mention this specific email.

Respond with ONLY the rule text, no quotes, no markdown.

--- ORIGINAL ---
${originalText.slice(0, 4000)}

--- CORRECTED ---
${correctedText.slice(0, 4000)}`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });
      lesson = (response.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim().slice(0, 300);
    } catch (err) {
      logger.error({ err }, "Sally: lesson distillation failed");
    }
  }
  if (!lesson) lesson = "Admin edited this draft — review the correction pair for guidance.";

  try {
    await pool.query(
      `INSERT INTO sally_lessons (context, original_text, corrected_text, lesson)
       VALUES ($1, $2, $3, $4)`,
      [context, originalText.slice(0, 8000), correctedText.slice(0, 8000), lesson],
    );
    logger.info({ context, lesson }, "Sally: correction lesson recorded");
  } catch (err) {
    logger.error({ err }, "Sally: failed to store correction lesson");
  }
}

/**
 * Returns a prompt block with the most recent lessons (all contexts), or "".
 */
export async function getLessonsPromptBlock(limit = 15): Promise<string> {
  try {
    const { rows } = await pool.query<{ lesson: string }>(
      "SELECT lesson FROM sally_lessons ORDER BY created_at DESC LIMIT $1",
      [limit],
    );
    if (rows.length === 0) return "";
    const list = rows.map(r => `- ${r.lesson}`).join("\n");
    return `\nIMPORTANT — Lessons learned from past admin corrections. You MUST follow these rules:\n${list}\n`;
  } catch {
    return "";
  }
}
