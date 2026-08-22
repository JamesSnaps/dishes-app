"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/report-client-error";
import { Button } from "@dishes/ui";

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AppError({ error, reset }: Props) {
  useEffect(() => {
    console.error(error);
    reportClientError(error, "app-error", { digest: error.digest });
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-5xl font-bold text-muted-foreground/30">!</p>
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="max-w-sm text-muted-foreground">
        {error.message || "An unexpected error occurred. Please try again."}
      </p>
      {/* The reference ties this screen to the line in the server log, which is
          the only place the real message survives — production redacts it. */}
      {error.digest && (
        <p className="font-mono text-xs text-muted-foreground/60">
          reference {error.digest}
        </p>
      )}
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
