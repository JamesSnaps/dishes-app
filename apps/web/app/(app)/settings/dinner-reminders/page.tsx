import Link from "next/link";
import { ChevronLeft, AlarmClock } from "lucide-react";
import { getDinnerReminderOverview } from "@/app/actions/dinner-reminders";
import { DinnerReminderForm } from "./_components/dinner-reminder-form";

export const metadata = { title: "Dinner Reminders" };
export const dynamic = "force-dynamic";

export default async function DinnerRemindersPage() {
  const overview = await getDinnerReminderOverview();
  const { tonight } = overview;

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <div className="mb-6">
        <Link
          href="/settings"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ChevronLeft className="h-4 w-4" />
          Settings
        </Link>
        <div className="flex items-center gap-2">
          <AlarmClock className="h-5 w-5 text-orange-500" />
          <h1 className="text-2xl font-bold">Dinner reminders</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Get a push notification telling you when to start cooking tonight&apos;s dinner,
          based on how long the recipe really takes you.
        </p>
      </div>

      {/* Tonight preview */}
      <div className="mb-6 rounded-xl bg-gradient-to-br from-orange-500/15 via-amber-500/10 to-rose-500/10 border border-orange-300/50 dark:border-orange-900/60 p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-orange-700 dark:text-orange-300">
          Tonight
        </p>
        {!tonight.lead ? (
          <p className="mt-1 text-sm text-muted-foreground">
            No dinner planned for today, so there&apos;s nothing to remind you about.
          </p>
        ) : (
          <>
            <p className="mt-1 text-lg font-bold leading-snug">
              {tonight.lead.title} · dinner at {tonight.dinnerTime}
              {tonight.overridden && (
                <span className="ml-2 align-middle text-xs font-semibold rounded-full bg-orange-500 text-white px-2 py-0.5">
                  changed today
                </span>
              )}
            </p>
            <p className="mt-1 text-sm">
              Start by <strong>{tonight.startAt}</strong> — it {tonight.lead.explanation}.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {!tonight.reminderEnabled
                ? "Reminder switched off for today in the planner."
                : overview.optedIn
                  ? `Reminder goes out at ${tonight.notifyAt}.`
                  : "Turn reminders on below to get a notification."}
            </p>
          </>
        )}
      </div>

      <DinnerReminderForm
        settings={overview.settings}
        optedIn={overview.optedIn}
        isAdmin={overview.isAdmin}
      />

      <p className="mt-6 text-sm text-muted-foreground">
        Need a different time for just one day? Tap the clock next to the day on the{" "}
        <Link href="/meal-plan" className="font-medium text-orange-600 dark:text-orange-400 underline-offset-2 hover:underline">
          meal planner
        </Link>
        . That changes only that date and leaves these defaults alone.
      </p>
    </div>
  );
}
