# Branding "Image" Object — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Branding page's single dedicated logo uploader with a general-purpose **`image`** layout object users can add, upload, and place anywhere (like text), and render it on the device.

**Architecture:** `image` is a new first-class layout-object type that reuses the proven `icon`-upload pipeline (pending-upload markers, R2 storage, presign walk, orphan cleanup, the firmware's `render_image()`), minus icon chrome (preset/tint/circle). The dedicated logo uploader and the top-level `logoUrl` are removed; the on-screen `logo` widget is repurposed to render the brand **wordmark text** (sent as a new top-level `wordmark` payload field = the organization name). Existing uploaded logos are migrated into `image` objects by a one-time script.

**Tech Stack:** Next.js 16 / React 19 / TypeScript (maratus-admin), Drizzle + Neon, Cloudflare R2, Vitest. ESP-IDF / LVGL 9.3 / cJSON (maratus-firmware), C host test harness (`tools/cfg-harness`).

## Global Constraints

- **Repos:** maratus-admin = `/Users/eren/Projects/maratus-admin`; maratus-firmware = `/Users/eren/Projects/maratus-firmware`. They are separate git repos — commit in each independently.
- **Money/units:** N/A here.
- **Image normalization:** all uploads pass through `normalizeUploadImage` (`lib/image.ts`) → 512px-max PNG. Keep the **512px** cap (do not raise it).
- **Upload limit:** ≤ **2 MB**, `image/*` only (matches `MAX_LOGO_BYTES`).
- **`signedUrl` is never persisted** — `normalizePrinterConfig` must strip it; only the R2 `url` key is stored.
- **Object cap:** `MAX_CUSTOM = 20` per screen, shared across `text` + `icon` + `image`.
- **ETag stability:** presigned URLs rotate every request and must NOT enter `computeConfigVersion`; only stored keys / scalar inputs do.
- **maratus-admin tests:** `npm run test` (vitest). **Type check / build:** `npm run build`.
- **maratus-firmware host tests:** `cd tools/cfg-harness && make test`.
- **Commit message footer (both repos):**
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Work happens on branch `feat/branding-image-object` (maratus-admin, already created) and a matching `feat/branding-image-object` branch in maratus-firmware (create in Task 8).

---

## File Structure

**maratus-admin**
- `lib/printer-layout.ts` — add `image` type, `PrinterImage`, `createImageObject`, `sanitizeImage`; include `image` in addable/cap logic. (Task 1)
- `lib/printer-layout.test.ts` — image sanitize/normalize tests. (Task 1)
- `lib/storage.ts` — `imageStorageKey`. (Task 2)
- `app/(tenant)/tenant/branding/actions.ts` — image pending-upload loop + orphan cleanup; delete logo-upload handling. (Task 3)
- `lib/device-config.ts` + `lib/device-config.test.ts` — drop `logoUrl` from version input, add `organizationName`. (Task 4)
- `lib/data.ts` — presign image keys; add `wordmark` to payload; drop `logoUrl` from payload & `getTenantBranding`; fetch org name. (Task 4)
- `lib/types.ts`, `app/(tenant)/tenant/branding/page.tsx` — drop `logoUrl`/`hasLogo` view-model plumbing. (Task 5)
- `components/device-preview/printer-editor/use-printer-editor.ts` — `addImage`; cap counts image. (Task 5)
- `components/device-preview/printer-editor/printer-controls.tsx` — "+ Image" button, image upload prop, image delete. (Task 5)
- `components/branding-editor.tsx` — image upload handler + form wiring; remove logo uploader UI/state. (Task 5)
- `components/device-preview/printer-preview.tsx` — `ImageObject` renderer; `LogoObject` → wordmark text. (Task 6)
- `lib/db/migrate-logo-to-image.ts` — one-time migration. (Task 7)

**maratus-firmware**
- `components/devcfg/include/device_config.h` — `OBJ_IMAGE`, `image_url`, `wordmark`. (Task 8)
- `components/devcfg/cfg_parse.c` — `"image"`→`OBJ_IMAGE`, parse `image.signedUrl`, parse top-level `wordmark`. (Task 8)
- `tools/cfg-harness/test_cfg.c` + `fixtures/sample-config.json` — image + wordmark parse test. (Task 8)
- `components/ui/ui.c` — `render_image` image routing; `render_wordmark` for `OBJ_LOGO`; dispatch. (Task 9)
- `main/app_state.c` — gather image URLs for prefetch. (Task 9)

---

## Task 1: `image` object type + sanitize (maratus-admin, pure logic)

**Files:**
- Modify: `lib/printer-layout.ts`
- Test: `lib/printer-layout.test.ts`

**Interfaces:**
- Produces: `PrinterImage { url?: string; signedUrl?: string }`; `createImageObject(z: number): PrinterObject`; `"image"` ∈ `OBJECT_TYPES` / `ADDABLE_TYPES`; `PrinterObject.image?: PrinterImage`.
- Consumes: existing `sanitizeBox`, `sanitizeObject`, `OBJECT_TYPES`, `MAX_CUSTOM`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/printer-layout.test.ts`:

```ts
import { normalizePrinterConfig, createImageObject } from "./printer-layout";

describe("image objects", () => {
  it("createImageObject makes an empty-upload image object", () => {
    const o = createImageObject(5);
    expect(o.type).toBe("image");
    expect(o.z).toBe(5);
    expect(o.image).toEqual({});
  });

  it("normalize preserves an image url and drops its signedUrl", () => {
    const cfg = normalizePrinterConfig({
      version: 3, clockTimezone: "UTC", clock24h: false, wifiLevel: 3, qrTimeoutSeconds: 60,
      screens: { idle: { objects: [
        { id: "img-1", type: "image", x: 0.3, y: 0.3, w: 0.3, h: 0.3, visible: true, z: 0,
          image: { url: "branding/o/images/x", signedUrl: "https://r2/x?sig=abc" } },
      ] } },
    });
    const img = cfg.screens.idle.objects.find((o) => o.type === "image");
    expect(img).toBeDefined();
    expect(img!.image!.url).toBe("branding/o/images/x");
    expect(img!.image!.signedUrl).toBeUndefined();
  });

  it("counts image objects against the MAX_CUSTOM cap", () => {
    const objects = Array.from({ length: 25 }, (_, i) => ({
      id: `img-${i}`, type: "image", x: 0.1, y: 0.1, w: 0.2, h: 0.2, visible: true, z: i,
      image: { url: `branding/o/images/${i}` },
    }));
    const cfg = normalizePrinterConfig({
      version: 3, clockTimezone: "UTC", clock24h: false, wifiLevel: 3, qrTimeoutSeconds: 60,
      screens: { idle: { objects } },
    });
    expect(cfg.screens.idle.objects.filter((o) => o.type === "image").length).toBe(20);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- printer-layout`
Expected: FAIL — `createImageObject` is not exported / `image` objects dropped by normalize.

- [ ] **Step 3: Add the type and helpers**

In `lib/printer-layout.ts`:

Add `"image"` to `OBJECT_TYPES` (line 13-17), next to `icon`:
```ts
export const OBJECT_TYPES = [
  "text", "logo", "clock", "wifi",
  "icon", "image",
  "qr", "spinner", "countdown", "pairingCode", "steps",
] as const;
```

Add to `ADDABLE_TYPES` (line 29):
```ts
export const ADDABLE_TYPES = ["text", "icon", "image"] as const;
```

Add to `TYPE_LABEL` (line 32-43): `image: "Image",`

Add to `DEFAULT_FONT` (line 146-149): include `image: 24` in the map literal (keep the record total).

Add the interface after `PrinterIcon` (after line 62):
```ts
export interface PrinterImage {
  url?: string;
  /** Display-only presigned URL; NEVER persisted (normalize drops it). */
  signedUrl?: string;
}
```

Add to `PrinterObject` (after line 83 `icon?: PrinterIcon;`):
```ts
  image?: PrinterImage; // image objects
```

Add a factory after `createIconObject` (after line 185):
```ts
/** A fresh custom image object, centered, on top (`z`). Empty until a file is uploaded. */
export function createImageObject(z: number): PrinterObject {
  return {
    id: `image-${genIdSuffix()}`,
    type: "image",
    x: 0.35, y: 0.35, w: 0.3, h: 0.3,
    visible: true,
    z,
    image: {},
  };
}
```

Add a sanitizer next to `sanitizeIcon` (after line 357):
```ts
function sanitizeImage(raw: unknown): PrinterImage {
  const r = (raw ?? {}) as Record<string, unknown>;
  // Keep only the canonical R2 key; drop signedUrl (display-only) and anything else.
  return typeof r.url === "string" && r.url ? { url: r.url } : {};
}
```

In `sanitizeObject`, add an `image` branch after the `icon` branch (after line 404):
```ts
  if (type === "image") {
    return {
      id, type: "image", z, visible,
      ...sanitizeBox(o, { x: 0.35, y: 0.35, w: 0.3, h: 0.3 }),
      image: sanitizeImage(o.image),
    };
  }
```

In `sanitizeScreen`, include `image` in the addable-cap branch (line 434):
```ts
    if (o.type === "text" || o.type === "icon" || o.type === "image") {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- printer-layout`
Expected: PASS (all image tests green, existing tests still green).

- [ ] **Step 5: Commit**

```bash
git add lib/printer-layout.ts lib/printer-layout.test.ts
git commit -m "feat(branding): add image layout-object type + sanitize

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `imageStorageKey` (maratus-admin)

**Files:**
- Modify: `lib/storage.ts:105-111` (alongside `iconStorageKey`)

**Interfaces:**
- Produces: `imageStorageKey(organizationId: string, assetId: string): string` → `branding/{org}/images/{id}`.

- [ ] **Step 1: Add the helper**

In `lib/storage.ts`, after `iconStorageKey` (line 111):
```ts
/** Object key convention for a tenant's uploaded printer image. */
export function imageStorageKey(
  organizationId: string,
  assetId: string,
): string {
  return `branding/${organizationId}/images/${assetId}`;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/storage.ts
git commit -m "feat(branding): add imageStorageKey R2 key helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Server action — image uploads + cleanup, drop logo (maratus-admin)

**Files:**
- Modify: `app/(tenant)/tenant/branding/actions.ts`

**Interfaces:**
- Consumes: `imageStorageKey` (Task 2); client sends `image.url = "pending:<objectId>"` + a `image:<objectId>` form file (Task 5).
- Produces: persisted image objects with R2-key `image.url`; orphaned image keys deleted.

- [ ] **Step 1: Add the image import**

Edit line 17 to add `imageStorageKey`:
```ts
import { deleteObject, iconStorageKey, imageStorageKey, putObject } from "@/lib/storage";
```
(Drop `logoStorageKey` from this import — it's no longer used here.)

- [ ] **Step 2: Add the image pending-upload loop**

Immediately after the icon loop (after line 104, the closing `}` of the `if (printerConfig !== undefined)` block that handles icons), add a second walk. Place it inside its own `if (printerConfig !== undefined)`:

```ts
  // Process newly-uploaded image files. The client sets image.url = "pending:<objectId>"
  // and sends the file under "image:<objectId>". Rewrite urls to the stored R2 key.
  if (printerConfig !== undefined) {
    for (const screen of PRINTER_SCREENS) {
      for (const o of printerConfig.screens[screen].objects) {
        if (o.type === "image" && o.image?.url?.startsWith("pending:")) {
          const objectId = o.image.url.slice("pending:".length);
          const file = formData.get(`image:${objectId}`);
          if (file instanceof File && file.size > 0) {
            if (!file.type.startsWith("image/")) {
              return { ok: false, error: "Image must be an image file." };
            }
            if (file.size > MAX_LOGO_BYTES) {
              return { ok: false, error: "Image must be under 2 MB." };
            }
            let bytes: Buffer;
            try {
              bytes = await normalizeUploadImage(Buffer.from(await file.arrayBuffer()));
            } catch {
              return { ok: false, error: "Couldn't process that image — try a PNG or JPEG." };
            }
            const key = imageStorageKey(organizationId, id("image"));
            try {
              await putObject(key, bytes, "image/png");
              o.image = { url: key };
            } catch (err) {
              console.error("Image upload failed", err);
              return { ok: false, error: "Image upload failed. Try again." };
            }
          } else {
            // No file for this pending marker — drop the (empty) image object so no
            // dangling "pending:" url is persisted.
            o.image = {};
          }
        }
      }
    }
  }
```

- [ ] **Step 3: Track previous image keys for orphan cleanup**

In the "Capture current state for cleanup" block, extend the prev-config walk (lines 169-178) to also collect image keys. Add a `previousImageKeys` set near `previousIconKeys` (line 153):
```ts
  const previousImageKeys = new Set<string>();
```
And inside the `for (const o of prevConfig.screens[screen].objects)` loop (after the icon `if`, ~line 175):
```ts
          if (o.type === "image" && o.image?.url) {
            previousImageKeys.add(o.image.url);
          }
```

- [ ] **Step 4: Delete orphaned image keys**

After the icon orphan-cleanup block (after line 232), add:
```ts
  if (printerConfig !== undefined) {
    const newImageKeys = new Set<string>();
    for (const screen of PRINTER_SCREENS) {
      for (const o of printerConfig.screens[screen].objects) {
        if (o.type === "image" && o.image?.url) newImageKeys.add(o.image.url);
      }
    }
    const orphaned = [...previousImageKeys].filter((k) => !newImageKeys.has(k));
    await Promise.all(orphaned.map((k) => deleteObject(k)));
  }
```

- [ ] **Step 5: Remove logo-upload handling**

Delete the logo block (lines 120-149: `logoUrlUpdate` declaration through the `else if (removeLogo)`), the `previousLogoKey` capture (lines 152, 165-167), the `logoUrl` writes in both the insert `.values` and `.onConflictDoUpdate.set` (lines 194, 206), and the orphan-logo deletion (lines 210-217). Adjust the cleanup-guard condition (line 154) from `if (logoUrlUpdate !== undefined || printerConfig !== undefined)` to `if (printerConfig !== undefined)`. Update the file's top comment (lines 4-7) to describe images instead of a single logo.

- [ ] **Step 6: Type-check + build**

Run: `npm run build`
Expected: compiles; no references to `logoUrlUpdate`, `previousLogoKey`, or `logoStorageKey` remain in this file.

- [ ] **Step 7: Commit**

```bash
git add "app/(tenant)/tenant/branding/actions.ts"
git commit -m "feat(branding): persist image uploads + cleanup; drop logo upload

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Device payload — presign images, wordmark, drop logoUrl (maratus-admin)

**Files:**
- Modify: `lib/device-config.ts`
- Test: `lib/device-config.test.ts`
- Modify: `lib/data.ts` (`getTenantBranding`, `getDeviceConfig`, `DeviceConfigPayload`, `TenantBranding`)

**Interfaces:**
- Produces: `DeviceConfigPayload.wordmark: string`; image objects carry `image.signedUrl`; no top-level `logoUrl`.
- Consumes: `imageStorageKey` keys from Task 3; `orgTable` (already imported in `lib/data.ts:27` as `organization as orgTable`).

- [ ] **Step 1: Update the ETag input test**

In `lib/device-config.test.ts`, find the test(s) that construct a `ConfigVersionInput` with `logoUrl` and replace that field with `organizationName: "Acme"`. Add an assertion that renaming the org changes the version:

```ts
it("organization name participates in the version (logoUrl no longer does)", () => {
  const base = {
    printerScreens: null, printerLayout: null, brandColor: null, brandBg: null,
    brandFg: null, brandMuted: null, qrVisibleSeconds: 60, screenBrightness: 100,
    screenSleepEnabled: false, screenSleepTimeoutSeconds: 300, settingsPasswordHash: null,
  };
  const a = computeConfigVersion({ ...base, organizationName: "Acme" });
  const b = computeConfigVersion({ ...base, organizationName: "Beta" });
  expect(a).not.toBe(b);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- device-config`
Expected: FAIL — `organizationName` not on `ConfigVersionInput`.

- [ ] **Step 3: Update `device-config.ts`**

Replace `logoUrl: string | null;` (line 12) with:
```ts
  organizationName: string | null;
```
In `computeConfigVersion`, replace `input.logoUrl ?? null,` (line 28) with:
```ts
    input.organizationName ?? null,
```
Update the header comment (lines 3-5) to drop the "logo KEY" mention.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- device-config`
Expected: PASS.

- [ ] **Step 5: Update `getDeviceConfig` in `lib/data.ts`**

Fetch the org name early (before the version computation, ~line 906) so it can feed both the ETag and the payload:
```ts
  const [org] = await db
    .select({ name: orgTable.name })
    .from(orgTable)
    .where(eq(orgTable.id, organizationId))
    .limit(1);
  const organizationName = org?.name ?? "";
```
In `computeConfigVersion({ ... })` (lines 914-927), replace `logoUrl: s?.logoUrl ?? null,` with:
```ts
    organizationName,
```
Generalize the presign walk (lines 935-950) to also collect + map image keys:
```ts
  // Presign uploaded icon + image keys across all screens (collect → presign → map back).
  const assetKeys = new Set<string>();
  for (const screen of PRINTER_SCREENS) {
    for (const o of config.screens[screen].objects) {
      if (o.type === "icon" && o.icon?.source === "upload" && o.icon.url) assetKeys.add(o.icon.url);
      if (o.type === "image" && o.image?.url) assetKeys.add(o.image.url);
    }
  }
  const signed = new Map<string, string>();
  await Promise.all([...assetKeys].map(async (k) => signed.set(k, await presignedGetUrl(k))));
  for (const screen of PRINTER_SCREENS) {
    for (const o of config.screens[screen].objects) {
      if (o.type === "icon" && o.icon?.source === "upload" && o.icon.url) {
        o.icon = { ...o.icon, signedUrl: signed.get(o.icon.url) ?? undefined };
      }
      if (o.type === "image" && o.image?.url) {
        o.image = { ...o.image, signedUrl: signed.get(o.image.url) ?? undefined };
      }
    }
  }
```
Delete the `const logoUrl = s?.logoUrl ? await presignedGetUrl(s.logoUrl) : null;` line (960). In the returned `payload` (lines 967-981) replace `logoUrl,` with `wordmark: organizationName,`.

- [ ] **Step 6: Update `DeviceConfigPayload`**

In `lib/data.ts` (lines 876-890): replace `logoUrl: string | null; // presigned, short-lived` with:
```ts
  wordmark: string; // brand wordmark text (= organization name) for the logo widget
```
Update the interface doc comment (line 875) to say "icons + images presigned".

- [ ] **Step 7: Update `getTenantBranding` + `TenantBranding`**

In `getTenantBranding` (lines 785-840): delete the `logoUrl` presign block (lines 794-798); generalize the icon presign walk (lines 807-822) the same way as Step 5 (add the `image` cases); in the returned object delete `logoUrl,` and `hasLogo: !!s?.logoUrl,`. Update the `TenantBranding` type (find it — it has `logoUrl: string | null; hasLogo: boolean;`) to drop both fields. Keep `logoText` on `Tenant` (line 44 of `lib/types.ts`) — it remains the preview wordmark.

- [ ] **Step 8: Build**

Run: `npm run build`
Expected: compiles. (Consumers of `logoUrl`/`hasLogo` in the branding editor/page are fixed in Task 5 — if the build is run before Task 5 it will flag those; that's expected and resolved there. Run `npx tsc --noEmit` and confirm the ONLY new errors are in `branding-editor.tsx` / `branding/page.tsx`.)

- [ ] **Step 9: Commit**

```bash
git add lib/device-config.ts lib/device-config.test.ts lib/data.ts lib/types.ts
git commit -m "feat(branding): device payload presigns images + sends wordmark, drops logoUrl

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Editor UI — add/upload image, remove logo uploader (maratus-admin)

**Files:**
- Modify: `components/device-preview/printer-editor/use-printer-editor.ts`
- Modify: `components/device-preview/printer-editor/printer-controls.tsx`
- Modify: `components/branding-editor.tsx`
- Modify: `app/(tenant)/tenant/branding/page.tsx`

**Interfaces:**
- Consumes: `createImageObject` (Task 1); `image:<objectId>` form contract (Task 3); `TenantBranding` without `logoUrl`/`hasLogo` (Task 4).
- Produces: editor `addImage()`, `onImageUpload(objectId, file)`; `image:<id>` files set on the save FormData.

- [ ] **Step 1: Add `addImage` to the editor hook**

In `use-printer-editor.ts`: import `createImageObject` (line 5-12). Add `addImage: () => void;` to the `PrinterEditor` interface (near `addIcon`, line 46). Update the cap count (line 80):
```ts
  const addableCount = objects.filter((o) => o.type === "text" || o.type === "icon" || o.type === "image").length;
```
Add the function after `addIcon` (line 162):
```ts
  function addImage() {
    if (disabled || atCustomCap) return;
    const z = objects.reduce((m, o) => Math.max(m, o.z), 0) + 1;
    const newImage = createImageObject(z);
    setObjects([...objects, newImage]);
    setSelectedId(newImage.id);
  }
```
Add `addImage,` to the returned object (near `addIcon,`, line 216).

- [ ] **Step 2: Add "+ Image" button, image properties, image delete**

In `printer-controls.tsx`: extend the component prop to also take an image-upload callback:
```ts
export function PrinterControls({ editor, onIconUpload, onImageUpload }: { editor: PrinterEditor; onIconUpload: (objectId: string, file: File) => void; onImageUpload: (objectId: string, file: File) => void }) {
```
Add an "Add image" button after the "Add icon" button (after line 60):
```tsx
            <button
              type="button"
              disabled={disabled || atCustomCap}
              onClick={editor.addImage}
              title={atCustomCap ? `Limit of ${MAX_CUSTOM} custom objects reached` : undefined}
              className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
            >
              <Plus className="size-3.5" /> Add image
            </button>
```
Make image objects deletable — update the list delete condition (line 83):
```tsx
              {(o.type === "text" || o.type === "icon" || o.type === "image") && (
```
Pass the callback through to `Properties` (line 99):
```tsx
      {selected && <Properties key={selected.id} object={selected} editor={editor} onIconUpload={onIconUpload} onImageUpload={onImageUpload} />}
```
Update the `Properties` signature (line 114) to accept `onImageUpload`. Add an image properties panel after the icon block (after line 166):
```tsx
      {object.type === "image" && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Image</Label>
          <ImageUploadField
            url={object.image?.signedUrl ?? object.image?.url ?? null}
            disabled={disabled}
            onUpload={(file) => onImageUpload(object.id, file)}
          />
        </div>
      )}
```
Add the `ImageUploadField` helper component at the bottom of the file (after `NumberField`):
```tsx
function ImageUploadField({ url, disabled, onUpload }: { url: string | null; disabled?: boolean; onUpload: (file: File) => void }) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2">
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-16 w-full rounded-md border object-contain" />
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => fileRef.current?.click()}
        className="w-full rounded-md border px-2 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
      >
        {url ? "Replace image" : "Upload image (≤ 2 MB)"}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Wire the image upload + form in `branding-editor.tsx`**

Add image-file state next to `iconFiles` (after line 137):
```ts
  const [imageFiles, setImageFiles] = React.useState<Record<string, File>>({});
  const onImageUpload = (objectId: string, file: File) => {
    if (!file.type.startsWith("image/")) { toast.error("Image must be an image."); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error("Image must be under 2 MB."); return; }
    setImageFiles((m) => ({ ...m, [objectId]: file }));
    editor.patch(objectId, { image: { url: `pending:${objectId}`, signedUrl: URL.createObjectURL(file) } });
  };
```
Reset `imageFiles` when server truth arrives (line 141):
```ts
  React.useEffect(() => { setConfig(initialConfig); setIconFiles({}); setImageFiles({}); }, [initialConfig]);
```
Add to `dirty` (line 149-ish): `|| Object.keys(imageFiles).length > 0`.
In `save()` set the files (after line 210):
```ts
    for (const [objectId, file] of Object.entries(imageFiles)) fd.set(`image:${objectId}`, file);
```
Clear on success (after line 225): `setImageFiles({});`. Add `setImageFiles({});` to `reset()` (near line 189).
Pass the new callback to `PrinterControls` (line 339):
```tsx
                <PrinterControls editor={editor} onIconUpload={onIconUpload} onImageUpload={onImageUpload} />
```

- [ ] **Step 4: Remove the dedicated logo uploader UI/state**

In `branding-editor.tsx`: delete the logo state (`logoPreview`, `logoFile`, `logoCleared`, lines 110-112), the `initialLogoUrl` prop (lines 86, 97), `fileRef`/`onFile`/`removeLogo` (lines 121, 159-180), the logo preview/upload JSX + hidden `<input>` (lines 258-283), and the logo bits of `reset()` (lines 191-195) and `save()` (lines 212-213, 223). Remove `logoUrl: logoPreview` from `printerBrand` (line 236) — `PrinterBrand.logoUrl` is removed in Task 6; until then leave `logoText` only. Keep the "Logo text (preview fallback)" field (lines 285-288) — it's the wordmark preview value. Remove the now-unused `ImageUp`/`X` imports if no longer referenced.

- [ ] **Step 5: Drop `logoUrl`/`hasLogo` from the page**

In `app/(tenant)/tenant/branding/page.tsx`: remove `initialLogoUrl={branding.logoUrl}` from the `<BrandingEditor>` props (line ~28). (The `BrandingEditor` prop type was updated in Step 4.)

- [ ] **Step 6: Build + manual smoke**

Run: `npm run build`
Expected: compiles with no `logoUrl`/`logoPreview` references left.
Manual: `npm run dev`, sign in as `dana@roastwell.co` / `123456`, open `/tenant/branding`. Confirm: no logo uploader in the Brand section; "+ Image" button present; adding an image, uploading a PNG, and seeing it in the preview works; Save succeeds (toast).

- [ ] **Step 7: Commit**

```bash
git add components/device-preview/printer-editor/use-printer-editor.ts components/device-preview/printer-editor/printer-controls.tsx components/branding-editor.tsx "app/(tenant)/tenant/branding/page.tsx"
git commit -m "feat(branding): add image object to editor, remove logo uploader

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Preview — render image objects + logo-as-wordmark (maratus-admin)

**Files:**
- Modify: `components/device-preview/printer-preview.tsx`

**Interfaces:**
- Consumes: `PrinterObject.image` (Task 1); `PrinterBrand.logoText`.
- Produces: an `ImageObject` renderer; `LogoObject` rendering the wordmark text (WYSIWYG parity with the device, which renders `OBJ_LOGO` as text).

- [ ] **Step 1: Remove `logoUrl` from `PrinterBrand`**

In `printer-preview.tsx` (lines 27-45): delete `logoUrl?: string | null;` from `PrinterBrand`.

- [ ] **Step 2: Render `LogoObject` as the wordmark text**

Replace `LogoObject` (lines 255-270) with a pure wordmark renderer (parity with the firmware, which draws the wordmark string as centered text):
```tsx
function LogoObject({ object, brand }: { object: PrinterObject; brand: PrinterBrand }) {
  const size = object.h * 720 * 0.42;
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      <span style={{ fontSize: cq(size), fontWeight: 700, color: "var(--k-fg)", textAlign: "center", lineHeight: 1.1, overflowWrap: "anywhere" }}>
        {brand.logoText}
      </span>
    </div>
  );
}
```
(Note: the `Logo` mark+wordmark component and the uploaded-logo `<img>` branch are intentionally dropped — the device can only render text for the logo widget, so the preview matches.)

- [ ] **Step 3: Add the `ImageObject` renderer + dispatch**

Add to the `ObjectVisual` switch (after the `icon` case, line 211):
```tsx
    case "image":
      return <ImageObject object={object} />;
```
Add the component near `IconObject`:
```tsx
function ImageObject({ object }: { object: PrinterObject }) {
  const src = object.image?.signedUrl ?? object.image?.url ?? null;
  if (!src) {
    return <div style={{ width: "100%", height: "100%", border: "1px dashed var(--k-muted)", borderRadius: 8 }} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
  );
}
```

- [ ] **Step 4: Build + manual**

Run: `npm run build`
Expected: compiles (no remaining `brand.logoUrl` references anywhere — grep to confirm: `grep -rn "logoUrl" components/ app/ lib/` should return nothing except possibly the migration script).
Manual (`npm run dev`): on `/tenant/branding`, the idle "Logo" widget now shows the brand name text; an added image renders its uploaded picture in preview.

- [ ] **Step 5: Commit**

```bash
git add components/device-preview/printer-preview.tsx
git commit -m "feat(branding): preview renders image objects + logo wordmark text

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: One-time migration — logoUrl → image object (maratus-admin)

**Files:**
- Create: `lib/db/migrate-logo-to-image.ts`

**Interfaces:**
- Consumes: `tenantSettings.logoUrl`, `tenantSettings.printerScreens/printerLayout`; `normalizePrinterConfig`, `PRINTER_SCREENS`.
- Produces: each org's `logo` widgets (where the org had an uploaded `logoUrl`) converted to `image` objects pointing at the existing R2 key; `logoUrl` cleared. Orgs without a logo keep their `logo` widget (now a wordmark). Idempotent.

- [ ] **Step 1: Write the script**

Create `lib/db/migrate-logo-to-image.ts` (mirrors `lib/db/backfill-qr-visible.ts`):
```ts
// One-time: convert each org's `logo` layout widgets into `image` objects pointing
// at the org's existing uploaded logo (tenant_settings.logoUrl), then clear logoUrl.
// Orgs with no uploaded logo are left unchanged (their logo widget renders the
// wordmark). Idempotent: re-running finds no remaining logoUrl and is a no-op.
//   npx tsx lib/db/migrate-logo-to-image.ts
import "./load-env"; // must be first: loads env before ../db reads it
import { eq, isNotNull } from "drizzle-orm";
import { db } from "../db";
import { tenantSettings } from "./schema";
import { normalizePrinterConfig, PRINTER_SCREENS } from "../printer-layout";

async function main() {
  const rows = await db
    .select({
      organizationId: tenantSettings.organizationId,
      logoUrl: tenantSettings.logoUrl,
      printerScreens: tenantSettings.printerScreens,
      printerLayout: tenantSettings.printerLayout,
    })
    .from(tenantSettings)
    .where(isNotNull(tenantSettings.logoUrl));

  let updated = 0;
  for (const r of rows) {
    if (!r.logoUrl) continue;
    const cfg = normalizePrinterConfig(r.printerScreens ?? r.printerLayout);
    for (const screen of PRINTER_SCREENS) {
      cfg.screens[screen].objects = cfg.screens[screen].objects.map((o) =>
        o.type === "logo"
          ? { id: o.id, type: "image", x: o.x, y: o.y, w: o.w, h: o.h, visible: o.visible, z: o.z, image: { url: r.logoUrl! } }
          : o,
      );
    }
    const printerLayout = {
      version: 2 as const,
      clockTimezone: cfg.clockTimezone,
      clock24h: cfg.clock24h,
      wifiLevel: cfg.wifiLevel,
      objects: cfg.screens.idle.objects,
    };
    await db
      .update(tenantSettings)
      .set({ printerScreens: cfg, printerLayout, logoUrl: null })
      .where(eq(tenantSettings.organizationId, r.organizationId));
    updated++;
  }
  console.log(`Migrated logo→image for ${updated} org(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (Note: `image` is now a valid `PrinterObjectType`, so the mapped object type-checks.)

- [ ] **Step 3: Dry-run against the dev DB**

Run: `npm run db:seed` (resets sample data incl. Roastwell's custom logo), then `npx tsx lib/db/migrate-logo-to-image.ts`.
Expected: prints `Migrated logo→image for N org(s).` (N ≥ 1 — Roastwell has a custom logo). Re-run it: prints `0 org(s)` (idempotent).
Verify in `npm run db:studio` that Roastwell's `printerScreens` idle objects now include an `image` object with `image.url` = the old logo key, and `logoUrl` is null.

- [ ] **Step 4: Commit**

```bash
git add lib/db/migrate-logo-to-image.ts
git commit -m "feat(branding): one-time migration of logoUrl into image objects

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Firmware — parse `image` object + `wordmark` (maratus-firmware)

**Files:**
- Modify: `components/devcfg/include/device_config.h`
- Modify: `components/devcfg/cfg_parse.c`
- Modify: `tools/cfg-harness/test_cfg.c`
- Modify: `tools/cfg-harness/fixtures/sample-config.json`

**Interfaces:**
- Produces: `OBJ_IMAGE` enum; `cfg_object_t.image_url`; `device_config_t.wordmark`; parser maps `"image"`→`OBJ_IMAGE`, reads `image.signedUrl`→`image_url`, reads top-level `"wordmark"`→`wordmark`.

- [ ] **Step 1: Create the firmware branch**

```bash
cd /Users/eren/Projects/maratus-firmware && git checkout -b feat/branding-image-object
```

- [ ] **Step 2: Write the failing host test + fixture**

In `tools/cfg-harness/fixtures/sample-config.json`: add `"wordmark": "Roastwell Coffee",` at the top level (after `logoUrl`), and add an image object to the `idle` screen's `objects` array (after the `t1` text object):
```json
        { "id": "img1", "type": "image", "x": 0.3, "y": 0.6, "w": 0.4, "h": 0.2, "visible": true, "z": 3, "image": { "signedUrl": "https://r2.example.com/branding/org_1/images/x.png?sig=ROTATES" } }
```
In `tools/cfg-harness/test_cfg.c`, inside `test_parse()` after the idle assertions (the block asserts `idle->n == 1`): change that to account for the new visible image object and assert image parsing. Replace the idle block (the `idle->n == 1` assertions) with:
```c
    // idle: hidden object dropped -> 1 text + 1 image visible.
    cfg_screen_t *idle = &cfg.screens[SCREEN_IDLE];
    assert(idle->n == 2);
    assert(idle->objects[0].type == OBJ_TEXT);
    assert(strcmp(idle->objects[0].text, "Welcome") == 0);
    assert(idle->objects[1].type == OBJ_IMAGE);
    assert(strstr(idle->objects[1].image_url, "/branding/org_1/images/x.png") != NULL);
    // top-level wordmark parsed.
    assert(strcmp(cfg.wordmark, "Roastwell Coffee") == 0);
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd tools/cfg-harness && make test`
Expected: compile error (`OBJ_IMAGE`/`image_url`/`wordmark` undefined) or assertion failure.

- [ ] **Step 4: Extend `device_config.h`**

Add `OBJ_IMAGE` to the enum (line 19-24), before `OBJ_UNKNOWN`:
```c
typedef enum {
    OBJ_TEXT, OBJ_ICON,
    OBJ_LOGO, OBJ_CLOCK, OBJ_WIFI, OBJ_QR, OBJ_SPINNER,
    OBJ_COUNTDOWN, OBJ_PAIRING_CODE, OBJ_STEPS,
    OBJ_IMAGE,
    OBJ_UNKNOWN
} cfg_obj_type_t;
```
Add `image_url` to `cfg_object_t` after the icon fields (after line 44):
```c
    // image
    char  image_url[CFG_URL_LEN];   // presigned (rotates); from image.signedUrl
```
Add `wordmark` to `device_config_t` after `logo_url` (line 63):
```c
    char     wordmark[CFG_TEXT_LEN];   // brand wordmark text for the logo widget
```

- [ ] **Step 5: Extend `cfg_parse.c`**

In `type_of` (line 35-48) add before the final `return`:
```c
    if (!strcmp(s, "image"))       return OBJ_IMAGE;
```
In `parse_screen`, add an image branch after the `OBJ_ICON` branch (after line 102, before the `OBJ_CLOCK` `else if`):
```c
        } else if (type == OBJ_IMAGE) {
            cJSON *image = cJSON_GetObjectItem(o, "image");
            copy_str(t->image_url, CFG_URL_LEN,
                     image ? cJSON_GetStringValue(cJSON_GetObjectItem(image, "signedUrl")) : NULL);
```
In `cfg_parse_json`, parse the top-level wordmark after the `logo_url` copy (after line 131):
```c
    copy_str(cfg->wordmark, CFG_TEXT_LEN, cJSON_GetStringValue(cJSON_GetObjectItem(root, "wordmark")));
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd tools/cfg-harness && make test`
Expected: `test_parse OK` and all other tests pass.

- [ ] **Step 7: Commit**

```bash
git add components/devcfg/include/device_config.h components/devcfg/cfg_parse.c tools/cfg-harness/test_cfg.c tools/cfg-harness/fixtures/sample-config.json
git commit -m "feat(devcfg): parse image objects + top-level wordmark

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Firmware — render image + logo-as-wordmark (maratus-firmware)

**Files:**
- Modify: `components/ui/ui.c`
- Modify: `main/app_state.c`

**Interfaces:**
- Consumes: `OBJ_IMAGE`, `image_url`, `wordmark` (Task 8); existing `render_image`, `render_text`, `asset_cache`, `gather_asset_urls`.
- Produces: `OBJ_IMAGE` rendered from `image_url`; `OBJ_LOGO` rendered as the wordmark text; image URLs prefetched.

- [ ] **Step 1: Route `render_image` for images**

In `components/ui/ui.c`, update the URL selection in `render_image` (line 180) — `OBJ_LOGO` no longer routes here:
```c
    const char *url = (o->type == OBJ_IMAGE) ? o->image_url : o->icon_url;
```
(The `o->type == OBJ_ICON && o->icon_circle` clause at line 208 stays — images never set `icon_circle`, so they always render rectangular contain-fit.)

- [ ] **Step 2: Add a wordmark renderer for `OBJ_LOGO`**

Add a small renderer near `render_text` (it can delegate to the existing text path by drawing `s_cfg->wordmark`). Add after `render_image` (after line 214):
```c
// The logo widget is now a brand wordmark: draw the org name (top-level "wordmark")
// as centered brand-fg text inside the object's box.
static void render_wordmark(lv_obj_t *scr, const cfg_object_t *o) {
    if (!s_cfg->wordmark[0]) { return; }   // nothing to show; leave the slot empty
    px_box_t b = geom_box(o);
    lv_obj_t *lbl = lv_label_create(scr);
    lv_label_set_long_mode(lbl, LV_LABEL_LONG_WRAP);
    lv_obj_set_width(lbl, b.w > 0 ? b.w : 200);
    lv_obj_set_pos(lbl, b.x, b.y);
    lv_obj_set_style_text_align(lbl, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_style_text_color(lbl, lv_color_hex(s_cfg->brand_fg), 0);
    lv_label_set_text(lbl, s_cfg->wordmark);
}
```
> Implementation note: match the existing `render_text` font/sizing conventions in this file (e.g. how it picks an `lv_font_t` from `font_size`). If `render_text` exposes a reusable label helper, prefer calling it with `s_cfg->wordmark` and a sensible size derived from `o->h` instead of duplicating styling. Keep the device output a bold centered wordmark, matching the admin preview's `LogoObject`.

- [ ] **Step 3: Update the render dispatch**

In the `switch (o->type)` (lines 479-494): change the `OBJ_LOGO` case and add `OBJ_IMAGE`:
```c
            case OBJ_LOGO: render_wordmark(scr, o); break;
            case OBJ_IMAGE: render_image(scr, o); break;
```

- [ ] **Step 4: Prefetch image assets**

In `main/app_state.c`, extend `gather_asset_urls` (lines 165-180). The top-level `logo_url` is no longer sent by the cloud, so drop that line and add images. Replace the body's collection loop region:
```c
static int gather_asset_urls(const device_config_t *cfg, const char *urls[], int cap)
{
    int n = 0;
    for (int s = 0; s < SCREEN_COUNT && n < cap; s++) {
        const cfg_screen_t *sc = &cfg->screens[s];
        for (int i = 0; i < sc->n && n < cap; i++) {
            const cfg_object_t *o = &sc->objects[i];
            if (o->type == OBJ_ICON && o->icon_src == ICON_UPLOAD &&
                o->visible && o->icon_url[0]) {
                urls[n++] = o->icon_url;
            } else if (o->type == OBJ_IMAGE && o->visible && o->image_url[0] && n < cap) {
                urls[n++] = o->image_url;
            }
        }
    }
    return n;
}
```
Update the comment above it (lines 162-164) to describe icons + images (no more top-level logo).

- [ ] **Step 5: Host tests still pass + build**

Run: `cd tools/cfg-harness && make test`
Expected: all pass (this task doesn't change parsing, but confirm no regression).
Run a firmware build: `cd /Users/eren/Projects/maratus-firmware && idf.py build` (per BUILD.md — ensure `ESP_IDF_VERSION` is **5.5**, not 5.5.4, per the SDIO trap note).
Expected: compiles clean.

- [ ] **Step 6: Commit**

```bash
git add components/ui/ui.c main/app_state.c
git commit -m "feat(ui): render image objects + logo widget as wordmark

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: End-to-end + HIL verification

**Files:** none (verification only).

- [ ] **Step 1: Run the migration against the target DB**

After the maratus-admin changes are deployed/previewed, run `npx tsx lib/db/migrate-logo-to-image.ts` once against the live DB (env via `.env.local`). Confirm the printed count and that re-running reports 0.

- [ ] **Step 2: Inspect the device payload**

With a claimed device's key, `curl` `GET {BETTER_AUTH_URL}/api/device/config` with `Authorization: Bearer <deviceKey>`. Confirm: no top-level `logoUrl`; a top-level `wordmark` string; any image object has `image.signedUrl`; the ETag differs after editing branding.

- [ ] **Step 3: HIL on hardware**

Flash the firmware build (per BUILD.md). On the device, verify:
- A migrated org (Roastwell) shows its **logo image** where the logo used to be (image object), aspect-correct.
- An org without an uploaded logo shows its **name as wordmark text** in the logo slot.
- Add a new image in admin, Save; on the device's next poll, the image appears.
- No placeholder boxes where the logo used to be.

- [ ] **Step 4: Update memory / docs**

Record the shipped state (admin + firmware branches, migration run) following the project's memory conventions. Note in the firmware memory that `OBJ_LOGO` is now a wordmark (not an image) and the cloud no longer sends `logoUrl`.

---

## Self-Review notes

- **Spec coverage:** image object (Tasks 1,5,6,8,9); reuse icon pipeline (Tasks 3,4); storage key (Task 2); presign walk (Task 4); orphan cleanup (Task 3); remove logo uploader + logoUrl (Tasks 3,4,5,6); wordmark for logo widget (Tasks 4,6,9) — note this supersedes the spec's "logo→text migration": orgs without a logo keep the `logo` widget which now renders the wordmark, so only logo→image migration is needed (Task 7); firmware parse+render+prefetch (Tasks 8,9); host + unit tests (Tasks 1,4,8); HIL (Task 10); 512px cap unchanged (Global Constraints).
- **Type consistency:** `PrinterImage`/`image_url`/`wordmark`/`organizationName`/`imageStorageKey`/`addImage`/`onImageUpload` used consistently across tasks.
- **Migration vs spec:** the spec proposed logo→text for logo-less orgs; this plan instead keeps the `logo` widget and renders it as the wordmark (less firmware risk than new wordmark code was avoided by reusing the text/label renderer; no seed changes needed). Net user-visible result matches the approved design.
