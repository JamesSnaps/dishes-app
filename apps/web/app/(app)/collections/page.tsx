import Link from "next/link";
import { FolderOpen } from "lucide-react";
import { db } from "@/lib/db";
import { collections, recipeCollections } from "@dishes/db/schema";
import { eq, count } from "drizzle-orm";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { CreateCollectionDialog } from "./_components/create-collection-dialog";

export const metadata = { title: "Collections" };

export default async function CollectionsPage() {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const rows = await db
    .select({
      id: collections.id,
      name: collections.name,
      icon: collections.icon,
      description: collections.description,
      recipeCount: count(recipeCollections.recipeId),
    })
    .from(collections)
    .leftJoin(recipeCollections, eq(recipeCollections.collectionId, collections.id))
    .where(eq(collections.householdId, householdId))
    .groupBy(collections.id, collections.icon)
    .orderBy(collections.name);

  return (
    <div className="p-4 lg:p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Collections</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {rows.length} collection{rows.length !== 1 ? "s" : ""}
          </p>
        </div>
        <CreateCollectionDialog />
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
          <FolderOpen className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-muted-foreground">No collections yet.</p>
          <p className="text-sm text-muted-foreground/60">
            Create a collection to group recipes together.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((col) => (
            <Link
              key={col.id}
              href={`/collections/${col.id}`}
              className="group flex flex-col gap-1.5 rounded-xl border bg-card p-5 hover:border-primary/40 hover:shadow-sm transition-all"
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl shrink-0 leading-none mt-0.5 w-7 text-center">
                  {col.icon ?? <FolderOpen className="h-5 w-5 text-primary mt-0.5" strokeWidth={1.75} />}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold leading-tight truncate group-hover:text-primary transition-colors">
                    {col.name}
                  </p>
                  {col.description && (
                    <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
                      {col.description}
                    </p>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1 pl-10">
                {Number(col.recipeCount)} recipe{Number(col.recipeCount) !== 1 ? "s" : ""}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
