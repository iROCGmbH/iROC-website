import { Router, type IRouter, type Request, type Response } from "express";
import { db, resourcesTable } from "@workspace/db";
import { ListResourcesQueryParams } from "@workspace/api-zod";
import { eq, or } from "drizzle-orm";
import cookieParser from "cookie-parser";
import { verifyToken } from "./iroc.js";

type ResourceRow = typeof resourcesTable.$inferSelect;
function toDto(r: ResourceRow) {
  return {
    id: r.id,
    title: r.title,
    titleDe: r.titleDe ?? null,
    description: r.description ?? null,
    descriptionDe: r.descriptionDe ?? null,
    type: r.type,
    instrument: r.instrument,
    url: r.url,
    thumbnailUrl: r.thumbnailUrl ?? null,
  };
}

const router: IRouter = Router();
router.use(cookieParser());

const SESSION_COOKIE = "iroc_portal_session";

function getSession(req: Request): { instrument: string } | null {
  const cookie = req.cookies?.[SESSION_COOKIE];
  if (!cookie) return null;
  try {
    const data = JSON.parse(Buffer.from(cookie, "base64").toString());
    return data?.instrument ? data : null;
  } catch {
    return null;
  }
}

/** Returns true when the request carries a valid admin or iROC-app Bearer token. */
function isAdmin(req: Request): boolean {
  const auth = req.headers.authorization ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  const token = auth.slice(7);
  if (token === process.env.ADMIN_PASSWORD) return true;
  if (verifyToken(token) !== null) return true;
  return false;
}

router.get("/resources", async (req: Request, res: Response) => {
  const parsed = ListResourcesQueryParams.safeParse(req.query);

  // Admins (website admin panel or iROC app) see all resources unfiltered.
  if (isAdmin(req)) {
    let query = db.select().from(resourcesTable).$dynamic();
    if (parsed.success && parsed.data.instrument) {
      query = query.where(
        or(
          eq(resourcesTable.instrument, parsed.data.instrument),
          eq(resourcesTable.instrument, "both"),
        ),
      );
    }
    if (parsed.success && parsed.data.type) {
      query = query.where(eq(resourcesTable.type, parsed.data.type));
    }
    res.json((await query).map(toDto));
    return;
  }

  // Portal patients: scope strictly to the session's instrument.
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  // Always scope to the session's instrument — never let the client override this.
  // Resources marked "both" are visible to all authenticated patients.
  let query = db
    .select()
    .from(resourcesTable)
    .where(
      or(
        eq(resourcesTable.instrument, session.instrument),
        eq(resourcesTable.instrument, "both"),
      ),
    )
    .$dynamic();

  // Optional type filter (e.g. "study", "video") from query params is still allowed.
  if (parsed.success && parsed.data.type) {
    query = query.where(eq(resourcesTable.type, parsed.data.type));
  }

  res.json((await query).map(toDto));
});

export default router;
