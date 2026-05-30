"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { StatusDot } from "@/components/status-badge";
import { DeviceRowActions } from "@/components/device-row-actions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DeviceRow, DeviceStatus } from "@/lib/types";
import { formatNumber, timeAgo } from "@/lib/format";

export function FleetTable({
  rows,
  customers,
}: {
  rows: DeviceRow[];
  customers: { id: string; name: string }[];
}) {
  const [customer, setCustomer] = React.useState("all");
  const [status, setStatus] = React.useState("all");
  const [query, setQuery] = React.useState("");

  const filtered = rows.filter((r) => {
    if (customer !== "all" && r.tenantId !== customer) return false;
    if (status !== "all" && r.status !== status) return false;
    if (query) {
      const q = query.toLowerCase();
      if (
        !r.id.toLowerCase().includes(q) &&
        !r.storeName.toLowerCase().includes(q) &&
        !r.tenantName.toLowerCase().includes(q)
      )
        return false;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by device, store, or customer…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={customer} onValueChange={setCustomer}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Customer" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All customers</SelectItem>
            {customers.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full sm:w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="online">Online</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="offline">Offline</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-6">Device ID</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Store</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last seen</TableHead>
              <TableHead className="text-right">Receipts (mo.)</TableHead>
              <TableHead className="w-10 pr-4" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="pl-6 font-mono text-xs">{r.id}</TableCell>
                <TableCell className="font-medium">{r.tenantName}</TableCell>
                <TableCell className="text-muted-foreground">{r.storeName}</TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1.5 text-sm capitalize">
                    <StatusDot status={r.status as DeviceStatus} />
                    {r.status}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {timeAgo(r.lastSeen)}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatNumber(r.receiptsThisMonth)}
                </TableCell>
                <TableCell className="pr-4">
                  <DeviceRowActions deviceId={r.id} status={r.status} />
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={7}
                  className="py-12 text-center text-sm text-muted-foreground"
                >
                  No devices match your filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <p className="text-xs text-muted-foreground">
        Showing {filtered.length} of {rows.length} devices.
      </p>
    </div>
  );
}
