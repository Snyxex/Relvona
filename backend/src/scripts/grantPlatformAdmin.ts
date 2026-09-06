import { eq } from "drizzle-orm";
import { db, closeDatabasePool } from "../db/index.js";
import { users } from "../db/schema.js";

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error("Usage: node dist/scripts/grantPlatformAdmin.js <existing-user-email>");
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) throw new Error("User not found. Register the account first.");
  await db.update(users).set({ systemRole: "superadmin", tokenVersion: user.tokenVersion + 1, updatedAt: new Date() }).where(eq(users.id, user.id));
  console.log("Platform administrator granted. Sign in again to continue.");
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(closeDatabasePool);
