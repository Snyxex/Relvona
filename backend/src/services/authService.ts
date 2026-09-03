import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db } from "../db/index.js";
import { users, organizations, organizationMembers, assistants, knowledgeBases } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { generateToken } from "../middleware/auth.js";
import { setDatabaseTenant } from "../db/tenantContext.js";

export class AuthService {
  static async registerUser(data: { name: string; email: string; password: string; orgName: string }) {
    const existingUser = await db.select().from(users).where(eq(users.email, data.email.toLowerCase().trim())).limit(1);
    if (existingUser.length > 0) {
      throw new Error("Email address already registered");
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(data.password, salt);

    // 1. Create User
    const [newUser] = await db.insert(users).values({
      name: data.name,
      email: data.email.toLowerCase().trim(),
      passwordHash,
    }).returning();

    // 2. Create Default Organization
    const slug = data.orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + crypto.randomBytes(2).toString("hex");
    const [newOrg] = await db.insert(organizations).values({
      name: data.orgName,
      slug,
    }).returning();

    // 3. Link User as Organization Owner
    await db.insert(organizationMembers).values({
      organizationId: newOrg.id,
      userId: newUser.id,
      role: "owner",
    });

    // The organization has just been created. Bind it before writing any
    // tenant-owned rows so PostgreSQL RLS accepts only this new tenant.
    setDatabaseTenant(newOrg.id);

    // 4. Create Default AI Assistant for Organization
    await db.insert(assistants).values({
      organizationId: newOrg.id,
      name: `${data.orgName} Support AI`,
      welcomeMessage: `Welcome to ${data.orgName}! How can we assist you today?`,
      widgetApiKey: `wpk_${crypto.randomBytes(24).toString("base64url")}`,
    });

    // 5. Create Default Knowledge Base
    await db.insert(knowledgeBases).values({
      organizationId: newOrg.id,
      name: "General Knowledge",
      description: "Default knowledge base for public documentation and FAQs",
    });

    const token = generateToken({ userId: newUser.id, email: newUser.email, systemRole: newUser.systemRole, tokenVersion: newUser.tokenVersion });

    return {
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        avatarUrl: newUser.avatarUrl,
        preferredLanguage: newUser.preferredLanguage,
        systemRole: newUser.systemRole,
      },
      organization: {
        id: newOrg.id,
        name: newOrg.name,
        slug: newOrg.slug,
        role: "owner",
      },
      token,
    };
  }

  static async loginUser(data: { email: string; password: string }) {
    const [user] = await db.select().from(users).where(eq(users.email, data.email.toLowerCase().trim())).limit(1);
    if (!user) {
      throw new Error("Invalid email or password");
    }

    const isMatch = await bcrypt.compare(data.password, user.passwordHash);
    if (!isMatch) {
      throw new Error("Invalid email or password");
    }

    // Get user memberships
    const memberships = await db
      .select({
        org: organizations,
        member: organizationMembers,
      })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
      .where(eq(organizationMembers.userId, user.id));

    const token = generateToken({ userId: user.id, email: user.email, systemRole: user.systemRole, tokenVersion: user.tokenVersion });

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        preferredLanguage: user.preferredLanguage,
        systemRole: user.systemRole,
      },
      organizations: memberships.map((m) => ({
        id: m.org.id,
        name: m.org.name,
        slug: m.org.slug,
        role: m.member.role,
      })),
      token,
    };
  }
}
