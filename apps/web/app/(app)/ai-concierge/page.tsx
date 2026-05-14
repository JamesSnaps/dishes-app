import Link from "next/link";
import { Suspense } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@dishes/ui";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { getAiConfig } from "@/app/actions/settings";
import { ConciergeClient } from "./_components/concierge-client";

export const metadata = { title: "AI Concierge" };

export default async function AiConciergePage() {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);
  const aiConfig = await getAiConfig(householdId);

  if (!aiConfig?.hasKey) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <Sparkles className="h-8 w-8 text-muted-foreground/50" />
        </div>
        <h1 className="text-xl font-semibold mb-2">AI not configured</h1>
        <p className="text-sm text-muted-foreground mb-6 max-w-sm">
          Add your OpenAI API key in Settings to start generating recipe ideas with the AI Concierge.
        </p>
        <Button asChild>
          <Link href="/settings/ai">Configure AI</Link>
        </Button>
      </div>
    );
  }

  return (
    <Suspense>
      <ConciergeClient />
    </Suspense>
  );
}
