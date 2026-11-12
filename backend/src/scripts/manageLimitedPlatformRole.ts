import { closeDatabasePool } from "../db/index.js";
import { isLimitedPlatformRole } from "../services/platformRbac.js";
import { grantLimitedPlatformRole, revokeLimitedPlatformRole } from "../services/platformRoleManagementService.js";

async function main() {
  const [command, email, role] = process.argv.slice(2);
  if (command === "grant" && email && isLimitedPlatformRole(role)) {
    const result = await grantLimitedPlatformRole(email, role);
    console.log(result.changed ? "Limited platform role granted; sessions revoked." : "Role already assigned.");
    return;
  }
  if (command === "revoke" && email && !role) {
    const result = await revokeLimitedPlatformRole(email);
    console.log(result.changed ? "Limited platform role revoked; sessions revoked." : "No limited platform role assigned.");
    return;
  }
  throw new Error("Usage: manageLimitedPlatformRole.js grant <email> PLATFORM_SUPPORT|PLATFORM_AUDITOR | revoke <email>");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Platform role operation failed");
  process.exitCode = 1;
}).finally(closeDatabasePool);
