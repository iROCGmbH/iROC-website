/**
 * Tests for the expense receipt orphan sweep and the path-computation helper
 * that underpins it.
 *
 * We verify two critical properties without making any GCS network calls:
 *
 *  1. `_computeSubdirListParams` produces the correct GCS list prefix and
 *     normalized /objects/… DB path for:
 *       a) a normal prefixed PRIVATE_OBJECT_DIR  ("/mybucket/myprefix")
 *       b) a trailing-slash variant               ("/mybucket/myprefix/")
 *       c) a multi-level prefix                  ("/mybucket/lvl1/lvl2")
 *     (A root "/mybucket"-only config is invalid per parseObjectPath's
 *      minimum-3-parts constraint and is not a supported configuration.)
 *
 *  2. `sweepExpenseOrphans` deletes orphaned files (old, no DB row) and skips
 *     linked files (already saved to iroc_expenses) and young files.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { _computeSubdirListParams } from "./objectStorage.js";

// ── 1. Pure path-computation tests (no mocking needed) ────────────────────────

describe("_computeSubdirListParams — GCS prefix and normalized path derivation", () => {
  describe("prefixed PRIVATE_OBJECT_DIR  (/mybucket/myprefix)", () => {
    it("extracts the correct bucket name", () => {
      const { bucketName } = _computeSubdirListParams("/mybucket/myprefix", "expense-receipts");
      expect(bucketName).toBe("mybucket");
    });

    it("builds the GCS list prefix without double slashes", () => {
      const { gcsPrefix } = _computeSubdirListParams("/mybucket/myprefix", "expense-receipts");
      expect(gcsPrefix).toBe("myprefix/expense-receipts/");
    });

    it("maps a GCS file.name to the canonical /objects/… DB path", () => {
      const uuid = "a1b2c3d4-0000-0000-0000-000000000001";
      const { fileNameToNormalizedPath } = _computeSubdirListParams("/mybucket/myprefix", "expense-receipts");
      expect(fileNameToNormalizedPath(`myprefix/expense-receipts/${uuid}`))
        .toBe(`/objects/expense-receipts/${uuid}`);
    });
  });

  describe("prefixed PRIVATE_OBJECT_DIR with trailing slash  (/mybucket/myprefix/)", () => {
    it("strips the trailing slash — no double slash in GCS prefix", () => {
      const { gcsPrefix } = _computeSubdirListParams("/mybucket/myprefix/", "expense-receipts");
      expect(gcsPrefix).toBe("myprefix/expense-receipts/");
    });

    it("maps a GCS file.name to the canonical /objects/… DB path", () => {
      const uuid = "a1b2c3d4-0000-0000-0000-000000000002";
      const { fileNameToNormalizedPath } = _computeSubdirListParams("/mybucket/myprefix/", "expense-receipts");
      expect(fileNameToNormalizedPath(`myprefix/expense-receipts/${uuid}`))
        .toBe(`/objects/expense-receipts/${uuid}`);
    });
  });

  describe("multi-level prefix  (/mybucket/lvl1/lvl2)", () => {
    it("builds the GCS list prefix preserving the full subpath", () => {
      const { gcsPrefix } = _computeSubdirListParams("/mybucket/lvl1/lvl2", "expense-receipts");
      expect(gcsPrefix).toBe("lvl1/lvl2/expense-receipts/");
    });

    it("maps a GCS file.name to the canonical /objects/… DB path", () => {
      const uuid = "a1b2c3d4-0000-0000-0000-000000000003";
      const { fileNameToNormalizedPath } = _computeSubdirListParams("/mybucket/lvl1/lvl2", "expense-receipts");
      expect(fileNameToNormalizedPath(`lvl1/lvl2/expense-receipts/${uuid}`))
        .toBe(`/objects/expense-receipts/${uuid}`);
    });
  });

  describe("root bucket PRIVATE_OBJECT_DIR  (/mybucket)", () => {
    it("extracts the correct bucket name", () => {
      const { bucketName } = _computeSubdirListParams("/mybucket", "expense-receipts");
      expect(bucketName).toBe("mybucket");
    });

    it("builds the GCS list prefix without any extra slash", () => {
      const { gcsPrefix } = _computeSubdirListParams("/mybucket", "expense-receipts");
      expect(gcsPrefix).toBe("expense-receipts/");
    });

    it("maps a GCS file.name to the canonical /objects/… DB path", () => {
      const uuid = "a1b2c3d4-0000-0000-0000-000000000004";
      const { fileNameToNormalizedPath } = _computeSubdirListParams("/mybucket", "expense-receipts");
      expect(fileNameToNormalizedPath(`expense-receipts/${uuid}`))
        .toBe(`/objects/expense-receipts/${uuid}`);
    });
  });

  describe("root bucket PRIVATE_OBJECT_DIR with trailing slash  (/mybucket/)", () => {
    it("strips the trailing slash — GCS prefix has no double slash", () => {
      const { gcsPrefix } = _computeSubdirListParams("/mybucket/", "expense-receipts");
      expect(gcsPrefix).toBe("expense-receipts/");
    });
  });

  describe("round-trip: upload path produced with trailing-slash dir is found by listFilesInSubdir", () => {
    // _presignUpload strips trailing slashes, so even when PRIVATE_OBJECT_DIR is
    // "/mybucket/myprefix/" the GCS object is stored at "myprefix/expense-receipts/<uuid>".
    // _computeSubdirListParams must list the same prefix so the sweep can find it.
    it("upload path and list prefix both use the slash-normalized form", () => {
      const uuid = "a1b2c3d4-0000-0000-0000-000000000005";

      // Simulate the path that _presignUpload creates (trailing slash stripped):
      const normalizedDir = "/mybucket/myprefix/".replace(/\/$/, "");
      const uploadedGcsObjectName = `myprefix/expense-receipts/${uuid}`;

      // Simulate what _computeSubdirListParams produces for listing:
      const { gcsPrefix, fileNameToNormalizedPath } =
        _computeSubdirListParams("/mybucket/myprefix/", "expense-receipts");

      // The uploaded object name must start with the list prefix.
      expect(uploadedGcsObjectName.startsWith(gcsPrefix)).toBe(true);

      // And the round-trip DB path must be correct.
      expect(fileNameToNormalizedPath(uploadedGcsObjectName))
        .toBe(`/objects/expense-receipts/${uuid}`);

      // Sanity: normalizedDir is the same as what we stripped to compute uploadedGcsObjectName.
      expect(normalizedDir).toBe("/mybucket/myprefix");
    });
  });
});

// ── 2. sweepExpenseOrphans behaviour tests ─────────────────────────────────────
//
// sweepExpenseOrphans accepts an optional storage instance for injection.
// We pass a plain fake object and a mocked DB pool — no GCS network calls.

vi.mock("@workspace/db", () => ({
  pool: { query: vi.fn() },
}));

import { pool } from "@workspace/db";
import { sweepExpenseOrphans } from "./expense-orphan-sweep.js";
import type { ObjectStorageService } from "./objectStorage.js";

const mockPool = pool as unknown as { query: ReturnType<typeof vi.fn> };

/** Creates a minimal fake GCS File object. */
function makeGcsFile(ageMinutes: number) {
  const created = new Date(Date.now() - ageMinutes * 60 * 1000).toISOString();
  return {
    getMetadata: vi.fn().mockResolvedValue([{ timeCreated: created }]),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

/** Builds a fake ObjectStorageService whose listFilesInSubdir returns the given entries. */
function makeStorage(
  entries: Array<{ file: ReturnType<typeof makeGcsFile>; normalizedPath: string }>,
): Pick<ObjectStorageService, "listFilesInSubdir"> {
  return {
    listFilesInSubdir: vi.fn().mockResolvedValue(entries),
  };
}

/**
 * Build a pool.query mock that serves both query shapes the sweep issues:
 *   1. Snapshot (LIKE): returns the full set of linked paths
 *   2. Per-file recheck (= $1): returns a row only if the path is in linkedPaths
 */
function makeQueryMock(linkedPaths: string[]) {
  return vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
    if (String(sql).includes("LIKE")) {
      // Snapshot query — return all linked paths at once
      return Promise.resolve({
        rows: linkedPaths.map((p) => ({ file_object_path: p })),
      });
    }
    // Per-file recheck query — params[0] is the specific path
    const path = params?.[0] as string | undefined;
    const isLinked = path !== undefined && linkedPaths.includes(path);
    return Promise.resolve({ rows: isLinked ? [{ id: 1 }] : [] });
  });
}

