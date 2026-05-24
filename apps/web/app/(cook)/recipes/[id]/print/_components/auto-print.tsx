"use client";

import { useEffect } from "react";

export function AutoPrint() {
  useEffect(() => {
    window.print();
  }, []);
  return null;
}

export function PrintToolbar() {
  return (
    <div className="no-print flex items-center justify-between gap-4 border-b bg-background px-6 py-3">
      <p className="text-sm text-muted-foreground">
        Use your browser&rsquo;s <strong>Print → Save as PDF</strong> to export as PDF.
      </p>
      <button
        onClick={() => window.print()}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Print / Save as PDF
      </button>
    </div>
  );
}
