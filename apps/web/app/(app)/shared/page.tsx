import Link from "next/link";
import { BookOpen, Library } from "lucide-react";
import { requireSession } from "@/lib/session";
import { listIncomingLibraryShares } from "@/lib/services/library-shares";

export const metadata = { title: "Shared with me" };

export default async function SharedLibrariesPage() {
  const session = await requireSession();
  const libraries = await listIncomingLibraryShares(session);

  return (
    <div className="mx-auto max-w-4xl p-4 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Shared with me</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Libraries other households have opened up to you. Browse them and take a
          copy of anything you like — your copy is yours to edit.
        </p>
      </div>

      {libraries.length === 0 ? (
        <div className="rounded-2xl border bg-gradient-to-br from-primary/[0.06] to-card p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Library className="h-6 w-6" />
          </div>
          <p className="mt-4 font-semibold">Nothing shared with you yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            When someone on this server shares their library, they&apos;ll send you an
            invitation link. Open it and the library appears here for good.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {libraries.map((lib) => (
            <Link
              key={lib.id}
              href={`/shared/${lib.id}`}
              className="group flex items-start gap-4 rounded-2xl border bg-gradient-to-br from-card to-primary/[0.05] p-4 shadow-sm transition-all hover:border-primary/40 hover:shadow-md"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/75 text-primary-foreground shadow-md shadow-primary/25">
                <BookOpen className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate font-semibold leading-tight group-hover:text-primary">
                  {lib.ownerHouseholdName}
                </p>
                {lib.label && (
                  <p className="truncate text-sm text-muted-foreground">{lib.label}</p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {lib.recipeCount} recipe{lib.recipeCount === 1 ? "" : "s"} shared
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
