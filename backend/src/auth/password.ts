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
