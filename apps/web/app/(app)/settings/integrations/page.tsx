import Link from "next/link";
import { headers } from "next/headers";
import { Bot, ChevronLeft, Plug } from "lucide-react";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { publicOrigin } from "@/lib/public-origin";
import { listIntegrationTokens } from "@/app/actions/integrations";
import { TokenList } from "./_components/token-list";
import { CreateTokenForm } from "./_components/create-token-form";
import { EndpointReference } from "./_components/endpoint-reference";
import { TryIt } from "./_components/try-it";
import { CopyButton } from "./_components/copy-button";

export const metadata = { title: "Integrations" };
export const dynamic = "force-dynamic";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{children}</h2>;
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-orange-700 dark:text-orange-300">{label}</p>
      <div className="mt-1 flex items-center gap-2 rounded-lg bg-background/80 px-3 py-2 shadow-sm">
        <code className="min-w-0 flex-1 break-all text-xs">{value}</code>
        <CopyButton text={value} />
      </div>
    </div>
  );
}

export default async function IntegrationsPage() {
  const user = await getAutheliaUser();
  const { householdId, role } = await requireHousehold(user);
  const isAdmin = role === "admin";

  const [tokens, headerList] = await Promise.all([listIntegrationTokens(householdId), headers()]);
  const origin = publicOrigin(headerList);
  const specUrl = `${origin}/api/integrations/openapi.json`;

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
          <Plug className="h-5 w-5 text-orange-500" />
          <h1 className="text-2xl font-bold">Integrations</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          A JSON API for n8n, Home Assistant, Siri Shortcuts and AI assistants, authenticated with household
          tokens.
        </p>
      </div>

      {/* Connection details */}
      <div className="mb-8 space-y-3 rounded-xl border border-orange-300/50 bg-gradient-to-br from-orange-500/15 via-amber-500/10 to-rose-500/10 p-4 shadow-sm dark:border-orange-900/60">
        <CopyRow label="Base URL" value={`${origin}/api/integrations`} />
        <CopyRow label="OpenAPI spec" value={specUrl} />
        <p className="text-xs text-muted-foreground">
          Send <code className="rounded bg-background/70 px-1">Authorization: Bearer &lt;token&gt;</code> on every
          request. 100 requests/minute per token. The spec URL needs no token.
        </p>
      </div>

      {/* Tokens */}
      <section className="mb-8">
        <SectionHeading>Tokens</SectionHeading>
        {!isAdmin && (
          <p className="mb-3 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
            Only admins can create or revoke integration tokens.
          </p>
        )}
        <TokenList tokens={tokens} />
        {isAdmin && (
          <div className="mt-3">
            <CreateTokenForm />
          </div>
        )}
      </section>

      {/* AI assistants */}
      <section className="mb-8">
        <SectionHeading>Connect an AI assistant</SectionHeading>
        <div className="rounded-xl border border-violet-300/50 bg-gradient-to-br from-violet-500/15 via-fuchsia-500/10 to-sky-500/10 p-4 text-sm shadow-sm dark:border-violet-900/60">
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <Bot className="h-4 w-4 text-violet-500" />
            Grok, ChatGPT, Claude and other assistants
          </div>
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>
              Create a token with only <code className="rounded bg-background/70 px-1">read:meal_plan</code>. That
              lets the assistant see the plan and full recipes but change nothing. Add{" "}
              <code className="rounded bg-background/70 px-1">read:shopping_list</code> if you want it to see the
              shopping list too.
            </li>
            <li>
              Wherever the assistant lets you add a custom action, tool or API (or in an n8n workflow sitting in
              between), import the OpenAPI spec URL above.
            </li>
            <li>
              Set authentication to <strong>Bearer token</strong> (API key in the{" "}
              <code className="rounded bg-background/70 px-1">Authorization</code> header) and paste the token.
            </li>
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">
            The spec tells the assistant to call <code className="rounded bg-background/70 px-1">getToday</code> or{" "}
            <code className="rounded bg-background/70 px-1">getWeekMealPlan</code> for what&apos;s planned, then{" "}
            <code className="rounded bg-background/70 px-1">getRecipe</code> for ingredients and method. Avoid giving
            an assistant <code className="rounded bg-background/70 px-1">write:meal_plan</code> unless you want it
            spending AI credit on meal generation.
          </p>
        </div>
      </section>

      {/* Endpoint reference */}
      <section className="mb-8">
        <SectionHeading>Endpoints</SectionHeading>
        <EndpointReference origin={origin} />
      </section>

      {/* Try it */}
      <section>
        <SectionHeading>Try it</SectionHeading>
        <TryIt />
      </section>
    </div>
  );
}
