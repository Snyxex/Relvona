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

export const LIGHT_USER_THEME: UserThemePreferences = {
  ...DEFAULT_USER_THEME,
  mode: "light",
  backgroundColor: "#f4f7fb",
  surfaceColor: "#ffffff",
  textColor: "#172033",
  mutedTextColor: "#64748b",
  primaryColor: "#2563eb",
};

const fonts: Record<UserThemePreferences["fontFamily"], string> = {
  sans: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  serif: 'Georgia, Cambria, "Times New Roman", serif',
  mono: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
};

export function completeUserTheme(value: unknown): UserThemePreferences {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...DEFAULT_USER_THEME, ...(value as Partial<UserThemePreferences>) }
    : { ...DEFAULT_USER_THEME };
}

export function applyUserTheme(value: unknown) {
  if (typeof document === "undefined") return;
  const theme = completeUserTheme(value);
  const root = document.documentElement;
  root.dataset.themeMode = theme.mode;
  root.dataset.density = theme.density;
  root.style.colorScheme = theme.mode;
  root.style.setProperty("--background", theme.backgroundColor);
  root.style.setProperty("--foreground", theme.textColor);
  root.style.setProperty("--card", theme.surfaceColor);
  root.style.setProperty("--card-strong", theme.surfaceColor);
  root.style.setProperty("--muted", theme.surfaceColor);
  root.style.setProperty("--muted-foreground", theme.mutedTextColor);
  root.style.setProperty("--primary", theme.primaryColor);
  root.style.setProperty("--primary-hover", `color-mix(in srgb, ${theme.primaryColor} 82%, ${theme.textColor})`);
  root.style.setProperty("--border", `color-mix(in srgb, ${theme.mutedTextColor} 28%, transparent)`);
  root.style.setProperty("--border-strong", `color-mix(in srgb, ${theme.mutedTextColor} 46%, transparent)`);
  root.style.setProperty("--ring", `color-mix(in srgb, ${theme.primaryColor} 42%, transparent)`);
  root.style.setProperty("--font-geist-sans", fonts[theme.fontFamily]);
  root.style.setProperty("--user-font-size", `${theme.fontSize}px`);
  root.style.setProperty("--user-radius", `${theme.radius}px`);
}
