import Link from "next/link";
import { ChevronLeft, Share2, ExternalLink } from "lucide-react";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { getAllShareTokens } from "@/app/actions/sharing";
import { RevokeButton } from "./_components/revoke-button";

export const metadata = { title: "Shared Links" };

export default async function SharesPage() {
  const user = await getAutheliaUser();
  await requireHousehold(user);

  const tokens = await getAllShareTokens();
  const active = tokens.filter((t) => t.active);
  const inactive = tokens.filter((t) => !t.active);

  function formatDate(date: Date) {
    return new Date(date).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <div className="mb-6">
        <Link
          href="/settings"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ChevronLeft className="h-4 w-4" />
          Settings
        </Link>
        <div className="flex items-center gap-2">
          <Share2 className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-2xl font-bold">Shared links</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage public links to your recipes. Revoking a link makes it immediately inaccessible.
        </p>
      </div>

      {/* Active links */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Active ({active.length})
        </h2>
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center border rounded-xl">
            No active share links. Open any recipe and use the actions menu to share it.
          </p>
        ) : (
          <div className="divide-y rounded-xl border overflow-hidden">
            {active.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-4 py-3 bg-card">
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/recipes/${t.recipeId}`}
                    className="text-sm font-medium hover:underline line-clamp-1"
                  >
                    {t.recipeTitle}
                  </Link>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Created {formatDate(t.createdAt)}
                    {t.createdBy && ` by ${t.createdBy}`}
                    {t.expiresAt && ` · Expires ${formatDate(t.expiresAt)}`}
                  </p>
                </div>
                <a
                  href={t.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title="Open link"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
                <RevokeButton tokenId={t.id} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Inactive / revoked links */}
      {inactive.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Revoked / expired ({inactive.length})
          </h2>
          <div className="divide-y rounded-xl border overflow-hidden opacity-60">
            {inactive.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-4 py-3 bg-card">
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/recipes/${t.recipeId}`}
                    className="text-sm font-medium hover:underline line-clamp-1"
                  >
                    {t.recipeTitle}
                  </Link>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t.revoked ? "Revoked" : "Expired"} · Created {formatDate(t.createdAt)}
                    {t.createdBy && ` by ${t.createdBy}`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
