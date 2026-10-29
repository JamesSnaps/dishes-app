"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/report-client-error";
import { reloadIfStaleBuild } from "@/components/chunk-reload-guard";

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: Props) {
  useEffect(() => {
    // An old build after a deploy — reload into the new one instead of erroring.
    if (reloadIfStaleBuild(`${error.name}: ${error.message}`)) return;
    console.error(error);
    reportClientError(error, "global-error", { digest: error.digest });
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8 text-center antialiased">
        <p className="font-serif text-5xl font-semibold text-primary">!</p>
        <h1 className="font-serif text-2xl font-semibold">Something went wrong</h1>
        <p className="max-w-sm text-muted-foreground">
          {error.message || "A critical error occurred."}
        </p>
        {error.digest && (
          <p className="font-mono text-xs text-muted-foreground">reference {error.digest}</p>
        )}
        <button
          onClick={reset}
          className="h-11 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground"
        >
          Try again
        </button>
      </body>
    </html>
  );
}
