"use client";

import { usePathname } from "next/navigation";
import { BookOpen, CalendarDays, Settings, ShoppingCart, Sparkles } from "lucide-react";
import { cn } from "@dishes/ui";
import { NAV_ITEMS } from "./nav-items";
import { useUnsavedChanges } from "@/components/unsaved-changes-context";
import { usePrefetchRoutes } from "@/hooks/use-prefetch-routes";

const ICONS = { BookOpen, CalendarDays, Settings, ShoppingCart, Sparkles };

interface Props {
  className?: string;
}

// Split nav items around the central FAB
const LEFT_ITEMS = NAV_ITEMS.slice(0, 2);
const RIGHT_ITEMS = NAV_ITEMS.slice(2);

/** Same reasoning as the side nav: buttons aren't prefetched, so warm them. */
const PREFETCH_ROUTES = NAV_ITEMS.map((item) => item.href);

export function BottomNav({ className }: Props) {
  const pathname = usePathname();
  const { requestNavigation } = useUnsavedChanges();

  usePrefetchRoutes(PREFETCH_ROUTES);

  function NavLink({ href, label, icon }: { href: string; label: string; icon: keyof typeof ICONS }) {
    const Icon = ICONS[icon];
    const active = pathname === href || pathname.startsWith(`${href}/`);
    return (
      <button
        onClick={() => requestNavigation(href)}
        className={cn(
          "flex flex-1 flex-col items-center gap-1 py-2 text-[11px] transition-colors",
          active
            ? "font-semibold text-primary"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Icon className="h-5 w-5" strokeWidth={active ? 2.5 : 1.75} />
        <span>{label}</span>
      </button>
    );
  }

  return (
    <nav
      className={cn(
        "fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 pb-safe-bottom",
        className
      )}
    >
      <div className="flex h-16 items-center px-2">
        {/* Left items */}
        {LEFT_ITEMS.map((item) => (
          <NavLink key={item.href} {...item} icon={item.icon as keyof typeof ICONS} />
        ))}

        {/* Central FAB — AI Concierge. AI is ink, never a colour of its own (DESIGN.md). */}
        <div className="flex flex-1 flex-col items-center">
          <button
            onClick={() => requestNavigation("/ai-concierge")}
            className="flex h-[52px] w-[52px] -translate-y-3 items-center justify-center rounded-full bg-ink shadow-lg shadow-ink/25 ring-4 ring-background transition-transform active:scale-95"
            aria-label="AI Concierge"
          >
            <Sparkles className="h-6 w-6 text-ink-foreground" strokeWidth={2} />
          </button>
        </div>

        {/* Right items */}
        {RIGHT_ITEMS.map((item) => (
          <NavLink key={item.href} {...item} icon={item.icon as keyof typeof ICONS} />
        ))}
      </div>
    </nav>
  );
}
