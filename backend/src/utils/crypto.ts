import crypto from "crypto";

const ENCRYPTION_KEY = process.env.ENCRYPTION_SECRET
  ? crypto.scryptSync(process.env.ENCRYPTION_SECRET, "salt", 32)
  : crypto.scryptSync("default-production-encryption-secret-key-32bytes!", "salt", 32);

const ALGORITHM = "aes-256-gcm";

// Encrypt secret text (e.g., API keys) before storing in DB
export function encryptSecret(text: string | null | undefined): string | null {
  if (!text) return null;
  if (text.startsWith("enc:")) return text; // already encrypted

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag().toString("hex");

  return `enc:${iv.toString("hex")}:${authTag}:${encrypted}`;
}

// Decrypt secret text server-side when needed
export function decryptSecret(encryptedText: string | null | undefined): string | null {
  if (!encryptedText) return null;
  if (!encryptedText.startsWith("enc:")) return encryptedText; // unencrypted legacy key

  try {
    const parts = encryptedText.split(":");
    if (parts.length !== 4) return encryptedText;

    const iv = Buffer.from(parts[1], "hex");
    const authTag = Buffer.from(parts[2], "hex");
    const encrypted = parts[3];

    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch (error) {
    console.error("Failed to decrypt secret:", (error as Error).message);
    return null;
  }
}
