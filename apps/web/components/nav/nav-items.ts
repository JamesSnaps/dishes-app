// The phone's bottom nav, either side of the AI button in the middle. No Home:
// /recipes opens on browse mode, which took over what Home showed — the iOS
// tab bar is the same five (Recipes, Planner, AI, Shopping, Settings).
export const NAV_ITEMS = [
  { href: "/recipes", label: "Recipes", icon: "BookOpen" },
  { href: "/meal-plan", label: "Planner", icon: "CalendarDays" },
  { href: "/shopping", label: "Shopping", icon: "ShoppingCart" },
  { href: "/settings", label: "Settings", icon: "Settings" },
] as const;
