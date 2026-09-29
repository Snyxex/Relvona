export type UserThemePreferences = {
  mode: "dark" | "light";
  backgroundColor: string;
  surfaceColor: string;
  textColor: string;
  mutedTextColor: string;
  primaryColor: string;
  fontFamily: "sans" | "serif" | "mono";
  fontSize: number;
  radius: number;
  density: "compact" | "comfortable" | "spacious";
};

export const DEFAULT_USER_THEME: UserThemePreferences = {
  mode: "dark",
  backgroundColor: "#070b14",
  surfaceColor: "#0d1422",
  textColor: "#e8edf6",
  mutedTextColor: "#91a0b5",
  primaryColor: "#4f8cff",
  fontFamily: "sans",
  fontSize: 16,
  radius: 12,
  density: "comfortable",
};

const hexColor = /^#[0-9a-f]{6}$/i;

export function normalizeUserTheme(value: unknown, current: unknown = DEFAULT_USER_THEME): UserThemePreferences | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const base = current && typeof current === "object" && !Array.isArray(current)
    ? { ...DEFAULT_USER_THEME, ...(current as Partial<UserThemePreferences>) }
    : DEFAULT_USER_THEME;
  const candidate = { ...base, ...(value as Partial<UserThemePreferences>) };
  if (!['dark', 'light'].includes(candidate.mode)) return null;
  if (![candidate.backgroundColor, candidate.surfaceColor, candidate.textColor, candidate.mutedTextColor, candidate.primaryColor].every((color) => typeof color === "string" && hexColor.test(color))) return null;
  if (!['sans', 'serif', 'mono'].includes(candidate.fontFamily)) return null;
  if (!Number.isInteger(candidate.fontSize) || candidate.fontSize < 12 || candidate.fontSize > 20) return null;
  if (!Number.isInteger(candidate.radius) || candidate.radius < 0 || candidate.radius > 24) return null;
  if (!['compact', 'comfortable', 'spacious'].includes(candidate.density)) return null;
  return candidate as UserThemePreferences;
}
