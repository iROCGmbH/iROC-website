import { Router, type IRouter, type Request, type Response } from "express";
import { DoctorLoginBody } from "@workspace/api-zod";
import cookieParser from "cookie-parser";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();
router.use(cookieParser());

const SESSION_COOKIE = "iroc_portal_session";

// Env-var defaults (used when no DB override exists)
const ENV_PASSWORDS: Record<string, string> = {
  spirecut: process.env.SPIRECUT_PORTAL_PASSWORD ?? "spirecut2024",
  ministem: process.env.MINISTEM_PORTAL_PASSWORD ?? "ministem2024",
};

async function getPortalPassword(instrument: string): Promise<string> {
  try {
    const [row] = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, `portal_password_${instrument}`));
    if (row?.value) return row.value;
  } catch {
    // DB unavailable — fall back to env vars
  }
  return ENV_PASSWORDS[instrument] ?? "";
}

router.post("/auth/login", async (req: Request, res: Response) => {
  const parsed = DoctorLoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid login data" });
    return;
  }

  const { instrument, password } = parsed.data;
  const expected = await getPortalPassword(instrument);

  if (!expected || password !== expected) {
    res.status(401).json({ error: "Invalid password" });
    return;
  }

  const sessionData = Buffer.from(JSON.stringify({ instrument, ts: Date.now() })).toString("base64");
  res.cookie(SESSION_COOKIE, sessionData, {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: "lax",
  });

  res.json({ success: true, instrument });
});

router.post("/auth/logout", (_req: Request, res: Response) => {
  res.clearCookie(SESSION_COOKIE);
  res.json({ message: "Logged out" });
});

router.get("/auth/me", (req: Request, res: Response) => {
  const cookie = req.cookies?.[SESSION_COOKIE];
  if (!cookie) {
    res.json({ authenticated: false, instrument: null });
    return;
  }

  try {
    const data = JSON.parse(Buffer.from(cookie, "base64").toString());
    if (data?.instrument) {
      res.json({ authenticated: true, instrument: data.instrument });
      return;
    }
  } catch {
    // ignore
  }

  res.json({ authenticated: false, instrument: null });
});

export default router;
