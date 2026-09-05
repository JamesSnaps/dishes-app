"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { resetOnboarding } from "@/app/actions/onboarding";

/** Clears this member's onboarding flag; the layout then re-mounts the wizard. */
export function ReplayTourButton() {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await resetOnboarding();
          router.push("/");
        })
      }
      className="flex w-full items-center justify-between rounded-lg border bg-card px-4 py-3 text-left transition-colors hover:bg-accent disabled:opacity-60"
    >
      <div>
        <p className="font-medium">Replay the welcome tour</p>
        <p className="text-sm text-muted-foreground">
          {isPending ? "Starting…" : "A quick reminder of what Dishes can do"}
        </p>
      </div>
      <Sparkles className="h-4 w-4 text-primary" />
    </button>
  );
}
