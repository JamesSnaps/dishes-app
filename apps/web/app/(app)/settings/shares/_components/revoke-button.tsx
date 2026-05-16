"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@dishes/ui";
import { revokeShareToken } from "@/app/actions/sharing";

export function RevokeButton({ tokenId }: { tokenId: string }) {
  const [isPending, startTransition] = useTransition();

  function handleRevoke() {
    startTransition(async () => {
      await revokeShareToken(tokenId);
    });
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 text-destructive hover:text-destructive"
      onClick={handleRevoke}
      disabled={isPending}
      title="Revoke link"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}
