import { redirect } from "next/navigation";
import Link from "next/link";
import { LinkIcon, UtensilsCrossed } from "lucide-react";
import { Button } from "@dishes/ui";
import { requireSession } from "@/lib/session";
import { importSharedRecipe, ShareLinkInvalidError } from "@/lib/services/recipe-import";
import { revalidatePath } from "next/cache";

/**
 * The authenticated half of "Add to my Dishes".
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

  if (result.status === "imported") {
    revalidatePath("/recipes");
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
