/**
 * "Push back 30 min" from a dinner reminder, for the iOS app (bearer auth).
 * The same handler as the web's service-worker route: `{ "date": "YYYY-MM-DD" }`
 * → `{ dinnerTime, remindAt }`.
 */
export { POST } from "@/app/api/dinner-reminders/snooze/route";
