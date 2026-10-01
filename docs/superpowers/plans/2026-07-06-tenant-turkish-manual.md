# Kiracı Yöneticisi Türkçe Kullanım Kılavuzu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Produce a comprehensive Turkish (tr) PDF user manual for the Maratus Admin **Tenant Admin (kiracı yöneticisi)** console, written so a person with zero prior knowledge can operate every screen.

**Architecture:** Author one Turkish Markdown file (`docs/manuals/tr/kiraci-kilavuzu.md`), built chapter-group by chapter-group with an accuracy check after each, then render to PDF via `make-pdf`. Mirrors the completed Super Admin manual.

**Tech Stack:** Markdown authoring; `make-pdf` skill. No application code changes.

## Global Constraints

- **Language:** Turkish, formal "siz", zero-knowledge reader.
- **UI naming rule:** every screen/button/field name **TURKISH-FIRST** as "Türkçe karşılık (İngilizce arayüz metni)" on first use, then Turkish short form. UI is English — never invent a Turkish label implying a Turkish UI. Column headers and field labels follow the SAME Turkish-first rule.
- **Accuracy principle:** document ONLY what exists in the SOURCE FACTS. Describe quirks; never "fix" code.
- **Mandatory accuracy notes** (place where relevant): (a) Dashboard "May 30, 2026" date chip is hardcoded; (b) Dashboard deltas +6.4% / +12.1% are hardcoded (only store-detail monthly delta is real); (c) API page says "Read-only keys" but `devices:trigger` is a write/credit-spending scope — mismatch; (d) account menu Profile/Settings are non-functional and Sign out only navigates to /login; (e) Branding "Logo text" field is preview-only (not saved); (f) Buy-credits section renders nothing when Stripe env is unconfigured.
- **Heading structure:** `#` title; `## N.` chapters (numbering LOCKED 1–16 from Task 1); `###` template sections; NEVER skip a level. Screen chapters: `### Bu ekran ne işe yarar?` → `### Ekranda neler var?` → `### Adım adım: <görev>` (ordered lists, not headings) → `### İpuçları ve dikkat edilecekler`.
- **File:** single file `docs/manuals/tr/kiraci-kilavuzu.md`; append chapters in order; commit after each task.
- **Branch:** `docs/tenant-turkish-manual` (spec already committed there).
- **Roles fact (use throughout):** owner|admin = "yönetebilir" (manage). member = salt-okunur. owner=admin functionally; owner can't be removed/demoted; invites grant only admin/member.

## File Structure

- **Create:** `docs/manuals/tr/kiraci-kilavuzu.md` — the whole manual (Tasks 1–7 append chapters 1–16).
- **Create (Task 8):** `docs/manuals/tr/kiraci-kilavuzu.pdf`.

No test framework — each task's verification is a proofreading checklist against its SOURCE FACTS + Global Constraints. Task 8's verification is a successful render.

---

### Task 1: Scaffold + Giriş, Maratus Nedir? (kiracı), Başlarken

**Files:** Create `docs/manuals/tr/kiraci-kilavuzu.md`.

**Interfaces:** Produces `# Kiracı Yöneticisi Kullanım Kılavuzu` (H1, cover title) + chapters 1–3.

