# Tasarım: Kiracı Yöneticisi Kullanım Kılavuzu (Türkçe PDF)

**Tarih:** 2026-07-06
**Durum:** Onaylandı (yapı) — içerik yazımı bekliyor
**Kapsam:** Maratus Admin konsolunun **Kiracı Yöneticisi (tenant owner/admin, müşteri tarafı)** bölümü için Türkçe kullanıcı kılavuzu. Süper Admin kılavuzunun (`super-admin-kilavuzu`) kardeş belgesidir; aynı biçim ve kuralları izler.

---

## 1. Amaç

Maratus'yu hiç kullanmamış bir kiracı yöneticisinin, yalnızca bu belgeyi izleyerek
kendi organizasyonunu (mağazalar, cihazlar, marka, üyeler, krediler, API) baştan
sona yönetebilmesini sağlayacak **kapsamlı, Türkçe bir kullanım kılavuzu** üretmek.

## 2. Kararlar (Süper Admin kılavuzuyla aynı; kullanıcı onayladı)

| Karar | Seçim |
|---|---|
| **Biçim** | Tek **PDF** — kapak, içindekiler (TOC), sayfa numaraları. `make-pdf` ile üretilir. |
| **Kaynak** | Türkçe **Markdown**: `docs/manuals/tr/kiraci-kilavuzu.md`. |
| **Ekran görüntüleri** | **İlk sürüm görüntüsüz** (ayrıntılı metin). |
| **Paketleme** | **Tek eksiksiz el kitabı**, her ekran bir bölüm. |
| **Derinlik** | **Kavramlar + görevler.** |
| **Dil kuralı** | Türkçe "siz"; UI adları **TÜRKÇE-ÖNCE**: "Türkçe karşılık (İngilizce arayüz metni)". |
| **Doğruluk** | Yalnızca arayüzde gerçekten var olanı belge; bilinen tuhaflıklar *belgelenir*, düzeltilmez. |
| **Başlık yapısı** | `#` başlık, `## N.` bölümler, `###` alt bölümler; seviye atlanmaz. |

## 3. Üretim Akışı

1. İçerik `docs/manuals/tr/kiraci-kilavuzu.md` dosyasına yazılır.
2. `make-pdf generate --cover --toc` ile PDF üretilir.
3. Hem `.md` hem `.pdf` git'e commit'lenir (dal: `docs/tenant-turkish-manual`).

## 4. Erişim modeli (kılavuzda anlatılacak)

- Kiracı bölümü `requireTenant()` ile korunur; giriş yoksa `/login`, aktif
  organizasyon yoksa (platform_admin ise `/admin`, değilse) `/login`.
- Aktif organizasyon = `session.activeOrganizationId`. Çalışma alanı etiketi **"Workspace"**.
- **Roller:** `owner | admin | member`. "Yönetebilir" kapıları (mağaza ekle, cihaz
  sahiplen, marka/cihaz ayarları düzenle, API anahtarı, üye yönet) `owner|admin`
  ister. **member salt-okunurdur.** owner=admin işlevsel olarak aynı; tek fark:
  owner silinemez/rolü düşürülemez, davet yalnızca admin/member verir.

## 5. Bölüm Yapısı (16 bölüm)

Numaralandırma **1. görevden itibaren kilitlidir** (aşağıdaki nihai numaralar).

0. Kapak + İçindekiler (make-pdf üretir)
1. **Giriş & Bu Kılavuz Hakkında**
2. **Maratus Nedir? (Kiracı Bakışıyla)** — kiracı/organizasyon, mağaza, cihaz (yazıcı),
   tetikleme→QR akışı, ön ödemeli kredi, roller.
3. **Başlarken** — giriş, `/tenant`'a yönlenme, kenar çubuğu ("Workspace" grubu, 10 öğe),
   çalışma alanı değiştirici (workspace switcher), hesap menüsü (Profile/Settings **işlevsiz**,
   Sign out yalnızca yönlendirir).
4. **Panel (Dashboard)** — 3 KPI (sabit deltalar + sabit tarih çipi notu), grafik, Eko etki, en yoğun mağazalar.
5. **Mağazalar (Stores)** — liste, **Mağaza ekle/düzenle**, **Mağaza Detayı** (KPI'lar, grafikler,
   yoğun saatler ısı haritası), **sahiplenilmemiş yazıcılar (unclaimed)** listesi.
