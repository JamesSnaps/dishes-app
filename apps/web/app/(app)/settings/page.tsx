import Link from "next/link";
import { BarChart3, FileText, FolderOpen, Gift, Images, Library, Package, UtensilsCrossed } from "lucide-react";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { getLogLevel } from "@/app/actions/settings";
import { getHouseholdWithMembers } from "@/lib/services/household-settings";
import { APP_VERSION } from "@/lib/version";
import { HouseholdNameForm } from "./_components/household-name-form";
import { MembersList } from "./_components/members-list";
import { AddMemberForm } from "./_components/add-member-form";
import { AppearanceSection } from "./_components/appearance-section";
import { LogLevelSection } from "./_components/log-level-section";
import { BackfillThumbnailsButton } from "./_components/backfill-thumbnails-button";
import { BackfillMealTypesButton } from "./_components/backfill-meal-types-button";
import { BackfillSaturatedFatButton } from "./_components/backfill-saturated-fat-button";
import { PushNotificationManager } from "@/components/push-notification-manager";
import { AssistHistorySection } from "./_components/assist-history-section";
import { ReplayTourButton } from "./_components/replay-tour-button";
import { CrumbImportModal } from "../recipes/_components/crumb-import-modal";
import { getAssistHistoryStats } from "@/app/actions/assist-history";

export const metadata = { title: "Settings" };

// A phone has no side nav, and no Home page any more, so these are its way in
// to the side nav's other pages — the iOS Settings tab's Kitchen and Insights.
const KITCHEN_LINKS = [
  { href: "/pantry", label: "Pantry", icon: Package, tint: "from-emerald-500/15 to-teal-500/10 text-emerald-600 dark:text-emerald-400" },
  { href: "/meals", label: "Saved meals", icon: UtensilsCrossed, tint: "from-orange-500/15 to-rose-500/10 text-orange-600 dark:text-orange-400" },
  { href: "/collections", label: "Collections", icon: FolderOpen, tint: "from-amber-500/15 to-orange-500/10 text-amber-600 dark:text-amber-400" },
  { href: "/memories", label: "Memories", icon: Images, tint: "from-pink-500/15 to-rose-500/10 text-pink-600 dark:text-pink-400" },
  { href: "/notes", label: "Notes", icon: FileText, tint: "from-sky-500/15 to-blue-500/10 text-sky-600 dark:text-sky-400" },
  { href: "/shared", label: "Shared with me", icon: Library, tint: "from-indigo-500/15 to-violet-500/10 text-indigo-600 dark:text-indigo-400" },
  { href: "/stats", label: "Stats", icon: BarChart3, tint: "from-orange-500/15 to-amber-500/10 text-orange-600 dark:text-orange-400" },
  { href: "/wrapped", label: "Wrapped", icon: Gift, tint: "from-fuchsia-500/15 to-rose-500/10 text-fuchsia-600 dark:text-fuchsia-400" },
];

