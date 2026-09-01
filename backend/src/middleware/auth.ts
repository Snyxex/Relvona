import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db } from "../db/index.js";
import { users, organizationMembers, organizations, apiKeys } from "../db/schema.js";
import { eq, and } from "drizzle-orm";

const JWT_SECRET = process.env.JWT_SECRET;
if (process.env.NODE_ENV === "production" && !JWT_SECRET) {
  throw new Error("JWT_SECRET must be configured in production");
}
const jwtSecret = JWT_SECRET || "development-only-jwt-secret-do-not-use-in-production";

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    systemRole: string;
  };
  organization?: {
    id: string;
    name: string;
    slug: string;
    role: string;
  };
}

export function generateToken(payload: { userId: string; email: string; systemRole: string }) {
  return jwt.sign(payload, jwtSecret, { expiresIn: "7d" });
}

export function verifyToken(token: string) {
  return jwt.verify(token, jwtSecret) as { userId: string; email: string; systemRole: string };
}

// Middleware: Authenticate User JWT
export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing or invalid authorization token" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = verifyToken(token);

    const [user] = await db.select().from(users).where(eq(users.id, decoded.userId)).limit(1);
    if (!user) {
      return res.status(401).json({ error: "User no longer exists" });
    }

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      systemRole: user.systemRole,
    };

    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Middleware: Require Tenant Context & Resolve Role
export async function tenantContext(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required before context selection" });
    }

    const orgId = req.headers["x-organization-id"] as string;
    const orgSlug = req.headers["x-organization-slug"] as string;

    if (!orgId && !orgSlug) {
      // Find first organization user belongs to
      const [firstMembership] = await db
        .select({
          org: organizations,
          member: organizationMembers,
        })
        .from(organizationMembers)
        .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
        .where(eq(organizationMembers.userId, req.user.id))
        .limit(1);

      if (!firstMembership) {
        return res.status(403).json({ error: "User does not belong to any organization" });
      }

      req.organization = {
        id: firstMembership.org.id,
        name: firstMembership.org.name,
        slug: firstMembership.org.slug,
        role: firstMembership.member.role,
      };

      return next();
    }

    // Resolve requested org
    let targetOrgId = orgId;
    if (!targetOrgId && orgSlug) {
      const [foundOrg] = await db.select().from(organizations).where(eq(organizations.slug, orgSlug)).limit(1);
      if (foundOrg) targetOrgId = foundOrg.id;
    }

    if (!targetOrgId) {
      return res.status(404).json({ error: "Specified organization not found" });
    }

    const [membership] = await db
      .select({
        org: organizations,
        member: organizationMembers,
      })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
      .where(
        and(
          eq(organizationMembers.organizationId, targetOrgId),
          eq(organizationMembers.userId, req.user.id)
        )
      )
      .limit(1);

    if (!membership) {
      return res.status(403).json({ error: "Access denied: User is not a member of this organization" });
    }

    req.organization = {
      id: membership.org.id,
      name: membership.org.name,
      slug: membership.org.slug,
      role: membership.member.role,
    };

    next();
  } catch (error) {
    return res.status(500).json({ error: "Failed to resolve tenant context", details: (error as Error).message });
  }
}

// Middleware: Role-Based Access Control (RBAC)
export function requireRole(allowedRoles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.organization) {
      return res.status(403).json({ error: "Organization context missing" });
    }

    if (!allowedRoles.includes(req.organization.role) && req.user?.systemRole !== "superadmin") {
      return res.status(403).json({ error: `Insufficient permissions. Required role: ${allowedRoles.join(" or ")}` });
    }

    next();
  };
}

// Middleware: API Key Authentication (for external integrations)
export async function authenticateApiKey(req: AuthRequest, res: Response, next: NextFunction) {
  const apiKeyHeader = req.headers["x-api-key"] as string;
  if (!apiKeyHeader) {
    return res.status(401).json({ error: "Missing API Key" });
  }

  const [org] = await db.select().from(organizations).where(eq(organizations.apiKey, apiKeyHeader)).limit(1);
  if (!org) {
    return res.status(401).json({ error: "Invalid API Key" });
  }

  req.organization = {
    id: org.id,
    name: org.name,
    slug: org.slug,
    role: "admin",
  };

  next();
}
