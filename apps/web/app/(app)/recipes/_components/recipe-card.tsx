"use client";

import Link from "next/link";
import { Check, Clock, UtensilsCrossed } from "lucide-react";
import { Badge, Card, cn } from "@dishes/ui";
import { FavouriteButton } from "./favourite-button";
import { StarRating } from "../[id]/_components/star-rating";

type RecipeCardProps = {
  id: string;
  title: string;
  description: string | null;
  cuisine: string | null;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  imageUrl: string | null;
  thumbnailUrl?: string | null;
  isFavourite: boolean;
  isAiGenerated: boolean;
  averageRating?: number | null;
  cookCount?: number;
  selectable?: boolean;
  selected?: boolean;
  onToggle?: (id: string) => void;
  backSearch?: string;
};

function totalTime(prep: number | null, cook: number | null): string | null {
  const total = (prep ?? 0) + (cook ?? 0);
  if (!total) return null;
  if (total < 60) return `${total}m`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function RecipeCard({
  id,
  title,
  description,
  cuisine,
  prepTimeMinutes,
  cookTimeMinutes,
  imageUrl,
  thumbnailUrl,
  isFavourite,
  isAiGenerated,
  averageRating,
  cookCount,
  selectable = false,
  selected = false,
  onToggle,
  backSearch,
}: RecipeCardProps) {
  const time = totalTime(prepTimeMinutes, cookTimeMinutes);

  const cardContent = (
    <Card className={cn(
      "overflow-hidden transition-all hover:shadow-md h-full",
      selectable && selected && "ring-2 ring-primary ring-offset-2"
    )}>
      {/* Image / placeholder */}
      <div className="relative aspect-[4/3] bg-muted flex items-center justify-center">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnailUrl ?? imageUrl}
            alt={title}
            className="h-full w-full object-cover"
          />
        ) : (
          <UtensilsCrossed className="h-10 w-10 text-muted-foreground/30" />
        )}

        {selectable ? (
          <div className={cn(
            "absolute top-2 left-2 h-6 w-6 rounded-full border-2 flex items-center justify-center transition-all shadow-sm",
            selected
              ? "bg-primary border-primary text-primary-foreground"
              : "bg-white/90 border-gray-300"
          )}>
            {selected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
          </div>
        ) : (
          <div className="absolute top-2 right-2">
            <FavouriteButton recipeId={id} isFavourite={isFavourite} size="sm" />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-3">
        <h3 className="font-semibold leading-tight line-clamp-2 group-hover:text-primary transition-colors">
          {title}
        </h3>

        {description && (
          <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
            {description}
          </p>
        )}

        {/* Rating row */}
        {(cookCount ?? 0) > 0 && (
          <div className="mt-2 flex items-center gap-1.5">
            <StarRating value={averageRating ?? null} readonly size="sm" />
            {averageRating != null && (
              <span className="text-xs text-muted-foreground">{averageRating / 2}/5</span>
            )}
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {cuisine && (
            <Badge variant="secondary" className="text-xs">
              {cuisine}
            </Badge>
          )}
          {isAiGenerated && (
            <Badge variant="outline" className="text-xs">
              AI
            </Badge>
          )}
          {time && (
            <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {time}
            </span>
          )}
        </div>
      </div>
    </Card>
  );

  if (selectable) {
    return (
      <div
        className="group block cursor-pointer select-none"
        onClick={() => onToggle?.(id)}
        role="checkbox"
        aria-checked={selected}
        tabIndex={0}
        onKeyDown={(e) => e.key === " " && onToggle?.(id)}
      >
        {cardContent}
      </div>
    );
  }

  const href = backSearch ? `/recipes/${id}?back=${encodeURIComponent(backSearch)}` : `/recipes/${id}`;

  function handleClick() {
    try {
      sessionStorage.setItem(
        "recipes-list-state",
        JSON.stringify({ search: backSearch ?? "", scrollY: window.scrollY })
      );
    } catch {}
  }

  return (
    <Link href={href} className="group block" onClick={handleClick}>
      {cardContent}
    </Link>
  );
}
