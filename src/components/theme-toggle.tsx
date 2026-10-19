"use client";

import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";

export const THEME_STORAGE_KEY = "bet-finder:theme:v1";

export function ThemeToggle() {
  function toggleTheme() {
    const dark = document.documentElement.classList.toggle("dark");
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, dark ? "dark" : "light");
    } catch {
      // Theme switching still works when browser storage is unavailable.
    }
  }

  return (
    <Button
      aria-label="Toggle light and dark theme"
      className="size-8 bg-transparent"
      onClick={toggleTheme}
      size="icon"
      title="Toggle light and dark theme"
      type="button"
      variant="outline"
    >
      <Sun aria-hidden="true" className="size-4 dark:hidden" />
      <Moon aria-hidden="true" className="hidden size-4 dark:block" />
    </Button>
  );
}
