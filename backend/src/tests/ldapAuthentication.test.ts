import assert from "node:assert/strict";
import { Client } from "ldapts";
import { ActiveDirectoryService } from "../services/activeDirectoryService.js";
async function run() {
  const original = {
    bind: Client.prototype.bind,
    search: Client.prototype.search,
    unbind: Client.prototype.unbind,
  };
  const previous = process.env.ACTIVE_DIRECTORY_ALLOW_PRIVATE_NETWORKS;
  let filter = "",
    binds: string[] = [],
    entries = [{ dn: "uid=alex,dc=example,dc=com" }];
  Client.prototype.bind = async function (dn: string, password: string) {
    binds.push(dn);
    if (password === "wrong") throw Error("Invalid credentials");
  };
  Client.prototype.search = async function (_base, options) {
    filter = String(options?.filter);
    return { searchEntries: entries, searchReferences: [] };
  } as typeof Client.prototype.search;
  Client.prototype.unbind = async () => {};
  process.env.ACTIVE_DIRECTORY_ALLOW_PRIVATE_NETWORKS = "true";
  const settings = {
    activeDirectoryEnabled: true,
    activeDirectoryUrl: "ldaps://directory.example.com:636",
    activeDirectoryBaseDn: "dc=example,dc=com",
    activeDirectoryBindDn: "cn=service,dc=example,dc=com",
    activeDirectoryBindPasswordEncrypted: "local-fixture-only",
    ldapDirectoryType: "ldap",
  };
  try {
    assert.equal(
      await ActiveDirectoryService.authenticate(
        settings,
        "alex@example.com",
        "correct",
        "org-test",
      ),
      true,
    );
    assert.match(filter, /objectClass=inetOrgPerson/);
    assert.match(filter, /mail=alex@example.com/);
    assert.equal(binds.length, 2);
    assert.equal(
      await ActiveDirectoryService.authenticate(
        settings,
        "alex@example.com",
        "wrong",
        "org-test",
      ),
      false,
    );
    await ActiveDirectoryService.authenticate(
      settings,
      "*)(uid=*)",
      "correct",
      "org-test",
    );
    assert.ok(!filter.includes("(uid=*)"));
    entries = [];
    assert.equal(
      await ActiveDirectoryService.authenticate(
        settings,
        "alex",
        "correct",
        "org-test",
      ),
      false,
    );
    entries = [{ dn: "first" }, { dn: "second" }];
    assert.equal(
      await ActiveDirectoryService.authenticate(
        settings,
        "alex",
        "correct",
        "org-test",
      ),
      false,
    );
    settings.ldapDirectoryType = "ad";
    await ActiveDirectoryService.authenticate(
      settings,
      "alex",
      "correct",
      "org-test",
    );
    assert.match(filter, /userAccountControl/);
    assert.equal(
      await ActiveDirectoryService.authenticate(
        { ...settings, activeDirectoryEnabled: false },
        "alex",
        "correct",
        "org-test",
      ),
      false,
    );
    console.log(
      "LDAP bind, filter injection, ambiguous users and AD compatibility: 10 cases passed",
    );
  } finally {
    Object.assign(Client.prototype, original);
    if (previous === undefined)
      delete process.env.ACTIVE_DIRECTORY_ALLOW_PRIVATE_NETWORKS;
    else process.env.ACTIVE_DIRECTORY_ALLOW_PRIVATE_NETWORKS = previous;
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
