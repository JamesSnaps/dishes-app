"use client";

import { useEffect } from "react";
import { FileDown } from "lucide-react";

/**
 * "Download PDF" — the browser's own print dialog, where "Save as PDF" is the
 * destination. No server rendering, no PDF library.
 *
 * Dark mode is Tailwind's `dark` class on <html>, and `dark:` styles would
 * print as white text on dark tiles. So the class comes off for the duration
 * of the print and goes back after — on the before/afterprint events, which
 * also covers someone pressing Ctrl/Cmd+P instead of the button.
 */
export function PrintButton() {
  useEffect(() => {
    const root = document.documentElement;
    let wasDark = false;
    const before = () => {
      wasDark = root.classList.contains("dark");
      if (wasDark) root.classList.remove("dark");
    };
    const after = () => {
      if (wasDark) root.classList.add("dark");
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
      after();
    };
  }, []);

  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
    >
      <FileDown className="h-3.5 w-3.5" />
      Download PDF
    </button>
  );
}
