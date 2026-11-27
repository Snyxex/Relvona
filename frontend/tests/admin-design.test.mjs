import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../src/", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("admin primitives are shared and have semantic statuses", () => {
  const source = read("components/admin/admin-ui.tsx");
  for (const component of [
    "AdminPage",
    "AdminHeader",
    "AdminPanel",
    "AdminButton",
    "AdminNotice",
    "AdminEmpty",
    "AdminBadge",
  ]) {
    assert.ok(
      source.includes("export function " + component),
      "shared component missing: " + component,
    );
  }
  assert.ok(source.includes('tone === "error" ? "alert" : "status"'));
  assert.ok(source.includes('type = "button"'));
});

const migrated = {
  "admin/platform-security/page.tsx": ["/platform-admin/security-settings"],
  "admin/notifications/page.tsx": ["/notifications/settings"],
  "admin/actions/page.tsx": ["/tools/executions"],
  "admin/support-teams/page.tsx": [
    "/support-teams",
    "/admin/employees",
    "/support-teams/sla-escalations",
  ],
};

for (const [path, endpoints] of Object.entries(migrated)) {
  test(path + " uses unified admin components and preserves API wiring", () => {
    const source = read("app/" + path);
    assert.ok(source.includes("@/components/admin/admin-ui"));
    for (const component of ["AdminPage", "AdminHeader", "AdminPanel"]) {
      assert.ok(source.includes("<" + component), component + " missing");
    }
    assert.ok(!source.includes("bg-slate-950"), "legacy dark surface remains");
    for (const endpoint of endpoints) {
      assert.ok(source.includes(endpoint), "missing API endpoint: " + endpoint);
    }
  });
}