describe("sweepExpenseOrphans", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes an old file that has no matching iroc_expenses row", async () => {
    const uuid = "aaaa0000-0000-0000-0000-000000000001";
    const file = makeGcsFile(60); // 60 min old — beyond the 30-min threshold
    const storage = makeStorage([{ file, normalizedPath: `/objects/expense-receipts/${uuid}` }]);
    mockPool.query = makeQueryMock([]);

    const result = await sweepExpenseOrphans(storage);

    expect(file.delete).toHaveBeenCalledOnce();
    expect(result.deleted).toBe(1);
    expect(result.errors).toBe(0);
  });

  it("skips a file that is already linked to an iroc_expenses row", async () => {
    const uuid = "bbbb0000-0000-0000-0000-000000000002";
    const file = makeGcsFile(60);
    const normalizedPath = `/objects/expense-receipts/${uuid}`;
    const storage = makeStorage([{ file, normalizedPath }]);
    mockPool.query = makeQueryMock([normalizedPath]);

    const result = await sweepExpenseOrphans(storage);

    expect(file.delete).not.toHaveBeenCalled();
    expect(result.deleted).toBe(0);
  });

  it("skips a file younger than the orphan age threshold", async () => {
    const uuid = "cccc0000-0000-0000-0000-000000000003";
    const file = makeGcsFile(5); // only 5 min old — under the 30-min threshold
    const storage = makeStorage([{ file, normalizedPath: `/objects/expense-receipts/${uuid}` }]);
    mockPool.query = makeQueryMock([]);

    const result = await sweepExpenseOrphans(storage);

    expect(file.delete).not.toHaveBeenCalled();
    expect(result.deleted).toBe(0);
  });

  it("counts a metadata-read failure in errors and skips the file", async () => {
    const uuid = "ffff0000-0000-0000-0000-000000000006";
    const brokenFile = {
      getMetadata: vi.fn().mockRejectedValue(new Error("GCS error")),
      delete: vi.fn(),
    };
    const storage = makeStorage([{
      file: brokenFile as ReturnType<typeof makeGcsFile>,
      normalizedPath: `/objects/expense-receipts/${uuid}`,
    }]);
    // No aged files reach the DB query; we still provide a safe mock.
    mockPool.query = makeQueryMock([]);

    const result = await sweepExpenseOrphans(storage);

    expect(brokenFile.delete).not.toHaveBeenCalled();
    expect(result.errors).toBe(1);
    expect(result.deleted).toBe(0);
  });

  it("deletes orphaned files and skips linked files in a mixed batch", async () => {
    const orphanUuid = "dddd0000-0000-0000-0000-000000000004";
    const linkedUuid = "eeee0000-0000-0000-0000-000000000005";

    const orphanFile = makeGcsFile(60);
    const linkedFile = makeGcsFile(60);
    const orphanPath = `/objects/expense-receipts/${orphanUuid}`;
    const linkedPath = `/objects/expense-receipts/${linkedUuid}`;

    const storage = makeStorage([
      { file: orphanFile, normalizedPath: orphanPath },
      { file: linkedFile, normalizedPath: linkedPath },
    ]);
    // linkedPath is in DB; orphanPath is not.
    mockPool.query = makeQueryMock([linkedPath]);

    const result = await sweepExpenseOrphans(storage);

    expect(orphanFile.delete).toHaveBeenCalledOnce();
    expect(linkedFile.delete).not.toHaveBeenCalled();
    expect(result.deleted).toBe(1);
    expect(result.scanned).toBe(2);
  });

  it("counts both young and old unlinked files in scanned, but only deletes the old one", async () => {
    const youngUuid = "1111cccc-0000-0000-0000-000000000008";
    const oldUuid   = "2222dddd-0000-0000-0000-000000000009";

    const youngFile = makeGcsFile(5);  // 5 min — under the 30-min threshold
    const oldFile   = makeGcsFile(60); // 60 min — beyond the 30-min threshold

    const storage = makeStorage([
      { file: youngFile, normalizedPath: `/objects/expense-receipts/${youngUuid}` },
      { file: oldFile,   normalizedPath: `/objects/expense-receipts/${oldUuid}` },
    ]);
    // Neither file is linked in the DB.
    mockPool.query = makeQueryMock([]);

    const result = await sweepExpenseOrphans(storage);

    // Both files were seen by the sweep.
    expect(result.scanned).toBe(2);
    // Only the aged file is deleted.
    expect(oldFile.delete).toHaveBeenCalledOnce();
    expect(youngFile.delete).not.toHaveBeenCalled();
    expect(result.deleted).toBe(1);
    expect(result.errors).toBe(0);
  });

  it("counts a delete failure as an error and continues sweeping the next file", async () => {
    const failUuid = "1111eeee-0000-0000-0000-000000000010";
    const okUuid   = "2222ffff-0000-0000-0000-000000000011";

    const failFile = {
      getMetadata: vi.fn().mockResolvedValue([{ timeCreated: new Date(Date.now() - 60 * 60 * 1000).toISOString() }]),
      delete: vi.fn().mockRejectedValue(new Error("GCS delete error")),
    };
    const okFile = makeGcsFile(60);

    const storage = makeStorage([
      { file: failFile as ReturnType<typeof makeGcsFile>, normalizedPath: `/objects/expense-receipts/${failUuid}` },
      { file: okFile,                                     normalizedPath: `/objects/expense-receipts/${okUuid}` },
    ]);
    // Neither file is linked in the DB.
    mockPool.query = makeQueryMock([]);

    const result = await sweepExpenseOrphans(storage);

    // The second file must still be deleted even though the first failed.
    expect(okFile.delete).toHaveBeenCalledOnce();
    // The failed delete is counted as an error, not a crash.
    expect(result.errors).toBe(1);
    expect(result.deleted).toBe(1);
    expect(result.scanned).toBe(2);
  });

  it("counts errors, deleted, and scanned correctly in a mixed batch with a metadata failure", async () => {
    // File A: getMetadata throws — should count as an error, not deleted
    const errorUuid = "aaaa1111-0000-0000-0000-000000000020";
    const errorFile = {
      getMetadata: vi.fn().mockRejectedValue(new Error("GCS metadata error")),
      delete: vi.fn(),
    };

    // File B: old and orphaned — should be deleted
    const oldUuid = "bbbb2222-0000-0000-0000-000000000021";
    const oldFile = makeGcsFile(60); // 60 min old — beyond the 30-min threshold

    // File C: young — should be skipped (not deleted, not an error)
    const youngUuid = "cccc3333-0000-0000-0000-000000000022";
    const youngFile = makeGcsFile(5); // 5 min old — under the 30-min threshold

    const oldPath   = `/objects/expense-receipts/${oldUuid}`;
    const youngPath = `/objects/expense-receipts/${youngUuid}`;
    const errorPath = `/objects/expense-receipts/${errorUuid}`;

    const storage = makeStorage([
      { file: errorFile as ReturnType<typeof makeGcsFile>, normalizedPath: errorPath },
      { file: oldFile,                                      normalizedPath: oldPath },
      { file: youngFile,                                    normalizedPath: youngPath },
    ]);
    // Neither old nor young file is linked in the DB.
    mockPool.query = makeQueryMock([]);

    const result = await sweepExpenseOrphans(storage);

    // All three files were scanned.
    expect(result.scanned).toBe(3);
    // Only the old orphaned file is deleted.
    expect(result.deleted).toBe(1);
    expect(oldFile.delete).toHaveBeenCalledOnce();
    // The metadata failure is counted as an error.
    expect(result.errors).toBe(1);
    // The error file and young file must not be deleted.
    expect(errorFile.delete).not.toHaveBeenCalled();
    expect(youngFile.delete).not.toHaveBeenCalled();
  });

  it("does not delete a file that becomes linked between snapshot and recheck", async () => {
    const uuid = "9999aaaa-0000-0000-0000-000000000007";
    const file = makeGcsFile(60);
    const normalizedPath = `/objects/expense-receipts/${uuid}`;
    const storage = makeStorage([{ file, normalizedPath }]);

    // Snapshot says not linked, but recheck says it is (concurrent save).
    mockPool.query = vi.fn().mockImplementation((sql: string) => {
      if (String(sql).includes("LIKE")) {
        return Promise.resolve({ rows: [] }); // snapshot: not linked yet
      }
      // INSERT INTO settings — ignore
      if (String(sql).includes("INSERT INTO settings")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [{ id: 42 }] }); // recheck: now linked
    });

    const result = await sweepExpenseOrphans(storage);

    expect(file.delete).not.toHaveBeenCalled();
    expect(result.deleted).toBe(0);
  });
});

