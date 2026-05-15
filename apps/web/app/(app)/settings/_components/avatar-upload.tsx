"use client";

import { useRef, useState } from "react";
import { Camera } from "lucide-react";
import Image from "next/image";

type Props = {
  memberId: string;
  displayName: string;
  avatarUrl: string | null;
  canEdit: boolean;
};

export function AvatarUpload({ memberId, displayName, avatarUrl, canEdit }: Props) {
  const [currentUrl, setCurrentUrl] = useState(avatarUrl);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`/api/members/${memberId}/avatar`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const { error } = await res.json();
        alert(error ?? "Upload failed.");
        return;
      }
      const { url } = await res.json();
      setCurrentUrl(url);
    } catch {
      alert("Upload failed. Please try again.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const initials = displayName.charAt(0).toUpperCase();

  const avatar = currentUrl ? (
    <Image
      src={currentUrl}
      alt={displayName}
      fill
      className="rounded-full object-cover"
      sizes="36px"
    />
  ) : (
    <div className="flex h-full w-full items-center justify-center rounded-full bg-muted text-sm font-semibold uppercase">
      {uploading ? "…" : initials}
    </div>
  );

  if (!canEdit) {
    return (
      <div className="relative h-9 w-9 shrink-0">
        {avatar}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className="relative h-9 w-9 shrink-0 group"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        title={`Change ${displayName}'s photo`}
      >
        {avatar}
        <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
          <Camera className="h-4 w-4 text-white" />
        </div>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={handleFileChange}
      />
    </>
  );
}
