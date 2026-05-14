"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

export function ScrollReset({ targetSelector }: { targetSelector: string }) {
  const pathname = usePathname();
  const prev = useRef(pathname);

  useEffect(() => {
    if (prev.current !== pathname) {
      prev.current = pathname;
      const el = document.querySelector(targetSelector);
      el?.scrollTo({ top: 0 });
    }
  }, [pathname, targetSelector]);

  return null;
}
