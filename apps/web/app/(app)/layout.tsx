import type { ReactNode } from "react";
import { BottomNav } from "@/components/nav/bottom-nav";
import { SideNav } from "@/components/nav/side-nav";
import { ScrollReset } from "@/components/scroll-reset";
import { JobsProvider } from "@/components/providers/jobs-provider";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { db } from "@/lib/db";
import { householdMembers } from "@dishes/db/schema";
import { eq } from "drizzle-orm";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getAutheliaUser();
  const { memberId } = await requireHousehold(user);
  const [member] = await db
    .select({ displayName: householdMembers.displayName, avatarUrl: householdMembers.avatarUrl })
    .from(householdMembers)
    .where(eq(householdMembers.id, memberId))
    .limit(1);

  return (
    <JobsProvider>
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar */}
      <SideNav
        className="hidden lg:flex"
        displayName={member?.displayName ?? user.displayName}
        avatarUrl={member?.avatarUrl ?? null}
      />

      {/* Main content */}
      <main id="main-scroll" className="flex-1 overflow-y-auto pb-20 lg:pb-0">
        <ScrollReset targetSelector="#main-scroll" />
        {children}
      </main>

      {/* Mobile bottom nav */}
      <BottomNav className="lg:hidden" />
    </div>
    </JobsProvider>
  );
}
