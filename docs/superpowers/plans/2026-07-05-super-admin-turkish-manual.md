# Süper Admin Türkçe Kullanım Kılavuzu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a comprehensive Turkish (tr) PDF user manual for the Maratus Admin **Süper Admin (platform_admin)** console, written so a person with zero prior knowledge can operate every screen by following it.

**Architecture:** Author one Turkish Markdown source file (`docs/manuals/tr/super-admin-kilavuzu.md`), built up chapter-group by chapter-group with an accuracy check against exact UI facts after each. A final task renders it to a polished PDF via the `make-pdf` skill (cover, TOC, page numbers) and commits both `.md` and `.pdf`.

**Tech Stack:** Markdown authoring; `make-pdf` skill for PDF rendering. No application code changes.

## Global Constraints

- **Language:** Body prose in Turkish, "siz" (formal/polite) register, written for a reader with zero prior knowledge.
- **UI naming rule:** Every screen/button/field name given as **"Türkçe karşılık (İngilizce arayüz metni)"** on first use in a chapter, then the Turkish short form (e.g. **Genel Bakış (Overview)**, **Yeni müşteri (New customer)** butonu). The app UI is in English — never invent a Turkish label that implies the UI is Turkish.
- **Accuracy principle:** Document ONLY what actually exists in the UI. This is documentation, not a code change — where the UI has quirks, *describe* them; do not "fix" code.
- **Mandatory accuracy notes** (must appear where relevant, phrased so as not to mislead):
  - The **+12.1%** delta on Overview → "Activations this month" is **hardcoded**, not a live metric.
  - The sidebar item is **"Billing & Revenue"** but that page's own title is **"Billing & Credits"** — note the mismatch.
  - There is **no** Suspend/Reactivate button in the UI although "Suspended" is a displayable tenant status — do not describe a button that does not exist.
  - **"Forgot password?"** and **"Continue with SSO"** on the login page are not functional (SSO shows a toast "SSO not configured").
- **Chapter template** (apply to every screen chapter): `#### Bu ekran ne işe yarar?` → `#### Ekranda neler var?` → `#### Adım adım: <görev>` (numbered) → `#### İpuçları ve dikkat edilecekler` (if any).
- **Source of truth:** The "SOURCE FACTS" block inside each task lists the exact UI labels/fields/actions. Do not add features not listed there. Do not omit listed ones.
- **File:** All content goes into the single file `docs/manuals/tr/super-admin-kilavuzu.md`. Tasks append chapters in order. Commit after each task.
- **Branch:** Work on `docs/super-admin-turkish-manual` (already created; the design spec is already committed there).

---

## File Structure

- **Create:** `docs/manuals/tr/super-admin-kilavuzu.md` — the entire manual, single source file. Chapters appended in reading order across Tasks 1–5.
- **Create (Task 6):** `docs/manuals/tr/super-admin-kilavuzu.pdf` — rendered output.

There is no test framework for prose. Each task's "verification" step is a concrete proofreading checklist run against that task's SOURCE FACTS and the Global Constraints. The final task's verification is a successful PDF render whose TOC lists all chapters.

---

### Task 1: Scaffold + foundational chapters (Giriş, Maratus Nedir?, Başlarken)

**Files:**
- Create: `docs/manuals/tr/super-admin-kilavuzu.md`

**Interfaces:**
- Produces: the document title (H1 `# Süper Admin Kullanım Kılavuzu`) and chapters 1–3. Later tasks append `## ` chapters after chapter 3. `make-pdf` (Task 6) reads the H1 as the cover title and `##` headings as TOC entries.

