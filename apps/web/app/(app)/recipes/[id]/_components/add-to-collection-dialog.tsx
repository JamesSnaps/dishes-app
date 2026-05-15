"use client";

import { useEffect, useState, useTransition } from "react";
import { FolderOpen, Plus } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@dishes/ui";
import { addRecipeToCollection, getHouseholdCollections } from "@/app/actions/collections";
import Link from "next/link";

interface Props {
  recipeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Collection = { id: string; name: string };

export function AddToCollectionDialog({ recipeId, open, onOpenChange }: Props) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getHouseholdCollections()
      .then(setCollections)
      .finally(() => setLoading(false));
  }, [open]);

  function handleAdd(collectionId: string) {
    startTransition(async () => {
      await addRecipeToCollection(collectionId, recipeId);
      setAdded((prev) => new Set(prev).add(collectionId));
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to collection</DialogTitle>
        </DialogHeader>

        {loading ? (
          <p className="py-4 text-sm text-muted-foreground text-center">Loading…</p>
        ) : collections.length === 0 ? (
          <div className="py-4 flex flex-col items-center gap-3 text-center">
            <p className="text-sm text-muted-foreground">No collections yet.</p>
            <Button asChild size="sm" variant="outline">
              <Link href="/collections" onClick={() => onOpenChange(false)}>
                <Plus className="mr-1 h-4 w-4" />
                Create one
              </Link>
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-1 py-1">
            {collections.map((col) => (
              <button
                key={col.id}
                disabled={pending || added.has(col.id)}
                onClick={() => handleAdd(col.id)}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-muted transition-colors text-left disabled:opacity-60"
              >
                <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate">{col.name}</span>
                {added.has(col.id) && (
                  <span className="text-xs text-primary font-medium">Added</span>
                )}
              </button>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
