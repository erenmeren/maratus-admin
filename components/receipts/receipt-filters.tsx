"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";

type Opt = { id: string; name: string };

export function ReceiptFilters({
  stores,
  devices,
  orgs,
}: {
  stores?: Opt[];
  devices?: Opt[];
  orgs?: Opt[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page"); // any filter change resets to page 1
    router.replace(`${pathname}?${next.toString()}`);
  }

  const sel = "h-8 rounded-lg border border-input bg-transparent px-2 text-sm";

  return (
    <div className="flex flex-wrap items-end gap-3">
      {orgs && (
        <select className={sel} defaultValue={params.get("org") ?? ""} onChange={(e) => set("org", e.target.value)}>
          <option value="">All organizations</option>
          {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      )}
      {stores && (
        <select className={sel} defaultValue={params.get("store") ?? ""} onChange={(e) => set("store", e.target.value)}>
          <option value="">All stores</option>
          {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      {devices && (
        <select className={sel} defaultValue={params.get("device") ?? ""} onChange={(e) => set("device", e.target.value)}>
          <option value="">All devices</option>
          {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      )}
      <select className={sel} defaultValue={params.get("status") ?? ""} onChange={(e) => set("status", e.target.value)}>
        <option value="">Any status</option>
        <option value="pending">Pending</option>
        <option value="ready">Ready</option>
        <option value="downloaded">Downloaded</option>
      </select>
      <Input type="date" defaultValue={params.get("from") ?? ""} onChange={(e) => set("from", e.target.value)} className="w-auto" />
      <Input type="date" defaultValue={params.get("to") ?? ""} onChange={(e) => set("to", e.target.value)} className="w-auto" />
      <Input placeholder="Exact token…" defaultValue={params.get("token") ?? ""} onChange={(e) => set("token", e.target.value)} className="w-40" />
    </div>
  );
}
