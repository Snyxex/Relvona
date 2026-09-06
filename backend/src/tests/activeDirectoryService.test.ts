import assert from "node:assert/strict";
import { isValidActiveDirectoryUrl, isValidDistinguishedName } from "../services/activeDirectoryService.js";

assert.equal(isValidActiveDirectoryUrl("ldaps://dc01.example.internal:636"), true);
assert.equal(isValidActiveDirectoryUrl("ldap://dc01.example.internal:389"), false);
assert.equal(isValidActiveDirectoryUrl("ldaps://user:password@dc01.example.internal"), false);
assert.equal(isValidActiveDirectoryUrl("ldaps://dc01.example.internal/path"), false);
assert.equal(isValidDistinguishedName("DC=example,DC=internal"), true);
assert.equal(isValidDistinguishedName("not-a-dn"), false);
console.log("Active Directory configuration validation: 6 cases passed.");
