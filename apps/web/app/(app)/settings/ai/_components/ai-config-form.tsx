"use client";

import { useState, useTransition } from "react";
import { Button } from "@dishes/ui";
import { Input } from "@dishes/ui";
import { saveAiConfig } from "@/app/actions/settings";

type Props = {
  config: {
    model: string;
    monthlyLimitUsd: string | null;
    hasKey: boolean;
    keyHint: string;
  } | null;
  isAdmin: boolean;
};

const MODELS = [
  { value: "gpt-4o", label: "GPT-4o (recommended)" },
  { value: "gpt-4o-mini", label: "GPT-4o mini (faster, cheaper)" },
  { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
];

export function AiConfigForm({ config, isAdmin }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleSubmit(formData: FormData) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        await saveAiConfig(formData);
        setSaved(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save AI config");
      }
    });
  }

  if (!isAdmin) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        Only household admins can configure AI settings.
      </div>
    );
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-5">
      {/* API Key */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">
          OpenAI API key
        </label>
        {config?.hasKey && (
          <p className="text-xs text-muted-foreground">
            Current key: <code className="font-mono">{config.keyHint}</code>
            {" "}— leave blank to keep it unchanged
          </p>
        )}
        <Input
          name="apiKey"
          type="password"
          placeholder={config?.hasKey ? "Enter new key to replace…" : "sk-…"}
          autoComplete="off"
          disabled={isPending}
        />
      </div>

      {/* Model */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">Model</label>
        <select
          name="model"
          defaultValue={config?.model ?? "gpt-4o"}
          disabled={isPending}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {MODELS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>

      {/* Monthly limit */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">Monthly spend limit (USD)</label>
        <p className="text-xs text-muted-foreground">
          AI generation will be disabled once this threshold is reached for the month.
        </p>
        <Input
          name="monthlyLimit"
          type="number"
          min="0"
          step="0.01"
          defaultValue={config?.monthlyLimitUsd ?? "20.00"}
          className="max-w-[140px]"
          disabled={isPending}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && <p className="text-sm text-green-600">Settings saved.</p>}

      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : "Save AI settings"}
        </Button>
      </div>
    </form>
  );
}
