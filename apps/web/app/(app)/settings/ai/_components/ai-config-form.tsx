"use client";

import { useState, useTransition } from "react";
import { Button } from "@dishes/ui";
import { Input } from "@dishes/ui";
import { Textarea } from "@dishes/ui";
import { saveAiConfig } from "@/app/actions/settings";

type Props = {
  config: {
    model: string;
    imageModel: string;
    monthlyLimitUsd: string | null;
    defaultPrompt: string | null;
    measurementSystem: string;
    hasKey: boolean;
    keyHint: string;
  } | null;
  isAdmin: boolean;
};

const CHAT_MODELS = [
  { value: "gpt-4.1-nano", label: "GPT-4.1 Nano (recommended)" },
  { value: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
  { value: "gpt-4.1", label: "GPT-4.1" },
  { value: "gpt-4o-mini", label: "GPT-4o Mini" },
  { value: "gpt-4o", label: "GPT-4o" },
  { value: "gpt-5.4-nano", label: "GPT-5.4 Nano" },
];

const IMAGE_MODELS = [
  { value: "gpt-image-2", label: "GPT Image 2 (recommended)" },
  { value: "dall-e-3", label: "DALL·E 3" },
  { value: "dall-e-2", label: "DALL·E 2" },
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
        <label className="text-sm font-medium">OpenAI API key</label>
        {config?.hasKey && (
          <p className="text-xs text-muted-foreground">
            Current key:{" "}
            <code className="font-mono">{config.keyHint}</code>
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

      {/* Chat model */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">Model</label>
        <select
          name="model"
          defaultValue={config?.model ?? "gpt-4.1-nano"}
          disabled={isPending}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {CHAT_MODELS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>

      {/* Image model */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">Image model</label>
        <select
          name="imageModel"
          defaultValue={config?.imageModel ?? "gpt-image-2"}
          disabled={isPending}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {IMAGE_MODELS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>

      {/* Measurement system */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">Measurement system</label>
        <p className="text-xs text-muted-foreground">
          AI-generated recipes will use this unit system for all quantities.
        </p>
        <select
          name="measurementSystem"
          defaultValue={config?.measurementSystem ?? "metric"}
          disabled={isPending}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="metric">Metric (g, ml, kg, l)</option>
          <option value="imperial">Imperial (cups, oz, lbs, tbsp)</option>
        </select>
      </div>

      {/* Default prompt */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">Default recipe preferences</label>
        <p className="text-xs text-muted-foreground">
          Applied to every AI recipe generation. Use this to set household-wide requirements, e.g. "Always make recipes kid-friendly and nut-free."
        </p>
        <Textarea
          name="defaultPrompt"
          rows={3}
          defaultValue={config?.defaultPrompt ?? ""}
          placeholder='e.g. "Always make recipes suitable for children. Avoid nuts and shellfish."'
          disabled={isPending}
          className="text-sm resize-none"
        />
      </div>

      {/* Monthly limit */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">Monthly spend limit (GBP)</label>
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
