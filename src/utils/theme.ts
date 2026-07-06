export type ThemeMode = "light" | "dark" | "system";

export function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveIsDark(mode: ThemeMode): boolean {
  if (mode === "system") return systemPrefersDark();
  return mode === "dark";
}

export function applyTheme(dark: boolean) {
  const root = document.documentElement;
  if (dark) {
    root.classList.add("theme-dark");
    root.classList.remove("theme-light");
  } else {
    root.classList.add("theme-light");
    root.classList.remove("theme-dark");
  }
}
