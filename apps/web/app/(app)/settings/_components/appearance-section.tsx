"use client";

import { useTheme } from "next-themes";
import { Moon, Sun, Monitor } from "lucide-react";

export function AppearanceSection() {
  const { theme, setTheme } = useTheme();

  const options = [
    { value: "system", label: "System", Icon: Monitor },
    { value: "light", label: "Light", Icon: Sun },
    { value: "dark", label: "Dark", Icon: Moon },
  ] as const;

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Appearance
      </h2>
      <div className="rounded-lg border bg-card p-4">
        <p className="text-sm font-medium mb-3">Theme</p>
        <div className="flex gap-2">
          {options.map(({ value, label, Icon }) => (
            <button
              key={value}
              onClick={() => setTheme(value)}
              className={`flex flex-1 flex-col items-center gap-1.5 rounded-lg border p-3 text-xs transition-colors ${
                theme === value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
