import { Readable } from 'stream';
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from '@workspace/api-zod';
import { Router, type IRouter, type Request, type Response } from 'express';
import { ObjectNotFoundError, ObjectStorageService } from '../lib/objectStorage';
import { requireAdmin } from './admin-auth.js';
import { validateEmailSignatureLogoUpload } from '../lib/email-signatures.js';
import {
  HERO_IMAGE_CONTENT_TYPE_MESSAGE,
  HERO_IMAGE_SIZE_LIMIT_MESSAGE,
  MAX_HERO_IMAGE_SIZE_BYTES,
} from '@workspace/spirecut-shared';

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
const HERO_IMAGE_CONTENT_TYPES = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]);

function isAllowedHeroImageUpload(name: string, contentType: string): boolean {
  const type = contentType.toLowerCase();
  if (!HERO_IMAGE_CONTENT_TYPES.has(type)) return false;
  const extension = name.trim().toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  const extensionsForType: Record<string, string[]> = {
    "image/avif": ["avif"],
    "image/gif": ["gif"],
    "image/jpeg": ["jpg", "jpeg"],
    "image/png": ["png"],
    "image/webp": ["webp"],
  };
  // The filename is metadata supplied by the admin client, but requiring it to
  // agree with the browser-reported MIME type prevents a renamed PDF/text file
  // from being accepted as a hero upload.
  return !!extension && extensionsForType[type].includes(extension);
}

/**
 * POST /storage/uploads/request-url/hero
 * Like /request-url but writes to the dedicated `hero-images` subdir so that
 * hero cleanup can only ever delete objects in that namespace, not generic
 * uploads such as team photos.
 * Protected: admin Bearer token required.
 */
router.post('/storage/uploads/request-url/hero', requireAdmin, async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Missing or invalid required fields' });
    return;
  }
  if (parsed.data.size > MAX_HERO_IMAGE_SIZE_BYTES) {
    res.status(400).json({ error: HERO_IMAGE_SIZE_LIMIT_MESSAGE });
    return;
  }
  if (!isAllowedHeroImageUpload(parsed.data.name, parsed.data.contentType)) {
    res.status(400).json({ error: HERO_IMAGE_CONTENT_TYPE_MESSAGE });
    return;
  }
  try {
    const { name, size, contentType } = parsed.data;
    const uploadURL = await objectStorageService.getObjectEntityUploadURLWithSubdir('hero-images');
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    res.json(RequestUploadUrlResponse.parse({ uploadURL, objectPath, metadata: { name, size, contentType } }));
  } catch (error) {
    req.log.error({ err: error }, 'Error generating hero upload URL');
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

/**
 * POST /storage/uploads/request-url/logo
 * Like /request-url/hero but writes to the dedicated `logos` subdir.
 * Protected: admin Bearer token required.
 */
router.post('/storage/uploads/request-url/logo', requireAdmin, async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Missing or invalid required fields' });
    return;
  }
  try {
    const { name, size, contentType } = parsed.data;
    try {
      validateEmailSignatureLogoUpload(size, contentType);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid signature logo.' });
      return;
    }
    const uploadURL = await objectStorageService.getObjectEntityUploadURLWithSubdir('logos');
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    res.json(RequestUploadUrlResponse.parse({ uploadURL, objectPath, metadata: { name, size, contentType } }));
  } catch (error) {
    req.log.error({ err: error }, 'Error generating logo upload URL');
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

/**
 * POST /storage/uploads/request-url
 * Accepts JSON metadata (name, size, contentType) — NOT the file.
 * Returns a presigned PUT URL + objectPath for direct GCS upload.
 * Protected: admin Bearer token required.
 */
router.post('/storage/uploads/request-url', requireAdmin, async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Missing or invalid required fields' });
    return;
  }

  try {
    const { name, size, contentType } = parsed.data;
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    res.json(RequestUploadUrlResponse.parse({ uploadURL, objectPath, metadata: { name, size, contentType } }));
  } catch (error) {
    req.log.error({ err: error }, 'Error generating upload URL');
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

/**
 * GET /storage/public-objects/*
 * Serves objects from PUBLIC_OBJECT_SEARCH_PATHS — always public.
 */
router.get('/storage/public-objects/*filePath', async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join('/') : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) { res.status(404).json({ error: 'File not found' }); return; }
    const response = await objectStorageService.downloadObject(file);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    } else { res.end(); }
  } catch (error) {
    req.log.error({ err: error }, 'Error serving public object');
    res.status(500).json({ error: 'Failed to serve public object' });
  }
});

/**
 * GET /storage/objects/*
 * Serves uploaded team photos and other private objects — public read (no auth needed to view).
 */
router.get('/storage/objects/*path', async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join('/') : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    } else { res.end(); }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: 'Object not found' }); return;
    }
    req.log.error({ err: error }, 'Error serving object');
    res.status(500).json({ error: 'Failed to serve object' });
  }
});

export default router;
