import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { listIntegrationTokens } from "@/app/actions/integrations";
import { TokenList } from "./_components/token-list";
import { CreateTokenForm } from "./_components/create-token-form";

export const metadata = { title: "Integrations" };

const API_ENDPOINTS = [
  { method: "GET", path: "/api/integrations/today", scope: "read:meal_plan", description: "Today's meals" },
  { method: "GET", path: "/api/integrations/meal-plan/week", scope: "read:meal_plan", description: "Full week plan" },
  { method: "GET", path: "/api/integrations/shopping-list", scope: "read:shopping_list", description: "Active shopping list" },
  { method: "POST", path: "/api/integrations/shopping-list/items", scope: "write:shopping_list", description: "Add shopping items" },
  { method: "POST", path: "/api/integrations/meal-plan/generate", scope: "write:meal_plan", description: "AI meal plan generation" },
];

export default async function IntegrationsPage() {
  const user = await getAutheliaUser();
  const { householdId, role } = await requireHousehold(user);
  const isAdmin = role === "admin";

  const tokens = await listIntegrationTokens(householdId);

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <h1 className="mb-1 text-2xl font-bold">Integrations</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Bearer tokens for n8n, Home Assistant, and other external tools.
      </p>

      {/* API Reference */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          API endpoints
        </h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Method</th>
                <th className="px-3 py-2 text-left font-medium">Path</th>
                <th className="px-3 py-2 text-left font-medium hidden sm:table-cell">Scope</th>
                <th className="px-3 py-2 text-left font-medium hidden md:table-cell">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {API_ENDPOINTS.map((ep) => (
                <tr key={ep.path + ep.method}>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-mono font-semibold ${ep.method === "GET" ? "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" : "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300"}`}>
                      {ep.method}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{ep.path}</td>
                  <td className="px-3 py-2 hidden sm:table-cell">
                    <code className="rounded bg-muted px-1 py-0.5 text-xs">{ep.scope}</code>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground hidden md:table-cell">{ep.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          All requests require <code className="rounded bg-muted px-1">Authorization: Bearer &lt;token&gt;</code>. Rate limit: 100 req/min per token.
        </p>
      </section>

      {/* Token list */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Tokens
        </h2>
        {!isAdmin && (
          <p className="mb-3 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            Only admins can manage integration tokens.
          </p>
        )}
        <TokenList tokens={tokens} />
      </section>

      {/* Create form — admins only */}
      {isAdmin && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            New token
          </h2>
          <CreateTokenForm />
        </section>
      )}
    </div>
  );
}
