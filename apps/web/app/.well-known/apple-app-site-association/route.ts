import { NextResponse } from "next/server";

/**
 * Universal links and Handoff for the iOS app: which of the web app's pages the
 * app may open itself. Apple's CDN fetches this without credentials, so it's
 * served with no session (middleware) and needs an Authelia bypass rule too
 * (README → iOS app).
 *
 * The paths match DishesLink in apps/ios/Dishes/App/DishesLink.swift; the app
 * names this domain back in its associated-domains entitlement. APPLE_APP_IDS
 * overrides the app ("TEAMID.bundle.id", comma-separated) for a fork.
 */
export function GET() {
  const appIDs = (process.env.APPLE_APP_IDS ?? "C729B84RYG.uk.collco.dishes")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return NextResponse.json(
    {
      applinks: {
        details: [
          {
            appIDs,
            components: [
              { "/": "/recipes/new", exclude: true },
              { "/": "/recipes/*" },
              { "/": "/recipes" },
              { "/": "/shopping" },
              { "/": "/meal-plan" },
              { "/": "/home" },
            ],
          },
        ],
      },
      activitycontinuation: { apps: appIDs },
    },
    { headers: { "Cache-Control": "public, max-age=3600" } }
  );
}
