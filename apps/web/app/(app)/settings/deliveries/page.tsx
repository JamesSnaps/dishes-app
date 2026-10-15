import Link from "next/link";
import { ChevronLeft, Truck } from "lucide-react";
import { getDeliveryOverview } from "@/app/actions/deliveries";
import { DeliverySettingsForm } from "./_components/delivery-settings-form";
import { DeliveryCalendar } from "./_components/delivery-calendar";
import { NextDeliveryCard } from "@/components/deliveries/next-delivery-card";

export const metadata = { title: "Grocery Deliveries" };
export const dynamic = "force-dynamic";

export default async function DeliveriesPage() {
  const overview = await getDeliveryOverview();

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
          <Truck className="h-5 w-5 text-emerald-600" />
          <h1 className="text-2xl font-bold">Grocery deliveries</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Set the days your shopping is delivered. On the day the order closes you&apos;ll get a
          reminder listing anything still to do: dinners not planned, meals not on the list,
          or items not in the basket yet.
        </p>
      </div>

      {overview.next && (
        <div className="mb-6">
          <NextDeliveryCard next={overview.next} canEdit={overview.canEdit} />
        </div>
      )}

      <DeliverySettingsForm
        settings={overview.settings}
        optedIn={overview.optedIn}
        isAdmin={overview.isAdmin}
      />

      <DeliveryCalendar
        upcoming={overview.upcoming}
        awayPeriods={overview.awayPeriods}
        canEdit={overview.canEdit}
        today={overview.today}
      />
    </div>
  );
}
