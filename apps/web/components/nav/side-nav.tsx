"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import {
  BookOpen,
  CalendarDays,
  ChefHat,
  FileText,
  FolderOpen,
  Heart,
  HelpCircle,
  Home,
  Moon,
  Package,
  Settings,
  ShoppingCart,
  Sparkles,
  Sun,
  UtensilsCrossed,
  ChevronDown,
} from "lucide-react";
import { cn } from "@dishes/ui";
import { NotificationsBell } from "@/components/notifications/notifications-bell";

interface Props {
  className?: string;
}

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  disabled?: boolean;
}

const MAIN_NAV: NavItem[] = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/recipes", label: "Recipes", icon: BookOpen },
  { href: "/meal-plan", label: "Meal Planner", icon: CalendarDays },
  { href: "/shopping", label: "Shopping List", icon: ShoppingCart },
  { href: "/pantry", label: "Pantry", icon: Package },
  { href: "/ai-concierge", label: "AI Concierge", icon: Sparkles },
  { href: "/what-can-i-cook", label: "What Can I Cook?", icon: ChefHat, disabled: true },
];

const PERSONAL_NAV: NavItem[] = [
  { href: "/favourites", label: "Favourites", icon: Heart },
  { href: "/collections", label: "Collections", icon: FolderOpen },
  { href: "/notes", label: "My Notes", icon: FileText },
];

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = !item.disabled && (pathname === item.href || pathname.startsWith(`${item.href}/`));
  const Icon = item.icon;

  if (item.disabled) {
    return (
      <span
        className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground/40 cursor-not-allowed select-none"
      >
        <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
        {item.label}
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
        active
          ? "bg-primary/10 text-primary font-medium"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" strokeWidth={active ? 2.5 : 1.75} />
      {item.label}
    </Link>
  );
}

export function SideNav({ className }: Props) {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <nav
      className={cn(
        "flex w-60 flex-col border-r bg-background h-screen sticky top-0",
        className
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center gap-2 border-b px-4 shrink-0">
        <UtensilsCrossed className="h-5 w-5 text-primary" />
        <span className="text-lg font-semibold flex-1">Dishes</span>
        <NotificationsBell />
      </div>

      {/* Scrollable nav area */}
      <div className="flex flex-col flex-1 overflow-y-auto">
        {/* Main nav */}
        <div className="flex flex-col gap-1 p-3">
          {MAIN_NAV.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} />
          ))}
        </div>

        {/* Personal section */}
        <div className="px-3 pb-1 pt-3">
          <p className="px-3 pb-1 text-xs font-medium text-muted-foreground/60 uppercase tracking-wider">
            Personal
          </p>
          <div className="flex flex-col gap-1">
            {PERSONAL_NAV.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} />
            ))}
          </div>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Settings + Help */}
        <div className="border-t p-3 flex flex-col gap-1">
          <NavLink item={{ href: "/settings", label: "Settings", icon: Settings }} pathname={pathname} />
          <NavLink item={{ href: "/help", label: "Help & Support", icon: HelpCircle, disabled: true }} pathname={pathname} />
        </div>
      </div>

      {/* Profile card */}
      <div className="border-t px-3 py-3 shrink-0">
        <div className="flex items-center gap-1 px-1 mb-1">
          <button
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors ml-auto"
            title={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {resolvedTheme === "dark" ? (
              <Sun className="h-3.5 w-3.5" />
            ) : (
              <Moon className="h-3.5 w-3.5" />
            )}
            {resolvedTheme === "dark" ? "Light" : "Dark"}
          </button>
        </div>
        <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted text-left">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary font-semibold text-xs">
            JC
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-medium leading-tight truncate">James</p>
            <p className="text-xs text-muted-foreground leading-tight">View profile</p>
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </div>
    </nav>
  );
}
