import Link from "next/link";
import { Bell, ChevronLeft } from "lucide-react";
import { getMyNotificationSettings } from "@/app/actions/notification-settings";
import { PushNotificationManager } from "@/components/push-notification-manager";
import { NotificationPrefs } from "./_components/notification-prefs";

export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const settings = await getMyNotificationSettings();

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <div className="mb-6">
        <Link
          href="/settings"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ChevronLeft className="h-4 w-4" />
          Settings
        </Link>
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold">Notifications</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose what you&apos;re told about. These are yours alone, and apply to every device
          below, including the iPhone and iPad app.
        </p>
      </div>

      <div className="mb-6 rounded-xl border border-transparent bg-highlight p-4 shadow-sm">
        <PushNotificationManager vapidPublicKey={process.env.VAPID_PUBLIC_KEY ?? null} />
      </div>

      <NotificationPrefs settings={settings} />

      <p className="mt-6 text-sm text-muted-foreground">
        Dinner times and grocery order deadlines are set up in{" "}
        <Link href="/settings/dinner-reminders" className="font-medium text-primary underline-offset-2 hover:underline">
          Dinner reminders
        </Link>{" "}
        and{" "}
        <Link href="/settings/deliveries" className="font-medium text-primary underline-offset-2 hover:underline">
          Grocery deliveries
        </Link>
        .
      </p>
    </div>
  );
}
