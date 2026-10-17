import { redirect } from "next/navigation";

// Home was folded into /recipes' browse mode (v1.38.0); old links and
// bookmarks land there.
export default function HomePage() {
  redirect("/recipes");
}
