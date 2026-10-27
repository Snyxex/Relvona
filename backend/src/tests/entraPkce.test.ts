import assert from "node:assert/strict";
import { createEntraPkce, pkceS256Challenge } from "../auth/entraPkce.js";

// RFC 7636 Appendix B official S256 test vector.
assert.equal(
  pkceS256Challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
  "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
);
const a = createEntraPkce(), b = createEntraPkce();
assert.equal(a.method, "S256");
assert.match(a.verifier, /^[A-Za-z0-9_-]{43}$/);
assert.match(a.challenge, /^[A-Za-z0-9_-]{43}$/);
assert.equal(a.challenge, pkceS256Challenge(a.verifier));
assert.notEqual(a.verifier, b.verifier, "each authorization attempt needs a unique random verifier");
assert.throws(() => pkceS256Challenge("too-short"), /Invalid PKCE/);
assert.throws(() => pkceS256Challenge("!".repeat(43)), /Invalid PKCE/);
console.log("Entra PKCE unit tests passed");
