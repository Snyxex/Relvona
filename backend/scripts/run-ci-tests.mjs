import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const groups = {
  unit: [
    "activeDirectoryService.test.ts",
    "bookingAccess.test.ts",
    "conversationLifecycle.test.ts",
    "errorResponses.test.ts",
    "githubIssueService.test.ts",
    "knowledgeRetrievalTriggerShape.test.ts",
    "objectStorage.test.ts",
    "objectStorageConfig.test.ts",
    "profileAvatar.test.ts",
    "schedulingAudit.test.ts",
    "schedulingLanguage.test.ts",
    "storageQuota.test.ts",
    "userTheme.test.ts",
  ],
  ai: [
    "ingestion.test.ts",
    "streaming.test.ts",
    "toolRegistry.test.ts",
  ],
  security: [
    "security.test.ts",
    "untrustedContext.test.ts",
  ],
  integration: [
    "actionApprovalSeparation.integration.test.ts",
    "assistantKnowledgeScope.integration.test.ts",
    "assistantVersions.integration.test.ts",
    "authorizationMiddleware.test.ts",
    "authRegression.integration.test.ts",
    "calendarReconciliation.integration.test.ts",
    "conversationAutoClose.integration.test.ts",
    "customerPortalMagicLink.integration.test.ts",
    "customerToolIsolation.integration.test.ts",
    "databaseTenantContext.test.ts",
    "ingestion.integration.test.ts",
    "integrationConnections.integration.test.ts",
    "integrationInbound.integration.test.ts",
    "integrationSync.integration.test.ts",
    "knowledgeCollections.integration.test.ts",
    "knowledgeGapDiscovery.integration.test.ts",
    "knowledgeIntelligence.integration.test.ts",
    "knowledgePublicationRls.integration.test.ts",
    "knowledgeRecrawlChangeDetection.integration.test.ts",
    "knowledgeRecrawlScheduling.integration.test.ts",
    "knowledgeRetrievalTracking.integration.test.ts",
    "knowledgeRevisionHistory.integration.test.ts",
    "platformAdmin.test.ts",
    "rustfs.integration.test.ts",
    "schedulingConcurrency.integration.test.ts",
    "tenantIsolation.integration.test.ts",
    "webhookOutbox.integration.test.ts",
  ],
};

const selectedGroup = process.argv[2];
assert.ok(selectedGroup === "all" || Object.hasOwn(groups, selectedGroup), `Unknown CI test group: ${selectedGroup ?? "<missing>"}`);

const assigned = Object.values(groups).flat();
assert.equal(new Set(assigned).size, assigned.length, "A test file is assigned to more than one CI group");

const discovered = readdirSync(new URL("../src/tests/", import.meta.url))
  .filter((name) => name.endsWith(".test.ts") && name !== "pipexImport.test.ts")
  .sort();
assert.deepEqual([...assigned].sort(), discovered, "Every backend test must be assigned to exactly one CI group");

const groupNames = selectedGroup === "all" ? Object.keys(groups) : [selectedGroup];
for (const groupName of groupNames) {
  for (const testFile of groups[groupName]) {
    console.log(`\n[${groupName}] ${testFile}`);
    const compiledTest = `dist/tests/${testFile.replace(/\.ts$/, ".js")}`;
    const result = spawnSync(process.execPath, [compiledTest], {
      cwd: new URL("../", import.meta.url),
      env: process.env,
      stdio: "inherit",
      timeout: groupName === "integration" ? 90_000 : 30_000,
    });
    if (result.error) throw new Error(`${groupName}/${testFile} failed to complete`, { cause: result.error });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
