// Mock dataset for the Ditto prototype.
// TODO: replace with API — this entire module is stand-in data.
//
// The hero tenant is "Roastwell Coffee", a regional coffee chain. A handful of
// other tenants exist so the super-admin tables have realistic breadth.

import type { Device, Invoice, Store, Tenant, TimePoint } from "./types";

// Deterministic pseudo-random so SSR and client render identically.
function seeded(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const FIRMWARE = ["2.4.1", "2.4.0", "2.3.7"];

function makeDevice(
  tenantId: string,
  storeId: string,
  idx: number,
  opts: Partial<Device> = {},
): Device {
  const rand = seeded(
    storeId.split("").reduce((a, c) => a + c.charCodeAt(0), 0) * (idx + 7),
  );
  const today = Math.floor(rand() * 180) + 40;
  return {
    id: `${storeId}-D${idx + 1}`.toUpperCase(),
    storeId,
    tenantId,
    name: `Kiosk ${idx + 1}`,
    status: "online",
    ipAddress: `10.0.${Math.floor(rand() * 40) + 1}.${Math.floor(rand() * 200) + 10}`,
    connectionType: rand() > 0.45 ? "ethernet" : "wifi",
    firmwareVersion: FIRMWARE[Math.floor(rand() * FIRMWARE.length)],
    lastSeen: new Date(Date.now() - Math.floor(rand() * 9) * 60_000).toISOString(),
    receiptsToday: today,
    receiptsThisMonth: today * (18 + Math.floor(rand() * 8)),
    ...opts,
  };
}

// ---- Roastwell Coffee (hero tenant) ----------------------------------------

const roastwellStores: Omit<Store, "devices">[] = [
  { id: "rw-downtown", tenantId: "roastwell", name: "Downtown Flagship", address: "412 Market St, San Francisco, CA" },
  { id: "rw-mission", tenantId: "roastwell", name: "Mission District", address: "2190 Valencia St, San Francisco, CA" },
  { id: "rw-soma", tenantId: "roastwell", name: "SoMa Roastery", address: "85 Bluxome St, San Francisco, CA" },
  { id: "rw-berkeley", tenantId: "roastwell", name: "Berkeley Campus", address: "2440 Bancroft Way, Berkeley, CA" },
  { id: "rw-oakland", tenantId: "roastwell", name: "Oakland Uptown", address: "1700 Telegraph Ave, Oakland, CA" },
];

const roastwellDeviceCounts = [3, 2, 2, 2, 3];

const roastwellStoresFull: Store[] = roastwellStores.map((s, si) => {
  const devices = Array.from({ length: roastwellDeviceCounts[si] }, (_, di) =>
    makeDevice("roastwell", s.id, di),
  );
  // Inject some non-online states for realism.
  if (s.id === "rw-mission") devices[1].status = "paused";
  if (s.id === "rw-soma") devices[0].status = "offline";
  if (s.id === "rw-oakland") devices[2].status = "paused";
  return { ...s, devices };
});

// ---- Other tenants (for super-admin breadth) -------------------------------

function buildSimpleTenant(
  tenantId: string,
  stores: { id: string; name: string; address: string; devices: number }[],
): Store[] {
  return stores.map((s) => {
    const devices = Array.from({ length: s.devices }, (_, di) =>
      makeDevice(tenantId, s.id, di),
    );
    return { id: s.id, tenantId, name: s.name, address: s.address, devices };
  });
}

const verdeStores = buildSimpleTenant("verde", [
  { id: "vd-1", name: "Verde — Pearl District", address: "1140 NW Everett St, Portland, OR", devices: 2 },
  { id: "vd-2", name: "Verde — Hawthorne", address: "3582 SE Hawthorne Blvd, Portland, OR", devices: 2 },
  { id: "vd-3", name: "Verde — Alberta", address: "1620 NE Alberta St, Portland, OR", devices: 1 },
]);
verdeStores[1].devices[0].status = "offline";

const harborStores = buildSimpleTenant("harbor", [
  { id: "hb-1", name: "Harbor Books — Main", address: "55 Wharf St, Seattle, WA", devices: 2 },
  { id: "hb-2", name: "Harbor Books — Ballard", address: "2214 NW Market St, Seattle, WA", devices: 1 },
]);
harborStores[0].devices[1].status = "paused";

const pulseStores = buildSimpleTenant("pulse", [
  { id: "pl-1", name: "Pulse Fitness — Midtown", address: "780 8th Ave, New York, NY", devices: 2 },
  { id: "pl-2", name: "Pulse Fitness — Brooklyn", address: "168 7th Ave, Brooklyn, NY", devices: 2 },
  { id: "pl-3", name: "Pulse Fitness — Queens", address: "31-00 47th Ave, Queens, NY", devices: 1 },
  { id: "pl-4", name: "Pulse Fitness — Jersey City", address: "150 Bay St, Jersey City, NJ", devices: 1 },
]);

const lumaStores = buildSimpleTenant("luma", [
  { id: "lm-1", name: "Luma Grocer — Capitol Hill", address: "1531 15th Ave, Seattle, WA", devices: 3 },
  { id: "lm-2", name: "Luma Grocer — Fremont", address: "3601 Fremont Ave N, Seattle, WA", devices: 2 },
]);
lumaStores[0].devices[2].status = "offline";

export const TENANTS: Tenant[] = [
  {
    id: "roastwell",
    name: "Roastwell Coffee",
    perPrintPrice: 0.04,
    contact: { name: "Dana Okafor", email: "dana@roastwell.co", phone: "+1 (415) 555-0142" },
    status: "active",
    brandColor: "#B4541F", // Roastwell's own roasted-amber brand — DATA, not chrome
    logoText: "Roastwell",
    staffPin: "4827",
    stores: roastwellStoresFull,
  },
  {
    id: "verde",
    name: "Verde Juicery",
    perPrintPrice: 0.05,
    contact: { name: "Marco Ruiz", email: "marco@verdejuice.com", phone: "+1 (503) 555-0188" },
    status: "active",
    brandColor: "#3F9D4E",
    logoText: "Verde",
    staffPin: "1190",
    stores: verdeStores,
  },
  {
    id: "harbor",
    name: "Harbor Books",
    perPrintPrice: 0.03,
    contact: { name: "Priya Shah", email: "priya@harborbooks.com", phone: "+1 (206) 555-0107" },
    status: "trial",
    brandColor: "#1F5C8B",
    logoText: "Harbor",
    staffPin: "7723",
    stores: harborStores,
  },
  {
    id: "pulse",
    name: "Pulse Fitness",
    perPrintPrice: 0.045,
    contact: { name: "Jordan Lee", email: "jordan@pulsefit.io", phone: "+1 (212) 555-0153" },
    status: "active",
    brandColor: "#E5484D",
    logoText: "Pulse",
    staffPin: "9051",
    stores: pulseStores,
  },
  {
    id: "luma",
    name: "Luma Grocer",
    perPrintPrice: 0.035,
    contact: { name: "Wei Chen", email: "wei@lumagrocer.com", phone: "+1 (206) 555-0199" },
    status: "suspended",
    brandColor: "#7C5CFC",
    logoText: "Luma",
    staffPin: "3360",
    stores: lumaStores,
  },
];

// ---- Time series ------------------------------------------------------------

const DAY_LABELS = (() => {
  const out: string[] = [];
  const now = Date.now();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * 86_400_000);
    out.push(d.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
  }
  return out;
})();

