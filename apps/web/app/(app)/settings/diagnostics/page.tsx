import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, Bug } from "lucide-react";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { getClientErrors } from "@/app/actions/diagnostics";
import { APP_VERSION } from "@/lib/version";
import { ErrorList } from "./_components/error-list";
import { ClearErrorsButton } from "./_components/clear-errors-button";

export const metadata = { title: "Diagnostics" };

// Always read the table fresh — a page of crash reports cached for even a minute
// is the one page where staleness defeats the point.
export const dynamic = "force-dynamic";

export default async function DiagnosticsPage() {
  const user = await getAutheliaUser();
  const { role } = await requireHousehold(user);
  if (role !== "admin") redirect("/settings");

  const errors = await getClientErrors(50);

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <div className="mb-6">
        <Link
          href="/settings"
          className="mb-4 flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Settings
        </Link>
        <div className="flex items-center gap-2">
          <Bug className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-2xl font-bold">Diagnostics</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          What actually went wrong behind &ldquo;Application error: a client-side
          exception has occurred&rdquo;. The newest 50 reports, from every device
          in the household.
        </p>
      </div>

      <ErrorList errors={errors} serverVersion={APP_VERSION} />

      {errors.length > 0 && (
        <div className="mt-6 flex justify-end">
          <ClearErrorsButton />
        </div>
      )}
    </div>
  );
}
