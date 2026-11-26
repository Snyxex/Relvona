import assert from "node:assert/strict";
import {
  validateOidcConfiguration,
  validateOidcClaims,
} from "../auth/oidcPolicy.js";
const config = {
  enabled: true,
  label: "Authentik",
  issuer: "https://id.example.com/application/o/relvona/",
  clientId: "relvona",
  allowedDomains: ["example.com"],
};
assert.equal(validateOidcConfiguration(config).clientId, "relvona");
for (const issuer of [
  "http://id.example.com",
  "https://user:pass@id.example.com",
  "https://id.example.com/?q=x",
])
  assert.throws(() => validateOidcConfiguration({ ...config, issuer }));
assert.throws(() =>
  validateOidcConfiguration({ ...config, allowedDomains: [] }),
);
const claims = {
  sub: "stable-subject",
  email: "alex@example.com",
  email_verified: true,
  nonce: "nonce",
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 60,
};
assert.equal(
  validateOidcClaims(claims, "nonce", config.allowedDomains).email,
  "alex@example.com",
);
for (const patch of [
  { email_verified: false },
  { nonce: "wrong" },
  { email: "alex@other.com" },
  { sub: "" },
  { exp: undefined },
  { iat: undefined },
])
  assert.throws(() =>
    validateOidcClaims({ ...claims, ...patch }, "nonce", config.allowedDomains),
  );
console.log("OIDC configuration and claim policy: 12 cases passed");
