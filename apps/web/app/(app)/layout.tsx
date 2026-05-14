import type { ReactNode } from "react";
import { BottomNav } from "@/components/nav/bottom-nav";
import { SideNav } from "@/components/nav/side-nav";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar */}
      <SideNav className="hidden lg:flex" />

      {/* Main content */}
      <main className="flex-1 overflow-y-auto pb-20 lg:pb-0">
        {children}
      </main>

      {/* Mobile bottom nav */}
      <BottomNav className="lg:hidden" />
    </div>
  );
}