6. **Cihazlar (Cihaz Yönetimi)** — cihaz kartı, **Duraklat/Etkinleştir**, **Yazıcı sahiplenme
   (Claim printer)** akışı (pairing code + tek seferlik cihaz anahtarı), **Cihaz Detayı** sayfası,
   **Uzaktan kontrol** (Reboot/Refresh config/Identify/Update firmware).
7. **Marka (Branding)** — marka stüdyosu: logo metni (**yalnızca önizleme**), vurgu rengi + presetler,
   gelişmiş tema, ekran düzenleri (7 ekran), ikon/görsel yükleme (2 MB), Staff PIN, canlı önizleme, kaydet çubuğu.
8. **Cihaz Ayarları (Device Settings)** — QR süresi (15–180s), parlaklık (10–100%), uyku + "sonra",
   Cihaz Ayarları PIN (4–12 hane).
9. **Üyeler (Members)** — davet (Email + rol Member/Admin), roller, üye tablosu (rol değiştir/kaldır), bekleyen davetler.
10. **Raporlar (Reports)** — grafikler, Eko tasarruf, CSV dışa aktarma.
11. **Analitik (Analytics)** — mağaza karşılaştırması, trendler, CSV dışa aktarma.
12. **Faturalandırma & Krediler (Billing)** — kredi bakiyesi, **kredi satın alma** (Stripe paketleri;
    env yoksa **hiç görünmez** notu), aylık kredi kullanımı tablosu.
13. **API** — API anahtarları, kapsamlar (`usage:read`, `devices:trigger`), "Read-only" **etiket uyumsuzluğu** notu, oluşturma (tek seferlik anahtar) + iptal.
14. **Etkinlik (Activity)** — denetim günlüğü tablosu, sayfalama, eylem etiketleri.
15. **Rozetler ve Terimler (Sözlük)** — cihaz durumları (Online/Offline/Paused), roller, kredi/tetikleme/aktivasyon.
16. **Sık Sorulanlar / Sorun Giderme.**

## 6. Doğruluk İlkesi — Kiracı tarafına özgü tuhaflıklar (kılavuzda dürüstçe ele alınacak)

1. Dashboard'daki **"May 30, 2026"** tarih çipi **sabit kodlu** (gerçek tarih değil).
2. Dashboard KPI deltaları **+6.4%** ve **+12.1%** **sabit kodlu**; yalnızca mağaza-detayı aylık delta gerçek.
3. **API** sayfası "Read-only keys" der ama `devices:trigger` kapsamı **yazma/kredi harcayan** bir yetkidir — uyumsuzluk belirtilir.
4. Hesap menüsü **Profile/Settings işlevsiz**; **Sign out** yalnızca `/login`'e yönlendirir (gerçek çıkış API'si çağırmaz).
5. **Branding "Logo text" alanı yalnızca önizleme** — kaydedilmez, yeniden yüklemede sıfırlanır.
6. **Reports** mağaza adlarından sabit kodlu **"Roastwell "** önekini kırpar (demo verisi kalıntısı) — düşük öncelik, isteğe bağlı not.
7. **Kredi satın alma bölümü** Stripe anahtarı/paketleri yapılandırılmamışsa **hiç görünmez**.
8. **Cihaz detayı uzaktan-kontrol komut tablosu** ham `type`/`status` gösterir (Activity'deki gibi Türkçeleştirilmemiş).
9. Bazı sayfalar (Billing/Members/Activity) kendi başlık/dolgu düzenini kullanır — görünüm biraz farklıdır.

## 7. Kapsam Dışı

- Süper Admin kılavuzu (zaten yayımlandı).
- Gerçek ekran görüntüleri (2. tur).
- Kod/UI düzeltmeleri (yalnızca dokümantasyon).

## 8. Başarı Ölçütü

Maratus'yu hiç görmemiş bir kiracı yöneticisi yalnızca bu PDF ile: giriş yapıp gezinebilir,
mağaza oluşturup düzenleyebilir, yazıcı sahiplenip yönetebilir, markasını ve cihaz
politikalarını ayarlayabilir, üye davet edebilir, kredi satın alabilir, API anahtarı
oluşturabilir, rapor/analitiği ve etkinlik günlüğünü yorumlayabilir.
