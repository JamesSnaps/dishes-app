"use client";

import { useState } from "react";
import { cn } from "@dishes/ui";

const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: "Mains",
    emojis: ["🍕", "🍝", "🍜", "🥘", "🍲", "🍛", "🥩", "🍗", "🍖", "🌮", "🥙", "🫔", "🍣", "🍱", "🥡", "🫕"],
  },
  {
    label: "Light",
    emojis: ["🥗", "🥦", "🌿", "🥞", "🧇", "🥚", "🥨", "🧆", "🫖", "☕", "🍱"],
  },
  {
    label: "Sweet",
    emojis: ["🎂", "🍰", "🧁", "🍪", "🍩", "🍫", "🍮", "🧇", "🫐", "🍓", "🍇"],
  },
  {
    label: "Occasion",
    emojis: ["🎉", "🥂", "⭐", "🔥", "🏠", "❤️", "🌟", "✨", "🎄", "🥳"],
  },
];

interface Props {
  value: string | null;
  onChange: (emoji: string | null) => void;
  /** Larger trigger for use in page headers */
  large?: boolean;
}

export function EmojiPicker({ value, onChange, large = false }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex items-center justify-center rounded-lg border transition-colors shrink-0",
          large
            ? "h-14 w-14 text-3xl"
            : "h-11 w-11 text-xl",
          open ? "border-primary ring-2 ring-primary/20" : "border-input hover:border-primary/50 bg-background"
        )}
        title="Choose an emoji"
      >
        {value ?? <span className={cn("text-muted-foreground", large ? "text-xl" : "text-base")}>☐</span>}
      </button>

      {/* Picker popover */}
      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className={cn("absolute left-0 z-20 w-64 rounded-xl border bg-popover shadow-lg p-3", large ? "top-16" : "top-12")}>
            <div className="flex flex-col gap-3">
              {EMOJI_GROUPS.map((group) => (
                <div key={group.label}>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">{group.label}</p>
                  <div className="flex flex-wrap gap-1">
                    {group.emojis.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => {
                          onChange(emoji === value ? null : emoji);
                          setOpen(false);
                        }}
                        className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-md text-lg transition-colors hover:bg-muted",
                          value === emoji && "bg-primary/10 ring-1 ring-primary"
                        )}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              {/* Clear option */}
              {value && (
                <button
                  type="button"
                  onClick={() => { onChange(null); setOpen(false); }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors text-left pt-1 border-t"
                >
                  Remove icon
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
