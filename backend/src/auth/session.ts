import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "./betterAuth.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";

export type AuthenticatedUser = { id: string; email: string; name: string; avatarUrl: string | null; preferredLanguage: string; systemRole: string; status: string };

export async function getCurrentUser(request: Pick<Request, "headers">): Promise<AuthenticatedUser | null> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  if (!session?.user?.id) return null;
  const [user] = await db.select().from(users).where(eq(users.id, session.user.id)).limit(1);
  if (!user || user.status !== "active") return null;
  return { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl, preferredLanguage: user.preferredLanguage, systemRole: user.systemRole, status: user.status };
}

export async function requireAuth(request: Request, response: Response, next: NextFunction) {
  try {
    const user = await getCurrentUser(request);
    if (!user) return response.status(401).json({ error: "Authentication required" });
    (request as Request & { user?: AuthenticatedUser }).user = user;
    next();
  } catch { return response.status(401).json({ error: "Authentication required" }); }
}
