import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import { recipes } from "@dishes/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { requireSession } from "@/lib/session";
import { getSharedLibrary } from "@/lib/services/library-browse";
import { LibraryShareInvalidError } from "@/lib/services/library-share-scope";
import { SharedLibraryGrid } from "./_components/shared-library-grid";

export const metadata = { title: "Shared library" };

interface Props {
  params: Promise<{ shareId: string }>;
}

export default async function SharedLibraryPage({ params }: Props) {
  const { shareId } = await params;
  const session = await requireSession();

  let library;
  try {
    library = await getSharedLibrary(session, shareId);
  } catch (err) {
    // Revoked, never granted, or someone else's — all the same to the viewer.
    if (err instanceof LibraryShareInvalidError) notFound();
    throw err;
  }

  // Which of these we already hold a copy of, so the grid can say so rather
  // than letting someone import the same thing twice.
  const copies = await db
    .select({ source: recipes.importedFromRecipeId, id: recipes.id })
    .from(recipes)
    .where(
      and(
        eq(recipes.householdId, session.householdId),
        isNotNull(recipes.importedFromRecipeId)
      )
    );

  const alreadyImported = Object.fromEntries(
    copies.filter((c) => c.source).map((c) => [c.source!, c.id])
  );

  return (
    <div className="mx-auto max-w-6xl p-4 lg:p-8">
      <Link
        href="/shared"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Shared with me
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-bold">{library.scope.ownerHouseholdName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {library.recipes.length} recipe{library.recipes.length === 1 ? "" : "s"} shared
          with your household. Nothing here changes unless you copy it.
        </p>
      </div>

      <SharedLibraryGrid
        shareId={shareId}
        ownerName={library.scope.ownerHouseholdName}
        recipes={library.recipes}
        cuisines={library.cuisines}
        tags={library.tags}
        alreadyImported={alreadyImported}
        canImport={session.role !== "child"}
      />
    </div>
  );
}
