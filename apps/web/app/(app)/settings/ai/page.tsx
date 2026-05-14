import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { getAiConfig } from "@/app/actions/settings";
import { AiConfigForm } from "./_components/ai-config-form";

export const metadata = { title: "AI Settings" };

export default async function AiSettingsPage() {
  const user = await getAutheliaUser();
  const { householdId, role } = await requireHousehold(user);
  const config = await getAiConfig(householdId);
  const isAdmin = role === "admin";

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <Link
        href="/settings"
        className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Settings
      </Link>

      <h1 className="mb-1 text-2xl font-bold">AI settings</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Your API key is stored encrypted and never exposed to the browser.
        AI generation is used for the recipe concierge flow.
      </p>

      <section className="rounded-lg border bg-card p-4">
        <AiConfigForm config={config} isAdmin={isAdmin} />
      </section>

      {config?.hasKey && (
        <section className="mt-6 rounded-lg border bg-card p-4">
          <h2 className="mb-1 font-semibold">Test connection</h2>
          <p className="text-sm text-muted-foreground">
            Go to{" "}
            <Link href="/recipes/new" className="underline underline-offset-2">
              New recipe
            </Link>{" "}
            and use the AI concierge to verify your key works.
          </p>
        </section>
      )}
    </div>
  );
}
