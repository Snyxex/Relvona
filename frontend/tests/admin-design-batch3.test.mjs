import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = (path) =>
  readFileSync(new URL("../src/app/admin/" + path, import.meta.url), "utf8");

const pages = [
  {
    route: "analytics/page.tsx",
    endpoints: [
      "/analytics/support?days=",
      "/analytics/knowledge-gaps?limit=100",
      "/analytics/knowledge-gaps/discover",
      "/analytics/knowledge-gaps/",
    ],
    actions: [
      "async function createGap(",
      "async function discoverGaps()",
      "async function setStatus(",
    ],
  },
  {
    route: "agents/page.tsx",
    endpoints: [
      "/assistants",
      "/versions",
      "/activate",
      "/playground",
    ],
    actions: [
      "async function publish(",
      "async function activate(",
      "async function runPlayground(",
      "window.confirm(",
    ],
  },
];

for (const page of pages) {
  test("admin design batch 3: " + page.route, () => {
    const content = source(page.route);
    assert.ok(content.includes('from "@/components/admin/admin-ui"'));
    for (const component of [
      "AdminPage",
      "AdminHeader",
      "AdminPanel",
      "AdminButton",
      "AdminNotice",
    ]) {
      assert.ok(content.includes("<" + component), "missing " + component);
    }
    assert.ok(!content.includes("bg-slate-950"));
    for (const endpoint of page.endpoints) {
      assert.ok(content.includes(endpoint), "missing endpoint: " + endpoint);
    }
    for (const action of page.actions) {
      assert.ok(content.includes(action), "missing operation: " + action);
    }
  });
}
