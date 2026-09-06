import { pool } from "@workspace/db";
import type { NextFunction, Request, Response } from "express";

export const REPLIT_AUTH_SESSION_COOKIE = "sid";

interface ReplitAuthUser {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
}

declare global {
  namespace Express {
    interface User extends ReplitAuthUser {}

    interface Request {
      isAuthenticated(): boolean;
      user?: User;
    }
  }
}

export async function replitAuthSessionMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  req.isAuthenticated = function () {
    return this.user != null;
  };

  const sessionId = req.cookies?.[REPLIT_AUTH_SESSION_COOKIE];
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    next();
    return;
  }

  try {
    const result = await pool.query<{
      sess: { user?: ReplitAuthUser };
    }>(
      `SELECT sess
         FROM sessions
        WHERE sid = $1
          AND expire > NOW()
        LIMIT 1`,
      [sessionId],
    );
    const user = result.rows[0]?.sess?.user;
    if (user?.id) {
      req.user = user;
    }
  } catch (error) {
    req.log?.warn({ err: error }, "Unable to load optional Replit Auth session");
  }

  next();
}