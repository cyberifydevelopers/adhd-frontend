import { useEffect, type ReactNode } from "react";
import { useThemeStore, applyThemeToDOM } from "@/stores/themeStore";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useThemeStore((s) => s.theme);

  // Apply theme on mount and whenever it changes
  useEffect(() => {
    applyThemeToDOM(theme);
  }, [theme]);

  // Listen for OS preference changes when in "system" mode
  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");

    const handler = () => {
      const current = useThemeStore.getState().theme;
      if (current === "system") {
        applyThemeToDOM("system");
      }
    };

    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return <>{children}</>;
}
