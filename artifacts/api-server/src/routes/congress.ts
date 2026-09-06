/**
 * Congress & Conference search and management routes.
 * All routes require iROC admin authentication.
 *
 * POST /api/iroc/congress/search  – AI-powered congress search (OpenAI Responses API)
 * GET  /api/iroc/congress         – list saved congress events
 * POST /api/iroc/congress         – save a congress event to the events table
 * DELETE /api/iroc/congress/:id   – delete a congress event
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { eventsTable } from "@workspace/db";
import { eq, and, asc, gte } from "drizzle-orm";
import { requireIrocAuth } from "./iroc.js";

const router: IRouter = Router();

const DEFAULT_THEMES = [
  "Orthobiology", "PRP", "Peptide", "Exosome", "Stem Cell",
  "MFAT", "SVF", "Regeneration", "Hand Surgery",
  "Ultrasound-guided orthopedic instruments",
  "Young & Student Surgeon Congresses",
];

// ── POST /api/iroc/congress/search ────────────────────────────────────────────
router.post(
  "/iroc/congress/search",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const { year, themes, query: customQuery } = req.body as {
      year?: number;
      themes?: string[];
      query?: string;
    };

    const searchYear = year || new Date().getFullYear();
    const searchThemes = themes && themes.length > 0 ? themes : DEFAULT_THEMES;

    const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

    if (!baseUrl || !apiKey) {
      res.status(503).json({ error: "AI search not configured" });
      return;
    }

    const systemPrompt =
      "You are a medical congress research assistant with up-to-date knowledge of international medical events. " +
      "Return ONLY valid JSON — no markdown, no explanation.";

    const { locations } = req.body as { locations?: string[] };
    const searchLocations =
      locations && locations.length > 0 ? locations : ["Germany", "Austria"];
    const locText = searchLocations.includes("International")
      ? "anywhere in the world with a focus on Europe"
      : searchLocations.join(", ");

    const userPrompt =
      `Find medical congress and conference events in ${searchYear} related to: ${searchThemes.join(", ")}.` +
      (customQuery ? ` Additional context: ${customQuery}.` : "") +
      ` Focus on events held in: ${locText}.` +
      ` Also include internationally significant congresses that are directly relevant to these themes (e.g. FESSH, ESSKA, ISAKOS, EFORT, DGOU, DGH, DGOOC, AAOS, ICRS, IOF) even if held elsewhere.` +
      ` Return a JSON object with key "congresses" containing an array. Each item must have:` +
      ` name (string), specialtyFocus (string – pick the closest theme from the list), startDate (YYYY-MM-DD), endDate (YYYY-MM-DD), location ("City, Country"), website (URL).` +
      ` Return 10–20 relevant results sorted by startDate ascending.`;

    let congresses: unknown[] = [];

    // ── Attempt 1: Responses API with web_search_preview ──────────────────────
    try {
      const resp = await fetch(`${baseUrl}/responses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-5.6-terra",
          tools: [{ type: "web_search_preview" }],
          input: [
            { role: "system", content: systemPrompt },
            { role: "user",   content: userPrompt   },
          ],
        }),
      });

      if (resp.ok) {
        const data = await resp.json() as { output?: { content?: { type: string; text: string }[] }[] };
        const text = data.output
          ?.flatMap((o) => o.content ?? [])
          ?.find((c) => c.type === "output_text")?.text ?? "";
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as { congresses?: unknown[] };
          congresses = parsed.congresses ?? [];
        }
      }
    } catch {
      // fall through to chat completions
    }

    // ── Fallback: Chat Completions with JSON mode ──────────────────────────────
    if (congresses.length === 0) {
      try {
        const resp = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "gpt-5.6-terra",
            max_completion_tokens: 4096,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user",   content: userPrompt   },
            ],
          }),
        });

        if (resp.ok) {
          const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
          const content = data.choices?.[0]?.message?.content ?? "{}";
          const parsed = JSON.parse(content) as { congresses?: unknown[] };
          congresses = parsed.congresses ?? [];
        }
      } catch (err) {
        console.error("[congress/search] chat completions error:", err);
        res.status(500).json({ error: "Search failed", details: String(err) });
        return;
      }
    }

    res.json({ results: congresses, year: searchYear });
  },
);

// ── GET /api/iroc/congress ────────────────────────────────────────────────────
router.get(
  "/iroc/congress",
  requireIrocAuth,
  async (_req: Request, res: Response) => {
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const rows = await db
      .select()
      .from(eventsTable)
      .where(and(eq(eventsTable.isCongressEvent, true), gte(eventsTable.eventDate, today)))
      .orderBy(asc(eventsTable.eventDate));
    res.json(rows);
  },
);

// ── POST /api/iroc/congress ───────────────────────────────────────────────────
router.post(
  "/iroc/congress",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const { name, specialtyFocus, startDate, endDate, location, website, logoUrl } =
      req.body as {
        name?: string;
        specialtyFocus?: string;
        startDate?: string;
        endDate?: string;
        location?: string;
        website?: string;
        logoUrl?: string;
      };

    if (!name?.trim())      { res.status(400).json({ error: "name is required" });      return; }
    if (!startDate?.trim()) { res.status(400).json({ error: "startDate is required" }); return; }
    if (!website?.trim())   { res.status(400).json({ error: "website is required" });   return; }

    const focusText = specialtyFocus?.trim() ?? null;

    const [row] = await db
      .insert(eventsTable)
      .values({
        title:          name.trim(),
        titleDe:        name.trim(),
        description:    focusText ? `Focus: ${focusText}` : null,
        descriptionDe:  focusText ? `Fokus: ${focusText}` : null,
        mediaUrl:       logoUrl?.trim() || null,
        mediaType:      "image",
        externalUrl:    website.trim(),
        eventDate:      startDate.trim(),
        endDate:        endDate?.trim() || null,
        location:       location?.trim() || null,
        specialtyFocus: focusText,
        isCongressEvent: true,
        isActive:       true,
      })
      .returning();

    res.status(201).json(row);
  },
);

// ── DELETE /api/iroc/congress/:id ─────────────────────────────────────────────
router.delete(
  "/iroc/congress/:id",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    await db
      .delete(eventsTable)
      .where(and(eq(eventsTable.id, id), eq(eventsTable.isCongressEvent, true)));
    res.json({ ok: true });
  },
);

export default router;
