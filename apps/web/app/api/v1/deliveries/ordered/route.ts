/**
 * "Mark as ordered" from a delivery reminder, for the iOS app (bearer auth).
 * The same handler as the web's service-worker route: `{ "date": "YYYY-MM-DD" }`
 * → `{ date, day }`.
 */
export { POST } from "@/app/api/deliveries/ordered/route";
