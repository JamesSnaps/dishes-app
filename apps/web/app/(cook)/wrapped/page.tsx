import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { getWrappedReport } from "@/lib/services/wrapped";
import { WrappedStory } from "./_components/wrapped-story";

export const metadata = { title: "Dishes Wrapped" };

export default async function WrappedPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);
  const { year } = await searchParams;
  const report = await getWrappedReport(householdId, year ? Number(year) : undefined);
  // Keyed by year so switching years restarts the story from slide one.
  return <WrappedStory key={report.year} report={report} />;
}