**SOURCE FACTS (from the codebase — use these exactly):**
- **What Maratus is:** Printers replace paper documents with a QR code the customer scans to download a digital document. Trigger-only model: the device shows a QR of a caller-supplied URL; Maratus no longer hosts documents.
- **Multi-tenant:** each customer = one organization (kiracı/tenant). Tenant roles (owner/admin/member) live on membership.
- **Super Admin is NOT an org membership:** it is `user.role = 'platform_admin'`. Distinct from tenant admins.
- **Device = printer.** Hardware shows a QR; customer scans it.
- **Trigger→QR flow:** an authenticated caller POSTs a trigger with a URL → 1 credit reserved → device polls, renders QR, acks → success settles the credit, failure/expiry releases it.
- **Prepaid credits:** each trigger costs 1 credit; reserve → settle → release lifecycle. New signups get 50 starter credits.
- **Firmware/OTA:** newest published firmware release is the OTA target devices fetch.
- **Login:** `/login`, email + password (Better Auth). Demo super admin: `admin@maratus.app` / `123456`. After sign-in, `platform_admin` → `/admin`; others → `/tenant`. "Forgot password?" and "Continue with SSO" are non-functional (SSO toast: "SSO not configured"). A "Demo accounts" panel lists the platform admin account.
- **Access gate:** whole `/admin` section requires `platform_admin`; otherwise redirect to `/tenant` (or `/login` if signed out).
- **Sidebar group "Platform", item order:** Overview → Customers → Device Fleet → Health → Firmware → Billing & Revenue. Top bar: theme toggle + user menu (name, email, role "Super Admin").

- [ ] **Step 1: Create the file with H1 title + a short "Bu Kılavuz Hakkında" preface**

Create `docs/manuals/tr/super-admin-kilavuzu.md` starting with:

```markdown
# Süper Admin Kullanım Kılavuzu

*Maratus Admin — Platform Yöneticisi (Süper Admin) Rehberi*

## 1. Giriş & Bu Kılavuz Hakkında
```

Write 2–3 short paragraphs: who this is for (Maratus platform yöneticileri / Süper Admin), that the app UI is in English so labels are given as "Türkçe (İngilizce)", and how to read the manual (önce kavramlar, sonra her ekran).

- [ ] **Step 2: Write chapter "2. Maratus Nedir? (Kavramsal Model)"**

Add `## 2. Maratus Nedir? (Kavramsal Model)`. Cover every SOURCE FACT under "What Maratus is", "Multi-tenant", "Super Admin is NOT an org membership", "Device = printer", "Trigger→QR flow", "Prepaid credits", "Firmware/OTA". Use short subsections or a bullet list. Explain the *why* (paperless, credit-metered) not just the *what*.

- [ ] **Step 3: Write chapter "3. Başlarken (Giriş ve Gezinme)"**

Add `## 3. Başlarken (Giriş ve Gezinme)`. Include: numbered login steps (`#### Adım adım: Giriş yapma`), the demo account, the redirect behavior, the access gate, the non-functional links note, and the sidebar menu order + top-bar controls. Use the chapter template.

- [ ] **Step 4: Verify against SOURCE FACTS + Global Constraints**

Re-read chapters 1–3 and confirm:
- Every SOURCE FACT above is represented.
- UI naming rule applied on first mention of each screen/label.
- Non-functional "Forgot password?"/"SSO" note is present and phrased as non-functional.
- No feature invented beyond SOURCE FACTS.
Fix any gaps inline.

- [ ] **Step 5: Commit**

```bash
git add docs/manuals/tr/super-admin-kilavuzu.md
git commit -m "docs(manual): TR super-admin manual — intro, concepts, getting started"
```

---

### Task 2: Overview + Customers chapters

**Files:**
- Modify: `docs/manuals/tr/super-admin-kilavuzu.md` (append chapters 4–5)

**Interfaces:**
- Consumes: chapter template + naming rule from Task 1.
- Produces: `## 4. Genel Bakış (Overview)` and `## 5. Müşteriler (Customers)`.

**SOURCE FACTS — Overview (`/admin`):**
- Title "Overview", desc "Platform-wide performance across all Maratus customers."
- KPI cards: **Activations this month** (delta badge **+12.1%** is HARDCODED — say so), hint "platform-wide"; **Active devices** shown as `active/total`, hint "printers online"; **Customers**, hint "{N} stores".
- Chart card **Activations over time** ("Monthly activations, all customers") — area chart.
- Table card **Top customers** ("By activations this month") + **All customers** link → `/admin/customers`. Columns: Customer, Stores, Devices, Activations. Names link to customer detail; each shows a status badge.
- Table card **Credits by company** ("Trigger credits spent this month"). Columns: Company, Credits spent, Triggers. Top 10. Empty: "No credit usage yet this month."
- No mutating controls on this screen.

