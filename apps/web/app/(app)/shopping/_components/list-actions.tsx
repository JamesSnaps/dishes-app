"use client";

import { useTransition } from "react";
import { Archive, Trash2, PackagePlus } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@dishes/ui";
import { clearChecked, archiveList } from "@/app/actions/shopping";
import { addCheckedItemsToStock } from "@/app/actions/pantry";

interface Props {
  listId: string;
  hasChecked: boolean;
}

export function ListActions({ listId, hasChecked }: Props) {
  const [pending, startTransition] = useTransition();

  function handleClearChecked() {
    startTransition(() => clearChecked(listId));
  }

  function handleArchive() {
    startTransition(() => archiveList(listId));
  }

  function handleArchiveAndAddToStock() {
    startTransition(async () => {
      await addCheckedItemsToStock(listId);
      await archiveList(listId);
    });
  }

  return (
    <div className="flex gap-2">
      {hasChecked && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleClearChecked}
          disabled={pending}
        >
          <Trash2 className="mr-1.5 h-4 w-4" />
          Clear checked
        </Button>
      )}
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" disabled={pending}>
            <Archive className="mr-1.5 h-4 w-4" />
            Complete list
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete this list?</DialogTitle>
            <DialogDescription>
              The list will be archived and a new one can be started.
              {hasChecked && " You can also add your checked items to pantry stock."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            {hasChecked && (
              <Button
                variant="outline"
                onClick={handleArchiveAndAddToStock}
                disabled={pending}
                className="w-full sm:w-auto"
              >
                <PackagePlus className="mr-1.5 h-4 w-4" />
                {pending ? "Saving…" : "Complete & add to pantry"}
              </Button>
            )}
            <Button onClick={handleArchive} disabled={pending} className="w-full sm:w-auto">
              {pending ? "Archiving…" : "Complete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
