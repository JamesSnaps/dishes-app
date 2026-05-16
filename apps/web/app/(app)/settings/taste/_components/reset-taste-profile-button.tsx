"use client";

import { useState } from "react";
import { Button } from "@dishes/ui";
import { clearTasteProfile } from "@/app/actions/taste-profile";

export function ResetTasteProfileButton() {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleReset() {
    setLoading(true);
    setError(null);
    const result = await clearTasteProfile();
    setLoading(false);
    if (result.error) {
      setError(result.error);
    }
    setConfirming(false);
  }

  if (confirming) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          This will clear all taste profile scores. Cook history is kept — the profile will rebuild as you rate more cooks.
        </p>
        <div className="flex gap-2">
          <Button variant="destructive" size="sm" onClick={handleReset} disabled={loading}>
            {loading ? "Resetting…" : "Yes, reset profile"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={loading}>
            Cancel
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
      Reset taste profile
    </Button>
  );
}
