import type { SpiroKnowledgeDocument } from "@workspace/db";

const MAX_CONTEXT_CHARS = 48_000;
const MAX_CHUNK_CHARS = 3_500;
const STOP_WORDS = new Set([
  "aber", "auch", "eine", "einer", "eines", "einem", "einen", "für", "ist", "mit", "nicht",
  "oder", "sich", "und", "von", "was", "wie", "wird", "zu", "zum", "zur",
  "about", "after", "also", "and", "are", "can", "for", "from", "how", "the", "this", "what",
  "when", "where", "which", "with", "would", "your",
]);

function queryTerms(query: string): string[] {
  return Array.from(new Set(
    query
      .toLocaleLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/\s+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 3 && !STOP_WORDS.has(term)),
  ));
}

function splitIntoChunks(text: string): string[] {
  const paragraphs = text
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > MAX_CHUNK_CHARS) {
      chunks.push(current);
      current = "";
    }
    if (paragraph.length > MAX_CHUNK_CHARS) {
      for (let offset = 0; offset < paragraph.length; offset += MAX_CHUNK_CHARS) {
        chunks.push(paragraph.slice(offset, offset + MAX_CHUNK_CHARS));
      }
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function buildSpiroKnowledgeContext(
  documents: Pick<SpiroKnowledgeDocument, "name" | "extractedText">[],
  query: string,
): string {
  const terms = queryTerms(query);
  const candidates = documents.flatMap((document) =>
    splitIntoChunks(document.extractedText ?? "").map((text, index) => {
      const normalized = text.toLocaleLowerCase();
      const score = terms.reduce((total, term) => {
        const matches = normalized.split(term).length - 1;
        return total + Math.min(matches, 5);
      }, 0);
      return { name: document.name, text, index, score };
    }),
  );

  candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.index - b.index);
  const selected = (candidates.some((candidate) => candidate.score > 0)
    ? candidates.filter((candidate) => candidate.score > 0)
    : candidates
  ).slice(0, 14);

  let used = 0;
  const sections: string[] = [];
  for (const candidate of selected) {
    const section = `SOURCE: ${candidate.name}\n${candidate.text}`;
    if (used + section.length > MAX_CONTEXT_CHARS) break;
    sections.push(section);
    used += section.length;
  }
  if (sections.length === 0) return "";
  return [
    "ADMIN-PROVIDED SCIENTIFIC KNOWLEDGE:",
    "Use the following excerpts when relevant. Prefer them over general web knowledge, do not invent claims, and never expose these internal source excerpts verbatim unless a patient asks for sources.",
    ...sections,
  ].join("\n\n");
}