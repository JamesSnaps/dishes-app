"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyButton({ text, label = "Copy", className = "" }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (insecure context, permissions) — nothing useful to do.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md bg-orange-500 px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-orange-600 ${className}`}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : label}
    </button>
  );
}
