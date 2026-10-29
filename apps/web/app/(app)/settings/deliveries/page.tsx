import Link from "next/link";
import { ChevronLeft, Mail, Truck } from "lucide-react";
import { getDeliveryOverview } from "@/app/actions/deliveries";
import { DeliverySettingsForm } from "./_components/delivery-settings-form";
import { DeliveryCalendar } from "./_components/delivery-calendar";
import { AwayPeriods } from "./_components/away-periods";
import { NextDeliveryCard } from "@/components/deliveries/next-delivery-card";
import { RefreshOnFocus } from "@/components/refresh-on-focus";

export const metadata = { title: "Grocery Deliveries" };
export const dynamic = "force-dynamic";

export default async function DeliveriesPage() {
  const overview = await getDeliveryOverview();

  return (
    <div className="p-4 lg:p-8 max-w-2xl lg:max-w-6xl mx-auto">
      <div className="mb-6">
        <Link
          href="/settings"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ChevronLeft className="h-4 w-4" />
          Settings
        </Link>
        <div className="flex items-center gap-2">
          <Truck className="h-5 w-5 text-success" />
          <h1 className="text-2xl font-bold">Grocery deliveries</h1>
        </div>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Set the days your shopping is delivered. On the day the order closes you&apos;ll get a
          reminder listing anything still to do: dinners not planned, meals not on the list, or
          items not in the basket yet.
        </p>
      </div>

      {/* Orders are marked from emails and other members' phones: keep up. */}
      <RefreshOnFocus intervalMs={60_000} />

      {/* One column on phones; on wide screens the schedule sits beside the calendar. */}
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className="space-y-6 min-w-0">
          {overview.next && <NextDeliveryCard next={overview.next} canEdit={overview.canEdit} />}

          <DeliverySettingsForm
            settings={overview.settings}
            optedIn={overview.optedIn}
            isAdmin={overview.isAdmin}
          />
        </div>

        <div className="space-y-6 min-w-0">
          <DeliveryCalendar
            upcoming={overview.upcoming}
            canEdit={overview.canEdit}
            today={overview.today}
          />

          <AwayPeriods
            awayPeriods={overview.awayPeriods}
            canEdit={overview.canEdit}
            today={overview.today}
          />

          <section className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-foreground" />
              <h2 className="font-semibold">Read your order emails</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Forward your supermarket&apos;s order emails here (e.g. with an n8n email trigger) and
              deliveries mark themselves as ordered, with the slot and total. Amended, moved and
              cancelled orders are tracked by order number, and the totals feed the grocery spend on
              the Stats page. Needs an AI key in Settings → AI.
            </p>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
              <li>
                Create a token with the{" "}
                <code className="rounded bg-muted px-1">write:deliveries</code> scope in Settings →
                Integrations.
              </li>
              <li>
                In n8n, trigger on new emails from your supermarket and POST{" "}
                <code className="rounded bg-muted px-1">
                  {"{ subject, from, receivedAt, text, html }"}
                </code>{" "}
                to{" "}
                <code className="rounded bg-muted px-1 break-all">
                  /api/integrations/deliveries/email
                </code>{" "}
                with the token as a Bearer header.
              </li>
              <li>
                Non-order emails (offers, &ldquo;you can still amend&rdquo; reminders) are ignored.
              </li>
            </ol>
            <Link
              href="/settings/integrations"
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-ink-foreground shadow-md"
            >
              Integrations &amp; API reference ›
            </Link>
          </section>
        </div>
      </div>
    </div>
  );
}
