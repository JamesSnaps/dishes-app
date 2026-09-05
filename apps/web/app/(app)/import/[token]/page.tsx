import { redirect } from "next/navigation";
import Link from "next/link";
import { LinkIcon, UtensilsCrossed } from "lucide-react";
import { Button } from "@dishes/ui";
import { requireSession } from "@/lib/session";
import { importSharedRecipe, ShareLinkInvalidError } from "@/lib/services/recipe-import";

/**
 * The authenticated half of "Add to my Dishes".
 *
 * The import runs during render rather than in an action, which is safe here
 * only because it is idempotent: a second pass finds the copy it already made
 * and returns that instead of duplicating. Nothing calls revalidatePath — it
 * is illegal during render, and dynamic pages are refetched on navigation
 * anyway, so the recipe list is current when the user reaches it.
 *
 * Deliberately NOT under /share/, which the reverse proxy and middleware let
 * through unauthenticated — this route must go through Authelia so that
 * requireSession() can resolve (and, for a first-time visitor, create) the
 * household the copy lands in.
 */

interface Props {
  params: Promise<{ token: string }>;
}

export const metadata = { title: "Adding recipe — Dishes" };

export default async function ImportSharedRecipePage({ params }: Props) {
  const { token } = await params;
  const session = await requireSession();

  let result;
  try {
    result = await importSharedRecipe(session, token);
  } catch (err) {
    if (!(err instanceof ShareLinkInvalidError)) throw err;
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <LinkIcon className="h-6 w-6" />
        </div>
        <h1 className="mt-5 text-2xl font-bold tracking-tight">Link no longer works</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This share link has been revoked or has expired. Ask whoever sent it for a
          fresh one.
        </p>
        <Button asChild className="mt-6">
          <Link href="/recipes">Back to my recipes</Link>
        </Button>
      </div>
    );
  }

  // "failed" only arises in a batch import from a shared library; a single
  // link either works or throws. Handled anyway so the union stays exhaustive.
  if (result.status === "failed") {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <LinkIcon className="h-6 w-6" />
        </div>
        <h1 className="mt-5 text-2xl font-bold tracking-tight">Couldn&apos;t add that recipe</h1>
        <p className="mt-2 text-sm text-muted-foreground">{result.reason}</p>
        <Button asChild className="mt-6">
          <Link href="/recipes">Back to my recipes</Link>
        </Button>
      </div>
    );
  }

  const query =
    result.status === "imported"
      ? `?imported=${encodeURIComponent(result.sourceName)}`
      : result.status === "duplicate"
        ? "?imported=already"
        : "";

  redirect(`/recipes/${result.recipeId}${query}`);

  // Unreachable — redirect throws — but keeps the component's return type honest.
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <UtensilsCrossed className="h-6 w-6 animate-pulse text-primary" />
    </div>
  );
}