**SOURCE FACTS — Customers list (`/admin/customers`):**
- Title "Customers", desc "{N} store chains on Maratus". Header button **New customer**.
- Table columns: Customer, Stores, Devices, Health, Activations (mo.), Status, (chevron). Row links to `/admin/customers/{id}`.
- Health cell: colored dot + label + (online/total). States: **Healthy** (yeşil), **Warning** (amber), **Critical** (kırmızı).
- Status cell badge: **Active** (yeşil), **Trial** (mor), **Suspended** (kırmızı).
- **New customer dialog:** title "New customer", desc "Add a store chain to the Maratus platform." Fields: **Company name** (zorunlu, placeholder "e.g. Roastwell Coffee"), **Contact name** ("Jane Doe"), **Contact email** ("jane@store.com"). Footer: **Cancel**, **Create customer** ("Creating…"). Action creates the tenant; success toast "Customer created — {name} has been added to Maratus."; error "Couldn't create customer".

- [ ] **Step 1: Write chapter "4. Genel Bakış (Overview)"**

Append `## 4. Genel Bakış (Overview)`. Follow the chapter template. In "Ekranda neler var?" list all three KPI cards, both tables (with columns), and the chart. Explicitly note the +12.1% is a sabit (hardcoded) placeholder, not canlı veri. Note this screen has no buttons to change anything (salt görüntüleme + linkler).

- [ ] **Step 2: Write chapter "5. Müşteriler (Customers)" — list + New customer**

Append `## 5. Müşteriler (Customers)`. Cover the table and all badge meanings (health + status). Add `#### Adım adım: Yeni müşteri oluşturma` with numbered steps: click **Yeni müşteri (New customer)** → fill Company name (zorunlu)/Contact name/Contact email → **Create customer** → success toast. Mention Company name is required.

- [ ] **Step 3: Verify against SOURCE FACTS**

Confirm all KPI/table/column labels, badge states, and dialog fields are present; +12.1% caveat present; naming rule applied. Fix inline.

- [ ] **Step 4: Commit**

```bash
git add docs/manuals/tr/super-admin-kilavuzu.md
git commit -m "docs(manual): TR super-admin manual — Overview + Customers list"
```

---

### Task 3: Customer detail chapter (extends chapter 5)

**Files:**
- Modify: `docs/manuals/tr/super-admin-kilavuzu.md` (append a `## 6. Müşteri Detayı` chapter; renumber later chapters accordingly — see note)

**Numbering note:** To keep numbers stable, make Customer detail its own top-level chapter `## 6. Müşteri Detayı (Customer Detail)` and shift subsequent chapters: Device Fleet becomes 7, Firmware 8, Health 9, Billing 10, Reference 11, Sözlük 12, SSS 13. Use these final numbers from Task 3 onward.

**Interfaces:**
- Consumes: chapter template.
- Produces: `## 6. Müşteri Detayı (Customer Detail)`.

