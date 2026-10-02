/**
 * Runs once when the Next.js server starts. Used to start in-process
 * background loops that Phase 1 has no worker container for.
 *
 * The import must sit inside the NEXT_RUNTIME check (not after an early
 * return) so the edge bundle drops it — web-push needs Node built-ins.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startDinnerReminderScheduler } = await import("./lib/dinner-reminders/scheduler");
    startDinnerReminderScheduler();
  }
}
