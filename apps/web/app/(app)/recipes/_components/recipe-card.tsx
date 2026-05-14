import Link from "next/link";
import { Clock, UtensilsCrossed } from "lucide-react";
import { Badge, Card } from "@dishes/ui";
import { FavouriteButton } from "./favourite-button";

type RecipeCardProps = {
  id: string;
  title: string;
  description: string | null;
  cuisine: string | null;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  imageUrl: string | null;
  isFavourite: boolean;
  isAiGenerated: boolean;
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
  isFavourite,
  isAiGenerated,
}: RecipeCardProps) {
  const time = totalTime(prepTimeMinutes, cookTimeMinutes);

  return (
    <Link href={`/recipes/${id}`} className="group block">
      <Card className="overflow-hidden transition-shadow hover:shadow-md h-full">
        {/* Image / placeholder */}
        <div className="relative aspect-[4/3] bg-muted flex items-center justify-center">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={title}
              className="h-full w-full object-cover"
            />
          ) : (
            <UtensilsCrossed className="h-10 w-10 text-muted-foreground/30" />
          )}

          <div className="absolute top-2 right-2">
            <FavouriteButton recipeId={id} isFavourite={isFavourite} size="sm" />
          </div>
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
    </Link>
  );
}