export default async function SettingsPage() {
  const user = await getAutheliaUser();
  const { householdId, memberId, role } = await requireHousehold(user);
  const [{ household, members }, logLevel, assistStats] = await Promise.all([
    getHouseholdWithMembers(householdId),
    getLogLevel(),
    getAssistHistoryStats(),
  ]);
  const isAdmin = role === "admin";

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <h1 className="mb-6 text-2xl font-bold">Settings</h1>

      <section className="mb-8 lg:hidden">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Kitchen and insights
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {KITCHEN_LINKS.map(({ href, label, icon: Icon, tint }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 rounded-xl border bg-gradient-to-br px-3 py-3 text-sm font-medium shadow-sm transition-shadow hover:shadow-md ${tint}`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="text-foreground">{label}</span>
            </Link>
          ))}
        </div>
      </section>

      <AppearanceSection />

      {/* Notifications */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Notifications
        </h2>
        <div className="rounded-lg border bg-card p-4">
          <PushNotificationManager vapidPublicKey={process.env.VAPID_PUBLIC_KEY ?? null} />
        </div>
        <Link
          href="/settings/notifications"
          className="mt-2 flex items-center justify-between rounded-lg border border-orange-300/60 dark:border-orange-900/60 bg-gradient-to-r from-orange-500/10 to-amber-500/10 px-4 py-3 hover:from-orange-500/20 hover:to-amber-500/20 transition-colors"
        >
          <div>
            <p className="font-medium">Choose notifications</p>
            <p className="text-sm text-muted-foreground">Which ones you get, and the devices they go to</p>
          </div>
          <span className="text-muted-foreground">›</span>
        </Link>
        <Link
          href="/settings/dinner-reminders"
          className="mt-2 flex items-center justify-between rounded-lg border border-orange-300/60 dark:border-orange-900/60 bg-gradient-to-r from-orange-500/10 to-rose-500/10 px-4 py-3 hover:from-orange-500/20 hover:to-rose-500/20 transition-colors"
        >
          <div>
            <p className="font-medium">Dinner reminders</p>
            <p className="text-sm text-muted-foreground">Get told when to start cooking, and set dinner times</p>
          </div>
          <span className="text-muted-foreground">›</span>
        </Link>
        <Link
          href="/settings/deliveries"
          className="mt-2 flex items-center justify-between rounded-lg border border-emerald-300/60 dark:border-emerald-900/60 bg-gradient-to-r from-emerald-500/10 to-teal-500/10 px-4 py-3 hover:from-emerald-500/20 hover:to-teal-500/20 transition-colors"
        >
          <div>
            <p className="font-medium">Grocery deliveries</p>
            <p className="text-sm text-muted-foreground">Delivery days, holidays, and reminders before orders close</p>
          </div>
          <span className="text-muted-foreground">›</span>
        </Link>
      </section>

      {/* Household */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Household
        </h2>
        <div className="rounded-lg border bg-card p-4">
          {isAdmin ? (
            <HouseholdNameForm currentName={household.name} />
          ) : (
            <div>
              <p className="text-sm font-medium text-muted-foreground">Household name</p>
              <p className="mt-1 text-lg font-semibold">{household.name}</p>
            </div>
          )}
        </div>
      </section>

      {/* Members */}
      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Members
          </h2>
          {isAdmin && <AddMemberForm />}
        </div>
        <MembersList
          members={members}
          currentUserMemberId={memberId}
          isAdmin={isAdmin}
        />
      </section>

      {/* Quick links */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Configuration
        </h2>
        <div className="flex flex-col gap-2">
          <Link
            href="/settings/ai"
            className="flex items-center justify-between rounded-lg border bg-card px-4 py-3 hover:bg-accent transition-colors"
          >
            <div>
              <p className="font-medium">AI settings</p>
              <p className="text-sm text-muted-foreground">OpenAI API key and model</p>
            </div>
            <span className="text-muted-foreground">›</span>
          </Link>
          <Link
            href="/settings/integrations"
            className="flex items-center justify-between rounded-lg border bg-card px-4 py-3 hover:bg-accent transition-colors"
          >
            <div>
              <p className="font-medium">Integrations</p>
              <p className="text-sm text-muted-foreground">API tokens for n8n, Home Assistant, and more</p>
            </div>
            <span className="text-muted-foreground">›</span>
          </Link>
          <Link
            href="/settings/taste"
            className="flex items-center justify-between rounded-lg border bg-card px-4 py-3 hover:bg-accent transition-colors"
          >
            <div>
              <p className="font-medium">Taste profile</p>
              <p className="text-sm text-muted-foreground">See how the household&apos;s preferences shape AI suggestions</p>
            </div>
            <span className="text-muted-foreground">›</span>
          </Link>
          <Link
            href="/settings/library-shares"
            className="flex items-center justify-between rounded-lg border bg-card px-4 py-3 hover:bg-accent transition-colors"
          >
            <div>
              <p className="font-medium">Shared libraries</p>
              <p className="text-sm text-muted-foreground">Let another household browse and copy from your recipes</p>
            </div>
            <span className="text-muted-foreground">›</span>
          </Link>
          <ReplayTourButton />
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Import
        </h2>
        <CrumbImportModal
          trigger={
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-lg border bg-card px-4 py-3 text-left hover:bg-accent transition-colors"
            >
              <div>
                <p className="font-medium">Import from Crouton</p>
                <p className="text-sm text-muted-foreground">Bring in recipes from a .crumb export</p>
              </div>
              <span className="text-muted-foreground">›</span>
            </button>
          }
        />
      </section>

      {isAdmin && (
        <>
          <AssistHistorySection stats={assistStats} />
          <LogLevelSection current={logLevel} />
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Diagnostics
            </h2>
            <Link
              href="/settings/diagnostics"
              className="flex items-center justify-between rounded-lg border bg-card px-4 py-3 hover:bg-accent transition-colors"
            >
              <div>
                <p className="font-medium">Crash reports</p>
                <p className="text-sm text-muted-foreground">
                  See what went wrong behind &ldquo;Application error&rdquo; on any device
                </p>
              </div>
              <span className="text-muted-foreground">›</span>
            </Link>
          </section>
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Maintenance
            </h2>
            <div className="rounded-lg border bg-card p-4 space-y-4">
              <BackfillThumbnailsButton />
              <BackfillMealTypesButton />
              <BackfillSaturatedFatButton />
            </div>
          </section>
        </>
      )}

      <p className="mt-8 text-xs text-muted-foreground">
        Version {APP_VERSION}
      </p>
    </div>
  );
}