// ── 3. Settings row persistence ────────────────────────────────────────────────
//
// After a real sweep run the function must write the result into the settings
// table so the admin health panel can display it.  We verify the INSERT is
// issued with the correct key and that the JSON payload matches the actual
// sweep outcome.

describe("sweepExpenseOrphans — settings row persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes scanned=1, deleted=1, errors=0 and a recent last_run to the settings table", async () => {
    const uuid = "a1b2c3d4-1111-1111-1111-000000000001";
    const file = makeGcsFile(60); // 60 min old — qualifies as an orphan
    const storage = makeStorage([{ file, normalizedPath: `/objects/expense-receipts/${uuid}` }]);

    let capturedKey: string | undefined;
    let capturedValue: string | undefined;

    mockPool.query = vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
      const sqlStr = String(sql);
      if (sqlStr.includes("INSERT INTO settings")) {
        // saveSweepStats writes ($1=key, $2=JSON value)
        capturedKey   = params?.[0] as string;
        capturedValue = params?.[1] as string;
        return Promise.resolve({ rows: [] });
      }
      if (sqlStr.includes("LIKE")) {
        // Snapshot query — no linked files
        return Promise.resolve({ rows: [] });
      }
      // Per-file recheck — not linked
      return Promise.resolve({ rows: [] });
    });

    const before = Date.now();
    const result = await sweepExpenseOrphans(storage);
    const after  = Date.now();

    // Return value must reflect the single orphan deletion.
    expect(result.scanned).toBe(1);
    expect(result.deleted).toBe(1);
    expect(result.errors).toBe(0);

    // The settings INSERT must have been issued.
    expect(capturedKey).toBe("expense_orphan_sweep_last_result");
    expect(capturedValue).toBeDefined();

    // The persisted JSON must carry the correct counters.
    const saved = JSON.parse(capturedValue!) as Record<string, unknown>;
    expect(saved.scanned).toBe(1);
    expect(saved.deleted).toBe(1);
    expect(saved.errors).toBe(0);

    // last_run must be a valid ISO timestamp within the test's wall-clock window.
    expect(typeof saved.last_run).toBe("string");
    const lastRunMs = new Date(saved.last_run as string).getTime();
    expect(lastRunMs).toBeGreaterThanOrEqual(before);
    expect(lastRunMs).toBeLessThanOrEqual(after);
  });
});