**SOURCE FACTS:**
- **Maratus (kiracı bakışı):** yazıcılar kâğıt yerine müşterinin taradığı QR gösterir. Kiracı = organizasyon (bir mağaza zinciri). Cihaz = yazıcı. Tetikleme→QR: bir çağrı (API) bir URL ile tetikler → 1 kredi rezerve → cihaz QR gösterir → ack → başarı krediyi düşer. Ön ödemeli kredi: her tetikleme 1 kredi.
- **Roller:** owner|admin yönetir; member salt-okunur. Davet yalnızca Admin/Member verir; owner korunur.
- **Giriş/erişim:** `/tenant` `requireTenant()` ile korunur. Giriş yoksa `/login`. Giriş sonrası kiracı kullanıcı `/tenant`'a iner (platform_admin `/admin`'e). Aktif organizasyon yoksa `/login` (platform_admin ise `/admin`).
- **Kenar çubuğu — grup etiketi "Workspace", sıra:** Dashboard, Stores, Branding, Device Settings, Members, Reports, Analytics, Billing, API, Activity. Üst bar: "Workspace / {ekran}" + tema değiştirici + hesap menüsü.
- **Çalışma alanı değiştirici (workspace switcher):** başlıkta aktif organizasyon adı + "Tenant Workspace". Açılır menüde kullanıcının organizasyonları (ad + rol), aktif olanda onay; başka birini seçince `setActive()` + `/tenant`. platform_admin ayrıca "Maratus HQ / Super Admin → /admin" görür.
- **Hesap menüsü:** avatar/ad/rol; **Profile** ve **Settings işlevsizdir** (tıklama yok); **Sign out** yalnızca `/login`'e yönlendirir (gerçek çıkış çağırmaz). ThemeToggle var.

- [ ] **Step 1: Create file with H1 + "1. Giriş & Bu Kılavuz Hakkında"**

Start the file:
```markdown
# Kiracı Yöneticisi Kullanım Kılavuzu

*Maratus Admin — Kiracı (Mağaza Zinciri) Yöneticisi Rehberi*

## 1. Giriş & Bu Kılavuz Hakkında
```
2–3 paragraf: kim için (kiracı owner/admin/member), UI İngilizce olduğu için "Türkçe (İngilizce)" kuralı ve nasıl okunacağı.

- [ ] **Step 2: Write "## 2. Maratus Nedir? (Kiracı Bakışıyla)"**

Cover all conceptual SOURCE FACTS (Maratus, kiracı/mağaza/cihaz, tetikleme→QR, kredi, roller). Explain the *why* (kâğıtsız, kredi-ölçümlü).

- [ ] **Step 3: Write "## 3. Başlarken (Giriş ve Gezinme)"**

`#### Adım adım: Giriş yapma` steps + access gate + sidebar ("Workspace" group, 10 items in order) + workspace switcher + account menu (with the Profile/Settings non-functional + Sign-out-only-navigates note). Use `###` template sections.

- [ ] **Step 4: Verify** against SOURCE FACTS + Global Constraints (Turkish-first naming; non-functional account items noted). Fix inline.

- [ ] **Step 5: Commit**
```bash
git add docs/manuals/tr/kiraci-kilavuzu.md
git commit -m "docs(manual): TR tenant manual — intro, concepts, getting started"
```

---

### Task 2: Panel (Dashboard) + Mağazalar (Stores)

**Files:** Modify `docs/manuals/tr/kiraci-kilavuzu.md` (append chapters 4–5).

**Interfaces:** Produces `## 4. Panel (Dashboard)` and `## 5. Mağazalar (Stores)`.

**SOURCE FACTS — Dashboard (`/tenant`):**
- Başlık: "Welcome back, {firstName}"; açıklama "Here's how {tenantName}'s paperless checkout is doing today."
- **Sabit tarih çipi "May 30, 2026"** — HARDCODED (gerçek tarih değil), belirt.
- 3 KPI: **"Activations today"** (delta **+6.4%** "vs. yesterday" — SABİT), **"Activations this month"** (delta **+12.1%** "vs. last month" — SABİT), **"Active devices"** (`{active}/{total}`, "printers online now").
- Kart **"Activations over time"** ("Daily activations, last 30 days") — alan grafiği.
- **Eko etki (Eco impact)** kartı: "From {n} paperless documents this month." 4 istatistik: **trees / paper / water / CO₂e** (ağaç/kâğıt/su/CO₂e).
- Kart **"Busiest stores"** ("Activations this month, by branch") + **"All stores"** linki → `/tenant/stores`; en fazla 4 mağaza döşemesi (ad, "{n} printers · {n} online", aylık aktivasyon, durum rozeti).

