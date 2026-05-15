"use client";

import { useTransition, useState } from "react";
import { Plus } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Textarea,
} from "@dishes/ui";
import { createCollection } from "@/app/actions/collections";
import { EmojiPicker } from "./emoji-picker";

export function CreateCollectionDialog() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [icon, setIcon] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    if (icon) formData.set("icon", icon);
    startTransition(async () => {
      await createCollection(formData);
      setOpen(false);
      setIcon(null);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setIcon(null); }}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" />
          New Collection
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New collection</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Name</Label>
            <div className="flex items-center gap-2">
              <EmojiPicker value={icon} onChange={setIcon} />
              <Input name="name" placeholder="e.g. Weekend dinners" required autoFocus className="flex-1" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="description">Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Textarea id="description" name="description" placeholder="What's this collection for?" rows={2} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
