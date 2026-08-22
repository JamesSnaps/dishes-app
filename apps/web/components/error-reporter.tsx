"use client";

import { useEffect } from "react";
import { installGlobalErrorReporting } from "@/lib/report-client-error";

/**
 * Installs the window-level error listeners.
 *
 * Mounted in the root layout so it is running before anything else can fail —
 * including the providers in the (app) layout, whose errors escape past
 * (app)/error.tsx to the root and show as a bare "client-side exception".
 */
export function ErrorReporter() {
  useEffect(() => installGlobalErrorReporting(), []);
  return null;
}
