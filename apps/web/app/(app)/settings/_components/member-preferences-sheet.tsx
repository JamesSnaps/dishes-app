"use client";

import { useState, useTransition } from "react";
import { Settings2, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@dishes/ui";
import { Button, Textarea } from "@dishes/ui";
import { updateMemberPreferences } from "@/app/actions/settings";

const DIETARY_FLAGS = [
  "Vegetarian",
  "Vegan",
  "Gluten-free",
  "Dairy-free",
  "Nut allergy",
  "Shellfish allergy",
  "Halal",
  "Kosher",
  "Low-FODMAP",
  "Egg-free",
];

interface Props {
  memberId: string;
  memberName: string;
  initialDietaryFlags: string[];
  initialDislikes: string[];
  initialPreferences: string[];
  initialCustomNotes: string;
}

function TagInput({
  tags,
  onChange,
  placeholder,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder: string;
}) {
  const [input, setInput] = useState("");

  function addTag(value: string) {
    const trimmed = value.trim();
    if (!trimmed || tags.includes(trimmed)) return;
    onChange([...tags, trimmed]);
    setInput("");
  }

  function removeTag(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(input);
    } else if (e.key === "Backspace" && !input && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  }

  return (
    <div className="min-h-[2.5rem] flex flex-wrap gap-1.5 rounded-lg border bg-muted/40 px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
      {tags.map((tag) => (
        <span
          key={tag}
          className="flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium"
        >
          {tag}
          <button
            type="button"
            onClick={() => removeTag(tag)}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label={`Remove ${tag}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => addTag(input)}
        placeholder={tags.length === 0 ? placeholder : ""}
        className="flex-1 min-w-[8rem] bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
      />
    </div>
  );
}

export function MemberPreferencesSheet({
  memberId,
  memberName,
  initialDietaryFlags,
  initialDislikes,
  initialPreferences,
  initialCustomNotes,
}: Props) {
  const [open, setOpen] = useState(false);
  const [dietaryFlags, setDietaryFlags] = useState<string[]>(initialDietaryFlags);
  const [dislikes, setDislikes] = useState<string[]>(initialDislikes);
  const [preferences, setPreferences] = useState<string[]>(initialPreferences);
  const [customNotes, setCustomNotes] = useState(initialCustomNotes);
  const [isPending, startTransition] = useTransition();

  function toggleFlag(flag: string) {
    setDietaryFlags((prev) =>
      prev.includes(flag) ? prev.filter((f) => f !== flag) : [...prev, flag]
    );
  }

  function handleSave() {
    startTransition(async () => {
      await updateMemberPreferences(memberId, {
        dietaryFlags,
        dislikes,
        preferences,
        customNotes,
      });
      setOpen(false);
    });
  }

  function handleOpenChange(next: boolean) {
    if (next) {
      setDietaryFlags(initialDietaryFlags);
      setDislikes(initialDislikes);
      setPreferences(initialPreferences);
      setCustomNotes(initialCustomNotes);
    }
    setOpen(next);
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label={`Edit ${memberName}'s preferences`}
          title="Edit preferences"
        >
          <Settings2 className="h-4 w-4" />
        </button>
      </SheetTrigger>

      <SheetContent side="right" className="w-full sm:max-w-md px-4 pb-8 overflow-y-auto">
        <SheetHeader className="mb-6">
          <SheetTitle>{memberName}</SheetTitle>
          <p className="text-sm text-muted-foreground">Food preferences &amp; restrictions</p>
        </SheetHeader>

        <div className="space-y-6">
          {/* Dietary flags */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Dietary requirements</label>
            <div className="flex flex-wrap gap-2">
              {DIETARY_FLAGS.map((flag) => (
                <button
                  key={flag}
                  type="button"
                  onClick={() => toggleFlag(flag)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    dietaryFlags.includes(flag)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {flag}
                </button>
              ))}
            </div>
          </div>

          {/* Dislikes */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Dislikes</label>
            <p className="text-xs text-muted-foreground">
              Ingredients or foods they won&apos;t eat
            </p>
            <TagInput
              tags={dislikes}
              onChange={setDislikes}
              placeholder="Type and press Enter — e.g. mushrooms, olives"
            />
          </div>

          {/* Preferences */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Favourites</label>
            <p className="text-xs text-muted-foreground">
              Things they particularly enjoy
            </p>
            <TagInput
              tags={preferences}
              onChange={setPreferences}
              placeholder="Type and press Enter — e.g. pasta, spicy food"
            />
          </div>

          {/* Custom notes */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Notes</label>
            <Textarea
              placeholder="Anything else the AI should know — e.g. won't eat anything green, prefers mild flavours"
              value={customNotes}
              onChange={(e) => setCustomNotes(e.target.value)}
              rows={3}
              className="resize-none"
            />
          </div>

          <Button
            className="w-full"
            onClick={handleSave}
            disabled={isPending}
          >
            {isPending ? "Saving…" : "Save preferences"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
