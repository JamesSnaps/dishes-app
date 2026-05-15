"use client";

import { useTransition, useState } from "react";
import { EmojiPicker } from "../../_components/emoji-picker";
import { updateCollectionIcon } from "@/app/actions/collections";

interface Props {
  collectionId: string;
  initialIcon: string | null;
}

export function CollectionIconButton({ collectionId, initialIcon }: Props) {
  const [icon, setIcon] = useState<string | null>(initialIcon);
  const [, startTransition] = useTransition();

  function handleChange(emoji: string | null) {
    setIcon(emoji);
    startTransition(async () => {
      await updateCollectionIcon(collectionId, emoji);
    });
  }

  return <EmojiPicker value={icon} onChange={handleChange} large />;
}