**SOURCE FACTS — Customer detail (`/admin/customers/[tenantId]`):**
- Header card: customer name + status badge, contact email (Mail), phone (Phone). 404 if not found. Back link "← Customers". Header button **Add branch**.
- Health summary strip: dot + level (Healthy/Warning/Critical) + counts **Online**, **Offline**, **Paused**, **Stuck pending**.
- KPI cards: **Stores**, **Devices**, **Activations this month**.
- Chart **Activations by store** ("This month, per branch") — horizontal bar.
- **Credits card:** shows **Available:** {n} · **Held:** {n}. Contains **Grant credits** form: fields **Credits** (number, min 1, max 1.000.000, zorunlu, placeholder "e.g. 100"), **Note (optional)** ("e.g. promotional grant"); submit **Grant credits** ("Granting…"). Success "Credits granted."; error "Enter a whole credit amount between 1 and 1,000,000." Ledger table (if entries): columns **Kind**, **Credits**, **Device**, **Note**, **Time**. Empty: "No ledger entries yet."
- **Assigned devices card:** "{N} printers across all stores", button **Add device**. Columns: **Device**, **Store**, **Status**, **Last seen**, **Activations (mo.)**, + row-actions menu.
- **Activity** section: up to 50 audit events, human labels (e.g. "Customer created", "Device provisioned", "Credits granted", "Device paused/resumed"). Empty: "No activity yet."
- **Add branch dialog:** title "Add branch", desc "Create a new branch for {customer}." Fields: **Branch name** (zorunlu, "e.g. Downtown Flagship"), **Address** ("412 Market St, San Francisco, CA"), **Timezone** (dropdown, default given; helper "Used for busiest-times analytics."). Footer **Cancel**, **Add branch** ("Adding…"). Toast "Branch added — {name} added to {customer}."
- **Provision device dialog (Add device):** title "Add device", desc "Provision a new printer for {customer}. You'll get a pairing code to enter on the device." Fields: **Device name** ("e.g. Printer 1"), **Store (optional)** (dropdown, default "Unassigned"; helper "Leave unassigned to let the tenant claim it into a store."). Submit **Add device** ("Adding…"). Success state titled "Device provisioned": warning "The device stays 'offline' until it pairs with this code." + a **Pairing code** with a copy button; close **Done**.

- [ ] **Step 1: Write chapter "6. Müşteri Detayı (Customer Detail)"**

Append `## 6. Müşteri Detayı (Customer Detail)`. Cover header, health strip, KPIs, chart, then task subsections:
- `#### Adım adım: Kredi yükleme (Grant credits)` — numbered: open Krediler kartı → enter **Credits** (1–1.000.000) → optional **Note** → **Grant credits** → "Credits granted." Note the ledger table records it (Kind/Credits/Device/Note/Time).
- `#### Adım adım: Şube ekleme (Add branch)` — **Add branch** → Branch name (zorunlu)/Address/Timezone → **Add branch**.
- `#### Adım adım: Cihaz sağlama (Add device)` — **Add device** → Device name/Store (optional) → **Add device** → copy the **pairing code**; explain the device stays "offline" until paired with that code.
- Describe the Assigned devices table and the Activity log.

- [ ] **Step 2: Renumber downstream chapter placeholders**

No downstream chapters exist yet, but from here on use the final numbering: Device Fleet = 7, Firmware = 8, Health = 9, Billing = 10, Referans = 11, Sözlük = 12, SSS = 13. (Record this so Tasks 4–5 use correct numbers.)

- [ ] **Step 3: Verify against SOURCE FACTS**

Confirm every card, the Grant credits field bounds (1–1.000.000), pairing-code behavior, both dialogs' fields, and the ledger columns are documented. Fix inline.

- [ ] **Step 4: Commit**

```bash
git add docs/manuals/tr/super-admin-kilavuzu.md
git commit -m "docs(manual): TR super-admin manual — Customer detail (credits, branches, devices)"
```

---

### Task 4: Device Fleet + Device detail + Firmware chapters

**Files:**
- Modify: `docs/manuals/tr/super-admin-kilavuzu.md` (append chapters 7–8)

**Interfaces:**
- Produces: `## 7. Cihaz Filosu (Device Fleet)` and `## 8. Firmware`.

