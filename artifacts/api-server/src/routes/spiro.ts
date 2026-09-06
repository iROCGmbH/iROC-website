import { Router, type IRouter, type Request, type Response } from "express";
import { db, spiroKnowledgeDocuments } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import pdfParse from "pdf-parse";
import { requireAdmin } from "./admin-auth.js";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage.js";

const router: IRouter = Router();
const storage = new ObjectStorageService();
const MAX_PDF_SIZE_BYTES = 20 * 1024 * 1024;

function publicDocument(row: typeof spiroKnowledgeDocuments.$inferSelect) {
  const { extractedText: _extractedText, ...document } = row;
  return document;
}

router.get("/admin/spiro/knowledge", requireAdmin, async (_req: Request, res: Response): Promise<void> => {
  const rows = await db.select().from(spiroKnowledgeDocuments).orderBy(desc(spiroKnowledgeDocuments.createdAt));
  res.json(rows.map(publicDocument));
});

router.post("/admin/spiro/knowledge/upload-url", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const { name, size, contentType } = req.body as { name?: unknown; size?: unknown; contentType?: unknown };
  if (typeof name !== "string" || !name.trim().toLowerCase().endsWith(".pdf")) {
    res.status(400).json({ error: "Only PDF files are supported" });
    return;
  }
  if (contentType !== "application/pdf") {
    res.status(400).json({ error: "The selected file is not a PDF" });
    return;
  }
  if (!Number.isInteger(size) || Number(size) <= 0 || Number(size) > MAX_PDF_SIZE_BYTES) {
    res.status(400).json({ error: "PDF files must be 20 MB or smaller" });
    return;
  }
  const uploadURL = await storage.getObjectEntityUploadURLWithSubdir("spiro-knowledge");
  res.json({ uploadURL, objectPath: storage.normalizeObjectEntityPath(uploadURL) });
});

router.post("/admin/spiro/knowledge", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const { name, objectPath, contentType, sizeBytes } = req.body as Record<string, unknown>;
  if (
    typeof name !== "string" ||
    typeof objectPath !== "string" ||
    contentType !== "application/pdf" ||
    !Number.isInteger(sizeBytes) ||
    Number(sizeBytes) <= 0 ||
    Number(sizeBytes) > MAX_PDF_SIZE_BYTES
  ) {
    res.status(400).json({ error: "Invalid PDF metadata" });
    return;
  }

  const [record] = await db.insert(spiroKnowledgeDocuments).values({
    name: name.trim().slice(0, 255),
    objectPath,
    contentType,
    sizeBytes: Number(sizeBytes),
    status: "processing",
  }).returning();

  try {
    const file = await storage.getObjectEntityFile(objectPath);
    const [metadata] = await file.getMetadata();
    const actualSize = Number(metadata.size ?? 0);
    if (metadata.contentType !== "application/pdf" || actualSize <= 0 || actualSize > MAX_PDF_SIZE_BYTES) {
      throw new Error("Stored object is not a supported PDF");
    }
    const [buffer] = await file.download();
    const parsed = await pdfParse(buffer);
    const extractedText = parsed.text.replace(/\u0000/g, "").trim();
    if (extractedText.length < 40) {
      throw new Error("No readable text was found. Scanned image-only PDFs are not supported yet.");
    }
    const [ready] = await db.update(spiroKnowledgeDocuments).set({
      status: "ready",
      extractedText,
      pageCount: parsed.numpages,
      characterCount: extractedText.length,
      analyzedAt: new Date(),
      errorMessage: null,
    }).where(eq(spiroKnowledgeDocuments.id, record.id)).returning();
    res.status(201).json(publicDocument(ready));
  } catch (error) {
    const message = error instanceof Error ? error.message : "PDF analysis failed";
    req.log.warn({ documentId: record.id, err: error }, "Spiro PDF analysis failed");
    const [failed] = await db.update(spiroKnowledgeDocuments).set({
      status: "failed",
      errorMessage: message.slice(0, 500),
      analyzedAt: new Date(),
    }).where(eq(spiroKnowledgeDocuments.id, record.id)).returning();
    res.status(422).json(publicDocument(failed));
  }
});

router.delete("/admin/spiro/knowledge/:id", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = Number.parseInt(rawId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid document ID" });
    return;
  }
  const [deleted] = await db.delete(spiroKnowledgeDocuments)
    .where(eq(spiroKnowledgeDocuments.id, id))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  try {
    await storage.deleteObjectEntity(deleted.objectPath);
  } catch (error) {
    if (!(error instanceof ObjectNotFoundError)) {
      req.log.warn({ documentId: id, err: error }, "Could not remove Spiro PDF object");
    }
  }
  res.sendStatus(204);
});

export default router;