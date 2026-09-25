import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiConfigurations } from "@dishes/db/schema";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { getWrappedReport } from "@/lib/services/wrapped";
import { getCachedRecap } from "@/lib/services/wrapped-recap";
import { WrappedStory } from "./_components/wrapped-story";

export const metadata = { title: "Dishes Wrapped" };

export default async function WrappedPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);
  const { year } = await searchParams;
  const report = await getWrappedReport(householdId, year ? Number(year) : undefined);
  const [recap, ai] = await Promise.all([
    getCachedRecap(householdId, report.year),
    db
      .select({ id: aiConfigurations.id })
      .from(aiConfigurations)
      .where(eq(aiConfigurations.householdId, householdId))
      .limit(1),
  ]);
  // Keyed by year so switching years restarts the story from slide one.
  return <WrappedStory key={report.year} report={report} initialRecap={recap} aiAvailable={ai.length > 0} />;
}
