"use client";

import { useRef, useState, useEffect } from "react";
import { Camera, ImageIcon, Loader2, AlertCircle } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@dishes/ui";
import { analyzeRecipePhoto, type GeneratedRecipe } from "@/app/actions/ai";

// ── Types ──────────────────────────────────────────────────────────────────────

interface PhotoImportModalProps {
  onImport: (recipe: GeneratedRecipe) => void;
}

type Phase = "idle" | "analyzing" | "error";

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Resize to ≤ 1600 px on the long edge and re-encode as JPEG before sending. */
async function resizeToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const MAX = 1600;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        if (width >= height) {
          height = Math.round((height * MAX) / width);
          width = MAX;
        } else {
          width = Math.round((width * MAX) / height);
          height = MAX;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);

      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      // Use indexOf to safely extract base64 data regardless of any commas in metadata
      const commaIdx = dataUrl.indexOf(",");
      resolve({
        base64: commaIdx >= 0 ? dataUrl.substring(commaIdx + 1) : dataUrl,
        mimeType: "image/jpeg",
      });
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to load image for processing."));
    };

    img.src = objectUrl;
  });
}

// ── Rotating loading messages ──────────────────────────────────────────────────

const SCAN_MESSAGES = [
  "Reading the recipe…",
  "Identifying ingredients…",
  "Structuring the method…",
  "Almost there…",
];

// ── Component ──────────────────────────────────────────────────────────────────

export function PhotoImportModal({ onImport }: PhotoImportModalProps) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [msgIdx, setMsgIdx] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Interval ref — cleaned up on unmount to prevent timer leak
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Epoch ref — incremented on dialog close to cancel any in-flight processFile calls
  const epochRef = useRef(0);

  // ── Cleanup on unmount ────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function startMessageCycle() {
    setMsgIdx(0);
    timerRef.current = setInterval(
      () => setMsgIdx((i) => (i + 1) % SCAN_MESSAGES.length),
      2000
    );
  }

  function stopMessageCycle() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function reset() {
    setPhase("idle");
    setError(null);
    stopMessageCycle();
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleOpenChange(v: boolean) {
    if (!v) {
      // Invalidate any in-flight processFile so it won't update state after close
      epochRef.current += 1;
      reset();
    }
    setOpen(v);
  }

  // ── File handling ────────────────────────────────────────────────────────────

  async function processFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("Please select an image file.");
      setPhase("error");
      return;
    }

    // Capture epoch at the start — if the dialog closes before we finish,
    // epochRef will have been incremented and we bail out before touching state.
    const myEpoch = ++epochRef.current;

    setPhase("analyzing");
    setError(null);
    startMessageCycle();

    try {
      const { base64, mimeType } = await resizeToBase64(file);
      if (epochRef.current !== myEpoch) return; // dialog was closed

      const result = await analyzeRecipePhoto(base64, mimeType);
      if (epochRef.current !== myEpoch) return; // dialog was closed

      stopMessageCycle();

      if (result.error || !result.recipe) {
        setError(result.error ?? "Could not extract a recipe from this image.");
        setPhase("error");
        return;
      }

      onImport(result.recipe);
      setOpen(false);
      reset();
    } catch (err) {
      if (epochRef.current !== myEpoch) return; // dialog was closed
      stopMessageCycle();
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPhase("error");
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  // Manage `capture` attribute purely imperatively — do not set it in JSX so
  // React reconciliation can't fight our DOM mutations between opens.
  function openCamera() {
    if (!fileInputRef.current) return;
    fileInputRef.current.setAttribute("capture", "environment");
    fileInputRef.current.click();
  }

  function openGallery() {
    if (!fileInputRef.current) return;
    fileInputRef.current.removeAttribute("capture");
    fileInputRef.current.click();
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1.5">
          <Camera className="h-4 w-4" />
          Scan recipe photo
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Import from photo</DialogTitle>
        </DialogHeader>

        {/*
          No `capture` attribute here — we set/remove it imperatively per button
          click so React's reconciler cannot clobber our DOM mutation.
        */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* ── Idle: choose source ── */}
        {phase === "idle" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Take a photo of a recipe or choose one from your library. AI will
              extract the title, ingredients, and method and pre-fill the form
              so you can review before saving.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={openCamera}
                className="flex flex-col items-center justify-center gap-2 h-24 rounded-xl border-2 border-dashed border-muted-foreground/30 bg-muted/30 hover:bg-muted/60 hover:border-muted-foreground/50 transition-colors cursor-pointer"
              >
                <Camera className="h-6 w-6 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Take photo</span>
              </button>

              <button
                type="button"
                onClick={openGallery}
                className="flex flex-col items-center justify-center gap-2 h-24 rounded-xl border-2 border-dashed border-muted-foreground/30 bg-muted/30 hover:bg-muted/60 hover:border-muted-foreground/50 transition-colors cursor-pointer"
              >
                <ImageIcon className="h-6 w-6 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Choose image</span>
              </button>
            </div>

            <p className="text-xs text-center text-muted-foreground">
              Works best with clear, well-lit photos of printed or handwritten recipes.
            </p>
          </div>
        )}

        {/* ── Analyzing ── */}
        {phase === "analyzing" && (
          <div className="flex flex-col items-center justify-center gap-4 py-10">
            <div className="h-16 w-16 rounded-full bg-gradient-to-br from-violet-500/20 to-purple-600/20 flex items-center justify-center ring-4 ring-violet-500/10">
              <Loader2 className="h-7 w-7 animate-spin text-violet-500" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-sm font-medium">{SCAN_MESSAGES[msgIdx]}</p>
              <p className="text-xs text-muted-foreground">This usually takes 10–20 seconds</p>
            </div>
          </div>
        )}

        {/* ── Error ── */}
        {phase === "error" && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
              <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={reset}>
                Try again
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
