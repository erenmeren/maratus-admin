# Tenant Device Move Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Move to store" control on the tenant device detail page, wiring the existing `assignDeviceToStore` action.

**Architecture:** One new client component + one page wiring. No action/data/schema changes.

**Tech Stack:** Next.js 16 App Router, React 19, shadcn/ui (Dialog/Select), sonner.

**Spec:** `docs/superpowers/specs/2026-07-11-tenant-device-move-design.md`

## Global Constraints

- Repo `/Users/eren/Projects/maratus-admin`, branch `feat/tenant-device-move` off `main` (created in Task 1).
- ⚠️ `.env.local` = PRODUCTION Neon: `db:seed`/`db:push`/`db:generate` FORBIDDEN.
- Gates per task: `npx tsc --noEmit && npm test`; `npm run build` once before finishing.
- Consumes existing interfaces exactly: `assignDeviceToStore(deviceId: string, storeId: string): Promise<ActionResult>` (`lib/actions/devices.ts`), `getTenantStores(organizationId: string): Promise<StoreSummary[]>` (`lib/data.ts`).
- UI copy English; pending-lock pattern as in `components/delete-store-dialog.tsx`; toast + `router.refresh()` idiom as in `components/store-delete-button.tsx`.

---

### Task 1: Move control component + device page wiring

**Files:**
- Create: `components/device-move-control.tsx`
- Modify: `app/(tenant)/tenant/stores/[storeId]/[deviceId]/page.tsx`

**Interfaces:**
- Consumes: `assignDeviceToStore`, `getTenantStores` (see Global Constraints).
- Produces: `DeviceMoveControl` props `{ deviceId: string; deviceName: string; stores: { id: string; name: string }[] }`.

- [ ] **Step 1: Branch**

```bash
cd /Users/eren/Projects/maratus-admin
git checkout main && git pull && git checkout -b feat/tenant-device-move
```

- [ ] **Step 2: Create `components/device-move-control.tsx`**

```tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Store as StoreIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { assignDeviceToStore } from "@/lib/actions/devices";

/** Tenant-side "move this printer to another branch" (owner/admin; server re-checks). */
export function DeviceMoveControl({
  deviceId,
  deviceName,
  stores,
}: {
  deviceId: string;
  deviceName: string;
  stores: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [target, setTarget] = React.useState("");

  async function onConfirm() {
    if (!target) return;
    setPending(true);
    const res = await assignDeviceToStore(deviceId, target);
    setPending(false);
    if (!res.ok) {
      toast.error("Couldn't move device", { description: res.error });
      return;
    }
    toast.success("Device moved");
    setOpen(false);
    router.push(`/tenant/stores/${target}/${deviceId}`);
    router.refresh();
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <StoreIcon className="size-4" />
        Move to store
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Move device</DialogTitle>
            <DialogDescription>
              Move <span className="font-medium">{deviceName}</span> to another
              branch. It keeps its key, history, and settings.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pick a store" />
              </SelectTrigger>
              <SelectContent>
                {stores.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button disabled={pending || !target} onClick={onConfirm}>
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 3: Wire the device detail page**

In `app/(tenant)/tenant/stores/[storeId]/[deviceId]/page.tsx`:

Imports:

```tsx
import { DeviceMoveControl } from "@/components/device-move-control";
import { getDevice, getDeviceCommands, getTenantStores } from "@/lib/data";
```

(replacing the existing `getDevice, getDeviceCommands` import line). The page currently destructures `{ organizationId }` from `requireTenant()` — change to `{ ctx, organizationId }` and compute after the existing guards:

```tsx
  const membership = ctx.organizations.find((o) => o.id === organizationId);
  const canManage = !!membership && ["owner", "admin"].includes(membership.role);
  const otherStores = canManage
    ? (await getTenantStores(organizationId))
        .filter((s) => s.id !== storeId)
        .map((s) => ({ id: s.id, name: s.name }))
    : [];
```

Locate where `DevicePauseControl` renders (read the rest of the file) and render beside it, inside the same wrapper:

```tsx
  {canManage && otherStores.length > 0 && (
    <DeviceMoveControl
      deviceId={device.id}
      deviceName={device.name}
      stores={otherStores}
    />
  )}
```

If `DevicePauseControl` is not inside a flex row that can take a sibling, wrap both in `<div className="flex items-center gap-2">` — keep the layout change minimal.

- [ ] **Step 4: Gates**

```bash
npx tsc --noEmit && npm test && npm run build
```

Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add components/device-move-control.tsx "app/(tenant)/tenant/stores/[storeId]/[deviceId]/page.tsx"
git commit -m "feat(tenant): move-to-store control on device detail page"
```

---

### Task 2: Live QA (prod-safe) + merge readiness

**Files:** none (verification only).

- [ ] **Step 1:** `npm run dev`; sign in as dana@roastwell.co / 123456; open a SoMa Roastery device (NOT Printer b580, which lives in Downtown Flagship).
- [ ] **Step 2:** "Move to store" → pick Mission District → Move. Expect: toast, redirect to `/tenant/stores/<mission-id>/<deviceId>`, page renders with "Printer in Mission District".
- [ ] **Step 3:** Move it back to SoMa Roastery the same way. `/tenant/activity` shows two "Device reassigned" rows.
- [ ] **Step 4:** Code-inspection records: control hidden when only one store exists (`otherStores.length > 0` gate) and for member role (`canManage`); server action still enforces owner/admin regardless.
- [ ] **Step 5:** Record results; stop the dev server.
