import { resolveIdentity } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import type { AutheliaUser } from "@dishes/shared";

/**
 * Everything a request handler needs to act on behalf of a user: who they are,
 * and which household membership scopes their queries.
 *
 * Service functions take this (or just the householdId/memberId from it) rather
 * than reaching for headers themselves, so they are callable from server
 * actions, route handlers, and eventually background jobs alike.
 */
type Membership = Awaited<ReturnType<typeof requireHousehold>>;

export type Session = Membership & {
  user: AutheliaUser;
  /** Display name used in household-facing copy, e.g. push notifications. */
  actorName: string;
};

/** Scoping context for service functions — the subset they actually need. */
export type HouseholdContext = Pick<Membership, "householdId" | "memberId">;

/** For services that attribute an action to a person (push copy, audit text). */
export type ActorContext = HouseholdContext & Pick<Session, "actorName">;

export async function requireSession(): Promise<Session> {
  const user = await resolveIdentity();
  const membership = await requireHousehold(user);
  return { ...membership, user, actorName: user.displayName };
}
