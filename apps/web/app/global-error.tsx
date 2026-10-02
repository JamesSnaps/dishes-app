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
        <p className="text-5xl font-bold text-gray-300">!</p>
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <p className="max-w-sm text-gray-500">
          {error.message || "A critical error occurred."}
        </p>
        {error.digest && (
          <p className="font-mono text-xs text-gray-400">reference {error.digest}</p>
        )}
        <button
          onClick={reset}
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
        >
          Try again
        </button>
      </body>
    </html>
  );
}
