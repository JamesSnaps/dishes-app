"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@dishes/ui";
import { clearClientErrors } from "@/app/actions/diagnostics";

export function ClearErrorsButton() {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => startTransition(() => clearClientErrors())}
    >
      <Trash2 className="mr-2 h-4 w-4" />
      {pending ? "Clearing…" : "Clear all reports"}
    </Button>
  );
}
