export const IMAGE_STYLES = [
  {
    value: "studio",
    label: "Studio",
    description: "Clean background, natural lighting — the classic food photo",
    promptSuffix:
      "Beautifully plated, appetising, clean neutral background, soft natural lighting. No text, no labels, no watermarks.",
  },
  {
    value: "moody",
    label: "Moody",
    description: "Dark, dramatic, cinematic",
    promptSuffix:
      "Dark, dramatic food photography. Deep shadows, rich tones, single-source side lighting, dark background, cinematic atmosphere. No text, no labels, no watermarks.",
  },
  {
    value: "rustic",
    label: "Rustic",
    description: "Wooden surfaces, earthy textures, farmhouse feel",
    promptSuffix:
      "Rustic food photography. Wooden table, linen napkins, natural props, warm tones, earthy textures, farmhouse aesthetic. No text, no labels, no watermarks.",
  },
  {
    value: "bright",
    label: "Bright & Fresh",
    description: "Light, airy, vibrant colours on white",
    promptSuffix:
      "Bright, airy food photography. White or light pastel background, soft natural light from above, vibrant colours, clean minimal styling. No text, no labels, no watermarks.",
  },
  {
    value: "overhead",
    label: "Flat-lay",
    description: "Shot directly overhead, neatly arranged",
    promptSuffix:
      "Overhead flat-lay food photography. Shot directly from above, neatly arranged on a clean surface, symmetrical styling, attractive props. No text, no labels, no watermarks.",
  },
  {
    value: "cellphone",
    label: "Cellphone",
    description: "Casual, Instagram-style, authentic",
    promptSuffix:
      "Casual iPhone food photo, slightly imperfect framing, warm restaurant ambient lighting, shallow depth of field, bokeh background, authentic and unfiltered feel. No text, no labels, no watermarks.",
  },
] as const;

export type ImageStyleValue = (typeof IMAGE_STYLES)[number]["value"];

export const DEFAULT_IMAGE_STYLE: ImageStyleValue = "studio";

export function getStyleSuffix(style: string | null | undefined): string {
  const found = IMAGE_STYLES.find((s) => s.value === style);
  return (found ?? IMAGE_STYLES[0]!).promptSuffix;
}
