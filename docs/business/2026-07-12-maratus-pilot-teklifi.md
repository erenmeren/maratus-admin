# Maratus — Dijital Belge Pilot Programı Teklifi

*Hazırlayan: Maratus · Tarih: 12 Temmuz 2026 · Gizli — yalnızca alıcı kurum içindir*

---

## Maratus nedir?

Maratus, kasadaki kâğıt fişi/belgeyi **QR kodlu dijital belgeye** çeviren bir
donanım + bulut platformudur. Kasaya yerleştirilen 4″ dokunmatik ekranlı
Maratus yazıcısı, satış anında müşteriye bir QR kodu gösterir; müşteri telefonuyla
okutup belgesine anında erişir. Kâğıt, rulo, yazıcı bakımı ve termal atık
tamamen ortadan kalkar.

- **Kurulum sıfır dokunuş:** Cihaz kutudan çıkar, Wi-Fi'a bağlanır ve
  kendini kurumunuza otomatik tanıtır (~3 saniye). Şubeye atamayı merkez
  ekibiniz panelden yapar; sahada teknik personel gerekmez.
- **Tam entegrasyon:** POS sisteminiz tek bir API çağrısıyla tetikler
  (`POST /devices/{id}/trigger`); belge içeriği sizin altyapınızda kalır.
- **Merkezi yönetim:** Tüm şubeler ve cihazlar tek panelde — arama, filtre,
  durum takibi, marka/ekran tasarımı, denetim kaydı (audit log).

## Neden şimdi?

Günde 5.000 işlem yapan bir şube, yalnızca termal kâğıda ayda yaklaşık
**300–600 USD** harcar (rulo + yazıcı yıpranması). 2.000 şubelik bir ağda bu,
yıllık **milyonlarca dolarlık** operasyonel giderdir — üstüne yazıcı arızaları,
rulo lojistiği ve sürdürülebilirlik raporlarındaki kâğıt ayak izi eklenir.

Maratus ile aynı ağ:

| | Kâğıt fiş | Maratus |
|---|---|---|
| İşlem başı maliyet | ~$0,002–0,004 | plana dahil |
| Rulo lojistiği / yazıcı bakımı | sürekli | yok |
| ESG / kâğıtsız raporlama | yok | otomatik |
| Müşteriyle dijital temas (kampanya, sadakat) | yok | her QR taramasında |

## Fiyatlandırma

İki basit model; pilot süresince ikisini de deneyimlersiniz:

**Model A — "Base + Usage" (önerilen başlangıç):**
cihaz başına aylık taban ücret + aylık dahil işlem kotası; kota üstü
işlemler kademeli fiyatlı kredilerle. Yoğun şubede dahi toplam maliyet,
o şubenin bugünkü kâğıt harcamasının **altında** kalacak şekilde
yapılandırılır.

**Model B — "Flat Fleet":**
cihaz başına sabit aylık ücret, **sınırsız işlem** (adil kullanım).
Bütçesi öngörülebilirlik isteyen ağlar için.

Hacim kademeleri (100+, 1.000+ şube) her iki modelde de geçerlidir;
kurumsal sözleşmede (24–36 ay) **cihaz donanımı ücretsizdir** ve arıza
değişim SLA'sı dahildir. Faturalama aylık, USD, Net-14 vadeli e-faturadır —
kredi kartı zorunluluğu yoktur.

## Pilot programı önerisi

| | |
|---|---|
| **Kapsam** | 50–100 şube (sizin seçiminiz; farklı yoğunluk profillerinden karma öneririz) |
| **Süre** | 3 ay |
| **Fiyat** | Model A, pilot kademesinden; donanım pilot süresince ücretsiz emanet |
| **Kurulum** | Cihazlar merkezden seri numarasıyla şubelere tahsis edilir; şubede yalnızca Wi-Fi bağlantısı gerekir |
| **Entegrasyon** | POS ekibinizle 1 hafta ortak çalışma; tek endpoint, test ortamı ve sandbox anahtarları ilk gün |
| **Destek** | Pilot boyunca adanmış teknik irtibat + haftalık durum raporu |

### Yazılı başarı kriterleri (pilot çıkış kapısı)

1. **Tarama oranı:** gösterilen QR'ların en az %X'i taranıyor *(hedef pilotta birlikte kalibre edilir)*
2. **Kâğıt tasarrufu:** pilot şubelerde rulo tüketiminde ölçülür düşüş — panelden şube bazında rapor
3. **Operasyonel kesintisizlik:** cihaz uptime ≥ %99, işlem gecikmesi ≤ 12 sn
4. **Saha kabulü:** kasiyerler ve şube yöneticilerinden yapılandırılmış geri bildirim

Kriterler sağlandığında, pilot fiyat şartları korunarak ağın tamamına
(2.000 şube) yıllık sözleşmeyle geçiş planı devreye alınır; pilot cihazları
yerinde kalır, hiçbir kurulum tekrarlanmaz.

## Sonraki adım

30 dakikalık bir teknik demo + ticari görüşme öneriyoruz: canlı cihazla
uçtan uca akışı (tetikleme → QR → panel raporu) gösterelim ve pilot şube
listesini birlikte taslaklayalım.

*İletişim: Eren Altan · erenaltan@gmail.com*
