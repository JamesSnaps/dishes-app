"use client";

import { useTransition, useState } from "react";
import Link from "next/link";
import { MoreVertical, Edit, Trash2, FolderOpen, FileText, CalendarDays, Share2, Printer, Download } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@dishes/ui";
import { deleteRecipe } from "@/app/actions/recipes";
import { AddToCollectionDialog } from "./add-to-collection-dialog";
import { AddToMealPlanDialog } from "./add-to-meal-plan-dialog";
import { ShareRecipeSheet } from "./share-recipe-sheet";

interface Props {
  recipeId: string;
  recipeTitle: string;
  hasSmtp: boolean;
}

export function RecipeActionsMenu({ recipeId, recipeTitle, hasSmtp }: Props) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [mealPlanOpen, setMealPlanOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      await deleteRecipe(recipeId);
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0">
            <MoreVertical className="h-5 w-5" />
            <span className="sr-only">Recipe actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/recipes/${recipeId}/edit`} className="flex items-center gap-2">
              <Edit className="h-4 w-4" />
              Edit recipe
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="flex items-center gap-2"
            onSelect={() => setCollectionOpen(true)}
          >
            <FolderOpen className="h-4 w-4" />
            Add to collection
          </DropdownMenuItem>
          <DropdownMenuItem
            className="flex items-center gap-2"
            onSelect={() => setMealPlanOpen(true)}
          >
            <CalendarDays className="h-4 w-4" />
            Add to meal plan
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/notes/new?recipeId=${recipeId}`} className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Add note
            </Link>
          </DropdownMenuItem>
          <ShareRecipeSheet
            recipeId={recipeId}
            recipeTitle={recipeTitle}
            hasSmtp={hasSmtp}
          />
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="flex items-center gap-2">
              <Share2 className="h-4 w-4" />
              Export
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem asChild>
                <a
                  href={`/recipes/${recipeId}/print`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2"
                >
                  <Printer className="h-4 w-4" />
                  PDF
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a
                  href={`/api/recipes/${recipeId}/export`}
                  className="flex items-center gap-2"
                >
                  <Download className="h-4 w-4" />
                  Plain text
                </a>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive flex items-center gap-2"
            onSelect={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
            Delete recipe
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AddToCollectionDialog
        recipeId={recipeId}
        open={collectionOpen}
        onOpenChange={setCollectionOpen}
      />

      <AddToMealPlanDialog
        recipeId={recipeId}
        open={mealPlanOpen}
        onOpenChange={setMealPlanOpen}
      />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete recipe?</DialogTitle>
            <DialogDescription>
              &ldquo;{recipeTitle}&rdquo; will be permanently deleted. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={pending} onClick={handleDelete}>
              {pending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
