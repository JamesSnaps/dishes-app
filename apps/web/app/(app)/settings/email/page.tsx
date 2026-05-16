import Link from "next/link";
import { ChevronLeft, Mail } from "lucide-react";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { getSmtpConfig } from "@/app/actions/sharing";
import { SmtpConfigForm } from "./_components/smtp-config-form";

export const metadata = { title: "Email Settings" };

export default async function EmailSettingsPage() {
  const user = await getAutheliaUser();
  const { householdId, role } = await requireHousehold(user);
  const isAdmin = role === "admin";

  const config = await getSmtpConfig(householdId);

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
          <Mail className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-2xl font-bold">Email</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure SMTP to send recipes to friends and family by email.
        </p>
      </div>

      <div className="rounded-xl border bg-card p-6">
        <SmtpConfigForm existing={config} isAdmin={isAdmin} />
      </div>

      <div className="mt-6 rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">Authelia bypass required</p>
        <p>
          Share links at <code className="text-xs bg-muted px-1 py-0.5 rounded">/share/*</code> are
          publicly accessible and require a one-time Authelia bypass rule. Add this to your
          Authelia access control config:
        </p>
        <pre className="mt-2 text-xs bg-muted rounded p-3 overflow-x-auto">{`- domain: dishes.yourdomain.com
  policy: bypass
  resources:
    - "^/share/.*$"`}</pre>
      </div>
    </div>
  );
}
