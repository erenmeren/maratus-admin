"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  inviteMember,
  cancelInvitation,
  removeMember,
  updateMemberRole,
} from "@/lib/actions/members";
import { INVITE_ROLES, ROLE_LABELS } from "@/lib/members";

const SELECT_CLASS = "h-8 rounded-lg border border-input bg-transparent px-2 text-sm";

function roleLabel(role: string): string {
  return Object.hasOwn(ROLE_LABELS, role) ? ROLE_LABELS[role as keyof typeof ROLE_LABELS].label : role;
}

type Member = { id: string; name: string; email: string; role: string };
type Invite = { id: string; email: string; role: string };

export function MembersManager({
  members,
  invitations,
  canManage,
}: {
  members: Member[];
  invitations: Invite[];
  canManage: boolean;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof INVITE_ROLES)[number]>("member");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Something went wrong.");
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {canManage && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => inviteMember(email, role).then((r) => (r.ok && setEmail(""), r)));
          }}
        >
          <div className="flex flex-col gap-1">
            <label className="text-sm text-muted-foreground">Email</label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" type="email" required />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm text-muted-foreground">Role</label>
            <select className={SELECT_CLASS} value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
              {INVITE_ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r].label}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">{ROLE_LABELS[role].description}</p>
          </div>
          <Button type="submit" disabled={pending}>Invite</Button>
        </form>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Members</h2>
        <table className="w-full text-sm">
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-t">
                <td className="py-2">{m.name}</td>
                <td className="text-muted-foreground">{m.email}</td>
                <td>
                  {canManage && m.role !== "owner" ? (
                    <select
                      className={SELECT_CLASS}
                      aria-label={`Role for ${m.email}`}
                      value={m.role}
                      disabled={pending}
                      onChange={(e) => run(() => updateMemberRole(m.id, e.target.value))}
                    >
                      {INVITE_ROLES.map((r) => (
                        <option key={r} value={r}>{ROLE_LABELS[r].label}</option>
                      ))}
                    </select>
                  ) : (
                    roleLabel(m.role)
                  )}
                </td>
                <td className="text-right">
                  {canManage && m.role !== "owner" && (
                    <span className="flex justify-end gap-2">
                      <button type="button" className="text-destructive underline" disabled={pending} onClick={() => run(() => removeMember(m.id))}>
                        Remove
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {invitations.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">Pending invitations</h2>
          <table className="w-full text-sm">
            <tbody>
              {invitations.map((i) => (
                <tr key={i.id} className="border-t">
                  <td className="py-2">{i.email}</td>
                  <td>{roleLabel(i.role)}</td>
                  <td className="text-right">
                    {canManage && (
                      <button type="button" className="text-destructive underline" disabled={pending} onClick={() => run(() => cancelInvitation(i.id))}>
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
