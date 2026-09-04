import crypto from "crypto";

type WidgetSession = {
  assistantId: string;
  conversationId: string;
  organizationId: string;
  expiresAt: number;
};

const currentSecret = process.env.JWT_SECRET_CURRENT || process.env.JWT_SECRET;
const previousSecret = process.env.JWT_SECRET_PREVIOUS;

function signingSecrets(): string[] {
  if (currentSecret) return [currentSecret, previousSecret].filter((value): value is string => Boolean(value));
  if (process.env.NODE_ENV === "production") throw new Error("JWT_SECRET_CURRENT is required for widget sessions");
  return ["development-only-widget-session-secret-do-not-use-in-production"];
}

function signature(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createWidgetSessionToken(data: Omit<WidgetSession, "expiresAt">): string {
  const payload = Buffer.from(JSON.stringify({ ...data, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 })).toString("base64url");
  return `${payload}.${signature(payload, signingSecrets()[0])}`;
}

export function verifyWidgetSessionToken(token: unknown, expected: Omit<WidgetSession, "expiresAt">): boolean {
  if (typeof token !== "string") return false;
  const [payload, receivedSignature, extra] = token.split(".");
  if (!payload || !receivedSignature || extra) return false;

  const validSignature = signingSecrets().some((secret) => {
    const expectedSignature = signature(payload, secret);
    return receivedSignature.length === expectedSignature.length && crypto.timingSafeEqual(Buffer.from(receivedSignature), Buffer.from(expectedSignature));
  });
  if (!validSignature) return false;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as WidgetSession;
    return parsed.assistantId === expected.assistantId
      && parsed.conversationId === expected.conversationId
      && parsed.organizationId === expected.organizationId
      && Number.isSafeInteger(parsed.expiresAt)
      && parsed.expiresAt > Date.now();
  } catch {
    return false;
  }
}
