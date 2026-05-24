"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@dishes/ui";

type UnsavedChangesContextType = {
  isDirty: boolean;
  setDirty: (dirty: boolean) => void;
  requestNavigation: (href: string) => void;
};

const UnsavedChangesContext = createContext<UnsavedChangesContextType>({
  isDirty: false,
  setDirty: () => {},
  requestNavigation: () => {},
});

export function UnsavedChangesProvider({ children }: { children: React.ReactNode }) {
  const [isDirty, setIsDirty] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const router = useRouter();

  const setDirty = useCallback((dirty: boolean) => setIsDirty(dirty), []);

  const requestNavigation = useCallback(
    (href: string) => {
      if (!isDirty) {
        router.push(href);
        return;
      }
      setPendingHref(href);
    },
    [isDirty, router]
  );

  function handleConfirm() {
    if (!pendingHref) return;
    setIsDirty(false);
    router.push(pendingHref);
    setPendingHref(null);
  }

  function handleCancel() {
    setPendingHref(null);
  }

  return (
    <UnsavedChangesContext.Provider value={{ isDirty, setDirty, requestNavigation }}>
      {children}
      <Dialog open={pendingHref !== null} onOpenChange={(open) => !open && setPendingHref(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Unsaved changes</DialogTitle>
            <DialogDescription>
              If you leave now, everything you&apos;ve entered will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handleCancel}>
              Keep editing
            </Button>
            <Button variant="destructive" onClick={handleConfirm}>
              Leave anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </UnsavedChangesContext.Provider>
  );
}

export function useUnsavedChanges() {
  return useContext(UnsavedChangesContext);
}
