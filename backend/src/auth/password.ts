import bcrypt from "bcryptjs";

/**
 * The users.password_hash column is retained temporarily for a safe rolling
 * migration only. It must never contain a real credential after migration.
 */
export const LEGACY_PASSWORD_SENTINEL = "!better-auth-managed!";

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(hash: string, password: string) {
  return bcrypt.compare(password, hash);
}


/**
 * NIST-inspired minimum for password-only authentication. This applies to
 * newly created/changed credentials, not existing logins during migration.
 */
export const NEW_PASSWORD_MIN_LENGTH = 15;
export const NEW_PASSWORD_MAX_LENGTH = 128;

export function requireNewPasswordPolicy(password: unknown): asserts password is string {
  if (typeof password !== "string" ||
      [...password].length < NEW_PASSWORD_MIN_LENGTH ||
      [...password].length > NEW_PASSWORD_MAX_LENGTH) {
    throw new Error("INVALID_PASSWORD_POLICY");
  }
}
