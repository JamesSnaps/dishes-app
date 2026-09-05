import Link from "next/link";
import { BookOpen, Library } from "lucide-react";
import { Button } from "@dishes/ui";
import { requireSession } from "@/lib/session";
import { previewLibraryInvite } from "@/lib/services/library-shares";
import { RedeemInviteButton } from "./_components/redeem-invite-button";

export const metadata = { title: "Library invitation" };

interface Props {
  params: Promise<{ code: string }>;
}

function Shell({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Library className="h-6 w-6" />
      </div>
      <h1 className="mt-5 text-2xl font-bold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      <div className="mt-6">
        {action ?? (
          <Button asChild variant="outline">
            <Link href="/shared">Shared with me</Link>
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Previewing an invitation. Deliberately does not redeem on load — accepting
 * is a mutation and belongs behind a button, not a GET.
 */
export default async function LibraryInvitePage({ params }: Props) {
  const { code } = await params;
  const session = await requireSession();
  const preview = await previewLibraryInvite(session, code);

  if (preview.status === "not-found") {
    return (
      <Shell
        title="Invitation not found"
        body="That link doesn't match any invitation. Ask whoever sent it for a fresh one."
      />
    );
  }

  if (preview.status === "self") {
    return (
      <Shell
        title="That's your own library"
        body="This invitation was created by your household, so there's nothing to accept. Send the link to whoever you meant to share with."
      />
    );
  }

  if (preview.status === "revoked") {
    return (
      <Shell
        title="This share has ended"
        body="The invitation was revoked. Anything you'd already copied stays in your library."
      />
    );
  }

  if (preview.status === "expired") {
    return (
      <Shell
        title="Invitation expired"
        body="Invitation links are short-lived. Ask for a new one — it takes them a couple of clicks."
      />
    );
  }

  if (preview.status === "already-redeemed") {
    return preview.byOwnHousehold && preview.shareId ? (
      <Shell
        title="You already have this"
        body="This library is already shared with your household."
        action={
          <Button asChild>
            <Link href={`/shared/${preview.shareId}`}>Open the library</Link>
          </Button>
        }
      />
    ) : (
      <Shell
        title="Invitation already used"
        body="Someone else has already accepted this invitation. If that wasn't meant to be you, ask the sender to revoke it and issue a new one."
      />
    );
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/75 text-primary-foreground shadow-lg shadow-primary/30">
        <BookOpen className="h-8 w-8" />
      </div>

      <h1 className="mt-5 text-2xl font-bold tracking-tight">
        {preview.ownerHouseholdName} wants to share their recipes
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {preview.recipeCount} recipe{preview.recipeCount === 1 ? "" : "s"} you&apos;ll be able
        to browse and copy from. {preview.label ? `They called it "${preview.label}". ` : ""}
        They can&apos;t see anything of yours, and they can stop sharing at any time.
      </p>

      <div className="mt-6 w-full">
        <RedeemInviteButton code={code} ownerName={preview.ownerHouseholdName} />
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Copies you take are yours to edit. Their later changes won&apos;t reach them.
      </p>
    </div>
  );
}
