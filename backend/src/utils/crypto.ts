import crypto from "crypto";

if (process.env.NODE_ENV === "production" && !(process.env.ENCRYPTION_SECRET_CURRENT || process.env.ENCRYPTION_SECRET)) {
  throw new Error("ENCRYPTION_SECRET_CURRENT must be injected in production");
}
const ALGORITHM = "aes-256-gcm";
const currentSecret = process.env.ENCRYPTION_SECRET_CURRENT || process.env.ENCRYPTION_SECRET;
const currentKeyId = process.env.ENCRYPTION_KEY_ID || "v1";
const previousSecret = process.env.ENCRYPTION_SECRET_PREVIOUS;
const previousKeyId = process.env.ENCRYPTION_PREVIOUS_KEY_ID || "previous";
const deriveKey = (secret: string) => crypto.scryptSync(secret, "support-ai/provider-key-encryption", 32);
const deriveLegacyKey = (secret: string) => crypto.scryptSync(secret, "salt", 32);

function keyFor(keyId: string): Buffer | null {
  if (keyId === currentKeyId && currentSecret) return deriveKey(currentSecret);
  if (keyId === previousKeyId && previousSecret) return deriveKey(previousSecret);
  return null;
}

function activeKey() {
  return currentSecret ? deriveKey(currentSecret) : deriveKey("development-only-encryption-secret");
}

// Encrypt secret text (e.g., API keys) before storing in DB
export function encryptSecret(text: string | null | undefined): string | null {
  if (!text) return null;
  if (text.startsWith("enc:")) return text; // already encrypted

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, activeKey(), iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag().toString("hex");

  return `enc:${currentKeyId}:${iv.toString("hex")}:${authTag}:${encrypted}`;
}

// Decrypt secret text server-side when needed
export function decryptSecret(encryptedText: string | null | undefined): string | null {
  if (!encryptedText) return null;
  if (!encryptedText.startsWith("enc:")) return encryptedText; // unencrypted legacy key

  try {
    const parts = encryptedText.split(":");
    const isVersioned = parts.length === 5;
    if (!isVersioned && parts.length !== 4) return null;
    // The original format used the fixed "salt" KDF salt. Keep this branch only
    // for migration, then remove it after all values have been re-encrypted.
    const iv = Buffer.from(parts[isVersioned ? 2 : 1], "hex");
    const authTag = Buffer.from(parts[isVersioned ? 3 : 2], "hex");
    const encrypted = parts[isVersioned ? 4 : 3];
    const candidates = isVersioned
      ? [keyFor(parts[1])].filter((key): key is Buffer => Boolean(key))
      : [currentSecret, previousSecret].filter((secret): secret is string => Boolean(secret)).map(deriveLegacyKey);
    if (candidates.length === 0) candidates.push(deriveLegacyKey("development-only-encryption-secret"));
    for (const key of candidates) {
      try {
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encrypted, "hex", "utf8");
        decrypted += decipher.final("utf8");
        return decrypted;
      } catch { /* try the previous rotation key */ }
    }
    return null;
  } catch (error) {
    console.error("Failed to decrypt secret:", (error as Error).message);
    return null;
  }
}

/** Re-encrypt a legacy or previous-key value with the active key version. */
export function reencryptSecret(encryptedText: string | null | undefined): string | null {
  const plaintext = decryptSecret(encryptedText);
  return plaintext === null ? null : encryptSecret(plaintext);
}