**SOURCE FACTS — Stores list (`/tenant/stores`):**
- Başlık "Stores"; açıklama "{n} branches · {online}/{total} printers online". Header (owner/admin): **"Add store"**.
- Tablo sütunları: **Store**, **Address**, **Printers** (`{online}/{total}` + nokta), **Activations (mo.)**, **Status**, (işlem sütunu). owner/admin satır kebabı **"Open store" / "Edit store"**; member satırı detay linki.
- **Add store diyaloğu:** başlık "Add store", açıklama "Create a new branch. You can claim printers into it afterwards." Alanlar: **Store name** (zorunlu, "e.g. Downtown Flagship"), **Address** (isteğe bağlı), **Timezone** (varsayılan, yardım "Used for busiest-times analytics."). Butonlar **Cancel / Add store** ("Adding…"). Başarı "Store added" / "{name} is ready for printers." Yetki hatası "You don't have permission to add stores." / "Store name is required."
- **Edit store diyaloğu:** başlık "Edit store", "Update this branch's details." Aynı 3 alan (önceden dolu). **Cancel / Save changes** ("Saving…"). Başarı "Store updated".

- [ ] **Step 1: Write "## 4. Panel (Dashboard)"** — template sections; list all 3 KPI cards (with the hardcoded date-chip + hardcoded delta notes), the chart, Eco impact card, Busiest stores. No mutating controls (linkler + döşemeler).

- [ ] **Step 2: Write "## 5. Mağazalar (Stores)"** — table + badges; `#### Adım adım: Mağaza ekleme (Add store)` (owner/admin; Store name zorunlu) and `#### Adım adım: Mağaza düzenleme (Edit store)`. Note member is read-only.

- [ ] **Step 3: Verify** all KPIs/tables/dialog fields; both hardcoded notes present; Turkish-first naming. Fix inline.

- [ ] **Step 4: Commit**
```bash
git add docs/manuals/tr/kiraci-kilavuzu.md
git commit -m "docs(manual): TR tenant manual — Dashboard + Stores"
```

---

### Task 3: Cihazlar (Store Detail sections, Claim, Device Card, Device Detail, Remote control)

**Files:** Modify the file (append chapters 6 = a big chapter; store-detail overview stays in ch5? — NO: to keep ch5 focused on the store LIST, put the **Store Detail page** overview here at the top of ch6 alongside device management, OR keep ch5 for list only and open ch6 with store-detail. Decision: ch5 = stores list + dialogs ONLY; ch6 = "Mağaza Detayı ve Cihaz Yönetimi": store detail page (KPIs/charts/heatmap/sections), claim flow, unclaimed printers, device card, pause, device detail page, remote control.)

**Interfaces:** Produces `## 6. Mağaza Detayı ve Cihaz Yönetimi`.

**SOURCE FACTS — Store detail (`/tenant/stores/[storeId]`):**
- "Stores" geri linki; bulunamazsa 404. Başlık = mağaza adı + rollup **durum rozeti** (herhangi biri online→online, değilse paused varsa→paused, yoksa→offline). owner/admin: **Store edit** + **Claim printer**. Altında adres + harita pini.
- KPI satır 1: **"Printers"** `{online}/{total}` "online"; **"Activations today"**; **"Activations this month"**; **"Avg / printer"** "activations this month".
- KPI satır 2: **"Activations this month"** (gerçek delta "vs last month"); **"Paper saved"** `{kg} kg` "this month"; **"Busiest day"** "last 90 days"; **"Peak hour"** "last 90 days".
- Kart **"Activations over time"** ("Daily activations, last 30 days"); kart **"Busiest times"** ("Activations by day of week and hour, last 90 days" — ısı haritası).
- **"Printers in this store"**: DeviceCard ızgarası. Boş: "No printers here yet" (owner/admin: "Claim a printer with its pairing code…").
- **"Unclaimed printers"** kartı (owner/admin, sahiplenilmemiş cihaz varsa): sayı + her cihaz adı + mono **pairing code**.

