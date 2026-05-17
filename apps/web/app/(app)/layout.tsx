import type { ReactNode } from "react";
import { BottomNav } from "@/components/nav/bottom-nav";
import { SideNav } from "@/components/nav/side-nav";
import { ScrollReset } from "@/components/scroll-reset";
import { JobsProvider } from "@/components/providers/jobs-provider";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { db } from "@/lib/db";
import { householdMembers, shoppingLists, shoppingListItems, mealPlans, mealPlanEntries } from "@dishes/db/schema";
import { and, count, eq } from "drizzle-orm";

function getMondayOfWeek(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function todayDayIndex(): number {
  const day = new Date().getDay();
  return day === 0 ? 6 : day - 1;
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getAutheliaUser();
  const { householdId, memberId } = await requireHousehold(user);

  const weekStartDate = getMondayOfWeek();
  const dayIndex = todayDayIndex();

  const [[member], [activeList], [currentPlan]] = await Promise.all([
    db
      .select({ displayName: householdMembers.displayName, avatarUrl: householdMembers.avatarUrl })
      .from(householdMembers)
      .where(eq(householdMembers.id, memberId))
      .limit(1),
    db
      .select({ id: shoppingLists.id })
      .from(shoppingLists)
      .where(and(eq(shoppingLists.householdId, householdId), eq(shoppingLists.status, "active")))
      .limit(1),
    db
      .select({ id: mealPlans.id })
      .from(mealPlans)
      .where(and(eq(mealPlans.householdId, householdId), eq(mealPlans.weekStartDate, weekStartDate)))
      .limit(1),
  ]);

  const [shoppingCountResult, mealCountResult] = await Promise.all([
    activeList
      ? db.select({ value: count() }).from(shoppingListItems).where(and(eq(shoppingListItems.listId, activeList.id), eq(shoppingListItems.isChecked, false)))
      : Promise.resolve([{ value: 0 }]),
    currentPlan
      ? db.select({ value: count() }).from(mealPlanEntries).where(and(eq(mealPlanEntries.mealPlanId, currentPlan.id), eq(mealPlanEntries.dayOfWeek, dayIndex)))
      : Promise.resolve([{ value: 0 }]),
  ]);

  const shoppingItemCount = Number(shoppingCountResult[0]?.value ?? 0);
  const todayMealCount = Number(mealCountResult[0]?.value ?? 0);

  return (
    <JobsProvider>
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar */}
      <SideNav
        className="hidden lg:flex"
        displayName={member?.displayName ?? user.displayName}
        avatarUrl={member?.avatarUrl ?? null}
        shoppingItemCount={shoppingItemCount}
        todayMealCount={todayMealCount}
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
