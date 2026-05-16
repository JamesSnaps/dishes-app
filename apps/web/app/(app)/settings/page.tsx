import Link from "next/link";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { getHouseholdWithMembers, getLogLevel } from "@/app/actions/settings";
import { APP_VERSION } from "@/lib/version";
import { HouseholdNameForm } from "./_components/household-name-form";
import { MembersList } from "./_components/members-list";
import { AddMemberForm } from "./_components/add-member-form";
import { AppearanceSection } from "./_components/appearance-section";
import { LogLevelSection } from "./_components/log-level-section";
import { BackfillThumbnailsButton } from "./_components/backfill-thumbnails-button";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await getAutheliaUser();
  const { householdId, memberId, role } = await requireHousehold(user);
  const [{ household, members }, logLevel] = await Promise.all([
    getHouseholdWithMembers(householdId),
    getLogLevel(),
  ]);
  const isAdmin = role === "admin";

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <h1 className="mb-6 text-2xl font-bold">Settings</h1>

      <AppearanceSection />

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
      <section>
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
        </div>
      </section>

      {isAdmin && (
        <>
          <LogLevelSection current={logLevel} />
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Maintenance
            </h2>
            <div className="rounded-lg border bg-card p-4">
              <BackfillThumbnailsButton />
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
