import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { getTasteProfile } from "@/app/actions/taste-profile";
import { ResetTasteProfileButton } from "./_components/reset-taste-profile-button";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";

export const metadata = { title: "Your Taste Profile" };

type ScoreRowProps = { label: string; score: number; max?: number };

function ScoreRow({ label, score, max = 5 }: ScoreRowProps) {
  const pct = Math.round((score / max) * 100);
  const color =
    score >= 4 ? "bg-green-500" : score >= 3 ? "bg-blue-500" : score >= 2 ? "bg-amber-500" : "bg-red-400";
  return (
    <div className="flex items-center gap-3">
      <span className="w-36 shrink-0 truncate text-sm capitalize">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {score.toFixed(1)}
      </span>
    </div>
  );
}

type ProfileSectionProps = {
  title: string;
  scores: Record<string, number>;
  limit?: number;
  emptyText: string;
};

function ProfileSection({ title, scores, limit = 10, emptyText }: ProfileSectionProps) {
  const sorted = Object.entries(scores)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit);

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      <div className="rounded-lg border bg-card p-4 space-y-3">
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          sorted.map(([label, score]) => (
            <ScoreRow key={label} label={label} score={score} />
          ))
        )}
      </div>
    </section>
  );
}

export default async function TasteProfilePage() {
  const user = await getAutheliaUser();
  const { householdId, role } = await requireHousehold(user);
  const profile = await getTasteProfile(householdId).catch(() => null);
  const isAdmin = role === "admin";

  const MIN_COOKS = 2;
  const hasProfile = profile && profile.ratedCookCount >= MIN_COOKS;

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <Link
        href="/settings"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Settings
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-bold">Your taste profile</h1>
        {profile ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Built from {profile.ratedCookCount} rated {profile.ratedCookCount === 1 ? "cook" : "cooks"}.
            {profile.ratedCookCount < 10 && " AI personalisation kicks in at 10 rated cooks."}
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">No data yet.</p>
        )}
      </div>

      {!hasProfile ? (
        <div className="rounded-xl border border-dashed p-12 text-center">
          <p className="font-medium">Profile not built yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Rate at least {MIN_COOKS} cooks after cooking a recipe. Scores appear here as your history grows.
          </p>
        </div>
      ) : (
        <>
          <ProfileSection
            title="Cuisines"
            scores={profile.cuisines}
            limit={10}
            emptyText="No cuisine data yet."
          />
          <ProfileSection
            title="Favourite ingredients"
            scores={Object.fromEntries(
              Object.entries(profile.ingredients).filter(([, s]) => s >= 3.0)
            )}
            limit={15}
            emptyText="Not enough data yet."
          />
          <ProfileSection
            title="Disliked ingredients"
            scores={Object.fromEntries(
              Object.entries(profile.ingredients)
                .filter(([, s]) => s <= 2.0)
                .sort(([, a], [, b]) => a - b)
            )}
            limit={10}
            emptyText="No strong dislikes detected."
          />
          <ProfileSection
            title="Tags & styles"
            scores={profile.tags}
            limit={12}
            emptyText="No tag data yet."
          />
        </>
      )}

      {isAdmin && profile && profile.ratedCookCount > 0 && (
        <section className="mt-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Admin
          </h2>
          <div className="rounded-lg border bg-card p-4">
            <p className="mb-3 text-sm font-medium">Reset taste profile</p>
            <ResetTasteProfileButton />
          </div>
        </section>
      )}
    </div>
  );
}
