"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  cancelCustomerInvitationAction,
  removeCustomerMemberAction,
} from "@/lib/actions/customers";
import type { CustomerTeamInvitation, CustomerTeamMember } from "@/lib/data";
import { formatDate } from "@/lib/format";

type Pending =
  | { kind: "member"; row: CustomerTeamMember }
  | { kind: "invitation"; row: CustomerTeamInvitation };

function RoleBadge({ role }: { role: string }) {
  return (
    <Badge variant={role === "owner" ? "default" : "secondary"} className="capitalize">
      {role}
    </Badge>
  );
}

function InvitedBy({ name, platform }: { name: string | null; platform: boolean }) {
  if (platform) return <Badge variant="outline">Maratus</Badge>;
  if (!name) return <span className="text-muted-foreground">—</span>;
  return <span className="text-muted-foreground">{name}</span>;
}

/**
 * Members + pending invitations of a customer on the admin customer page.
 * Rows a platform admin invited get a remove/cancel action; rows the customer
 * invited are read-only here (the tenant manages those on /tenant/members).
 */
export function CustomerTeamCard({
  organizationId,
  members,
  invitations,
  readOnly,
}: {
  organizationId: string;
  members: CustomerTeamMember[];
  invitations: CustomerTeamInvitation[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = React.useState<Pending | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function onConfirm() {
    if (!confirming) return;
    setBusy(true);
    const res =
      confirming.kind === "member"
        ? await removeCustomerMemberAction(organizationId, confirming.row.id)
        : await cancelCustomerInvitationAction(organizationId, confirming.row.id);
    setBusy(false);
    if (!res.ok) {
      toast.error(confirming.kind === "member" ? "Couldn't remove member" : "Couldn't cancel invitation", {
        description: res.error,
      });
      return;
    }
    toast.success(
      confirming.kind === "member"
        ? res.accountDeleted
          ? "Member removed and account deleted"
          : "Member removed"
        : "Invitation canceled",
    );
    setConfirming(null);
    router.refresh();
  }

  const isMember = confirming?.kind === "member";
  const target = confirming?.kind === "member" ? confirming.row.email : confirming?.row.email;
  const removingOwner = confirming?.kind === "member" && confirming.row.role === "owner";
  const ownersLeft = members.filter((m) => m.role === "owner").length;

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Team</CardTitle>
        <CardDescription>
          {members.length} {members.length === 1 ? "member" : "members"}
          {invitations.length > 0 &&
            ` · ${invitations.length} pending ${invitations.length === 1 ? "invitation" : "invitations"}`}
          . You can remove people Maratus invited; the customer manages everyone they invited.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Person</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Invited by</TableHead>
              <TableHead>Status</TableHead>
              {!readOnly && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.length === 0 && invitations.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={readOnly ? 4 : 5} className="py-6 text-center text-muted-foreground">
                  No one yet. Invite an owner to get this customer started.
                </TableCell>
              </TableRow>
            )}
            {members.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  <div className="font-medium">{m.name}</div>
                  <div className="text-xs text-muted-foreground">{m.email}</div>
                </TableCell>
                <TableCell>
                  <RoleBadge role={m.role} />
                </TableCell>
                <TableCell>
                  <InvitedBy name={m.invitedBy} platform={m.invitedByPlatform} />
                </TableCell>
                <TableCell className="text-muted-foreground">Joined {formatDate(m.joinedAt)}</TableCell>
                {!readOnly && (
                  <TableCell>
                    {m.invitedByPlatform && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => setConfirming({ kind: "member", row: m })}
                      >
                        <Trash2 className="size-4" />
                        <span className="sr-only">Remove {m.email}</span>
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
            {invitations.map((i) => (
              <TableRow key={i.id}>
                <TableCell>
                  <div className="font-medium text-muted-foreground">{i.email}</div>
                  <div className="text-xs text-muted-foreground">Invited {formatDate(i.sentAt)}</div>
                </TableCell>
                <TableCell>
                  <RoleBadge role={i.role} />
                </TableCell>
                <TableCell>
                  <InvitedBy name={i.invitedBy} platform={i.invitedByPlatform} />
                </TableCell>
                <TableCell>
                  {i.expired ? (
                    <Badge variant="destructive">Expired</Badge>
                  ) : (
                    <span className="text-muted-foreground">Pending · expires {formatDate(i.expiresAt)}</span>
                  )}
                </TableCell>
                {!readOnly && (
                  <TableCell>
                    {i.invitedByPlatform && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => setConfirming({ kind: "invitation", row: i })}
                      >
                        <X className="size-4" />
                        <span className="sr-only">Cancel invitation for {i.email}</span>
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={confirming !== null} onOpenChange={(o) => !o && !busy && setConfirming(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{isMember ? "Remove member?" : "Cancel invitation?"}</DialogTitle>
            <DialogDescription>
              {isMember ? (
                <>
                  <b>{target}</b> loses access to this customer right away. If they don&apos;t
                  belong to any other customer, their account is deleted too.
                  {removingOwner && ownersLeft === 1 && (
                    <> This is the only owner — invite a new one afterwards.</>
                  )}
                </>
              ) : (
                <>
                  The invitation link sent to <b>{target}</b> stops working.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setConfirming(null)}>
              Keep
            </Button>
            <Button variant="destructive" disabled={busy} onClick={onConfirm}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {isMember ? "Remove" : "Cancel invitation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
