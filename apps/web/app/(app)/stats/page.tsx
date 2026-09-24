import Link from "next/link";
import {
  BarChart3,
  CheckCircle2,
  AlertTriangle,
  Globe,
  HeartPulse,
  Lightbulb,
  Trophy,
  Users,
  Star,
} from "lucide-react";
import { cn } from "@dishes/ui";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import {
  HEART_HEALTHY_MAX_SATURATED_FAT_G,
  HEART_HEALTHY_MIN_FIBER_G,
} from "@/lib/heart-healthy";
import {
  PROTEIN_KINDS,
  PROTEIN_LABELS,
  WEEKLY_PROTEIN_TARGETS,
  meetsTarget,
  type MealSummary,
  type ProteinKind,
} from "@/lib/meal-stats";
import { STATS_RANGES, getStatsReport, parseRange, type StatsRange } from "@/lib/services/stats";
import { BarList, DataTable, Section, ShareColumns, StatTile } from "./_components/stat-pieces";
import { PrintButton } from "./_components/print-button";

export const metadata = { title: "Stats" };

function pct(part: number, whole: number): string {
  return whole ? `${Math.round((part / whole) * 100)}%` : "—";
}

function grams(v: number | null): string {
  return v === null ? "—" : `${v}g`;
}

function targetText(kind: ProteinKind): string | null {
  const t = WEEKLY_PROTEIN_TARGETS[kind];
  if (!t) return null;
  if (t.min !== undefined) return `aim ${t.min}+ a week`;
  return t.max === 0 ? "aim for none" : `at most ${t.max} a week`;
}

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; person?: string }>;
}) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);
  const params = await searchParams;
  const range = parseRange(params.range);
  const report = await getStatsReport(householdId, range, params.person);
  const personParam = report.person ? `&person=${report.person.id}` : "";
  const { totals, summary } = report;

  const missingNutrition = summary.meals - summary.withNutrition;

  return (
    <div className="mx-auto max-w-5xl p-4 lg:p-8">
      {/* Print-only title: what this PDF is, for whom, and when */}
      <div className="mb-6 hidden border-b pb-3 print:block">
        <h1 className="text-2xl font-bold">
          Eating stats{report.person ? ` — ${report.person.name}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground">
          {DATE.format(new Date(report.from + "T00:00:00Z"))} to {DATE.format(new Date(report.to + "T00:00:00Z"))} ·
          generated {DATE.format(new Date())} from Dishes
        </p>
      </div>

      {/* Header + range */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <BarChart3 className="h-6 w-6 text-primary" />
            Stats
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            What you&rsquo;ve eaten, from the meal plan and logged cooks.
          </p>
        </div>
        <nav className="flex rounded-full bg-muted p-1" aria-label="Time range">
          {(Object.keys(STATS_RANGES) as StatsRange[]).map((key) => (
            <Link
              key={key}
              href={`/stats?range=${key}${personParam}`}
              aria-current={key === range ? "page" : undefined}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                key === range
                  ? "bg-gradient-to-r from-orange-500 to-rose-500 text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {STATS_RANGES[key].label}
            </Link>
          ))}
        </nav>
      </div>

      {/* Whose stats, and export */}
      <div className="-mt-3 mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        {report.members.length > 1 ? (
          <nav className="flex flex-wrap gap-1.5" aria-label="Person">
            {[{ id: "", name: "Everyone" }, ...report.members].map((m) => {
              const active = (report.person?.id ?? "") === m.id;
              return (
                <Link
                  key={m.id || "everyone"}
                  href={`/stats?range=${range}${m.id ? `&person=${m.id}` : ""}`}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    active
                      ? "border-blue-400 bg-blue-500 text-white"
                      : "border-blue-200 bg-blue-50 text-blue-700 hover:border-blue-300 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-400"
                  )}
                >
                  {m.name}
                </Link>
              );
            })}
          </nav>
        ) : (
          <span />
        )}
        <PrintButton />
      </div>

      {totals.meals === 0 ? (
        <div className="rounded-2xl border border-dashed p-10 text-center">
          <p className="font-medium">Nothing eaten in this period yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Meals appear here once their day on the meal plan has passed, or when you log a cook.
          </p>
          <Link href="/meal-plan" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
            Go to the meal planner →
          </Link>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Headline tiles */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile value={totals.meals} label="Meals eaten" tone="orange" hint="Planned meals whose day has passed, plus logged cooks" />
            <StatTile value={totals.distinctRecipes} label="Different recipes" tone="violet" />
            <StatTile value={totals.newRecipes} label="New recipes tried" tone="emerald" hint="Eaten for the first time in this period" />
            <StatTile
              value={totals.avgRating !== null ? `${totals.avgRating}★` : "—"}
              label="Average rating"
              hint="Across cooks and ratings in this period, out of 5"
            />
            <StatTile value={totals.cooksLogged} label="Cooks logged" />
            <StatTile
              value={totals.avgCookMinutes !== null ? `${totals.avgCookMinutes}m` : "—"}
              label="Avg time cooking"
              hint="From cooks logged with a time"
            />
          </div>

          {/* Heart health */}
          <Section
            title="Heart health"
            icon={<HeartPulse className="h-4 w-4 text-rose-500" />}
            description={
              <>
                Heart-healthy means at most {HEART_HEALTHY_MAX_SATURATED_FAT_G}g saturated fat and at least{" "}
                {HEART_HEALTHY_MIN_FIBER_G}g fibre per serving.
              </>
            }
            className={report.heartFocus ? "border-rose-200/70 dark:border-rose-900/50" : undefined}
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile
                value={pct(summary.heartHealthy, summary.withNutrition)}
                label="Meals heart-healthy"
                tone="rose"
                hint={`${summary.heartHealthy} of ${summary.withNutrition} meals with figures`}
              />
              <StatTile value={grams(summary.avgSaturatedFatG)} label="Avg sat. fat / meal" tone="rose" />
              <StatTile value={grams(summary.avgFiberG)} label="Avg fibre / meal" tone="rose" />
              <StatTile
                value={summary.avgCalories !== null ? summary.avgCalories : "—"}
                label="Avg kcal / meal"
                tone="rose"
              />
            </div>

            <div className="mt-5 grid gap-6 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-medium">
                  Share of meals heart-healthy, by {report.bucketUnit}
                </h3>
                <ShareColumns
                  columns={report.buckets.map((b) => ({
                    key: b.period,
                    label: b.label,
                    share: b.withNutrition ? b.heartHealthy / b.withNutrition : null,
                    tooltip: `${b.period}: ${b.heartHealthy} of ${b.withNutrition} meals with figures (${b.meals} eaten)`,
                  }))}
                  emptyLabel="no meals with figures"
                />
                <DataTable
                  caption={`Heart-healthy meals by ${report.bucketUnit}`}
                  headers={[report.bucketUnit === "week" ? "Week of" : "Month", "Meals", "With figures", "Heart-healthy"]}
                  rows={report.buckets.map((b) => [b.label, b.meals, b.withNutrition, b.heartHealthy])}
                />
              </div>

              <div>
                <h3 className="mb-2 text-sm font-medium">Protein, meals per week</h3>
                <ul className="space-y-2">
                  {PROTEIN_KINDS.map((kind) => {
                    const rate = report.proteinsPerWeek[kind];
                    const ok = meetsTarget(kind, rate);
                    const target = targetText(kind);
                    return (
                      <li key={kind} className="flex items-center justify-between gap-3 text-sm">
                        <span className="flex items-center gap-1.5">
                          {ok === true && <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="On target" />}
                          {ok === false && <AlertTriangle className="h-4 w-4 text-amber-600" aria-label="Off target" />}
                          {ok === undefined && <span className="inline-block w-4" />}
                          {PROTEIN_LABELS[kind]}
                        </span>
                        <span className="text-right">
                          <span className="font-semibold tabular-nums">{rate}</span>
                          {target && <span className="ml-1.5 text-xs text-muted-foreground">{target}</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-3 text-xs text-muted-foreground">
                  Worked out from ingredient names, so a meal can count as more than one kind.
                </p>
              </div>
            </div>

            {missingNutrition > 0 && (
              <p className="mt-4 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                {missingNutrition} of {summary.meals} meals have no saturated fat / fibre figures, so they
                aren&rsquo;t counted above.{" "}
                <Link href="/settings" className="font-medium text-primary hover:underline">
                  Estimate them in Settings → Maintenance
                </Link>
              </p>
            )}
          </Section>

          {/* What we eat */}
          <div className="grid gap-5 lg:grid-cols-2">
            <Section title="Most eaten" icon={<Trophy className="h-4 w-4 text-amber-500" />}>
              <BarList
                barClassName="bg-gradient-to-r from-orange-400 to-amber-400"
                rows={report.topRecipes.map((r) => ({
                  key: r.id,
                  label: (
                    <Link href={`/recipes/${r.id}`} className="hover:text-primary hover:underline">
                      {r.title}
                    </Link>
                  ),
                  value: r.count,
                  tooltip: `${r.title}: eaten ${r.count}×`,
                }))}
                valueSuffix="×"
              />
            </Section>

            <Section title="Cuisines" icon={<Globe className="h-4 w-4 text-violet-500" />}>
              <BarList
                barClassName="bg-gradient-to-r from-violet-500 to-fuchsia-400"
                rows={report.cuisines.map((c) => ({
                  key: c.name,
                  label: c.name,
                  value: c.count,
                  tooltip: `${c.name}: ${c.count} meals (${pct(c.count, totals.meals)})`,
                }))}
              />
            </Section>
          </div>

          {/* By person */}
          {report.people.length > 0 && (
            <Section
              icon={<Users className="h-4 w-4 text-blue-500" />}
              title={report.person ? report.person.name : "By person"}
              description="A meal counts for everyone unless a logged cook says who was eating."
            >
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {report.people.map((p) => (
                  <PersonCard key={p.id} person={p} />
                ))}
              </div>
            </Section>
          )}

          {/* Worth a look — app nudges, left out of the PDF */}
          <Section
            title="Worth a look"
            icon={<Lightbulb className="h-4 w-4 text-amber-500" />}
            className="print:hidden"
          >
            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-medium">Favourites you haven&rsquo;t had in a while</h3>
                {report.forgottenFavourites.length ? (
                  <ul className="space-y-1.5 text-sm">
                    {report.forgottenFavourites.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-2">
                        <Link href={`/recipes/${r.id}`} className="truncate hover:text-primary hover:underline">
                          {r.title}
                        </Link>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {r.rating !== null && (
                            <span className="mr-2 inline-flex items-center gap-0.5">
                              <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                              {r.rating}
                            </span>
                          )}
                          {r.lastEaten ? `last ${DATE.format(new Date(r.lastEaten + "T00:00:00Z"))}` : "never eaten"}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">None — your favourites are all in rotation.</p>
                )}
              </div>

              <div className="space-y-4">
                {report.heartHealthyUntried.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-sm font-medium">Heart-healthy recipes you&rsquo;ve never eaten</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {report.heartHealthyUntried.map((r) => (
                        <Link
                          key={r.id}
                          href={`/recipes/${r.id}`}
                          className="rounded-full bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-500/20 dark:text-rose-300"
                        >
                          {r.title}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
                <Tips report={report} />
              </div>
            </div>
          </Section>
          <p className="hidden text-xs text-muted-foreground print:block">
            Figures are per-serving estimates from recipe nutrition data (much of it AI-estimated), and
            &ldquo;eaten&rdquo; means meals on the household meal plan or logged as cooked. A guide to
            eating patterns, not a clinical record.
          </p>
        </div>
      )}
    </div>
  );
}

function PersonCard({ person }: { person: Awaited<ReturnType<typeof getStatsReport>>["people"][number] }) {
  const s: MealSummary = person.summary;
  return (
    <div
      className={cn(
        "rounded-xl bg-gradient-to-br p-4 shadow-sm",
        person.cholesterolDiet
          ? "from-rose-50 to-pink-50 ring-1 ring-rose-200/70 dark:from-rose-950/30 dark:to-pink-950/10 dark:ring-rose-900/50"
          : "from-blue-50 to-sky-50 dark:from-blue-950/30 dark:to-sky-950/10"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold">{person.name}</p>
        {person.cholesterolDiet && (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-medium text-white">
            <HeartPulse className="h-3 w-3" />
            Cholesterol-lowering
          </span>
        )}
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {s.meals} meals{person.topCuisine ? ` · mostly ${person.topCuisine}` : ""}
      </p>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Mini value={pct(s.heartHealthy, s.withNutrition)} label="Heart-healthy" />
        <Mini value={grams(s.avgSaturatedFatG)} label="Sat. fat" />
        <Mini value={grams(s.avgFiberG)} label="Fibre" />
      </div>

      {person.cholesterolDiet && (
        <ul className="mt-3 space-y-1 text-xs">
          {(Object.keys(WEEKLY_PROTEIN_TARGETS) as ProteinKind[]).map((kind) => {
            const rate = person.proteinsPerWeek[kind];
            const ok = meetsTarget(kind, rate);
            return (
              <li key={kind} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1">
                  {ok ? (
                    <CheckCircle2 className="h-3 w-3 text-emerald-600" aria-label="On target" />
                  ) : (
                    <AlertTriangle className="h-3 w-3 text-amber-600" aria-label="Off target" />
                  )}
                  {PROTEIN_LABELS[kind]}
                </span>
                <span className="tabular-nums">
                  {rate}/wk <span className="text-muted-foreground">({targetText(kind)})</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {person.topRecipes.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Top dishes</p>
          <ol className="mt-1 space-y-0.5 text-sm">
            {person.topRecipes.map((r) => (
              <li key={r.id} className="flex justify-between gap-2">
                <Link href={`/recipes/${r.id}`} className="truncate hover:text-primary hover:underline">
                  {r.title}
                </Link>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{r.count}×</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function Mini({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg bg-white/70 px-1 py-1.5 shadow-sm dark:bg-white/5">
      <div className="text-sm font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

/** Plain-language nudges from the numbers — only the ones that apply. */
function Tips({ report }: { report: Awaited<ReturnType<typeof getStatsReport>> }) {
  const tips: string[] = [];
  const p = report.proteinsPerWeek;

  if (report.heartFocus) {
    if (p.oilyFish < 2) tips.push(`Oily fish is at ${p.oilyFish} a week — salmon, mackerel or sardines twice a week is the goal.`);
    if (p.pulses < 3) tips.push(`Beans, lentils or tofu are at ${p.pulses} a week — try a "Heart-healthy week" plan to get to 3.`);
    if (p.redMeat > 1) tips.push(`Red meat is at ${p.redMeat} a week — swapping one for chicken or fish helps.`);
    if (p.processedMeat > 0) tips.push(`Processed meat turned up ${p.processedMeat} times a week — bacon, sausages and ham are worth cutting.`);
  }
  if (report.totals.distinctRecipes > 0 && report.totals.meals / report.totals.distinctRecipes > 3) {
    tips.push("You're repeating a small set of dishes — the planner's \"Try something new\" style mixes it up.");
  }
  if (report.neverEaten > 0) {
    tips.push(
      report.neverEaten === 1
        ? "1 recipe in your library has never been eaten."
        : `${report.neverEaten} recipes in your library have never been eaten.`
    );
  }
  if (report.totals.cooksLogged === 0) {
    tips.push("Log cooks from cooking mode to see who ate what, and how long things really take.");
  }

  if (!tips.length) return null;
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium">Tips</h3>
      <ul className="space-y-1.5 text-sm">
        {tips.map((t) => (
          <li key={t} className="flex gap-2">
            <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
