import { createHash, randomBytes } from "node:crypto";

/** RFC 7636: 32 random bytes encoded as base64url = 43-character high-entropy verifier. */
export function createEntraPkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: pkceS256Challenge(verifier), method: "S256" as const };
}

export function pkceS256Challenge(verifier: string): string {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) {
    throw new Error("Invalid PKCE verifier");
  }
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}
