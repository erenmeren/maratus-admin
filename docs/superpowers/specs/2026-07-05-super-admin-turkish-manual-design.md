# Tasarım: Süper Admin Kullanım Kılavuzu (Türkçe PDF)

**Tarih:** 2026-07-05
**Durum:** Onaylandı (yapı) — içerik yazımı bekliyor
**Kapsam:** Maratus Admin konsolunun **Süper Admin (platform_admin)** bölümü için Türkçe kullanıcı kılavuzu.

---

## 1. Amaç

Maratus Admin'in Süper Admin bölümünü hiç bilmeyen bir kişinin, yalnızca bu belgeyi
takip ederek konsolu baştan sona kullanabilmesini sağlayacak **kapsamlı, Türkçe bir
kullanım kılavuzu** üretmek. Bu, çok bölümlü bir dokümantasyon çalışmasının ilk
parçasıdır; kiracı (tenant) tarafı kılavuzları sonraki aşamalarda ele alınacaktır.

## 2. Kararlar (kullanıcıyla netleştirildi)

| Karar | Seçim |
|---|---|
| **Biçim** | Tek bir cilalı **PDF** — kapak, içindekiler (TOC), sayfa numaraları, üstbilgi. `make-pdf` becerisiyle üretilir. |
| **Kaynak** | Türkçe **Markdown** dosyası repoda kalır: `docs/manuals/tr/super-admin-kilavuzu.md`. PDF bundan üretilir ve tekrar üretilebilir. |
| **Ekran görüntüleri** | **İlk sürüm görüntüsüz** (metin ağırlıklı, ayrıntılı adım anlatımı). Gerçek ekran görüntüleri ikinci turda eklenecek. |
| **Paketleme** | **Tek eksiksiz el kitabı** ("Süper Admin Kullanım Kılavuzu"), her ekran bir bölüm. |
| **Derinlik** | **Kavramlar + görevler.** Önce "Maratus Nedir?" kavramsal bölümü ve Sözlük, ardından adım adım görev anlatımları. |
| **Dil kuralı** | Türkçe anlatım; arayüz İngilizce olduğu için ekran/buton/alan adları **"Türkçe karşılık (İngilizce arayüz metni)"** kalıbıyla verilir (ör. **Genel Bakış (Overview)**, **Yeni müşteri (New customer)** butonu). |
| **Ton** | Nazik/resmî "siz" dili; sıfırdan öğrenen okura göre; numaralı adımlar. |

## 3. Üretim Akışı

1. Türkçe Markdown içeriği `docs/manuals/tr/super-admin-kilavuzu.md` dosyasına yazılır.
2. `make-pdf` becerisiyle PDF üretilir (kapak sayfası + TOC + sayfa numaraları).
3. PDF `docs/manuals/tr/` altına konur.
4. Hem `.md` hem `.pdf` git'e commit'lenir.

## 4. Yazım Kuralları (kılavuz genelinde tutarlı)

- **Ekran adları:** İlk geçtiğinde "Türkçe karşılık (İngilizce)" biçimi; sonra Türkçe kısaltma.
- **Bölüm kalıbı (her ekran için):**
  1. **Bu ekran ne işe yarar?** (1–3 cümle)
  2. **Ekranda neler var?** (KPI kartları, tablolar, rozetler — birebir etiketlerle)
  3. **Adım adım: <görev>** (numaralı, tek tek eylemler)
  4. **İpuçları ve dikkat edilecekler** (varsa)
- **Doğruluk notları** (aşağıda) kılavuzda okuyucuyu yanıltmayacak biçimde ele alınır.

## 5. Bölüm Yapısı ve İçerik Kapsamı

Kılavuz aşağıdaki bölümlerden oluşur. Her ekran bölümü, kod tabanından çıkarılan
**tüm** KPI kartlarını, tablo sütunlarını, butonları, diyalogları ve alanları kapsar.

### 0. Kapak + İçindekiler
`make-pdf` tarafından üretilir.

### 1. Giriş & Bu Kılavuz Hakkında
Kılavuzun kimin için olduğu (Maratus platform yöneticileri / Süper Admin), nasıl
okunacağı, dil kuralı açıklaması.

### 2. Maratus Nedir? (Kavramsal Model)
- **Maratus ne yapar:** yazıcılar kâğıt belge yerine, müşterinin telefonuyla
  taradığı bir QR kod gösterir.
