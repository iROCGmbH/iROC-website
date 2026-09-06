import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { File, Storage } from '@google-cloud/storage';

import {
  canAccessObject,
  getObjectAclPolicy,
  ObjectAclPolicy,
  ObjectPermission,
  setObjectAclPolicy,
} from './objectAcl';

const REPLIT_SIDECAR_ENDPOINT = 'http://127.0.0.1:1106';

export const objectStorageClient = new Storage({
  credentials: {
    audience: 'replit',
    subject_token_type: 'access_token',
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: 'external_account',
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: 'json',
        subject_token_field_name: 'access_token',
      },
    },
    universe_domain: 'googleapis.com',
  },
  projectId: '',
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super('Object not found');
    this.name = 'ObjectNotFoundError';
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || '';
    const paths = Array.from(
      new Set(
        pathsStr
          .split(',')
          .map((path) => path.trim())
          .filter((path) => path.length > 0),
      ),
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          'tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths).',
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || '';
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          'tool and set PRIVATE_OBJECT_DIR env var.',
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  async downloadObject(
    file: File,
    cacheTtlSec: number = 3600,
  ): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const aclPolicy = await getObjectAclPolicy(file);
    const isPublic = aclPolicy?.visibility === 'public';

    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      'Content-Type':
        (metadata.contentType as string) || 'application/octet-stream',
      'Cache-Control': `${isPublic ? 'public' : 'private'}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) {
      headers['Content-Length'] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    return this._presignUpload('uploads');
  }

  /**
   * Like getObjectEntityUploadURL() but writes the object under a caller-supplied
   * subdirectory instead of the default "uploads/" prefix.  Use this to create
   * isolated, flow-specific namespaces (e.g. "expense-receipts") so that cleanup
   * endpoints can restrict deletion to a provably owned prefix.
   */
  async getObjectEntityUploadURLWithSubdir(subdir: string): Promise<string> {
    return this._presignUpload(subdir);
  }

  private async _presignUpload(subdir: string): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          'tool and set PRIVATE_OBJECT_DIR env var.',
      );
    }

    // Strip any trailing slash so the interpolation below never produces a
    // double-slash path (e.g. "/bucket/prefix//expense-receipts/<uuid>").
    const normalizedDir = privateObjectDir.endsWith('/')
      ? privateObjectDir.slice(0, -1)
      : privateObjectDir;

    const objectId = randomUUID();
    const fullPath = `${normalizedDir}/${subdir}/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({
      bucketName,
      objectName,
      method: 'PUT',
      ttlSec: 900,
    });
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith('/objects/')) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split('/');
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join('/');
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith('/')) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith('https://storage.googleapis.com/')) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith('/')) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith('/')) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  /**
   * Deletes an object from storage given a path like `/objects/<entityId>`.
   * Skips the existence pre-check so concurrent deletes are both idempotent:
   * GCS 404 during delete is treated as success rather than an error.
   */
  async deleteObjectEntity(objectPath: string): Promise<void> {
    if (!objectPath.startsWith('/objects/')) {
      throw new ObjectNotFoundError();
    }
    const parts = objectPath.slice(1).split('/');
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }
    const entityId = parts.slice(1).join('/');
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith('/')) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    try {
      await objectFile.delete();
    } catch (err: unknown) {
      // GCS returns code 404 when the object is already gone — treat as success (idempotent).
      if ((err as { code?: number }).code === 404) return;
      throw err;
    }
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }

  /**
   * List all GCS File objects stored under a caller-supplied subdirectory of
   * PRIVATE_OBJECT_DIR (e.g. "expense-receipts").  Returns each file together
   * with its canonical /objects/… path so callers can cross-reference the DB.
   */
  async listFilesInSubdir(
    subdir: string,
  ): Promise<Array<{ file: File; normalizedPath: string }>> {
    const { bucketName, gcsPrefix, fileNameToNormalizedPath } =
      _computeSubdirListParams(this.getPrivateObjectDir(), subdir);

    const bucket = objectStorageClient.bucket(bucketName);
    const [files] = await bucket.getFiles({ prefix: gcsPrefix });

    return files.map((file) => ({
      file,
      normalizedPath: fileNameToNormalizedPath(file.name),
    }));
  }
}

/**
 * Exported only for unit-testing.
 *
 * Computes the GCS bucket name, the list prefix, and a converter from a raw
 * GCS file.name back to the canonical "/objects/…" DB path — all without
 * making any network calls.  Keeping this logic as a pure function lets tests
 * verify all PRIVATE_OBJECT_DIR shapes:
 *   "/bucket"          – root (no subpath)
 *   "/bucket/prefix"   – single-level subpath
 *   "/bucket/l1/l2"    – multi-level subpath
 *   any of the above with a trailing slash
 *
 * We split bucket/prefix ourselves rather than delegating to parseObjectPath
 * because that helper requires at least three path segments and would throw on
 * a bare "/bucket" configuration.
 */
export function _computeSubdirListParams(
  privateDir: string,
  subdir: string,
): {
  bucketName: string;
  /** Prefix to pass to bucket.getFiles({ prefix }) */
  gcsPrefix: string;
  /** Convert a raw GCS file.name to the /objects/… path stored in the DB */
  fileNameToNormalizedPath: (fileName: string) => string;
} {
  // Strip trailing slash so "/bucket/prefix/" and "/bucket/prefix" are identical.
  const cleanDir = privateDir.endsWith('/') ? privateDir.slice(0, -1) : privateDir;
  // Ensure a leading slash then split; remove the leading '' produced by the split.
  const withLeadingSlash = cleanDir.startsWith('/') ? cleanDir : `/${cleanDir}`;
  const parts = withLeadingSlash.split('/').slice(1); // ['bucket'] or ['bucket','prefix',…]
  const bucketName = parts[0];
  const baseObjectName = parts.slice(1).join('/'); // '' for root, 'prefix' or 'l1/l2' otherwise

  // GCS list prefix:
  //   root:    "expense-receipts/"
  //   prefix:  "prefix/expense-receipts/"
  const gcsPrefix = baseObjectName ? `${baseObjectName}/${subdir}/` : `${subdir}/`;

  // Converter from GCS file.name → /objects/… DB path:
  //   "expense-receipts/<uuid>"         → "/objects/expense-receipts/<uuid>"  (root)
  //   "prefix/expense-receipts/<uuid>"  → "/objects/expense-receipts/<uuid>"  (prefixed)
  const fileNameToNormalizedPath = (fileName: string) => {
    const entityId = baseObjectName
      ? fileName.slice(baseObjectName.length + 1) // strip "prefix/"
      : fileName;
    return `/objects/${entityId}`;
  };

  return { bucketName, gcsPrefix, fileNameToNormalizedPath };
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }
  const pathParts = path.split('/');
  if (pathParts.length < 3) {
    throw new Error('Invalid path: must contain at least a bucket name');
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join('/');

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`,
    );
  }

  const { signed_url: signedURL } = (await response.json()) as { signed_url: string };
  return signedURL;
}