const MONTH_LABELS = ["Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May"];

/** Build a 30-day daily series for a tenant scaled to its size. */
export function dailySeries(scale: number, seed = 1): TimePoint[] {
  const rand = seeded(seed * 31 + 5);
  return DAY_LABELS.map((label, i) => {
    const weekday = i % 7;
    const weekendDip = weekday === 0 || weekday === 6 ? 0.78 : 1;
    const trend = 1 + i * 0.012;
    const noise = 0.85 + rand() * 0.3;
    const receipts = Math.round(scale * weekendDip * trend * noise);
    return { label, receipts, revenue: 0 };
  });
}

/** Build a 9-month series for a tenant scaled to its size. */
export function monthlySeries(scale: number, seed = 1): TimePoint[] {
  const rand = seeded(seed * 17 + 3);
  return MONTH_LABELS.map((label, i) => {
    const trend = 1 + i * 0.08;
    const noise = 0.9 + rand() * 0.2;
    const receipts = Math.round(scale * 30 * trend * noise);
    return { label, receipts, revenue: 0 };
  });
}

// ---- Invoices ---------------------------------------------------------------

export const INVOICES: Invoice[] = (() => {
  const out: Invoice[] = [];
  const periods = ["Feb 2026", "Mar 2026", "Apr 2026", "May 2026"];
  for (const t of TENANTS) {
    const monthlyReceipts = t.stores
      .flatMap((s) => s.devices)
      .reduce((a, d) => a + d.receiptsThisMonth, 0);
    periods.forEach((period, pi) => {
      const rand = seeded(
        t.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0) + pi * 13,
      );
      const receipts = Math.round(monthlyReceipts * (0.85 + rand() * 0.25));
      const isCurrent = pi === periods.length - 1;
      const status: Invoice["status"] = isCurrent
        ? "due"
        : t.status === "suspended" && pi === periods.length - 2
          ? "overdue"
          : "paid";
      out.push({
        id: `INV-${t.id.slice(0, 3).toUpperCase()}-2026${(2 + pi).toString().padStart(2, "0")}`,
        tenantId: t.id,
        period,
        receipts,
        amount: Math.round(receipts * t.perPrintPrice * 100) / 100,
        status,
        issuedOn: new Date(2026, 1 + pi, 1).toISOString(),
      });
    });
  }
  return out;
})();
