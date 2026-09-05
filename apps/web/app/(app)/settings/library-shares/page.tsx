import Link from "next/link";
import { ChevronLeft, Library } from "lucide-react";
import { db } from "@/lib/db";
import { collections, recipeTags, recipes } from "@dishes/db/schema";
import { asc, eq } from "drizzle-orm";
import { requireSession } from "@/lib/session";
import { listOutgoingLibraryShares } from "@/lib/services/library-shares";
import { ShareLibraryPanel } from "./_components/share-library-panel";

export const metadata = { title: "Shared libraries" };

export default async function LibrarySharesPage() {
  const session = await requireSession();
  const isAdmin = session.role === "admin";

  const [outgoing, householdCollections, tagRows] = await Promise.all([
    listOutgoingLibraryShares(session),
    db
      .select({ id: collections.id, name: collections.name, icon: collections.icon })
      .from(collections)
      .where(eq(collections.householdId, session.householdId))
      .orderBy(asc(collections.name)),
    // Join through recipes: recipe_tags carries no household of its own, and
    // an unfiltered distinct would list every household's tags on the server.
    db
      .selectDistinct({ tag: recipeTags.tag })
      .from(recipeTags)
      .innerJoin(recipes, eq(recipes.id, recipeTags.recipeId))
      .where(eq(recipes.householdId, session.householdId))
      .orderBy(asc(recipeTags.tag)),
  ]);

  return (
    <div className="mx-auto max-w-3xl p-4 lg:p-8">
      <Link
        href="/settings"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Settings
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-bold">Shared libraries</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Let another household on this server browse part of your recipe library and
          copy from it. They never see your meal plans, shopping lists, or private
          notes — and you can stop sharing at any time.
        </p>
      </div>

      {!isAdmin ? (
        <div className="rounded-2xl border bg-card p-6 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Library className="h-5 w-5" />
          </div>
          <p className="mt-3 font-medium">Admins only</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Sharing your household&apos;s library with another household is an admin
            decision. Ask an admin in your household to set it up.
          </p>
        </div>
      ) : (
        <ShareLibraryPanel
          shares={outgoing}
          collections={householdCollections}
          tags={tagRows.map((t) => t.tag)}
        />
      )}
    </div>
  );
}