- **Çok kiracılı (multi-tenant) model:** her müşteri = bir kiracı (organization).
- **Cihaz = yazıcı**; tetikleme → QR akışı (caller URL sağlar, cihaz QR gösterir).
- **Ön ödemeli kredi mantığı:** her tetikleme 1 kredi; rezerve → sonuçlandır → serbest bırak.
- **Firmware / OTA** kısa özet.
- Süper Admin ile kiracı yöneticisinin farkı (Süper Admin bir organizasyon üyesi
  değildir; `user.role = 'platform_admin'`).

### 3. Başlarken (Giriş ve Gezinme)
- **Giriş yapma:** `/login`, e-posta + parola. Demo süper admin: `admin@maratus.app` / `123456`.
  "Forgot password?" ve "Continue with SSO" şu an işlevsel değil (SSO yapılandırılmamış).
- Giriş sonrası `platform_admin` → `/admin`'e yönlendirilir.
- **Erişim yetkisi:** yalnızca `platform_admin` bu bölümü görür; değilse `/tenant`'a yönlenir.
- **Kenar çubuğu (Platform grubu) menü sırası:** Overview, Customers, Device Fleet,
  Health, Firmware, **Billing & Revenue**. Üst bar: tema değiştirici + kullanıcı menüsü.
- **Doğruluk notu:** kenar çubuğunda **"Billing & Revenue"** yazar, ancak sayfanın
  kendi başlığı **"Billing & Credits"**'tir — kılavuzda bu tutarsızlık belirtilir.

### 4. Genel Bakış (Overview) — `/admin`
- KPI kartları: **Activations this month**, **Active devices** (aktif/toplam),
  **Customers** (mağaza sayısı ipucu).
- **Doğruluk notu:** "Activations this month" kartındaki **+12.1%** değeri sabit
  kodludur (canlı bir metrik değil) — kılavuzda canlı oran gibi tanıtılmaz.
- "Activations over time" alan grafiği.
- Tablolar: **Top customers** (Customer/Stores/Devices/Activations, "All customers" linki),
  **Credits by company** (Company/Credits spent/Triggers, ilk 10, boş durum metni).

### 5. Müşteriler (Customers) — `/admin/customers` + müşteri detayı
- **Liste:** sütunlar Customer/Stores/Devices/Health/Activations (mo.)/Status/›.
  Sağlık rozetleri (Healthy/Warning/Critical) ve durum rozetleri (Active/Trial/Suspended).
- **Yeni müşteri (New customer)** diyaloğu: Company name (zorunlu), Contact name,
  Contact email → `createCustomer`. Başarı/hata bildirimleri.
- **Müşteri detay sayfası** (`/admin/customers/[tenantId]`):
  - Başlık kartı (ad + durum, e-posta, telefon), "← Customers" linki, **Add branch** butonu.
  - Sağlık özeti şeridi (Online/Offline/Paused/Stuck pending).
  - KPI: Stores, Devices, Activations this month.
  - "Activations by store" yatay çubuk grafik.
  - **Krediler kartı:** Available/Held, **Grant credits** formu (Credits 1–1.000.000, Note),
    ledger tablosu (Kind/Credits/Device/Note/Time).
  - **Assigned devices** tablosu + **Add device** (ProvisionDevice) diyaloğu (pairing code + kopyala).
  - **Add branch** diyaloğu (Branch name/Address/Timezone).
  - **Activity** (denetim günlüğü, insan-okur etiketler).

### 6. Cihaz Filosu (Device Fleet) — `/admin/devices` + cihaz detayı
- KPI: Total devices, Online, Paused, Offline.
- **Filtreler:** arama (device/store/customer), Customer açılır menüsü, Status açılır menüsü.
- **Tablo:** Device ID/Customer/Store/Status/Last seen/Firmware (güncelleme pili)/Activations (mo.)/eylemler.
- **Satır eylemleri (Device row actions):** Pause/Activate, Rename, Move to store,
  Unassign, **Delete** (onay diyaloğu). Offline cihaz duraklatılamaz/aktifleştirilemez.
