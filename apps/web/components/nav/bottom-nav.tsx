"use client";

import { usePathname } from "next/navigation";
import { BookOpen, CalendarDays, Home, Images, ShoppingCart, Sparkles } from "lucide-react";
import { cn } from "@dishes/ui";
import { NAV_ITEMS } from "./nav-items";
import { useUnsavedChanges } from "@/components/unsaved-changes-context";

const ICONS = { BookOpen, CalendarDays, Home, Images, ShoppingCart, Sparkles };

interface Props {
  className?: string;
}

// Split nav items around the central FAB
const LEFT_ITEMS = NAV_ITEMS.slice(0, 2);
const RIGHT_ITEMS = NAV_ITEMS.slice(2);

export function BottomNav({ className }: Props) {
  const pathname = usePathname();
  const { requestNavigation } = useUnsavedChanges();

  function NavLink({ href, label, icon }: { href: string; label: string; icon: keyof typeof ICONS }) {
    const Icon = ICONS[icon];
    const active = pathname === href || pathname.startsWith(`${href}/`);
    return (
      <button
        onClick={() => requestNavigation(href)}
        className={cn(
          "flex flex-1 flex-col items-center gap-1 py-2 text-xs transition-colors",
          active
            ? "text-primary"
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
        "fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 pb-safe-bottom",
        className
      )}
    >
      <div className="flex h-16 items-center px-2">
        {/* Left items */}
        {LEFT_ITEMS.map((item) => (
          <NavLink key={item.href} {...item} icon={item.icon as keyof typeof ICONS} />
        ))}

        {/* Central FAB — AI Concierge */}
        <div className="flex flex-1 flex-col items-center">
          <button
            onClick={() => requestNavigation("/ai-concierge")}
            className="flex h-12 w-12 -translate-y-3 items-center justify-center rounded-full bg-primary shadow-lg shadow-primary/30 transition-transform active:scale-95"
            aria-label="AI Concierge"
          >
            <Sparkles className="h-6 w-6 text-primary-foreground" strokeWidth={2} />
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
