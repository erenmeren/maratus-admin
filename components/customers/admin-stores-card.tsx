"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DeleteStoreDialog } from "@/components/delete-store-dialog";
import { deleteStoreForOrg } from "@/lib/actions/stores";

interface AdminStoreRow {
  id: string;
  name: string;
  address: string;
  deviceCount: number;
  armedCount: number;
}

/** Store list on the admin customer page, with per-store delete (hidden when archived). */
export function AdminStoresCard({
  organizationId,
  stores,
  readOnly,
}: {
  organizationId: string;
  stores: AdminStoreRow[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = React.useState<AdminStoreRow | null>(null);
  const [pending, setPending] = React.useState(false);

  async function onConfirm() {
    if (!confirming) return;
    setPending(true);
    const res = await deleteStoreForOrg(organizationId, confirming.id);
    setPending(false);
    if (!res.ok) {
      toast.error("Couldn't delete store", { description: res.error });
      return;
    }
    toast.success("Store deleted");
    setConfirming(null);
    router.refresh();
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Stores</CardTitle>
        <CardDescription>
          {stores.length} {stores.length === 1 ? "branch" : "branches"}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Store</TableHead>
              <TableHead>Address</TableHead>
              <TableHead className="text-center">Devices</TableHead>
              {!readOnly && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {stores.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell className="text-muted-foreground">{s.address || "—"}</TableCell>
                <TableCell className="text-center">{s.deviceCount}</TableCell>
                {!readOnly && (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => setConfirming(s)}
                    >
                      <Trash2 className="size-4" />
                      <span className="sr-only">Delete {s.name}</span>
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      <DeleteStoreDialog
        storeName={confirming?.name ?? ""}
        deviceCount={confirming?.deviceCount ?? 0}
        armedCount={confirming?.armedCount ?? 0}
        open={confirming !== null}
        onOpenChange={(o) => !o && setConfirming(null)}
        pending={pending}
        onConfirm={onConfirm}
      />
    </Card>
  );
}
