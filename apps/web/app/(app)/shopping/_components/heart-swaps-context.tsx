"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Whether shopping rows should show heart-healthy swap hints. Set once by the
 * page (someone in the household has the Cholesterol-lowering toggle) and read
 * by each row, rather than threaded through the list client and view.
 */
const HeartSwapsContext = createContext(false);

export function HeartSwapsProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <HeartSwapsContext.Provider value={enabled}>{children}</HeartSwapsContext.Provider>;
}

export function useHeartSwaps(): boolean {
  return useContext(HeartSwapsContext);
}
