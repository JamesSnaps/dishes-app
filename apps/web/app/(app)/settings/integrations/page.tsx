import Link from "next/link";
import { headers } from "next/headers";
import { Bot, ChevronLeft, Plug, Sparkles, UtensilsCrossed } from "lucide-react";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { publicOrigin } from "@/lib/public-origin";
import { listIntegrationTokens, listTokenMembers } from "@/lib/services/integration-tokens";
import { TokenList } from "./_components/token-list";
import { CreateTokenForm } from "./_components/create-token-form";
import { EndpointReference } from "./_components/endpoint-reference";
import { TryIt } from "./_components/try-it";
import { CopyButton } from "./_components/copy-button";
import { MENU_ASSISTANT_INSTRUCTIONS } from "@/lib/menu-assistant";

export const metadata = { title: "Integrations" };
export const dynamic = "force-dynamic";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{children}</h2>;
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-primary">{label}</p>
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

  const [tokens, members, headerList] = await Promise.all([
    isAdmin ? listIntegrationTokens({ householdId, role }) : [],
    isAdmin ? listTokenMembers(householdId) : [],
    headers(),
  ]);
  const origin = publicOrigin(headerList);
  const specUrl = `${origin}/api/integrations/openapi.json`;
  const mealsOutSpecUrl = `${specUrl}?ops=meals-out`;
  const mcpUrl = `${origin}/api/integrations/mcp`;
  const claudeCodeCommand = `claude mcp add --transport http dishes ${mcpUrl} --header "Authorization: Bearer <token>"`;
  const claudeDesktopConfig = JSON.stringify(
    {
      mcpServers: {
        dishes: {
          command: "npx",
          args: ["-y", "mcp-remote", mcpUrl, "--header", "Authorization:${DISHES_AUTH}"],
          env: { DISHES_AUTH: "Bearer <token>" },
        },
      },
    },
    null,
    2
  );

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
          <Plug className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold">Integrations</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          A JSON API for n8n, Home Assistant, Siri Shortcuts and AI assistants, authenticated with household
          tokens.
        </p>
      </div>

      {/* Connection details */}
      <div className="mb-8 space-y-3 rounded-xl border border-transparent bg-highlight p-4 shadow-sm">
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
        {isAdmin ? (
          <>
            <TokenList tokens={tokens} />
            <div className="mt-3">
              <CreateTokenForm members={members} />
            </div>
          </>
        ) : (
          <p className="mb-3 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
            Only admins can view, create or revoke integration tokens.
          </p>
        )}
      </section>

      {/* AI assistants */}
      <section className="mb-8">
        <SectionHeading>Connect an AI assistant</SectionHeading>
        <div className="rounded-xl border border-transparent bg-muted p-4 text-sm shadow-sm">
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <Bot className="h-4 w-4 text-foreground" />
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

        <div className="mt-3 rounded-xl border border-transparent bg-success-tint p-4 text-sm shadow-sm">
          <div className="mb-1 flex items-center gap-2 font-semibold">
            <UtensilsCrossed className="h-4 w-4 text-success" />
            ChatGPT: help choosing when eating out
          </div>
          <p className="mb-3 text-muted-foreground">
            A custom GPT that reads the menu you send it (photo, PDF or link), suggests dishes using what Dishes knows
            about who&apos;s eating (dietary needs, tastes, this week&apos;s heart-health targets), then logs what you
            ordered as a meal out. Dishes estimates the nutrition, as it does for meals out logged here.
          </p>
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>
              Create a token with <code className="rounded bg-background/70 px-1">read:preferences</code>,{" "}
              <code className="rounded bg-background/70 px-1">read:meal_plan</code> and{" "}
              <code className="rounded bg-background/70 px-1">write:outside_meals</code>, with <strong>Acts as</strong>{" "}
              set to you. Meals it logs and their ratings will be yours.
            </li>
            <li>
              In ChatGPT: <strong>GPTs → Create → Configure</strong>. Under Actions, <strong>Create new action</strong>{" "}
              and <strong>Import from URL</strong> with this spec, which only has the eating-out operations:
              <div className="mt-1.5">
                <CopyRow label="Eating-out spec" value={mealsOutSpecUrl} />
              </div>
            </li>
            <li>
              Authentication: <strong>API Key</strong>, auth type <strong>Bearer</strong>, and paste the token.
            </li>
            <li>
              Paste these into <strong>Instructions</strong>:
              <div className="mt-1.5 rounded-lg bg-background/80 shadow-sm">
                <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-success">
                    Instructions
                  </span>
                  <CopyButton text={MENU_ASSISTANT_INSTRUCTIONS} />
                </div>
                <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words px-3 py-2 font-sans text-xs">
                  {MENU_ASSISTANT_INSTRUCTIONS}
                </pre>
              </div>
            </li>
            <li>
              Keep the GPT shared with <strong>Only me</strong>: anyone who can use it can read your household&apos;s
              brief and log meals as you.
            </li>
          </ol>
        </div>

        <div className="mt-3 rounded-xl border border-transparent bg-warning-tint p-4 text-sm shadow-sm">
          <div className="mb-1 flex items-center gap-2 font-semibold">
            <Sparkles className="h-4 w-4 text-warning" />
            Claude: the same, as an MCP server
          </div>
          <p className="mb-3 text-muted-foreground">
            The same eating-out tools and instructions as the GPT above, for Claude. Use a token with the same three
            scopes, acting as you; Claude only sees the tools its token allows.
          </p>
          <div className="space-y-3">
            <CopyRow label="MCP server URL" value={mcpUrl} />
            <CopyRow label="Claude Code" value={claudeCodeCommand} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                Claude Desktop — claude_desktop_config.json
              </p>
              <div className="mt-1 rounded-lg bg-background/80 shadow-sm">
                <div className="flex justify-end border-b px-3 py-1.5">
                  <CopyButton text={claudeDesktopConfig} />
                </div>
                <pre className="overflow-x-auto px-3 py-2 text-xs">{claudeDesktopConfig}</pre>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Replace <code className="rounded bg-background/70 px-1">&lt;token&gt;</code>, keeping the word
                Bearer. <code className="rounded bg-background/70 px-1">mcp-remote</code> needs Node.js on the computer
                running Claude Desktop.
              </p>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            On claude.ai (and the Claude apps) a custom connector signs in through Authelia instead of using a token.
            It needs an Authelia client for Claude; the README has the setup.
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
