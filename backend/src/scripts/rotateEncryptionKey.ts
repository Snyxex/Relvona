import pg from "pg";
import { reencryptSecret } from "../utils/crypto.js";

async function rotate() {
  const url = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_ADMIN_URL is required for cross-tenant key rotation");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  let rotated = 0;
  try {
    await client.query("BEGIN");
    const assistantRows = (await client.query("SELECT id, api_key, embedding_api_key FROM assistants")).rows;
    const settingsRows = (await client.query("SELECT id, openai_key_encrypted, nvidia_key_encrypted FROM organization_settings")).rows;
    for (const assistant of assistantRows) {
      const apiKey = reencryptSecret(assistant.api_key);
      const embeddingApiKey = reencryptSecret(assistant.embedding_api_key);
      if (apiKey !== assistant.api_key || embeddingApiKey !== assistant.embedding_api_key) {
        await client.query("UPDATE assistants SET api_key = $1, embedding_api_key = $2, updated_at = NOW() WHERE id = $3", [apiKey, embeddingApiKey, assistant.id]);
        rotated++;
      }
    }
    for (const settings of settingsRows) {
      const openaiKeyEncrypted = reencryptSecret(settings.openai_key_encrypted);
      const nvidiaKeyEncrypted = reencryptSecret(settings.nvidia_key_encrypted);
      if (openaiKeyEncrypted !== settings.openai_key_encrypted || nvidiaKeyEncrypted !== settings.nvidia_key_encrypted) {
        await client.query("UPDATE organization_settings SET openai_key_encrypted = $1, nvidia_key_encrypted = $2, updated_at = NOW() WHERE id = $3", [openaiKeyEncrypted, nvidiaKeyEncrypted, settings.id]);
        rotated++;
      }
    }
    await client.query("COMMIT");
    console.log(`Re-encrypted ${rotated} record(s) with the active encryption key.`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { await client.end(); }
}

rotate().catch((error) => { console.error("Encryption key rotation failed:", error); process.exit(1); });
