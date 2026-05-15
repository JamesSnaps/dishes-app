"use client";

import { useState } from "react";

interface StarRatingProps {
  value: number | null; // 0–10
  onChange?: (value: number) => void;
  readonly?: boolean;
  size?: "sm" | "md" | "lg";
}

const sizes = {
  sm: 14,
  md: 20,
  lg: 28,
};

function StarIcon({
  fill,
  px,
  gradientId,
}: {
  fill: "full" | "half" | "empty";
  px: number;
  gradientId: string;
}) {
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block", flexShrink: 0 }}
    >
      {fill === "half" && (
        <defs>
          <linearGradient id={gradientId}>
            <stop offset="50%" stopColor="#f59e0b" />
            <stop offset="50%" stopColor="transparent" />
          </linearGradient>
        </defs>
      )}
      <polygon
        points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"
        fill={
          fill === "full"
            ? "#f59e0b"
            : fill === "half"
              ? `url(#${gradientId})`
              : "currentColor"
        }
        className={fill === "empty" ? "text-muted-foreground/25" : ""}
        stroke={fill === "empty" ? "currentColor" : "#f59e0b"}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function StarRating({
  value,
  onChange,
  readonly = false,
  size = "md",
}: StarRatingProps) {
  const [hover, setHover] = useState<number | null>(null);

  const display = hover ?? value ?? 0;
  const px = sizes[size];

  function fillFor(star: number): "full" | "half" | "empty" {
    const threshold = display / 2;
    if (threshold >= star) return "full";
    if (threshold >= star - 0.5) return "half";
    return "empty";
  }

  if (readonly) {
    return (
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <StarIcon key={star} fill={fillFor(star)} px={px} gradientId={`sr-ro-${star}`} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <div key={star} className="relative cursor-pointer" style={{ width: px, height: px }}>
          <StarIcon fill={fillFor(star)} px={px} gradientId={`sr-int-${star}`} />
          {/* left half → half-star rating */}
          <button
            type="button"
            className="absolute inset-y-0 left-0 w-1/2"
            onMouseEnter={() => setHover((star - 1) * 2 + 1)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onChange?.((star - 1) * 2 + 1)}
            aria-label={`Rate ${(star - 1) * 2 + 1} out of 10`}
          />
          {/* right half → full-star rating */}
          <button
            type="button"
            className="absolute inset-y-0 right-0 w-1/2"
            onMouseEnter={() => setHover(star * 2)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onChange?.(star * 2)}
            aria-label={`Rate ${star * 2} out of 10`}
          />
        </div>
      ))}
    </div>
  );
}