- **Cihaz detay sayfası** (`/admin/devices/[deviceId]`):
  - KPI: Activations today / this month.
  - Device details (Device ID, IP, Connection, Firmware + güncelleme uyarısı).
  - Status & management + eylem menüsü; effective status mantığı (15 dk eşiği, paused önceliği).
  - **Remote control** (CommandBar): Reboot, Refresh config, Identify, Update firmware
    → `enqueueDeviceCommand`; komut geçmişi tablosu.

### 7. Firmware — `/admin/firmware`
- **Publish firmware** formu: version (CONFIG_DITTO_FW_VERSION ile eşleşmeli), `.bin`
  dosya (≤ 8MB), yinelenen sürüm reddi. Başarı/hata metinleri.
- Sürümler tablosu: Version ("latest"), Size (KB), SHA-256, Published.
- **Delete** butonu (latest silme uyarısı farklıdır; window.confirm).
- OTA mantığı: en yeni sürüm cihazların çektiği hedeftir.

### 8. Sistem Sağlığı (Platform Health) — `/admin/health`
- **Alerts banner** (uyarı yoksa "All systems nominal"); uyarı türleri (stale device,
  stuck pending, inactive tenant).
- **Fleet freshness:** Devices/Online/Paused/Stale (15m+) + stale tablosu.
- **Trigger activity:** Activations (1h/24h), Stuck pending + acked/pending/failed alt satırı.
- **Per-tenant usage:** Top tenants (24h), Inactive (7d+).
- **Alert history:** Open / Resolved (7d).
- Bu ekran salt-okunur (mutasyon yok).

### 9. Faturalandırma & Krediler (Billing & Credits) — `/admin/billing`
- **Export tenants** (CSV: Customer/Balance/Consumed (mo.)/Lifetime purchased).
- KPI: Credits sold, Credits consumed, Outstanding liability.
- **Per-tenant credits** tablosu (Customer/Balance/Consumed (mo.)/Lifetime purchased).

### 10. Rozetler ve Göstergeler (Referans)
Kiracı durumu (Active/Trial/Suspended), cihaz durumu (Online/Offline/Paused +
effective status), müşteri sağlığı (Healthy/Warning/Critical), firmware güncelleme pili.
- **Doğruluk notu:** "Suspended" durumu görüntülenir ama arayüzde askıya alma/yeniden
  etkinleştirme butonu **yoktur** — kılavuzda mevcut olmayan bir buton tarif edilmez.

### 11. Sözlük (Terimler)
Kiracı (tenant/organization), Süper Admin (platform_admin), Kredi, Tetikleme (trigger),
Aktivasyon, Cihaz/Yazıcı, Pairing code, Firmware/OTA, Ledger (kredi defteri),
Effective status, Stuck pending.

### 12. Sık Sorulanlar / Sorun Giderme (kısa)
Örn: "Cihaz neden offline görünüyor?", "Kredi nasıl yüklenir?", "Firmware güncellemesi
cihaza ne zaman ulaşır?", "Neden askıya alma butonu yok?".

## 6. Doğruluk İlkesi (kritik)

Kılavuz **yalnızca arayüzde gerçekten var olan** özellikleri anlatır. Aşağıdaki
tuzaklar kılavuzda doğru biçimde ele alınır:
- "+12.1%" Overview deltası **sabit kodlu**dur → canlı metrik gibi sunulmaz.
- Kenar çubuğu "Billing & Revenue" ↔ sayfa başlığı "Billing & Credits" **uyuşmazlığı** belirtilir.
- Kiracı **askıya alma/yeniden etkinleştirme** butonu arayüzde yok → tarif edilmez.
- "Forgot password?" ve "Continue with SSO" işlevsel değil → öyle belirtilir.

## 7. Kapsam Dışı (bu aşamada)

- Kiracı (tenant) tarafı kılavuzları — sonraki dokümantasyon parçası.
- Gerçek ekran görüntüleri — ikinci tur.
- İngilizce veya diğer dillerde sürümler.
- Kod/UI değişiklikleri (bu yalnızca dokümantasyondur; uyuşmazlıklar *belgelenir*, düzeltilmez).

## 8. Başarı Ölçütü

Maratus'yu hiç görmemiş bir Süper Admin, yalnızca bu PDF'i okuyarak: giriş yapabilir,
gezinebilir, yeni müşteri ve şube oluşturabilir, cihaz sağlayıp yönetebilir, kredi
yükleyebilir, firmware yayımlayabilir, sistem sağlığını ve faturalandırmayı yorumlayabilir.
