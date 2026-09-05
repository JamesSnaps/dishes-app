"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@dishes/ui";
import { redeemLibraryInvite } from "@/app/actions/library-shares";

/** Accepting is a mutation, so it lives behind a button rather than the page load. */
export function RedeemInviteButton({
  code,
  ownerName,
}: {
  code: string;
  ownerName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function accept() {
    setError(null);
    startTransition(async () => {
      const { result, error: err } = await redeemLibraryInvite(code);
      if (err || !result) {
        setError(err ?? "Couldn't accept that invitation.");
        return;
      }

      switch (result.status) {
        case "redeemed":
        case "already-connected":
          router.push(`/shared/${result.shareId}`);
          break;
        case "self":
          setError("That invitation was created by your own household.");
          break;
        case "unavailable":
          setError("That invitation has expired or been used already.");
          break;
      }
    });
  }

  return (
    <>
      <Button className="w-full gap-2" onClick={accept} disabled={isPending}>
        {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        Accept and browse {ownerName}
      </Button>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </>
  );
}
