import { closeDatabasePool } from "../db/index.js";
import { grantPlatformAdministrator } from "../services/platformAdminGrantService.js";

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error("Usage: node dist/scripts/grantPlatformAdmin.js <existing-user-email>");
  const result = await grantPlatformAdministrator(email);
  console.log(result.granted
    ? "Platform administrator granted. Existing sessions revoked; sign in again."
    : "Platform administrator role already exists; no change required.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Platform administrator grant failed");
  process.exitCode = 1;
}).finally(closeDatabasePool);
