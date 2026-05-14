"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, CalendarDays, Home, ShoppingCart, Settings } from "lucide-react";
import { cn } from "@dishes/ui";
import { NAV_ITEMS } from "./nav-items";

const ICONS = { BookOpen, CalendarDays, Home, ShoppingCart, Settings };

interface Props {
  className?: string;
}

export function BottomNav({ className }: Props) {
  const pathname = usePathname();

  return (
    <nav
      className={cn(
        "fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60",
        className
      )}
    >
      <div className="flex h-16 items-center justify-around px-2">
        {NAV_ITEMS.map(({ href, label, icon }) => {
          const Icon = ICONS[icon];
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 py-2 text-xs transition-colors",
                active
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-5 w-5" strokeWidth={active ? 2.5 : 1.75} />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