**SOURCE FACTS — DeviceCard:** cihaz detayına link; ad, cihaz id (mono), durum noktası + durum. 2 istatistik: bugün / bu ay. Alt: bağlantı (Wi-Fi/Ethernet), "Seen {timeAgo}". **"Active"/"Paused"/"Unreachable" anahtarı** → `setDeviceActive` (offline'da devre dışı). Başarı "{name} resumed/paused". Hata geri alır + "Couldn't update device."

**SOURCE FACTS — Claim device dialog:** tetikleyici **"Claim printer"**. "Claim a printer" / "Enter the pairing code shown on the printer screen to bind it to this store." Alan **Pairing code** (zorunlu, otomatik BÜYÜK, "XXXX-XXXX", yardım "Find it under Settings → Pairing on the device."). Submit "Claim printer" ("Claiming…"). Başarı: "{deviceName} claimed" + "It will activate automatically within a few seconds…" + katlanır **"Manual setup (advanced)"** → tek seferlik **Device key** (mono, kopyala) + uyarı "This key is shown once and can't be retrieved later — Maratus only keeps a hashed copy." **Done**. Hatalar: "No device found with that pairing code." / "That device has already been claimed." / "That device belongs to another account." / "Enter a pairing code." / yetki "You don't have permission to claim devices."

**SOURCE FACTS — Device detail (`/tenant/stores/[storeId]/[deviceId]`):**
- Geri linki = mağaza adı; 404 if not in org. Başlık = cihaz adı, "Printer in {store}".
- KPI: "Activations today", "Activations this month".
- Kart **"Device details"**: **Device ID** (mono), **IP address** (mono), **Connection** (Wi-Fi/Ethernet), **Firmware** `v{version}` (+ "→ v{latest} available" güncelleme varsa).
- **Duraklat kontrolü** kartı: durum noktası + durum; alt metin "Accepting documents"/"Paused — not accepting documents"/"Device is unreachable". Buton **Pause/Activate** (offline devre dışı).
- Kart **"Connectivity"**: Last seen, Store, Firmware.
- **"Remote control"** (CommandBar): **Reboot**, **Refresh config**, **Identify**, **Update firmware** → `enqueueDeviceCommand`; "{type} queued — the device will pick it up on its next check-in." Komut tablosu: **Command | Status | Queued** (HAM `type`/`status` — Türkçeleştirilmemiş; belirt).

- [ ] **Step 1: Write "## 6. Mağaza Detayı ve Cihaz Yönetimi"** — `### Bu ekran ne işe yarar?`, `### Ekranda neler var?` (store detail KPIs/charts/heatmap/sections/unclaimed), then walkthroughs: `### Adım adım: Yazıcı sahiplenme (Claim printer)` (pairing code → device key one-time note), `### Adım adım: Cihazı duraklatma/etkinleştirme`, `### Cihaz Detayı (Device Detail)` sub-section, `### Adım adım: Uzaktan komut gönderme`. Note the remote-control table shows raw English status.

- [ ] **Step 2: Verify** all store-detail KPIs (both rows), claim flow incl. one-time device key, device card toggle, device-detail cards, all 4 remote commands, unclaimed printers. Fix inline.

- [ ] **Step 3: Commit**
```bash
git add docs/manuals/tr/kiraci-kilavuzu.md
git commit -m "docs(manual): TR tenant manual — store detail, claim, device management"
```

---

### Task 4: Marka (Branding) + Cihaz Ayarları (Device Settings)

**Files:** Modify the file (append chapters 7–8).

**Interfaces:** Produces `## 7. Marka (Branding)` and `## 8. Cihaz Ayarları (Device Settings)`.

**SOURCE FACTS — Branding (`/tenant/branding`):**
- Başlık "Branding", "Customize how your printers look to customers. Changes preview live." `canEdit=owner|admin`; değilse kilit afişi "You have view-only access. Only owners and admins can edit branding." (girişler devre dışı).
- **Sol panel akordeon** (varsayılan açık "screen"):
  - **Brand:** **"Logo text (preview fallback)"** ("Your brand" — **YALNIZCA ÖNİZLEME, kaydedilmez**, belirt). **"Accent color (hex)"** — renk seçici + hex (geçersizse kırmızı kenar) + 7 preset. **Advanced theme:** Background/Text/Muted text.
  - **Screen:** PrinterControls — nesneleri sürükle/düzenle, çift-tık metin, ikon/görsel yükle. **Sınır: görsel olmalı, 2 MB altında** ("Icon must be an image." / "Icon must be under 2 MB.").
  - **Security:** **"Staff PIN"** — sayısal, en çok 6 hane, göster/gizle.
- **Sağ panel — Canlı önizleme:** "Live preview", "4″ printer · 720 × 720 · 100% ≈ actual size". **Preview** (tam ekran). **Ekran seçici** 7 ekran: Idle / ready, Processing, Document ready, Sent ✓, Error / offline, Paused, Setup / pairing. **Zoom** kaydırıcısı.
- **Kaydet çubuğu:** "Unsaved changes"/"All changes saved". **Reset** ve **Save branding** ("Saving…"). Başarı "Branding saved" / "Your printers will update on next sync." Geçersiz hex → "Enter a valid hex color first." Yetki "You don't have permission to edit branding."

**SOURCE FACTS — Device Settings (`/tenant/device-settings`):**
- Başlık "Device Settings", "Policies applied to every device in your organization. Devices update automatically." `canEdit=owner|admin`.
- **"QR code visible for"** kaydırıcı **15–180s**, adım 5, "{n}s". **"Screen brightness"** **10–100%**, adım 1. **"Screen sleep"** anahtarı (açıkken **"Sleep after"** seçenekleri: 30 sn, 1/2/5/10/15/30/60 dk). **"Device Settings PIN"** — 4–12 hane; PIN varsa **"Remove PIN…"** onay kutusu.
- Kaydet çubuğu: "Read only"/"Unsaved changes"/"All changes saved". Başarı toast "Device settings saved. Devices will update on next check-in." Hata "PIN must be 4–12 digits." / "You don't have permission to edit device settings."

- [ ] **Step 1: Write "## 7. Marka (Branding)"** — template + `### Adım adım: Markayı düzenleme ve kaydetme`. MUST note the **"Logo text" preview-only** fact + the view-only (member) banner + 2 MB icon limit.

- [ ] **Step 2: Write "## 8. Cihaz Ayarları (Device Settings)"** — template + `### Adım adım: Cihaz politikalarını ayarlama` (QR süresi/parlaklık/uyku/PIN with exact bounds). Note member is read-only.

- [ ] **Step 3: Verify** all branding panels + preview screens + save-bar + the preview-only note; all device-settings sliders/bounds + PIN. Fix inline.

- [ ] **Step 4: Commit**
```bash
git add docs/manuals/tr/kiraci-kilavuzu.md
git commit -m "docs(manual): TR tenant manual — Branding + Device Settings"
```

---

### Task 5: Üyeler (Members) + Raporlar (Reports) + Analitik (Analytics)

**Files:** Modify the file (append chapters 9–11).

**Interfaces:** Produces `## 9. Üyeler (Members)`, `## 10. Raporlar (Reports)`, `## 11. Analitik (Analytics)`.

**SOURCE FACTS — Members (`/tenant/members`):**
- Başlık "Members". `canManage=owner|admin`.
- **Davet formu** (yönetici): **Email** (zorunlu, "teammate@company.com") + **Role** (Member/Admin) + **Invite** → `inviteMember`. "Enter a valid email." Davet e-postası gider.
- **Üyeler tablosu** (başlıksız): ad, e-posta, rol. Yönetici: owner-olmayan satırlarda **"Make admin"/"Make member"** + **"Remove"**. Korumalar "Cannot remove the owner." / "Cannot change the owner's role."
- **Pending invitations** (varsa): e-posta, rol, (yönetici) **"Cancel"** → `cancelInvitation`. member salt-okunur.

**SOURCE FACTS — Reports (`/tenant/reports`):**
- Başlık "Reports", "Activations, breakdowns, and eco savings across your fleet." Header **Export report** → `{slug}-report.csv` (Section/Label/Activations).
- Kart **"Activations over time"** ("Monthly activations, last 9 months"). Kartlar **"By store"** ("Activations this month, per branch") ve **"By device"** ("Top printers by activations this month", top 8). Kart **"Eco savings over time"** ("Paper saved per month (kg)") + Eko etki kartı ("last 9 months").
- QUIRK (isteğe bağlı düşük öncelikli not): mağaza adlarından sabit "Roastwell " öneki kırpılır (demo kalıntısı).

**SOURCE FACTS — Analytics (`/tenant/analytics`):**
- Başlık "Analytics", "Compare activation volume and trends across your stores." Header **Export analytics** → `store-analytics.csv` (Store/Activations (this month)/Trend %/Paper saved (kg)).
- Boş: "No store data yet" / "Once your stores start showing QR codes, comparisons show up here."
- Kart **"Activations by store"** ("This month, highest first"). Kart **"Store comparison"** ("This month vs last, per store") — satırlar: ad, "{n} activations", trend: **"new"** (null) / yeşil ▲ / kırmızı ▼. Kart **"Trajectories"** ("Monthly activations per store, last 9 months").
- **Export ready** toast / "{n} rows → {filename}".

- [ ] **Step 1: Write "## 9. Üyeler (Members)"** — template + `### Adım adım: Üye davet etme`, `### Adım adım: Rol değiştirme / üye kaldırma`, bekleyen davetler. Owner korumaları + member salt-okunur.

- [ ] **Step 2: Write "## 10. Raporlar (Reports)"** — template + `### Adım adım: Raporu dışa aktarma (CSV)`. Optional low-priority "Roastwell " note.

- [ ] **Step 3: Write "## 11. Analitik (Analytics)"** — template + `### Adım adım: Analitiği dışa aktarma (CSV)`; trend rozetleri (new/▲/▼); boş durum.

- [ ] **Step 4: Verify** members invite/role/remove + guards; reports cards + export; analytics cards + trend indicators + empty state. Fix inline.

- [ ] **Step 5: Commit**
```bash
git add docs/manuals/tr/kiraci-kilavuzu.md
git commit -m "docs(manual): TR tenant manual — Members, Reports, Analytics"
```

---

### Task 6: Faturalandırma & Krediler (Billing) + API + Etkinlik (Activity)

**Files:** Modify the file (append chapters 12–14).

**Interfaces:** Produces `## 12. Faturalandırma & Krediler (Billing)`, `## 13. API`, `## 14. Etkinlik (Activity)`.

**SOURCE FACTS — Billing (`/tenant/billing`):**
- Başlık "Billing", "Manage your prepaid credit balance." (Kendi başlık/dolgu düzeni.)
- **BuyCreditsSection:** başlık **"Credits"**, "Available: {n}". **Stripe anahtarı yoksa VEYA kredi paketi yoksa HİÇBİR ŞEY göstermez** (belirt). Paket başına **"Buy {credits} credits"** ("Loading…") → `startCreditCheckout` → inline Stripe Checkout (PaymentElement), "Purchasing {credits} credits", **Pay now** ("Processing…") + **Cancel**. Başarı → sayfa yenilenir. Hata inline.
- **"Credit usage this month":** "Available {n}" (+ "· Held {n}" varsa). Boş: "No credit usage this month." Tablo **Device | Credits | Triggers** ("Unattributed" bilinmeyen) + **Total** satırı. Fatura/abonelik/ödeme-yöntemi YOK (yalnızca ön ödemeli kredi).

**SOURCE FACTS — API (`/tenant/api`):**
- Başlık "API keys", "Read-only keys for the Maratus public API." — **UYUMSUZLUK NOTU:** "Read-only" der ama `devices:trigger` kapsamı cihaz tetikler ve **kredi harcar**; belirt.
- Header (owner/admin): **"Create API key"**.
- Kart **"Using the API"**: temel URL `/api/v1`, `Authorization: Bearer <key>`, `GET /usage`, `POST /api/v1/devices/{deviceId}/trigger`, `/api/v1/openapi.json` linki.
- Tablo: **Name | Key** (önek + "…") **| Last used** (tarih/"Never") **| Created** | (işlemler, yönetici). Boş: "No API keys yet."
- **Create dialog:** "Create API key" / "Create an API key scoped to this organization. Choose its permissions below." Alan **Name** (zorunlu, ≤100). **Permissions:** **`usage:read`** (varsayılan işaretli), **`devices:trigger`** (varsayılan kapalı; not "devices:trigger lets this key trigger devices and spend credits."). **Create key** → tek seferlik anahtar (kod bloğu + kopyala, "Copy it now — you won't be able to see it again.") + **Done**. Hata "Key name is required." vb.
- **Revoke dialog:** ""{name}" will stop working immediately. This can't be undone." **Revoke** ("Revoking…") → "Key revoked".

**SOURCE FACTS — Activity (`/tenant/activity`):**
- Başlık "Activity". Tablo sütunları: **When | Action | Actor | Target**. When=timeAgo; Action=insan-okur etiket; Actor=+ küçük rozet (device/system); Target=mono id/"—".
- Boş: "No activity yet." Sayfalama "Page {p} of {n}" + **Previous/Next** (sınırlarda devre dışı).
- Etiket örnekleri: Store created/updated, Device claimed/paused/resumed, Command sent to device, Device went offline, API key created/revoked, Branding updated, Device settings updated, Member invited/added/removed, Member role changed, Invitation canceled, Credits purchased/granted.

- [ ] **Step 1: Write "## 12. Faturalandırma & Krediler (Billing)"** — template + `### Adım adım: Kredi satın alma`. MUST note the buy-section-hidden-without-Stripe-env fact. No invoices/subscription.

- [ ] **Step 2: Write "## 13. API"** — template + `### Adım adım: API anahtarı oluşturma` (kapsamlar + tek seferlik anahtar) + `### Adım adım: API anahtarını iptal etme`. MUST note the "Read-only" vs `devices:trigger` mismatch.

- [ ] **Step 3: Write "## 14. Etkinlik (Activity)"** — template; table columns, pagination, label examples.

- [ ] **Step 4: Verify** billing (buy flow + hidden-without-env note + usage table), API (create/revoke + scope mismatch note + one-time key), activity (columns + pagination). Fix inline.

- [ ] **Step 5: Commit**
```bash
git add docs/manuals/tr/kiraci-kilavuzu.md
git commit -m "docs(manual): TR tenant manual — Billing, API, Activity"
```

---

### Task 7: Rozetler ve Terimler (Sözlük) + Sık Sorulanlar

**Files:** Modify the file (append chapters 15–16 — the LAST chapters).

**Interfaces:** Produces `## 15. Rozetler ve Terimler (Sözlük)` and `## 16. Sık Sorulanlar / Sorun Giderme`.

**SOURCE FACTS — Badges/roles/terms:**
- Cihaz durumu: **Online** (yeşil, ulaşılabilir, belge kabul eder), **Offline** (gri, ulaşılamaz; duraklat/etkinleştir devre dışı — "Device is offline and can't be changed."), **Paused** (amber, çevrimiçi ama belge kabul etmez). Mağaza rollup durumu türetilir.
- Roller: **owner** (silinemez/rol düşürülemez), **admin** (owner ile aynı yetkiler), **member** (salt-okunur). Davet yalnızca Admin/Member.
- Terimler: Kiracı (tenant/organization), Mağaza (store/branch), Cihaz/Yazıcı, Tetikleme (Trigger — API isteği), Aktivasyon (Activation — sayılan tamamlanmış birim), Kredi (prepaid), Pairing code, Device key (tek seferlik), Firmware, Uzaktan komut (remote command), Pairing/Claim, Eko etki.

**SSS (en az):** "Cihaz neden offline görünüyor?", "Kredi nasıl satın alınır?" (→ Billing; Stripe yoksa görünmez), "Yazıcıyı nasıl eklerim?" (→ Claim printer, pairing code), "Neden markadaki logo metni kaydedilmiyor?" (preview-only), "API anahtarı 'read-only' ama neden cihaz tetikleyebiliyor?" (devices:trigger), "Bir üyeyi neden admin yapamıyorum / kaldıramıyorum?" (yalnızca owner/admin yönetir; owner korunur).

- [ ] **Step 1: Write "## 15. Rozetler ve Terimler (Sözlük)"** — a badge/role table + glossary; each term one short definition (cross-ref chapters where helpful).

- [ ] **Step 2: Write "## 16. Sık Sorulanlar / Sorun Giderme"** — the listed questions with correct answers.

- [ ] **Step 3: Verify** + WHOLE-FILE re-scan: all 6 mandatory accuracy notes present somewhere; numbering 1–16 with no gaps/dupes; no skipped heading levels; Turkish-first naming throughout. Fix inline.

- [ ] **Step 4: Commit**
```bash
git add docs/manuals/tr/kiraci-kilavuzu.md
git commit -m "docs(manual): TR tenant manual — badges, glossary, FAQ"
```

---

### Task 8: Render to PDF and finalize

**Files:** Create `docs/manuals/tr/kiraci-kilavuzu.pdf`.

- [ ] **Step 1: Render** via make-pdf:
```bash
P="$HOME/.claude/skills/gstack/make-pdf/dist/pdf"
"$P" generate --cover --toc --title "Kiracı Yöneticisi Kullanım Kılavuzu" --author "Maratus" --date "Temmuz 2026" \
  docs/manuals/tr/kiraci-kilavuzu.md docs/manuals/tr/kiraci-kilavuzu.pdf
```

- [ ] **Step 2: Verify** exit 0; cover title correct; TOC lists all 16 chapters; report any missing dependency (poppler may be absent — note that visual inspection is deferred to the user).

- [ ] **Step 3: Commit**
```bash
git add docs/manuals/tr/kiraci-kilavuzu.md docs/manuals/tr/kiraci-kilavuzu.pdf
git commit -m "docs(manual): render TR tenant manual to PDF"
```

---

## Self-Review (author checklist — completed during planning)

**Spec coverage:** Every spec chapter maps to a task — Giriş/Concepts/Başlarken→T1; Dashboard/Stores→T2; Store detail+Devices+Claim+Remote→T3; Branding+Device Settings→T4; Members/Reports/Analytics→T5; Billing/API/Activity→T6; Badges/Sözlük/SSS→T7; PDF→T8. Six mandatory accuracy notes assigned: date chip + deltas (T2), Logo-text preview-only (T4), buy-section hidden (T6), API mismatch (T6), account-menu non-functional (T1).

**Placeholder scan:** No TBD/TODO. Each task carries exact SOURCE FACTS.

**Numbering:** Locked 1–16 from Task 1; T7 Step 3 re-checks 1–16. Chapter 5 = stores list only; chapter 6 = store detail + device management (device detail folded in) — no cross-task chapter splitting.

**Scope:** Documentation only; screenshots + super-admin manual out of scope.
