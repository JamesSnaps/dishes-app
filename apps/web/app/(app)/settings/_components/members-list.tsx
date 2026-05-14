"use client";

import { useTransition } from "react";
import { Button } from "@dishes/ui";
import { updateMemberRole, removeMember } from "@/app/actions/settings";

type Member = {
  id: string;
  autheliaUser: string;
  displayName: string;
  role: "admin" | "adult" | "child";
  avatarUrl: string | null;
};

const ROLE_LABELS: Record<Member["role"], string> = {
  admin: "Admin",
  adult: "Adult",
  child: "Child",
};

const ROLES: Member["role"][] = ["admin", "adult", "child"];

function RoleSelect({ member, currentUserMemberId }: { member: Member; currentUserMemberId: string }) {
  const [isPending, startTransition] = useTransition();
  const isSelf = member.id === currentUserMemberId;

  return (
    <select
      value={member.role}
      disabled={isPending || isSelf}
      className="rounded-md border border-input bg-background px-2 py-1 text-sm disabled:opacity-50"
      onChange={(e) => {
        const role = e.target.value as Member["role"];
        startTransition(() => updateMemberRole(member.id, role));
      }}
    >
      {ROLES.map((r) => (
        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
      ))}
    </select>
  );
}

function RemoveButton({ member, currentUserMemberId }: { member: Member; currentUserMemberId: string }) {
  const [isPending, startTransition] = useTransition();
  const isSelf = member.id === currentUserMemberId;
  if (isSelf) return null;

  return (
    <Button
      size="sm"
      variant="ghost"
      className="text-destructive hover:text-destructive"
      disabled={isPending}
      onClick={() => {
        if (!confirm(`Remove ${member.displayName} from the household?`)) return;
        startTransition(() => removeMember(member.id));
      }}
    >
      {isPending ? "Removing…" : "Remove"}
    </Button>
  );
}

export function MembersList({
  members,
  currentUserMemberId,
  isAdmin,
}: {
  members: Member[];
  currentUserMemberId: string;
  isAdmin: boolean;
}) {
  return (
    <ul className="divide-y rounded-lg border bg-card">
      {members.map((member) => (
        <li key={member.id} className="flex items-center gap-3 px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold uppercase">
            {member.displayName.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium leading-tight">{member.displayName}</p>
            <p className="text-xs text-muted-foreground">{member.autheliaUser}</p>
          </div>
          {isAdmin ? (
            <div className="flex items-center gap-2">
              <RoleSelect member={member} currentUserMemberId={currentUserMemberId} />
              <RemoveButton member={member} currentUserMemberId={currentUserMemberId} />
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">{ROLE_LABELS[member.role]}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
