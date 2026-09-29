import assert from "node:assert/strict";
import { DEFAULT_USER_THEME, normalizeUserTheme } from "../services/userThemeService.js";

const custom = normalizeUserTheme({
  mode: "light",
  backgroundColor: "#f4f7fb",
  surfaceColor: "#ffffff",
  textColor: "#172033",
  mutedTextColor: "#64748b",
  primaryColor: "#2563eb",
  fontFamily: "serif",
  fontSize: 18,
  radius: 6,
  density: "spacious",
});
assert.ok(custom);
assert.equal(custom.mode, "light");
assert.equal(custom.fontSize, 18);

const partial = normalizeUserTheme({ primaryColor: "#abcdef" }, DEFAULT_USER_THEME);
assert.ok(partial);
assert.equal(partial.backgroundColor, DEFAULT_USER_THEME.backgroundColor);
assert.equal(partial.primaryColor, "#abcdef");

assert.equal(normalizeUserTheme({ ...DEFAULT_USER_THEME, backgroundColor: "red" }), null);
assert.equal(normalizeUserTheme({ ...DEFAULT_USER_THEME, fontSize: 30 }), null);
assert.equal(normalizeUserTheme({ ...DEFAULT_USER_THEME, fontFamily: "comic" }), null);
assert.equal(normalizeUserTheme({ ...DEFAULT_USER_THEME, density: "tiny" }), null);

console.log("User theme validation tests passed.");
