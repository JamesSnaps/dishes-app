/**
 * A restaurant menu, however it arrived — photos, a PDF, a link, pasted text
 * — as content the model can read. The "Help me choose" chooser
 * (`lib/ai/menu-picks.ts`) sends these alongside the diner brief.
 *
 * PDFs go to the model as they are (OpenAI reads a PDF's text and its page
 * images), so a scanned menu needs nothing extra. A link is fetched with
 * `safeFetch`: a PDF or image is used as it comes, a web page reduced to its
 * text. A page that's all script and no menu says so rather than letting the
 * model guess.
 */

import type OpenAI from "openai";
import sharp from "sharp";
import { FetchFailedError, safeFetch, UnsafeUrlError } from "@/lib/safe-fetch";
import { htmlToText } from "@/lib/deliveries/email";

export const MAX_MENU_PHOTOS = 4;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
/** Plenty for any menu; a page longer than this is mostly not the menu. */
const MAX_PAGE_CHARS = 40_000;
/** Less text than this from a web page means the menu isn't in it (built by script, or an image). */
const MIN_PAGE_CHARS = 200;

/** A problem with the menu given, worded for the person who gave it. */
export class MenuSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MenuSourceError";
  }
}

export type MenuSources = {
  /** Photos of the menu, as uploaded. */
  photos: { body: Buffer; type: string }[];
  /** A PDF of the menu, as uploaded. */
  pdf: Buffer | null;
  /** A link to the menu: a web page, a PDF or an image. */
  url: string | null;
  /** The menu typed or pasted. */
  text: string | null;
};

export function hasMenu(s: MenuSources): boolean {
  return s.photos.length > 0 || !!s.pdf || !!s.url?.trim() || !!s.text?.trim();
}

async function imagePart(body: Buffer): Promise<OpenAI.ChatCompletionContentPart> {
  let small: Buffer;
  try {
    small = await sharp(body)
      .rotate() // phone photos carry their orientation in EXIF
      .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch {
    throw new MenuSourceError("One of the photos couldn't be read. Try taking it again.");
  }
  return { type: "image_url", image_url: { url: `data:image/jpeg;base64,${small.toString("base64")}`, detail: "high" } };
}

function pdfPart(body: Buffer): OpenAI.ChatCompletionContentPart {
  if (body.subarray(0, 5).toString("latin1") !== "%PDF-") throw new MenuSourceError("That file isn't a PDF.");
  return {
    type: "file",
    file: { filename: "menu.pdf", file_data: `data:application/pdf;base64,${body.toString("base64")}` },
  };
}

async function linkParts(raw: string): Promise<OpenAI.ChatCompletionContentPart[]> {
  let fetched;
  try {
    fetched = await safeFetch(raw.trim(), {
      accept: "text/html,application/xhtml+xml,application/pdf,image/*;q=0.8,*/*;q=0.5",
      maxBytes: MAX_FILE_BYTES,
    });
  } catch (err) {
    if (err instanceof UnsafeUrlError || err instanceof FetchFailedError) throw new MenuSourceError(err.message);
    throw err;
  }

  const type = fetched.contentType.toLowerCase();
  if (type.includes("pdf") || fetched.body.subarray(0, 5).toString("latin1") === "%PDF-") return [pdfPart(fetched.body)];
  if (type.startsWith("image/")) return [await imagePart(fetched.body)];

  const text = htmlToText(fetched.body.toString("utf8")).slice(0, MAX_PAGE_CHARS);
  if (text.length < MIN_PAGE_CHARS) {
    throw new MenuSourceError(
      "That page doesn't show its menu as text (it may be built by script, or be a picture). Try a photo, or the PDF if there is one."
    );
  }
  return [{ type: "text", text: `The menu, from ${fetched.url}:\n${text}` }];
}

/** Everything given, as model content: photos first, then the PDF, the link and the text. */
export async function menuParts(s: MenuSources): Promise<OpenAI.ChatCompletionContentPart[]> {
  if (s.photos.length > MAX_MENU_PHOTOS) {
    throw new MenuSourceError(`Up to ${MAX_MENU_PHOTOS} photos of the menu, please.`);
  }
  for (const p of s.photos) {
    if (p.body.length > MAX_FILE_BYTES) throw new MenuSourceError("One of the photos is too large (15 MB at most).");
  }
  if (s.pdf && s.pdf.length > MAX_FILE_BYTES) throw new MenuSourceError("The PDF is too large (15 MB at most).");

  const parts: OpenAI.ChatCompletionContentPart[] = [];
  for (const p of s.photos) parts.push(await imagePart(p.body));
  if (s.pdf) parts.push(pdfPart(s.pdf));
  if (s.url?.trim()) parts.push(...(await linkParts(s.url)));
  const text = s.text?.trim();
  if (text) parts.push({ type: "text", text: `The menu, as typed:\n${text.slice(0, MAX_PAGE_CHARS)}` });
  return parts;
}
