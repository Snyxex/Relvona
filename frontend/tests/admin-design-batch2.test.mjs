import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = (path) =>
  readFileSync(new URL("../src/app/admin/" + path, import.meta.url), "utf8");

const routes = [
  {
    path: "answer-quality/page.tsx",
    endpoints: ["/knowledge-intelligence/answer-quality/preview"],
    actions: ["inspect()", "toggleSource(id: string)"],
  },
  {
    path: "mail-server/page.tsx",
    endpoints: ["/admin/mail-server", "/admin/mail-server/test"],
    actions: ["async function save()", "async function testConnection()"],
  },
];

for (const page of routes) {
  test("unified admin page: " + page.path, () => {
    const content = source(page.path);
    assert.ok(content.includes('from "@/components/admin/admin-ui"'));
    assert.ok(content.includes("<AdminPage"));
    assert.ok(content.includes("<AdminHeader"));
    assert.ok(content.includes("<AdminPanel"));
    assert.ok(content.includes("<AdminButton"));
    assert.ok(content.includes('AdminNotice tone="error"'));
    assert.ok(!content.includes("bg-slate-950"));
    for (const endpoint of page.endpoints) {
      assert.ok(content.includes(endpoint), "missing endpoint " + endpoint);
    }
    for (const action of page.actions) {
      assert.ok(content.includes(action), "missing action " + action);
    }
  });
}
