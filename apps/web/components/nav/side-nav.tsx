"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, CalendarDays, ShoppingCart, Settings, UtensilsCrossed } from "lucide-react";
import { cn } from "@dishes/ui";
import { NAV_ITEMS } from "./nav-items";

const ICONS = { BookOpen, CalendarDays, ShoppingCart, Settings };

interface Props {
  className?: string;
}

export function SideNav({ className }: Props) {
  const pathname = usePathname();

  return (
    <nav
      className={cn(
        "flex w-60 flex-col border-r bg-background",
        className
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center gap-2 border-b px-6">
        <UtensilsCrossed className="h-5 w-5 text-primary" />
        <span className="text-lg font-semibold">Dishes</span>
      </div>

      {/* Nav links */}
      <div className="flex flex-col gap-1 p-3">
        {NAV_ITEMS.map(({ href, label, icon }) => {
          const Icon = ICONS[icon];
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" strokeWidth={active ? 2.5 : 1.75} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