**SOURCE FACTS — Device Fleet (`/admin/devices`):**
- Title "Device Fleet", desc "Every printer across every customer, in one place."
- KPI cards: **Total devices**; **Online** ("ready to trigger"); **Paused** ("temporarily off"); **Offline** ("unreachable").
- Filters: **Search** ("Search by device, store, or customer…"), **Customer** dropdown ("All customers" + each), **Status** dropdown ("All statuses"/"Online"/"Paused"/"Offline").
- Table columns: **Device ID** (links to detail), **Customer**, **Store**, **Status**, **Last seen**, **Firmware** (`v{version}`; amber **update** pill when a newer release exists), **Activations (mo.)**, row-actions. Footer "Showing {n} of {total} devices." Empty "No devices match your filters."
- **Row actions menu:** **Pause**/**Activate** (only if status ≠ offline; offline can't be toggled → "Device is offline and can't be changed."), **Rename** (dialog: **Device name** → **Save**, "Device renamed"), **Move to store** (only when a store list is available; dialog: **Store** → **Move**), **Unassign** (clears store, sets offline), **Delete** (destructive; confirm "Delete device?" — "This permanently removes {name} and its document history. This can't be undone.").

**SOURCE FACTS — Device detail (`/admin/devices/[deviceId]`):**
- Title = device name, desc "Printer at {store}". Back link "← Device Fleet". 404 if missing.
- KPI cards: **Activations today**, **Activations this month**.
- Details card: **Device ID**, **IP address**, **Connection** ("Wi-Fi"/"Ethernet"), **Firmware** (`v{version}`, "→ v{latest} available" when update exists).
- Status & management: **Status** (effective), **Customer** (link), **Store**, **Last seen**, **Actions** (same row-actions menu). Effective status rule: paused wins; offline if never seen or last seen >15 min ago; else online.
- **Remote control** (CommandBar) buttons: **Reboot**, **Refresh config**, **Identify**, **Update firmware** → queues a command; feedback "{type} queued — the device will pick it up on its next check-in." Command history table: **Command**, **Status**, **Queued**.

**SOURCE FACTS — Firmware (`/admin/firmware`):**
- Title "Firmware", desc "Upload a build (its version must match the binary's CONFIG_MARATUS_FW_VERSION). The newest release is what devices fetch via the OTA manifest."
- **Publish form:** **version** text ("Version (e.g. 0.3.0-m6b)", zorunlu), **file** input (`.bin`, zorunlu), **Publish firmware** ("Publishing…"). Rules: version required; a non-empty `.bin` required; size ≤ 8MB; duplicate version rejected ("Version {v} is already published."). Success "Published {version}."
- Releases table (newest 50): **Version** (first row "(latest)"), **Size** (KB), **SHA-256** (first 12 chars + "…"), **Published**.
- **Delete** per row (window.confirm). Latest warning: "Delete {v}? It is the LATEST release — devices will fall back to the previous release as their OTA target." Non-latest: "Delete {v}? This permanently removes the binary and cannot be undone."

- [ ] **Step 1: Write chapter "7. Cihaz Filosu (Device Fleet)" incl. device detail**

Append `## 7. Cihaz Filosu (Device Fleet)`. Cover KPI cards, filters, table columns, and the firmware update pill. Then subsections:
- `#### Cihaz satır eylemleri (Row actions)` — describe each: Pause/Activate (offline duraklatılamaz), Rename, Move to store, Unassign, Delete (kalıcı, onay ister).
- `#### Cihaz Detayı (Device Detail)` — KPIs, details card, effective status rule (15 dk eşiği, paused önceliği), and `#### Adım adım: Uzaktan komut gönderme` for Reboot/Refresh config/Identify/Update firmware, noting commands run on next check-in and appear in the command history table.

- [ ] **Step 2: Write chapter "8. Firmware"**

Append `## 8. Firmware`. `#### Adım adım: Firmware yayımlama` (numbered: version gir → .bin seç → **Publish firmware**; kurallar: ≤8MB, yinelenen sürüm reddedilir, sürüm CONFIG_MARATUS_FW_VERSION ile eşleşmeli). Describe the releases table columns and the two different **Delete** warnings (latest vs non-latest). Explain OTA: en yeni sürüm cihazların hedefidir.

- [ ] **Step 3: Verify against SOURCE FACTS**

Confirm all fleet KPIs, filters, columns, every row action + its guard (offline can't toggle), device-detail effective-status rule, all 4 remote-control commands, firmware publish rules (8MB, duplicate, version match), and both delete warnings are present. Fix inline.

- [ ] **Step 4: Commit**

```bash
git add docs/manuals/tr/super-admin-kilavuzu.md
git commit -m "docs(manual): TR super-admin manual — Device Fleet, device detail, Firmware"
```

---

### Task 5: Health + Billing + Reference + Sözlük + SSS chapters

**Files:**
- Modify: `docs/manuals/tr/super-admin-kilavuzu.md` (append chapters 9–13)

**Interfaces:**
- Produces: chapters `## 9. Sistem Sağlığı`, `## 10. Faturalandırma & Krediler`, `## 11. Rozetler ve Göstergeler`, `## 12. Sözlük`, `## 13. Sık Sorulanlar / Sorun Giderme`.

**SOURCE FACTS — Health (`/admin/health`):**
- Title "Platform health". Read-only (no mutating controls).
- **Alerts banner:** no alerts → "All systems nominal." Alert types: "{n} device(s) not seen in 15+ minutes" (warning), "{n} document(s) stuck pending 30+ minutes" (warning), per inactive tenant "{name}: no documents in 7 days" (info; collapses to "{n} tenants have no documents in 7 days" when >5).
- **Fleet freshness:** KPI **Devices**, **Online**, **Paused**, **Stale (15m+)**; stale table columns **Device**, **Tenant**, **Last seen**.
- **Trigger activity:** KPI **Activations (1h)**, **Activations (24h)**, **Stuck pending**; sub-line "Last 24h: {n} acked · {n} pending · {n} failed".
- **Per-tenant usage:** **Top tenants (24h)** (empty "No activations in the last 24h.") and **Inactive (7d+)** (empty "All tenants active.").
- **Alert history:** **Open** (empty "No open alerts.") and **Resolved (7d)** (empty "Nothing resolved recently.").

**SOURCE FACTS — Billing (`/admin/billing`):**
- Title "Billing & Credits", desc "Platform-wide prepaid credit sales, consumption, and per-tenant balances." (Sidebar item labeled "Billing & Revenue" — note the mismatch.)
- Header button **Export tenants** → CSV `maratus-credits.csv`, headers **Customer, Balance, Consumed (mo.), Lifetime purchased**; toast "Export ready — {n} rows → filename".
- KPI cards: **Credits sold** ("lifetime, all tenants"), **Credits consumed** ("lifetime, all tenants"), **Outstanding liability** ("unspent credits owed to tenants").
- Table **Per-tenant credits** ("Balance, consumption this month, and lifetime purchases"). Columns: **Customer** (link), **Balance**, **Consumed (mo.)**, **Lifetime purchased**. Empty "No tenants with credit activity yet."

**SOURCE FACTS — Badges reference:**
- Tenant status: **Active** (yeşil), **Trial** (mor), **Suspended** (kırmızı) — Suspended görüntülenir ama arayüzde askıya alma/yeniden etkinleştirme butonu YOK.
- Device status: **Online** (yeşil, nabız), **Offline** (gri), **Paused** (amber); effective status 15 dk eşiği, paused önceliği.
- Customer health: **Healthy** (yeşil), **Warning** (amber), **Critical** (kırmızı) + online/total.
- Firmware **update** pill (amber) when device firmware ≠ latest release.

**Sözlük terms to define:** Kiracı (tenant/organization), Süper Admin (platform_admin), Kredi, Tetikleme (trigger), Aktivasyon, Cihaz/Yazıcı, Pairing code, Firmware/OTA, Ledger (kredi defteri), Effective status, Stuck pending.

- [ ] **Step 1: Write chapter "9. Sistem Sağlığı (Platform Health)"**

Append `## 9. Sistem Sağlığı (Platform Health)`. Cover the alerts banner (all message types), Fleet freshness, Trigger activity, Per-tenant usage, Alert history. State clearly it is read-only (salt izleme, buton yok).

- [ ] **Step 2: Write chapter "10. Faturalandırma & Krediler (Billing & Credits)"**

Append `## 10. Faturalandırma & Krediler (Billing & Credits)`. Note the sidebar/title mismatch ("Billing & Revenue" ↔ "Billing & Credits"). Cover the 3 KPI cards, the per-tenant table, and `#### Adım adım: Kiracı kredilerini dışa aktarma (Export)` for the CSV export.

- [ ] **Step 3: Write chapter "11. Rozetler ve Göstergeler"**

Append `## 11. Rozetler ve Göstergeler (Referans)`. Tabulate tenant status, device status, customer health, firmware pill with colors and meanings. Include the note that Suspend/Reactivate has no UI button.

- [ ] **Step 4: Write chapter "12. Sözlük (Terimler)"**

Append `## 12. Sözlük (Terimler)`. Define every term in the Sözlük list, one short definition each.

- [ ] **Step 5: Write chapter "13. Sık Sorulanlar / Sorun Giderme"**

Append `## 13. Sık Sorulanlar / Sorun Giderme`. Include at least: "Cihaz neden offline görünüyor?" (15 dk / paused), "Kredi nasıl yüklenir?" (→ Müşteri Detayı → Grant credits), "Firmware güncellemesi cihaza ne zaman ulaşır?" (bir sonraki check-in / OTA), "Neden bir kiracıyı askıya alamıyorum?" (arayüzde buton yok).

- [ ] **Step 6: Verify against SOURCE FACTS + all Global Constraints**

Confirm: all health sections + alert messages; billing KPIs/table + the sidebar/title mismatch note; badges table complete with the Suspend-no-button note; every Sözlük term defined; FAQ covers the listed questions. Re-scan the WHOLE file for the four mandatory accuracy notes and consistent numbering (chapters 1–13, no duplicates/gaps). Fix inline.

- [ ] **Step 7: Commit**

```bash
git add docs/manuals/tr/super-admin-kilavuzu.md
git commit -m "docs(manual): TR super-admin manual — Health, Billing, reference, glossary, FAQ"
```

---

### Task 6: Render to PDF and finalize

**Files:**
- Create: `docs/manuals/tr/super-admin-kilavuzu.pdf`

**Interfaces:**
- Consumes: the complete `docs/manuals/tr/super-admin-kilavuzu.md` (chapters 1–13).

- [ ] **Step 1: Render the PDF via the make-pdf skill**

Invoke the `make-pdf` skill on `docs/manuals/tr/super-admin-kilavuzu.md`, producing `docs/manuals/tr/super-admin-kilavuzu.pdf` with a cover page (title from the H1), a table of contents (from `##` headings), and page numbers. Confirm Turkish characters (ç, ğ, ı, İ, ö, ş, ü) render correctly.

- [ ] **Step 2: Verify the rendered PDF**

Open/inspect the PDF and confirm:
- Cover shows "Süper Admin Kullanım Kılavuzu".
- TOC lists all 13 chapters in order.
- Turkish diacritics render (no mojibake).
- Page numbers present.
If make-pdf reports a missing dependency, surface that to the user rather than silently skipping.

- [ ] **Step 3: Commit both source and PDF**

```bash
git add docs/manuals/tr/super-admin-kilavuzu.md docs/manuals/tr/super-admin-kilavuzu.pdf
git commit -m "docs(manual): render TR super-admin manual to PDF"
```

---

## Self-Review (author checklist — completed during planning)

**Spec coverage:** Every design-doc chapter maps to a task — Giriş/Maratus Nedir?/Başlarken → Task 1; Overview/Customers → Task 2; Customer detail → Task 3; Device Fleet/detail/Firmware → Task 4; Health/Billing/Reference/Sözlük/SSS → Task 5; PDF render → Task 6. The four mandatory accuracy notes are assigned: +12.1% (Task 2), Billing label mismatch (Task 5), no Suspend button (Tasks 5), non-functional login links (Task 1).

**Placeholder scan:** No "TBD/TODO". Each task carries its exact SOURCE FACTS so the writer needs no re-exploration.

**Numbering consistency:** Task 3 introduces Customer detail as chapter 6 and locks final numbering 7–13 for downstream chapters; Task 5's Step 6 re-checks 1–13 for gaps/dupes. Final chapter count = 13 plus cover+TOC generated by make-pdf.

**Scope:** Documentation only; tenant-side manual and real screenshots are explicitly out of scope (second pass).
