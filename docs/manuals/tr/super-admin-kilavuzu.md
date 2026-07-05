# Süper Admin Kullanım Kılavuzu

*Ditto Admin — Platform Yöneticisi (Süper Admin) Rehberi*

## 1. Giriş & Bu Kılavuz Hakkında

Bu kılavuz, Ditto Admin uygulamasının **Süper Admin (Platform Admin)** bölümünü
kullanacak Ditto platform yöneticileri için hazırlanmıştır. Ditto'yu daha önce
hiç kullanmamış olduğunuzu varsayarak, en temel kavramlardan başlayıp adım adım
ilerler; hiçbir ön bilgi gerektirmez.

Ditto Admin uygulamasının arayüzü **İngilizce**'dir; bu kılavuz Türkçe yazılmış
olsa da uygulamanın kendisi Türkçeleştirilmemiştir. Bu nedenle bir ekran adı,
düğme veya alan adı ilk kez geçtiğinde, "**Türkçe karşılığı (İngilizce arayüz
metni)**" biçiminde verilir — örneğin **Genel Bakış (Overview)**. Parantez
içindeki İngilizce metin, ekranda aynen göreceğiniz metindir; parantezden önceki
Türkçe kısım ise bunun açıklaması/çevirisidir.

Kılavuzu okurken şu sırayı izlemenizi öneririz: önce **kavramları** öğrenin
(Ditto nedir, kiracı/tenant ne demek, Süper Admin kimdir, cihaz-tetikleme akışı
nasıl işler, kredi sistemi nasıl çalışır), ardından uygulamadaki **her ekranı**
tek tek keşfedin. Bu sıralama, ekranlarda gördüğünüz her düğme ve alanın "neden"
orada olduğunu anlamanızı kolaylaştırır.

## 2. Ditto Nedir? (Kavramsal Model)

### 2.1 Ditto ne işe yarar?

Ditto, işletmelerin kağıt belge (fiş, fatura, garanti kartı vb.) basmak yerine
müşterilerine bir **QR kod** göstermesini sağlayan bir sistemdir. Müşteri bu QR
kodu telefonuyla okutur ve ilgili dijital belgeyi indirir. Böylece kağıt israfı
ortadan kalkar.

Önemli bir noktayı baştan netleştirmek gerekir: Ditto **yalnızca tetikleme
(trigger-only) modeliyle** çalışır — yani Ditto artık belgeleri kendi
sunucularında barındırmaz. Cihaz, çağıran tarafın (işletmenin kendi sisteminin)
sağladığı bir URL'nin QR kodunu ekranda gösterir; belgenin kendisi işletmenin
kendi altyapısında durur, Ditto sadece "bu URL'nin QR kodunu göster" komutunu
cihaza iletir.

### 2.2 Çok kiracılı yapı (Multi-tenant) — Organizasyon = Kiracı

Ditto Admin, **çok kiracılı (multi-tenant)** bir sistemdir: Ditto'yu kullanan
her **müşteri firma, bir "organizasyon" (kiracı / tenant)** olarak temsil edilir.
Her kiracının kendi mağazaları, cihazları ve kullanıcıları vardır; bir kiracının
verileri diğerine karışmaz.

Bir kiracı içindeki kullanıcıların rolleri (owner/admin/member — sahip/yönetici/
üye) o kiracıya özel üyelik bilgisinde tutulur. Yani "bu kişi Roastwell Coffee
kiracısında yönetici" gibi bir bilgi, o kiracıya bağlı bir üyelik kaydıdır.

### 2.3 Süper Admin bir kiracı üyeliği DEĞİLDİR

Bu kılavuzun konusu olan **Süper Admin (Platform Admin)** rolü, yukarıdaki
kiracı/organizasyon üyeliklerinden **tamamen ayrı** bir kavramdır. Bir kullanıcının
Süper Admin olması, herhangi bir kiracıya üye olmasından kaynaklanmaz; kullanıcının
kendi hesabında platform genelinde geçerli bir yetki (`platform_admin` rolü)
olarak tanımlanır.

Kısacası: **Tenant Admin** (bir kiracının yöneticisi) ile **Süper Admin**
(tüm platformun yöneticisi) birbirinden farklı iki roldür. Süper Admin, tüm
kiracıları görebilir ve platform genelinde işlem yapabilirken, bir Tenant Admin
sadece kendi kiracısını yönetir.

### 2.4 Cihaz = Yazıcı (Printer)

Ditto'da bahsedilen "cihaz (device)", fiziksel bir **yazıcı (printer)**
donanımıdır. Bu donanım, kağıda bir şey basmaz; ekranında müşteriye taranacak
QR kodu gösterir.

### 2.5 Tetikleme → QR akışı (Trigger → QR flow)

Bir cihazın müşteriye QR kod gösterebilmesi için aşağıdaki akış izlenir:

1. Yetkilendirilmiş bir çağıran taraf (işletmenin kendi sistemi), Ditto'ya
   "bu cihazda şu URL'nin QR'ını göster" isteği gönderir (bir **tetikleme /
   trigger** isteği).
2. Bu istek karşılığında kiracının kredi bakiyesinden **1 kredi rezerve edilir**
   (henüz kesin olarak düşülmez, sadece ayrılır).
3. Cihaz, bekleyen komutları düzenli olarak yoklar (polling), komutu alır ve
   ekranında ilgili URL'nin QR kodunu gösterir.
4. Cihaz, komutu işleyip işlemediğini bildirir (ack):
   - İşlem **başarılı** olduysa, rezerve edilen kredi kalıcı olarak **düşülür
     (settle)**.
   - İşlem **başarısız** olur ya da süresi dolarsa, rezerve edilen kredi
     **serbest bırakılır (release)** ve kiracının bakiyesine geri döner.

### 2.6 Ön ödemeli kredi sistemi (Prepaid Credits)

Ditto, kullanım başına **ön ödemeli kredi** modeliyle ücretlendirilir: her
başarılı tetikleme (yukarıdaki akışın tamamlanması) kiracıya **1 kredi**ye mal
olur. Krediler önce rezerve edilir, işlem başarıyla tamamlanınca kesin olarak
düşülür (settle), başarısız olursa serbest bırakılır (release). Yeni kaydolan
her kiracıya başlangıçta **50 başlangıç kredisi (starter credits)**
tanımlanır — bu krediler ücretsizdir.

### 2.7 Ürün yazılımı ve OTA güncellemeleri (Firmware/OTA)

Cihazlar, çalıştıkları ürün yazılımını (firmware) uzaktan güncelleyebilir.
Yayınlanan ürün yazılımı sürümleri arasında **en son yayınlanan (newest
published) sürüm**, cihazların OTA (kablosuz/uzaktan) güncelleme sırasında
hedefleyeceği sürümdür.

## 3. Başlarken (Giriş ve Gezinme)

Bu bölümde Ditto Admin'e Süper Admin olarak nasıl giriş yapacağınızı, giriş
sonrası nereye yönlendirileceğinizi, erişim kurallarını ve ana gezinme
menüsünü öğreneceksiniz.

### 3.1 Amaç

Bu bölümü tamamladığınızda, Ditto Admin'e giriş yapabilecek ve Süper Admin
paneli içinde temel gezinmeyi (sol menü ve üst çubuk) yapabilecek durumda
olacaksınız.

### Adım adım: Giriş yapma

1. Tarayıcınızda uygulamanın giriş sayfasına, yani **`/login`** adresine gidin.
2. **E-posta (Email)** alanına hesabınızın e-posta adresini girin.
3. **Şifre (Password)** alanına şifrenizi girin.
4. **Giriş Yap (Sign in)** düğmesine tıklayın.

Giriş sayfasında bir **"Demo hesapları" (Demo accounts)** paneli bulunur; bu
panel, şifresi ortak olan (`123456`) **iki** demo hesabı listeler:

- **Kiracı sahibi (Tenant owner):** `dana@roastwell.co`
- **Platform admin (Süper Admin):** `admin@ditto.app`

> **Dikkat:** Giriş formu, sayfa ilk açıldığında **varsayılan olarak kiracı
> hesabıyla (`dana@roastwell.co`)** önceden doldurulmuş gelir. Siz bir Süper
> Admin olarak giriş yapmak istediğinizde, **E-posta (Email)** alanını elle
> `admin@ditto.app` olarak değiştirmeniz gerekir; **Şifre (Password)** alanı
> her iki hesap için de aynıdır: `123456`.

> **Önemli — çalışmayan bağlantılar:** Giriş sayfasındaki **"Şifremi unuttum?"
> (Forgot password?)** ve **"SSO ile devam et" (Continue with SSO)**
> bağlantıları **işlevsel değildir**. "SSO ile devam et" bağlantısına
> tıklandığında ekranda "SSO not configured" (SSO yapılandırılmadı) uyarısı
> (toast) görüntülenir. Bu iki seçeneği kullanarak giriş yapmaya
> çalışmayın — yalnızca e-posta + şifre ile giriş yapılabilir.

### 3.2 Giriş sonrası yönlendirme

Başarılı bir girişten sonra uygulama, hesabınızın rolüne göre sizi otomatik
olarak yönlendirir:

- Hesabınız **`platform_admin`** rolündeyse (yani Süper Admin iseniz),
  **`/admin`** adresine yönlendirilirsiniz — bu kılavuzun konusu olan Süper
  Admin paneli buradadır.
- Diğer tüm kullanıcılar **`/tenant`** adresine yönlendirilir (kendi
  kiracılarının paneli).

### 3.3 Erişim kuralı (Access gate)

`/admin` ile başlayan tüm bölüm, yalnızca **`platform_admin`** rolüne sahip
kullanıcılara açıktır:

- `platform_admin` olmayan, ama oturumu açık bir kullanıcı bu bölüme erişmeye
  çalışırsa **`/tenant`** adresine yönlendirilir.
- Oturumu kapalı (giriş yapmamış) bir kullanıcı bu bölüme erişmeye çalışırsa
  **`/login`** sayfasına yönlendirilir.

### 3.4 Sol menü — "Platform" grubu

Giriş yaptıktan ve Süper Admin paneline ulaştıktan sonra, sol taraftaki gezinme
menüsünde **"Platform"** adlı bir grup görürsünüz. Bu grup, aşağıdaki sırayla
şu ekranları içerir:

1. **Genel Bakış (Overview)**
2. **Müşteriler (Customers)**
3. **Cihaz Filosu (Device Fleet)**
4. **Sağlık (Health)**
5. **Ürün Yazılımı (Firmware)**
6. **Faturalandırma ve Gelir (Billing & Revenue)**

Bu ekranların her biri, kılavuzun ilerleyen bölümlerinde ayrıntılı olarak
anlatılacaktır.

### 3.5 Üst çubuk (Top bar)

Panelin üst kısmında, tüm ekranlarda ortak olarak bulunan iki kontrol yer alır:

- **Tema geçişi (Theme toggle):** Açık/koyu tema arasında geçiş yapmanızı
  sağlar.
- **Kullanıcı menüsü (User menu):** Oturum açmış kullanıcının adını,
  e-posta adresini ve rolünü ("**Süper Admin (Super Admin)**") gösterir.

## 4. Genel Bakış (Overview)

Bu bölüm, Süper Admin girişinden sonra karşınıza çıkan ilk ekranı anlatır:
**Genel Bakış (Overview)** ekranı, adresi **`/admin`** olan, platformun
tamamına ait özet bilgileri gösteren ekrandır.

### Bu ekran ne işe yarar?

Genel Bakış ekranının başlığı **"Overview"**, alt açıklaması ise **"Platform-wide
performance across all Ditto customers."** ("Ditto'nun tüm müşterileri
genelinde platform performansı") biçimindedir. Bu ekran, tek bir kiracıya değil,
**platformdaki tüm kiracılara (müşterilere)** ait verilerin özetini bir arada
gösterir; böylece Süper Admin, tek bir bakışta platformun genel durumunu
görebilir.

### Ekranda neler var?

Ekranın üst kısmında üç **KPI kartı (KPI cards — anahtar performans göstergesi
kartları)** yer alır:

1. **Bu ayki aktivasyonlar (Activations this month):** Bu ay platform
   genelinde gerçekleşen toplam aktivasyon sayısını gösterir; ipucu
   metni "platform-wide" ("platform genelinde") yazar. Kartın yanında
   **+12.1%** değerinde bir değişim rozeti (delta badge) görünür.

   > **Önemli — bu rakam sabittir:** Karttaki **+12.1%** değişim rozeti,
   > uygulama kodunda **sabit (hardcoded)** bir değer olarak yazılmıştır;
   > herhangi bir gerçek/canlı (live) veriden hesaplanmaz. Bu ekranı ne zaman
   > açarsanız açın, önceki ayla karşılaştırma olarak her zaman aynı **+12.1%**
   > değerini görürsünüz. Bu rakamı gerçek bir büyüme/aylık karşılaştırma
   > yüzdesi olarak yorumlamayın — yalnızca görsel bir yer tutucudur.
   > (Karşılaştırma için: aşağıdaki **Aktif cihazlar** ve **Müşteriler**
   > kartlarında böyle bir rozet yoktur; bu rozet yalnızca bu karta özeldir.)

2. **Aktif cihazlar (Active devices):** Şu anda çevrimiçi olan cihaz sayısını,
   toplam cihaz sayısına oranla `aktif/toplam` (`active/total`) biçiminde
   (örn. "5/6") gösterir; ipucu metni "printers online" ("çevrimiçi
   yazıcılar") yazar. Bu kartta değişim rozeti bulunmaz.

3. **Müşteriler (Customers):** Platformdaki toplam müşteri (kiracı) sayısını
   gösterir; ipucu metni ilgili müşterilerin toplam mağaza sayısını "{N}
   stores" ("{N} mağaza") biçiminde belirtir. Bu kartta da değişim rozeti
   bulunmaz.

KPI kartlarının altında bir **grafik kartı (chart card)** yer alır: **Zaman
içinde aktivasyonlar (Activations over time)**. Bu kart "Monthly activations,
all customers" ("Tüm müşteriler için aylık aktivasyonlar") açıklamasıyla, bir
**alan grafiği (area chart)** üzerinde aktivasyonların zaman içindeki seyrini
gösterir.

Grafiğin altında iki **tablo kartı (table card)** bulunur:

- **En çok aktivasyon yapan müşteriler (Top customers):** "By activations this
  month" ("Bu ayki aktivasyonlara göre") açıklamasıyla, en çok aktivasyon yapan
  müşterileri listeler. Sütunları: **Müşteri (Customer)**, **Mağazalar
  (Stores)**, **Cihazlar (Devices)**, **Aktivasyonlar (Activations)**. Tablodaki
  müşteri adları tıklanabilir birer bağlantıdır ve ilgili müşterinin ayrıntı
  sayfasına (**`/admin/customers/{id}`**) götürür; her satırda ayrıca, Bölüm
  5'te ayrıntılı anlatılan bir **durum rozeti (status badge)** bulunur.
  Kartın sağ üst köşesinde **Tüm müşteriler (All customers)** bağlantısı yer
  alır; bu bağlantı sizi **`/admin/customers`** adresindeki tam müşteri
  listesine götürür.

- **Şirkete göre krediler (Credits by company):** "Trigger credits spent this
  month" ("Bu ay harcanan tetikleme kredileri") açıklamasıyla, kredi
  harcamasını şirket bazında listeler. Sütunları: **Şirket (Company)**,
  **Harcanan kredi (Credits spent)**, **Tetiklemeler (Triggers)**. Bu tabloda
  en fazla **ilk 10 (top 10)** şirket gösterilir. Bu ay hiç kredi
  harcanmamışsa, tablo yerine "No credit usage yet this month." ("Bu ay henüz
  kredi kullanımı yok.") mesajı görüntülenir.

### Adım adım: Bir müşterinin ayrıntısına gitme

Genel Bakış ekranında herhangi bir veriyi değiştirebileceğiniz bir kontrol
yoktur; ekran tamamen **salt görüntülemedir (read-only)** ve yalnızca
bağlantılar içerir. Bir müşterinin ayrıntılarına gitmek isterseniz:

1. **En çok aktivasyon yapan müşteriler (Top customers)** kartındaki listede,
   gitmek istediğiniz müşterinin adına tıklayın; bu sizi doğrudan o
   müşterinin ayrıntı sayfasına götürür.
2. Aradığınız müşteri bu kısa listede yoksa, kartın üzerindeki **Tüm
   müşteriler (All customers)** bağlantısına tıklayarak tam müşteri listesine
   (**Müşteriler (Customers)** ekranı, bkz. Bölüm 5) gidin ve müşteriyi orada
   arayın.

### İpuçları ve dikkat edilecekler

- Genel Bakış ekranında **hiçbir düğme veya form yoktur**; bu ekran yalnızca
  bilgi görüntülemek ve diğer ekranlara bağlantı vermek içindir (salt
  görüntüleme + linkler). Bir ayar değiştirmek veya kayıt oluşturmak
  istiyorsanız ilgili diğer ekranlara (**Müşteriler**, **Cihaz Filosu**, vb.)
  gitmeniz gerekir.
- **Bu ayki aktivasyonlar (Activations this month)** kartındaki
  **+12.1%** rozetinin **sabit (hardcoded)** bir değer olduğunu unutmayın —
  bu, gerçek bir aylık karşılaştırma değildir; canlı veri değildir.
- **Şirkete göre krediler (Credits by company)** tablosu yalnızca ilk 10
  şirketi gösterir; platformda 10'dan fazla şirket kredi harcamışsa, bu
  listede yer almayan şirketler olabilir.

## 5. Müşteriler (Customers)

Bu bölüm, platformdaki tüm müşteri firmalarını (kiracıları) listeleyen
**Müşteriler (Customers)** ekranını ve yeni bir müşteri oluşturma işlemini
anlatır. Bu ekranın adresi **`/admin/customers`**'dır.

### Bu ekran ne işe yarar?

Müşteriler ekranının başlığı **"Customers"**, alt açıklaması ise platformdaki
toplam mağaza zinciri sayısını gösteren "{N} store chains on Ditto" ("Ditto'da
{N} mağaza zinciri") biçimindedir — buradaki {N} sayısı, o an platformdaki
toplam müşteri sayısına göre otomatik güncellenir. Bu ekran, Süper Admin'in
platformdaki **tüm müşterileri (kiracıları)** tek bir tabloda görmesini ve
gerektiğinde **yeni bir müşteri (yeni bir kiracı)** oluşturmasını sağlar.

### Ekranda neler var?

Ekranın sağ üst köşesinde bir **Yeni müşteri (New customer)** düğmesi bulunur;
bu düğme yeni bir müşteri oluşturma penceresini (dialog) açar.

Ekranın ana kısmında bir tablo yer alır; sütunları şunlardır:

- **Müşteri (Customer):** Müşteri firmanın adı.
- **Mağazalar (Stores):** Müşterinin sahip olduğu mağaza sayısı.
- **Cihazlar (Devices):** Müşterinin sahip olduğu cihaz (yazıcı) sayısı.
- **Sağlık (Health):** Müşterinin cihaz filosunun genel sağlık durumunu
  gösterir. Bu hücrede renkli bir nokta, bir durum etiketi ve çevrimiçi/toplam
  cihaz sayısı (`online/total`, örn. "(4/6)") birlikte gösterilir. Alabileceği
  değerler:
  - **Sağlıklı (Healthy)** — yeşil nokta,
  - **Uyarı (Warning)** — amber (turuncu-sarı) nokta,
  - **Kritik (Critical)** — kırmızı nokta.
- **Aktivasyonlar (ay) (Activations (mo.)):** O müşterinin bu ayki toplam
  aktivasyon sayısı.
- **Durum (Status):** Müşterinin hesap durumunu gösteren bir rozet (badge).
  Alabileceği değerler:
  - **Aktif (Active)** — yeşil rozet,
  - **Deneme (Trial)** — mor rozet,
  - **Askıya alınmış (Suspended)** — kırmızı rozet.
- Satırın en sağında bir **ok işareti (chevron)** bulunur; bu, satırın
  tıklanabilir olduğunu ve bir ayrıntı sayfasına götürdüğünü belirtir.

Tablodaki herhangi bir satıra tıkladığınızda, o müşterinin ayrıntı sayfasına
(**`/admin/customers/{id}`**) yönlendirilirsiniz.

### Adım adım: Yeni müşteri oluşturma

1. Müşteriler ekranının sağ üst köşesindeki **Yeni müşteri (New customer)**
   düğmesine tıklayın.
2. Karşınıza başlığı **"New customer"**, açıklaması **"Add a store chain to
   the Ditto platform."** ("Ditto platformuna bir mağaza zinciri ekleyin.")
   olan bir pencere (dialog) açılır. Bu pencerede üç alan bulunur:
   - **Şirket adı (Company name)** — **zorunlu** bir alandır; örnek olarak
     "e.g. Roastwell Coffee" ("örn. Roastwell Coffee") yer tutucusu
     (placeholder) gösterilir.
   - **İletişim adı (Contact name)** — isteğe bağlıdır; "Jane Doe" yer
     tutucusu gösterilir.
   - **İletişim e-postası (Contact email)** — isteğe bağlıdır; "jane@store.com"
     yer tutucusu gösterilir.
3. **Şirket adı (Company name)** alanını doldurun — bu alan zorunludur, boş
   bırakırsanız müşteri oluşturulamaz. Dilerseniz **İletişim adı (Contact
   name)** ve **İletişim e-postası (Contact email)** alanlarını da doldurun.
4. Vazgeçmek isterseniz **İptal (Cancel)** düğmesine tıklayarak pencereyi
   kapatabilirsiniz.
5. Müşteriyi oluşturmak için **Müşteri oluştur (Create customer)** düğmesine
   tıklayın. İşlem sürerken düğme metni **"Creating…"** ("Oluşturuluyor…")
   olarak değişir.
6. İşlem başarılı olursa ekranda **"Customer created"** ("Müşteri
   oluşturuldu") başlıklı bir bildirim (toast) belirir; bildirimin alt
   satırında "{isim} has been added to Ditto." ("{isim} Ditto'ya eklendi.")
   açıklaması yer alır ve yeni müşteri tabloya eklenir. İşlem başarısız
   olursa, **"Couldn't create customer"** ("Müşteri oluşturulamadı") başlıklı
   bir hata bildirimi görünür; bildirimin açıklama kısmında sunucudan dönen
   hata mesajı gösterilir.

### İpuçları ve dikkat edilecekler

- **Şirket adı (Company name)** alanı zorunludur; bu alanı boş bırakırsanız
  müşteri oluşturulamaz. **İletişim adı (Contact name)** ve **İletişim
  e-postası (Contact email)** alanları isteğe bağlıdır, boş bırakılabilir.
- **Sağlık (Health)** sütunu ile **Durum (Status)** sütununu birbirine
  karıştırmayın: **Sağlık**, cihazların o an çevrimiçi olup olmadığını
  (teknik/operasyonel durum) gösterirken; **Durum**, müşterinin hesap
  durumunu (ticari/idari durum: aktif, deneme, askıya alınmış) gösterir. Bir
  müşteri "Aktif (Active)" durumda olduğu halde cihazları "Kritik (Critical)"
  sağlık durumunda olabilir, ya da tam tersi.
- Tablodaki bir satıra tıklayarak o müşterinin ayrıntı sayfasına
  gidebilirsiniz; bu sayfa bu kılavuzun ileriki bir bölümünde ayrıca ele
  alınacaktır.

## 6. Müşteri Detayı (Customer Detail)

Bu bölüm, **Müşteriler (Customers)** ekranındaki bir satıra tıkladığınızda
açılan **Müşteri Detayı (Customer Detail)** ekranını anlatır. Bu ekranın
adresi **`/admin/customers/{tenantId}`**'dir ve tek bir müşteriye (kiracıya)
ait tüm ayrıntıları — sağlık durumu, KPI'lar, krediler, cihazlar ve
etkinlik geçmişi — bir arada gösterir. Belirtilen kimliğe (`tenantId`) sahip
bir müşteri bulunamazsa, ekran **404 (bulunamadı)** hatası döner.

### Bu ekran ne işe yarar?

Müşteri Detayı ekranı, Süper Admin'in **tek bir müşteriyi** derinlemesine
incelemesini ve o müşteriyle ilgili üç temel işlemi yapmasını sağlar: müşteriye
**kredi yüklemek**, müşteriye yeni bir **şube (branch)** eklemek ve müşteri
için yeni bir **cihaz (printer) sağlamak (provision)**. Ekranın en üstünde,
**Müşteriler (Customers)** ekranına dönmenizi sağlayan bir **"← Customers"**
geri bağlantısı bulunur.

### Ekranda neler var?

Ekran, yukarıdan aşağıya doğru şu kartlardan oluşur:

**Başlık kartı (Header card):** Müşterinin adını ve hesabın **durum rozetini
(status badge)** gösterir — Aktif/Deneme/Askıya alınmış (bkz. Bölüm 5,
**Durum (Status)** sütunu). Altında iki iletişim bilgisi yer alır: **e-posta
adresi** (bir zarf simgesiyle, **E-posta (Mail)**) ve **telefon numarası**
(bir ahize simgesiyle, **Telefon (Phone)**). Kartın sağında **Şube ekle
(Add branch)** düğmesi bulunur.

**Sağlık özeti şeridi (Health summary strip):** Renkli bir nokta ve bir
seviye etiketiyle müşterinin cihaz filosunun genel sağlığını gösterir —
**Sağlıklı (Healthy)**, **Uyarı (Warning)** veya **Kritik (Critical)** (bkz.
Bölüm 5). Bunun yanında dört sayaç yer alır: **Çevrimiçi (Online)**,
**Çevrimdışı (Offline)**, **Duraklatılmış (Paused)** ve **Takılı kalmış,
bekleyen (Stuck pending)**.

**KPI kartları:** Üç kart yer alır: **Mağazalar (Stores)**, **Cihazlar
(Devices)** ve **Bu ayki aktivasyonlar (Activations this month)**.

**Grafik kartı — Mağazaya göre aktivasyonlar (Activations by store):** "This
month, per branch" ("Bu ay, şubeye göre") açıklamasıyla, her şubenin bu ayki
aktivasyon sayısını **yatay çubuk grafik (horizontal bar chart)** olarak
gösterir.

**Krediler kartı (Credits card):** Başlığın altında müşterinin güncel kredi
durumu özetlenir: **Available:** (kullanılabilir kredi) {n} ve **Held:**
(rezerve/tutulan kredi) {n}. Bu kartın içinde iki bölüm bulunur:

- **Kredi yükleme formu (Grant credits):** **Kredi (Credits)** (sayı,
  zorunlu, en az 1 en çok 1.000.000, yer tutucu "e.g. 100") ve **Not (isteğe
  bağlı) (Note (optional))** (yer tutucu "e.g. promotional grant")
  alanlarından oluşur; gönder düğmesi **Kredi yükle (Grant credits)**
  ("Granting…" durumuna geçer). Başarılı olursa "Credits granted." ("Kredi
  yüklendi.") mesajı görünür; geçersiz bir miktar girilirse "Enter a whole
  credit amount between 1 and 1,000,000." ("1 ile 1.000.000 arasında tam
  sayı bir kredi miktarı girin.") hata mesajı görünür.
- **Kredi hareket dökümü (ledger) tablosu:** Kayıt varsa şu sütunlarla
  listelenir: **Hareket türü (Kind)**, **Kredi (Credits)**, **Cihaz
  (Device)** (ilgili cihaz varsa), **Not (Note)** ve **Zaman (Time)**. Hiç
  kayıt yoksa "No ledger entries yet." ("Henüz kredi hareketi yok.") mesajı
  gösterilir.

**Atanmış cihazlar kartı (Assigned devices card):** Başlığın altında "{N}
printers across all stores" ("Tüm mağazalarda {N} yazıcı") açıklaması,
sağ üstte ise **Cihaz ekle (Add device)** düğmesi bulunur. Tablo sütunları:
**Cihaz (Device)** (cihaz kimliği), **Mağaza (Store)**, **Durum (Status)**
(bir renkli nokta ile), **Son görülme (Last seen)**, **Aktivasyonlar (ay)
(Activations (mo.))** ve en sağda her satır için bir **satır işlemleri
menüsü (row-actions menu)**.

**Etkinlik (Activity) bölümü:** Bu müşteriye ait en fazla **50** denetim
(audit) olayını, insan tarafından okunabilir etiketlerle listeler — örneğin
"Customer created" ("Müşteri oluşturuldu"), "Device provisioned" ("Cihaz
sağlandı"), "Credits granted" ("Kredi yüklendi"), "Device paused/resumed"
("Cihaz duraklatıldı/devam ettirildi"). Hiç etkinlik yoksa "No activity yet."
("Henüz etkinlik yok.") mesajı gösterilir.

### Adım adım: Kredi yükleme (Grant credits)

1. Müşteri Detayı ekranında **Krediler (Credits)** kartına gidin.
2. **Kredi (Credits)** alanına yüklemek istediğiniz kredi miktarını girin —
   bu alan **zorunludur** ve **1 ile 1.000.000 arasında bir tam sayı**
   olmalıdır (yer tutucu: "e.g. 100").
3. İsterseniz **Not (isteğe bağlı) (Note (optional))** alanına bu yüklemeyle
   ilgili bir açıklama yazın (örn. "promotional grant" — "promosyon amaçlı
   yükleme").
4. **Kredi yükle (Grant credits)** düğmesine tıklayın. İşlem sürerken düğme metni
   **"Granting…"** ("Yükleniyor…") olarak değişir.
5. İşlem başarılı olursa "Credits granted." ("Kredi yüklendi.") mesajı
   görünür ve **Available** (kullanılabilir) bakiye güncellenir. Girdiğiniz
   miktar 1–1.000.000 aralığı dışındaysa veya tam sayı değilse, "Enter a
   whole credit amount between 1 and 1,000,000." hata mesajı görünür ve
   yükleme gerçekleşmez.
6. Başarılı her yükleme, kartın altındaki **kredi hareket dökümü (ledger)**
   tablosuna yeni bir satır olarak eklenir; bu satırda hareketin türü
   (**Kind**), miktarı (**Credits**), ilişkili cihaz varsa cihazı
   (**Device**), yazdığınız not (**Note**) ve zamanı (**Time**) görüntülenir.

### Adım adım: Şube ekleme (Add branch)

1. Müşteri Detayı ekranının başlık kartındaki **Şube ekle (Add branch)**
   düğmesine tıklayın.
2. Karşınıza başlığı **"Add branch"**, açıklaması **"Create a new branch for
   {customer}."** ("{müşteri} için yeni bir şube oluşturun.") olan bir
   pencere (dialog) açılır. Bu pencerede üç alan bulunur:
   - **Şube adı (Branch name)** — **zorunlu**dur; yer tutucu "e.g. Downtown
     Flagship" ("örn. Downtown Flagship").
   - **Adres (Address)** — isteğe bağlıdır; yer tutucu "412 Market St, San
     Francisco, CA".
   - **Saat dilimi (Timezone)** — açılır bir liste (dropdown); önceden
     tanımlı bir varsayılan değerle gelir. Altında "Used for busiest-times
     analytics." ("En yoğun saatler analizinde kullanılır.") açıklaması yer
     alır.
3. **Şube adı (Branch name)** alanını doldurun — bu alan zorunludur.
   Dilerseniz **Adres (Address)** alanını doldurun ve **Saat dilimi
   (Timezone)** seçimini değiştirin.
4. Vazgeçmek isterseniz **İptal (Cancel)** düğmesine tıklayın.
5. Şubeyi oluşturmak için **Add branch** düğmesine tıklayın. İşlem sürerken
   düğme metni **"Adding…"** ("Ekleniyor…") olarak değişir.
6. İşlem başarılı olursa "Branch added" ("Şube eklendi") başlıklı bir
   bildirim (toast) görünür; alt satırında "{şube adı} added to {müşteri}."
   ("{şube adı}, {müşteri}'ye eklendi.") açıklaması yer alır ve pencere
   kapanır.

### Adım adım: Cihaz sağlama (Add device)

1. **Atanmış cihazlar (Assigned devices)** kartındaki **Cihaz ekle (Add
   device)** düğmesine tıklayın.
2. Karşınıza başlığı **"Add device"**, açıklaması **"Provision a new printer
   for {customer}. You'll get a pairing code to enter on the device."**
   ("{müşteri} için yeni bir yazıcı sağlayın. Cihaza girmeniz için bir
   eşleştirme kodu alacaksınız.") olan bir pencere açılır. Bu pencerede iki
   alan bulunur:
   - **Cihaz adı (Device name)** — yer tutucu "e.g. Printer 1" ("örn.
     Printer 1").
   - **Mağaza (isteğe bağlı) (Store (optional))** — açılır bir liste;
     varsayılan değeri **"Unassigned"** ("Atanmamış") olup, altında "Leave
     unassigned to let the tenant claim it into a store." ("Kiracının
     cihazı bir mağazaya kendi kendine bağlayabilmesi için atanmamış
     bırakın.") açıklaması yer alır.
3. İsterseniz **Cihaz adı (Device name)** alanını doldurun ve/veya **Mağaza
   (Store)** açılır listesinden bir mağaza seçin; boş bırakırsanız cihaz
   **"Unassigned" (Atanmamış)** olarak sağlanır.
4. **Add device** düğmesine tıklayın. İşlem sürerken düğme metni
   **"Adding…"** ("Ekleniyor…") olarak değişir.
5. İşlem başarılı olursa pencere, başlığı **"Device provisioned"** ("Cihaz
   sağlandı") olan bir başarı durumuna geçer. Burada bir uyarı kutusunda
   **"The device stays 'offline' until it pairs with this code."** ("Cihaz,
   bu kodla eşleşene kadar 'offline' (çevrimdışı) kalır.") metni ve bir
   **Eşleştirme kodu (Pairing code)** görüntülenir; kodun yanındaki
   **kopyala (copy)** düğmesiyle kodu panoya kopyalayabilirsiniz.
6. Bu eşleştirme kodunu, ilgili fiziksel cihazın (yazıcının) kendisine
   girmeniz gerekir; cihaz bu kodla başarıyla eşleşene kadar sistemde
   **çevrimdışı (offline)** görünmeye devam eder. Pencereyi kapatmak için
   **Done** ("Tamam") düğmesine tıklayın.

### İpuçları ve dikkat edilecekler

- **Grant credits** formundaki **Credits** alanı yalnızca **1 ile 1.000.000
  arasında bir tam sayı** kabul eder; bu aralığın dışında bir değer girilirse
  veya alan boş bırakılırsa yükleme reddedilir ve hata mesajı gösterilir.
- Yeni sağladığınız bir cihaz, **eşleştirme kodu (pairing code)** ile
  fiziksel cihaza girilip eşleştirilene kadar filoda **"offline"
  (çevrimdışı)** görünür; bu kod yalnızca sağlama işlemi başarılı olduğunda,
  bir kez gösterilir — kopyala düğmesiyle kopyalamayı unutmayın.
- **Cihaz ekle (Add device)** penceresinde **Mağaza (Store)** alanını boş
  (**Unassigned**) bırakmak sorun değildir; bu, kiracının cihazı kendi
  panelinden istediği mağazaya atayabilmesini sağlar.
- **Etkinlik (Activity)** listesi bu müşteriye özel en fazla **50** olayı
  gösterir; daha eski olaylar bu listede görünmeyebilir.

## 7. Cihaz Filosu (Device Fleet)

Bu bölüm, platformdaki **tüm cihazları (tüm yazıcıları), tüm müşteriler
genelinde** tek bir tabloda listeleyen **Cihaz Filosu (Device Fleet)** ekranını
ve bu ekrandan açılan **Cihaz Detayı (Device Detail)** ekranını anlatır. Bu
ekranın adresi **`/admin/devices`**'tır.

### Bu ekran ne işe yarar?

Cihaz Filosu ekranının başlığı **"Device Fleet"**, alt açıklaması ise **"Every
printer across every customer, in one place."** ("Her müşteriye ait her
yazıcı, tek bir yerde.") biçimindedir. Bu ekran, Süper Admin'in platformdaki
**tüm cihazları** — hangi müşteriye ve mağazaya ait olduklarından bağımsız
olarak — tek bir listede görmesini, filtrelemesini ve her cihaz üzerinde
işlem (duraklatma, yeniden adlandırma, taşıma, silme vb.) yapmasını sağlar.

### Ekranda neler var?

Ekranın üst kısmında dört **KPI kartı** yer alır:

1. **Toplam cihaz (Total devices):** Platformdaki toplam cihaz sayısı.
2. **Çevrimiçi (Online):** Şu anda çevrimiçi olan cihaz sayısı; ipucu metni
   "ready to trigger" ("tetiklemeye hazır") yazar.
3. **Duraklatılmış (Paused):** Duraklatılmış cihaz sayısı; ipucu metni
   "temporarily off" ("geçici olarak kapalı") yazar.
4. **Çevrimdışı (Offline):** Ulaşılamayan cihaz sayısı; ipucu metni
   "unreachable" ("ulaşılamıyor") yazar.

KPI kartlarının altında üç filtre kontrolü bulunur:

- **Ara (Search):** Yer tutucu metni "Search by device, store, or customer…"
  ("Cihaza, mağazaya veya müşteriye göre ara…") olan bir serbest metin
  arama kutusu; cihaz kimliği, mağaza adı veya müşteri adına göre arama yapar.
- **Müşteri (Customer):** Açılır liste (dropdown); varsayılan değeri
  **"All customers"** ("Tüm müşteriler") olup, altında platformdaki her
  müşteri ayrı bir seçenek olarak listelenir.
- **Durum (Status):** Açılır liste; seçenekleri **"All statuses"** ("Tüm
  durumlar"), **"Online"** (Çevrimiçi), **"Paused"** (Duraklatılmış) ve
  **"Offline"** (Çevrimdışı) biçimindedir.

Filtrelerin altında ana tablo yer alır; sütunları şunlardır:

- **Cihaz kimliği (Device ID):** Tıklanabilir bir bağlantıdır; ilgili
  cihazın **Cihaz Detayı (Device Detail)** sayfasına
  (**`/admin/devices/{id}`**) götürür.
- **Müşteri (Customer):** Cihazın bağlı olduğu müşteri (kiracı).
- **Mağaza (Store):** Cihazın bağlı olduğu mağaza.
- **Durum (Status):** Renkli bir nokta ile birlikte cihazın durumu
  (Online/Paused/Offline).
- **Son görülme (Last seen):** Cihazın en son ne zaman görüldüğü.
- **Ürün yazılımı (Firmware):** `v{sürüm}` biçiminde geçerli ürün yazılımı
  sürümü. Cihazın sürümünden daha yeni bir yayınlanmış sürüm varsa, sürümün
  yanında **amber (turuncu-sarı) renkli bir güncelleme (update) rozeti**
  görünür.
- **Aktivasyonlar (ay) (Activations (mo.)):** Cihazın bu ayki toplam
  aktivasyon sayısı.
- En sağda, satır işlemleri için bir menü düğmesi bulunur (aşağıya bakınız).

Tablonun altında "Showing {n} of {total} devices." ("{total} cihazdan {n}
tanesi gösteriliyor.") biçiminde bir sayaç metni yer alır. Filtrelere uyan
hiçbir cihaz yoksa, tablo yerine "No devices match your filters." ("Filtrelerinize
uyan cihaz yok.") mesajı görüntülenir.

### Cihaz satır eylemleri (Row actions)

Tablodaki her satırın en sağındaki **üç nokta menüsü (satır işlemleri)**
düğmesine tıkladığınızda aşağıdaki eylemler açılır:

- **Duraklat (Pause) / Etkinleştir (Activate):** Cihaz çevrimiçiyse **Duraklat
  (Pause)**, duraklatılmışsa **Etkinleştir (Activate)** seçeneği görünür ve
  tıklandığında cihaz duraklatılır veya yeniden etkinleştirilir (duraklatılınca
  **Cihaz duraklatıldı (Device paused)**, etkinleştirilince **Cihaz
  etkinleştirildi (Device activated)** bildirimi görünür). **Önemli:** Cihaz
  **çevrimdışı (offline)** ise bu seçenek menüde hiç görünmez; bunun ötesinde,
  bir cihaz çevrimdışıyken bu eylem yine de tetiklenmeye çalışılırsa sistem
  işlemi reddeder ve "Device is offline and can't be changed." ("Cihaz
  çevrimdışı ve değiştirilemez.") mesajını gösterir — çevrimdışı bir cihazın
  duraklatma/etkinleştirme durumu değiştirilemez.
- **Yeniden adlandır (Rename):** Açılan pencerede tek bir alan bulunur:
  **Cihaz adı (Device name)**. Yeni adı girip **Kaydet (Save)** düğmesine
  tıkladığınızda, işlem başarılı olursa **Cihaz yeniden adlandırıldı (Device
  renamed)** bildirimi görünür.
- **Mağazaya taşı (Move to store):** Yalnızca bir mağaza listesi mevcut
  olduğunda menüde görünür. Açılan pencerede **Mağaza (Store)** açılır
  listesinden hedef mağazayı seçip **Taşı (Move)** düğmesine tıklarsınız;
  başarılı olursa **Cihaz taşındı (Device moved)** bildirimi görünür.
- **Atamayı kaldır (Unassign):** Cihazın mağaza atamasını kaldırır ve cihazı
  **çevrimdışı (offline)** durumuna getirir. Başarılı olursa **Cihaz ataması
  kaldırıldı (Device unassigned)** bildirimi görünür.
- **Sil (Delete):** **Yıkıcı (destructive)** bir eylemdir; tıklandığında bir
  onay penceresi açılır: başlık "Delete device?" ("Cihaz silinsin mi?"),
  açıklama "This permanently removes {ad} and its document history. This
  can't be undone." ("Bu, {ad} adlı cihazı ve belge geçmişini (cihazın
  geçmiş aktivasyon kayıtları) kalıcı olarak kaldırır. Bu işlem geri
  alınamaz."). Onaylarsanız cihaz kalıcı olarak
  silinir ve **Cihaz silindi (Device deleted)** bildirimi görünür.

### Cihaz Detayı (Device Detail)

Cihaz Filosu tablosundaki **Device ID** bağlantısına tıkladığınızda, tek bir
cihaza ait ayrıntıları gösteren **Cihaz Detayı (Device Detail)** ekranına
gidersiniz; adresi **`/admin/devices/{deviceId}`**'dir. Belirtilen kimliğe
sahip bir cihaz bulunamazsa ekran **404 (bulunamadı)** hatası döner.

Ekranın en üstünde **Cihaz Filosu**'na dönmenizi sağlayan bir **"← Device
Fleet"** geri bağlantısı bulunur. Başlık, cihazın adıdır; alt açıklama ise
"Printer at {mağaza}" ("{mağaza}'daki yazıcı") biçimindedir.

Ekranda şu bölümler yer alır:

- **KPI kartları:** **Bugünkü aktivasyonlar (Activations today)** ve
  **Bu ayki aktivasyonlar (Activations this month)**.
- **Cihaz ayrıntıları (Device details) kartı:** **Cihaz kimliği (Device
  ID)**, **IP adresi (IP address)**, **Bağlantı (Connection)** (bağlantı
  türü — "Wi-Fi" veya "Ethernet") ve **Ürün yazılımı (Firmware)**
  (`v{sürüm}`; daha yeni bir sürüm varsa yanında "→ v{en yeni sürüm}
  available" ("→ v{en yeni sürüm} mevcut") ibaresi) bilgilerini gösterir.
- **Durum ve yönetim (Status & management) kartı:** **Durum (Status)**
  (etkin/efektif durum), **Müşteri (Customer)** (müşteriye giden bir bağlantı),
  **Mağaza (Store)**, **Son görülme (Last seen)** ve **İşlemler (Actions)**
  (Cihaz Filosu tablosundakiyle **aynı satır eylemleri menüsü** — Duraklat/
  Etkinleştir (Pause/Activate), Yeniden adlandır (Rename), Mağazaya taşı (Move
  to store), Atamayı kaldır (Unassign), Sil (Delete)) satırlarını içerir.

> **Önemli — etkin durum (effective status) kuralı:** Bu ekranda gösterilen
> **Status** değeri, aşağıdaki kurala göre hesaplanır:
> 1. Cihaz **duraklatılmışsa (paused)**, durum her zaman **Paused**'dır
>    (başka hiçbir koşul bunu değiştirmez — duraklatma önceliklidir).
> 2. Duraklatılmamışsa ve cihaz **hiç görülmemişse** ya da **en son görülme
>    zamanının üzerinden 15 dakikadan fazla** geçmişse, durum **Offline**
>    olarak hesaplanır.
> 3. Yukarıdaki iki koşuldan hiçbiri geçerli değilse, durum **Online**'dır.

### Adım adım: Uzaktan komut gönderme

Cihaz Detayı ekranındaki **Uzaktan kontrol (Remote control)** bölümü, dört
düğme içerir: **Yeniden başlat (Reboot)**, **Yapılandırmayı yenile (Refresh
config)**, **Tanımla (Identify)** ve **Ürün yazılımını güncelle (Update
firmware)**.

1. **Uzaktan kontrol (Remote control)** bölümünde, göndermek istediğiniz
   komuta karşılık gelen düğmeye tıklayın: **Yeniden başlat (Reboot)**,
   **Yapılandırmayı yenile (Refresh config)**, **Tanımla (Identify)** veya
   **Ürün yazılımını güncelle (Update firmware)**.
2. Komut sıraya alınır (kuyruğa eklenir); ekranda "{komut} queued — the device
   will pick it up on its next check-in." ("{komut} kuyruğa alındı — cihaz bir
   sonraki bağlantı kontrolünde bunu alacak.") mesajı görünür. Yani komut
   **anında** cihaza iletilmez; cihaz bir sonraki kez sunucuyu yokladığında
   (poll ettiğinde) komutu alır.
3. Gönderdiğiniz komut, bölümün altındaki **komut geçmişi (command history)**
   tablosuna yeni bir satır olarak eklenir. Bu tablonun sütunları: **Komut
   (Command)** (komut türü), **Durum (Status)** ve **Kuyruğa alınma (Queued)**
   (kuyruğa alınma zamanı).

### İpuçları ve dikkat edilecekler

- **Çevrimdışı (Offline)** bir cihazda **Duraklat/Etkinleştir (Pause/Activate)**
  seçeneği menüde hiç görünmez; ayrıca bu eylem yine de tetiklenmeye çalışılırsa
  sistem "Device is offline and can't be changed." ("Cihaz çevrimdışı ve
  değiştirilemez.") mesajıyla reddeder. Bu tür bir cihazın duraklatma durumunu
  değiştirmek isterseniz, önce cihazın çevrimiçi olmasını (görülmesini)
  beklemeniz gerekir.
- **Mağazaya taşı (Move to store)** seçeneği yalnızca uygun bir mağaza listesi
  varsa menüde görünür; hiç mağaza yoksa bu seçeneği göremezsiniz.
- **Atamayı kaldır (Unassign)** işlemi cihazın mağaza bağlantısını kaldırır
  **ve** cihazı çevrimdışı durumuna getirir; bu geri alınabilir bir işlemdir
  (cihazı **Mağazaya taşı (Move to store)** ile tekrar bir mağazaya
  atayabilirsiniz).
- **Sil (Delete)** işlemi **kalıcıdır ve geri alınamaz**; her zaman bir onay
  penceresi ister. Silmeden önce doğru cihazı seçtiğinizden emin olun.
- Cihaz Detayı ekranındaki **etkin durum (effective status)** kuralında,
  **duraklatma (paused) her zaman önceliklidir** — bir cihaz hem
  duraklatılmış hem de 15 dakikadan uzun süredir görülmemiş olsa bile,
  gösterilen durum yine **Paused**'dır, **Offline** değil.
- **Uzaktan kontrol (Remote control)** düğmeleriyle gönderdiğiniz komutlar
  **anında yürütülmez**; cihaz komutu ancak bir sonraki bağlantı kontrolünde
  (poll) alır ve işler. Komutun ne zaman işlendiğini görmek için **komut
  geçmişi (command history)** tablosundaki **Durum (Status)** sütununu kontrol edin.

## 8. Firmware

Bu bölüm, cihazlara yüklenecek ürün yazılımı (firmware) sürümlerini yönetmek
için kullanılan **Ürün yazılımı (Firmware)** ekranını anlatır. Bu ekranın
adresi **`/admin/firmware`**'dir.

### Bu ekran ne işe yarar?

Firmware ekranının başlığı **"Firmware"**, alt açıklaması ise **"Upload a
build (its version must match the binary's CONFIG_DITTO_FW_VERSION). The
newest release is what devices fetch via the OTA manifest."** ("Bir yapı
(build) yükleyin — sürümü, ikili dosyanın CONFIG_DITTO_FW_VERSION değeriyle
eşleşmelidir. En yeni yayın, cihazların OTA bildirimi üzerinden getirdiği
sürümdür.") biçimindedir. Bu ekran, Süper Admin'in yeni bir ürün yazılımı
sürümü **yayımlamasını (publish)**, yayınlanmış sürümleri bir tabloda
görmesini ve gerektiğinde bir sürümü **silmesini** sağlar.

### Ekranda neler var?

Ekranın üst kısmında bir **yayımlama formu (Publish form)** yer alır; hemen
altında ise yayınlanmış sürümleri listeleyen bir **tablo** bulunur (en yeni
**50** sürüm gösterilir).

Tablo sütunları:

- **Sürüm (Version):** Sürüm numarası; en üstteki (en yeni) satırın yanında
  **"(latest)"** ("(en yeni)") ibaresi eklenir.
- **Boyut (Size):** Yayınlanan ikili dosyanın boyutu, KB (kilobayt) cinsinden.
- **SHA-256:** Dosyanın SHA-256 özetinin (hash) ilk 12 karakteri, ardından
  "…" ile kısaltılmış biçimde.
- **Yayınlanma tarihi (Published):** Sürümün yayınlandığı tarih/saat.

Hiç sürüm yayınlanmamışsa, tablo yerine "No releases yet." ("Henüz sürüm
yok.") mesajı görüntülenir.

### Adım adım: Firmware yayımlama

1. Firmware ekranındaki yayımlama formunda **Sürüm (Version)** ("Version (e.g.
   0.3.0-m6b)" — "Sürüm (örn. 0.3.0-m6b)") alanına yayınlamak istediğiniz
   sürüm numarasını girin. Bu alan **zorunludur**.
2. **file** dosya seçme alanından yayınlamak istediğiniz **`.bin`** (ikili)
   dosyasını seçin. Bu alan da **zorunludur**; boş bir dosya veya dosya
   seçilmemesi kabul edilmez.
3. **Firmware yayımla (Publish firmware)** düğmesine tıklayın. İşlem
   sürerken düğme metni **"Publishing…"** ("Yayımlanıyor…") olarak değişir.
4. İşlem başarılı olursa "Published {sürüm}." ("{sürüm} yayınlandı.") mesajı
   görünür ve form sıfırlanır; yeni sürüm tabloya eklenir.

Yayımlama sırasında aşağıdaki kurallar **sistem tarafından** uygulanır ve
bunlardan herhangi biri karşılanmazsa yayımlama reddedilir (bir hata
mesajıyla birlikte):

- **Sürüm (Version)** alanı **zorunludur**; boş bırakılırsa yayımlama
  reddedilir.
- Boş olmayan, geçerli bir **`.bin`** dosyası seçilmiş olmalıdır.
- Dosya boyutu **8 MB'ı aşamaz**; aşarsa yayımlama reddedilir.
- Aynı sürüm numarası **daha önce yayınlanmışsa**, yeni yayımlama girişimi
  reddedilir — "Version {sürüm} is already published." ("{sürüm} sürümü
  zaten yayınlanmış.") mesajı görünür; **yinelenen (duplicate) sürümler
  kabul edilmez.**

> **Önemli — sürüm/CONFIG_DITTO_FW_VERSION eşleşmesi sistem tarafından
> doğrulanmaz:** Girdiğiniz sürüm numarasını, yüklediğiniz `.bin` dosyasının
> derlenmiş **CONFIG_DITTO_FW_VERSION** değeriyle aynı yazmanız gerekir; bunu
> **sizin sağlamanız gerekir** — sistem, `.bin` dosyasının içeriğini
> incelemez ve bu eşleşmeyi otomatik olarak **doğrulamaz**. Sistemin
> yukarıdaki dört kuralın (Sürüm alanı boş olmama, dosya seçilmiş olma,
> 8 MB sınırı, yinelenmeyen sürüm numarası) dışında yaptığı başka bir
> otomatik denetim yoktur.

### Adım adım: Firmware sürümü silme

1. Silmek istediğiniz sürümün satırındaki **Sil (Delete)** düğmesine
   tıklayın.
2. Bir onay penceresi (tarayıcının kendi onay kutusu) açılır; gösterilen
   uyarı, sildiğiniz sürümün **en yeni (latest)** sürüm olup olmamasına göre
   **farklıdır:**
   - Sildiğiniz sürüm **en yeni (latest)** ise: "Delete {sürüm}? It is the
     LATEST release — devices will fall back to the previous release as
     their OTA target." ("{sürüm} silinsin mi? Bu, EN YENİ sürümdür — cihazlar
     OTA hedefi olarak bir önceki sürüme geri döner.")
   - Sildiğiniz sürüm en yeni değilse: "Delete {sürüm}? This permanently
     removes the binary and cannot be undone." ("{sürüm} silinsin mi? Bu,
     ikili dosyayı kalıcı olarak kaldırır ve geri alınamaz.")
3. Onayladığınızda sürüm kalıcı olarak silinir ve tablo satırı kaybolur.
   Vazgeçerseniz onay penceresini iptal ederek işlemi durdurabilirsiniz.

### İpuçları ve dikkat edilecekler

- **En yeni (newest) yayınlanan sürüm, cihazların OTA (kablosuz güncelleme)
  ile hedefleyeceği sürümdür** — yani cihazlar, güncelleme yaparken her
  zaman en son yayımladığınız sürümü çekerler (bkz. Bölüm 2.7).
- Yayımlamadan önce girdiğiniz **Sürüm (Version)** değerinin, yüklediğiniz
  ikili dosyanın **CONFIG_DITTO_FW_VERSION** değeriyle **birebir
  eşleştiğinden** emin olun; bunu doğrulamak **sizin sorumluluğunuzdadır**
  — sistem bu eşleşmeyi otomatik olarak denetlemez. Eşleşmezse cihazlar
  üzerinde tutarsızlık oluşabilir.
- Dosya boyutu sınırını (**8 MB**) aşan bir dosya yüklemeye çalışmayın —
  reddedilir.
- Aynı sürüm numarasını **iki kez** yayımlayamazsınız; her sürüm numarası
  yalnızca bir kez kullanılabilir.
- **En yeni (latest)** bir sürümü silerken dikkatli olun: bu sürümü
  silmek, cihazların OTA hedefinin bir önceki sürüme **geri düşmesine**
  neden olur — uyarı penceresi bunu size özellikle hatırlatır.

## 9. Sistem Sağlığı (Platform Health)

Bu bölüm, platformun genel operasyonel sağlığını tek bir sayfada özetleyen
**Sağlık (Health)** ekranını anlatır. Bu ekranın adresi **`/admin/health`**'tir.

### Bu ekran ne işe yarar?

Sağlık ekranının başlığı **"Platform health"**'tir. Bu ekran, Süper Admin'in
platform genelinde bir sorun olup olmadığını — çevrimdışı kalan cihazlar,
takılı kalmış işlemler, hareketsiz kiracılar gibi — hızlıca görebilmesi için
tasarlanmıştır.

> **Önemli — bu ekran tamamen salt izlemedir (read-only):** Sağlık ekranında
> **hiçbir düğme, form veya düzenleme kontrolü bulunmaz**. Ekrandaki hiçbir
> öğeye tıklayarak bir ayarı değiştiremez, bir cihazı duraklatamaz ya da bir
> uyarıyı kapatamazsınız — bu ekran yalnızca izleme (monitoring) amaçlıdır.
> Bir işlem yapmanız gerekiyorsa (örn. bir cihazı yeniden başlatmak), ilgili
> işlemi **Cihaz Filosu (Device Fleet)** (Bölüm 7) veya **Müşteri Detayı**
> (Bölüm 6) ekranlarından yapmanız gerekir.

### Ekranda neler var?

**Uyarılar şeridi (Alerts banner):** Ekranın en üstünde yer alır. Hiçbir aktif
uyarı yoksa "**All systems nominal.**" ("Tüm sistemler normal.") mesajı
görüntülenir. Aktif uyarı varsa, aşağıdaki uyarı türlerinden biri veya birkaçı
listelenir:

- **Cihaz tazeliği uyarısı (uyarı/warning rengi):** "**{n} device(s) not seen
  in 15+ minutes**" ("{n} cihaz 15+ dakikadır görülmedi") — 15 dakikadan uzun
  süredir kendini bildirmeyen (duraklatılmamış) cihaz sayısını gösterir.
- **Beklemede takılı işlem (tetikleme) uyarısı (uyarı/warning rengi):** "**{n}
  document(s) stuck pending 30+ minutes**" ("{n} beklemede takılı işlem
  (tetikleme), 30+ dakikadır bekliyor") — 30 dakikadan uzun süredir "pending"
  (beklemede) durumunda takılı kalan tetikleme sayısını gösterir.
- **Hareketsiz kiracı uyarısı (bilgi/info rengi):** Son 7 gündür hiç
  aktivasyonu olmayan her kiracı için ayrı bir satır: "**{kiracı adı}: no
  documents in 7 days**" ("{kiracı adı}: 7 gündür aktivasyon yok").
  Hareketsiz kiracı sayısı **5'ten fazla** ise, bu tek tek satırlar yerine
  tek bir özet uyarıya **çöker (collapse)**: "**{n} tenants have no documents
  in 7 days**" ("{n} kiracının 7 gündür aktivasyonu yok") — bu, çok sayıda
  boş kiracısı olan bir platformda uyarı şeridinin aşırı uzamasını önler.

> **Önemli — "document" kelimesi tarihsel bir kalıntıdır:** Yukarıdaki iki
> uyarı örneğinde geçen İngilizce **"document"** kelimesi ("document(s)
> stuck pending 30+ minutes" ve "no documents in 7 days"), sistemin eski
> (belge tabanlı) mimarisinden kalma bir kalıntıdır ve arayüz metni olduğu
> için değiştirilemez. Ditto artık yalnızca tetikleme-modeliyle
> (trigger-only) çalıştığından ve belgeleri kendi sunucularında
> barındırmadığından (bkz. Bölüm 2.1), bu mesajlar aslında depolanan bir
> belgeyi değil, **beklemede takılı bir işlemi (tetikleme)** ya da
> **eksik aktivasyonu** işaret eder.

**Filo güncelliği (Fleet freshness):** Dört KPI kartı içerir: **Cihazlar
(Devices)** (toplam cihaz sayısı), **Çevrimiçi (Online)**, **Duraklatılmış
(Paused)** ve **Eskimiş (15dk+) (Stale (15m+))** (15 dakikadan uzun süredir
görülmeyen cihaz sayısı). Eskimiş cihaz varsa, KPI kartlarının altında bir
**eskimiş cihazlar tablosu** görünür; sütunları **Cihaz (Device)**, **Kiracı
(Tenant)** ve **Son görülme (Last seen)**'dir. Hiç eskimiş cihaz yoksa bu
tablo hiç görüntülenmez.

**Tetikleme etkinliği (Trigger activity):** Üç KPI kartı içerir:
**Aktivasyonlar (1sa) (Activations (1h))**, **Aktivasyonlar (24sa)
(Activations (24h))** ve **Takılı kalmış bekleyenler (Stuck pending)**. Kartların altında
bir alt satır bulunur: "**Last 24h: {n} acked · {n} pending · {n} failed**"
("Son 24 saat: {n} onaylandı (acked) · {n} beklemede (pending) · {n}
başarısız (failed)") — bu, son 24 saatteki tüm tetiklemelerin nihai durumlara
göre dökümünü gösterir.

**Kiracı bazlı kullanım (Per-tenant usage):** İki liste yan yana gösterilir:

- **En çok kullanan kiracılar (24sa) (Top tenants (24h)):** Son 24 saatte en
  çok aktivasyon yapan kiracıları listeler. Hiç aktivasyon yoksa "**No
  activations in the last 24h.**" ("Son 24 saatte hiç aktivasyon yok.")
  mesajı görüntülenir.
- **Hareketsiz kiracılar (7g+) (Inactive (7d+)):** Son 7 gündür hiç
  aktivasyonu olmayan kiracıları listeler. Tüm kiracılar aktifse "**All
  tenants active.**" ("Tüm kiracılar aktif.") mesajı görüntülenir.

**Uyarı geçmişi (Alert history):** İki liste içerir:

- **Açık (Open):** Şu anda açık (çözülmemiş) uyarıları listeler. Hiç açık
  uyarı yoksa "**No open alerts.**" ("Açık uyarı yok.") mesajı görüntülenir.
- **Çözülenler (7g) (Resolved (7d)):** Son 7 gün içinde çözülmüş uyarıları
  listeler. Hiç çözülmüş uyarı yoksa "**Nothing resolved recently.**" ("Son
  zamanlarda hiçbir şey çözülmedi.") mesajı görüntülenir.

### İpuçları ve dikkat edilecekler

- Bu ekran **tamamen salt görüntülemedir**; herhangi bir düğme veya form
  aramayın — burada hiçbiri yoktur.
- Uyarı eşiklerini birbirinden ayırt edin: **cihaz tazeliği** 15 dakika,
  **beklemede takılı işlem (tetikleme)** 30 dakika, **hareketsiz kiracı**
  7 gün eşiğini kullanır — üçü de farklı sürelerdir.
- Hareketsiz kiracı sayısı **5'i aştığında**, uyarı şeridinde kiracı adları
  tek tek görünmez; bunun yerine tek bir toplu sayı (örn. "7 tenants have no
  documents in 7 days") gösterilir. Belirli bir kiracının durumunu görmek
  isterseniz **Per-tenant usage** bölümündeki **Inactive (7d+)** listesine
  veya **Müşteriler (Customers)** ekranına (Bölüm 5) bakın.
- **Fleet freshness** altındaki eskimiş cihazlar tablosu, yalnızca eskimiş
  cihaz **varsa** görünür; hiç eskimiş cihaz yoksa bu bölümde KPI kartlarının altında
  hiçbir tablo görüntülenmez.

## 10. Faturalandırma & Krediler (Billing & Credits)

Bu bölüm, platform genelindeki ön ödemeli kredi satışlarını, tüketimini ve
kiracı bazlı bakiyeleri gösteren ekranı anlatır. Bu ekranın adresi
**`/admin/billing`**'dir.

### Bu ekran ne işe yarar?

> **Önemli — sol menü etiketi ile ekran başlığı farklıdır:** Sol taraftaki
> gezinme menüsünde bu ekrana giden bağlantı **"Faturalandırma ve Gelir
> (Billing & Revenue)"** olarak etiketlenir (bkz. Bölüm 3.4). Ancak bu
> bağlantıya tıkladığınızda ulaştığınız ekranın **kendi başlığı farklıdır:
> "Billing & Credits"**. Bu bir hata değildir, ama kılavuzu okurken kafanızın
> karışmaması için baştan belirtiyoruz: sol menüdeki "**Billing & Revenue**"
> ile ekranın üstünde gördüğünüz "**Billing & Credits**" başlığı, **aynı
> ekranı** ifade eden iki farklı isimdir.

Ekranın alt açıklaması **"Platform-wide prepaid credit sales, consumption,
and per-tenant balances."** ("Platform genelinde ön ödemeli kredi satışları,
tüketimi ve kiracı bazlı bakiyeler.") biçimindedir. Bu ekran, Süper Admin'in
platformdaki kredi ekonomisinin genel durumunu görmesini ve kiracı bazlı
kredi verilerini dışa aktarmasını (export) sağlar.

### Ekranda neler var?

Ekranın sağ üst köşesinde bir **Kiracıları dışa aktar (Export tenants)**
düğmesi bulunur (aşağıdaki adım adım bölümüne bakınız).

Üç **KPI kartı** yer alır:

1. **Satılan krediler (Credits sold):** İpucu metni "lifetime, all tenants"
   ("tüm zamanlar, tüm kiracılar") — platform genelinde bugüne kadar satılan
   toplam kredi miktarı.
2. **Tüketilen krediler (Credits consumed):** İpucu metni "lifetime, all
   tenants" — platform genelinde bugüne kadar harcanan toplam kredi miktarı.
3. **Ödenmemiş yükümlülük (Outstanding liability):** İpucu metni "unspent
   credits owed to tenants" ("kiracılara borçlu olunan harcanmamış
   krediler") — henüz harcanmamış, kiracıların hâlâ kullanabileceği toplam
   kredi miktarı.

KPI kartlarının altında **Kiracı bazlı krediler (Per-tenant credits)**
başlıklı bir tablo kartı bulunur; açıklaması "Balance, consumption this
month, and lifetime purchases" ("Bakiye, bu ayki tüketim ve tüm zamanlar
satın alımlar") biçimindedir. Sütunları:

- **Müşteri (Customer):** Tıklanabilir bir bağlantıdır; ilgili müşterinin
  ayrıntı sayfasına (**`/admin/customers/{id}`**, bkz. Bölüm 6) götürür.
- **Bakiye (Balance):** Kiracının o anki kullanılabilir kredi bakiyesi.
- **Tüketilen (ay) (Consumed (mo.)):** Kiracının bu ay tükettiği kredi
  miktarı.
- **Tüm zamanlar satın alınan (Lifetime purchased):** Kiracının bugüne
  kadar satın aldığı toplam kredi miktarı.

Kredi hareketi olan hiçbir kiracı yoksa, tablo yerine "**No tenants with
credit activity yet.**" ("Henüz kredi hareketi olan kiracı yok.") mesajı
görüntülenir.

### Adım adım: Kiracı kredilerini dışa aktarma (Export)

1. Faturalandırma & Krediler ekranının sağ üst köşesindeki **Kiracıları
   dışa aktar (Export tenants)** düğmesine tıklayın.
2. Düğmeye tıklandığı anda, herhangi bir onay penceresi açılmadan, tarayıcınız
   **`ditto-credits.csv`** adlı bir CSV dosyasını doğrudan indirir. Dosyanın
   sütun başlıkları sırasıyla **Customer**, **Balance**, **Consumed (mo.)**
   ve **Lifetime purchased**'dır; her satır, o anda **Kiracı bazlı krediler
   (Per-tenant credits)** tablosunda görünen bir kiracıya karşılık gelir.
3. İndirme tamamlandığında ekranda "**Export ready**" ("Dışa aktarma hazır")
   başlıklı bir bildirim (toast) belirir; açıklama satırında "**{n} rows →
   ditto-credits.csv**" ("{n} satır → ditto-credits.csv") biçiminde kaç
   satırın dışa aktarıldığı gösterilir.
4. İndirilen `ditto-credits.csv` dosyasını, bilgisayarınızdaki bir tablolama
   programıyla (örn. Excel, Google E-Tablolar) açarak inceleyebilirsiniz.

### İpuçları ve dikkat edilecekler

- Sol menüdeki **"Billing & Revenue"** bağlantısı ile bu ekranın kendi
  başlığı olan **"Billing & Credits"** arasındaki isim farkını unutmayın —
  ikisi de aynı ekranı işaret eder.
- **Bakiye (Balance)**, **Tüketilen (ay) (Consumed (mo.))** ve **Tüm zamanlar
  satın alınan (Lifetime purchased)** sütunlarını birbirine karıştırmayın:
  Bakiye o anki kullanılabilir miktardır, Consumed (mo.) yalnızca bu ayki
  tüketimdir, Lifetime purchased ise kiracının bugüne kadar satın aldığı
  toplam miktardır.
- **Müşteri (Customer)** sütunundaki isimler birer bağlantıdır; bir kiracının
  ayrıntılarına (kredi yükleme dahil, bkz. Bölüm 6) hızlıca gitmek için
  bunlara tıklayabilirsiniz.
- **Kiracıları dışa aktar (Export tenants)** düğmesi, ekranda o an görünen
  **Kiracı bazlı krediler** tablosunun tam bir kopyasını indirir; ekranda
  herhangi bir filtre bulunmadığından, dışa aktarılan dosya her zaman kredi
  hareketi olan **tüm** kiracıları içerir.

## 11. Rozetler ve Göstergeler (Referans)

Bu bölüm, kılavuz boyunca karşınıza çıkan renkli rozet ve göstergeleri tek
bir referans tablosunda toplar. Her rozetin nerede kullanıldığı, önceki
bölümlerde (5, 6, 7, 10) ayrıca anlatılmıştır; burada yalnızca hızlı bir
başvuru kaynağı olarak özetlenir.

### 11.1 Kiracı durumu (Tenant status)

Bu rozet **Müşteriler (Customers)** (Bölüm 5) ve **Müşteri Detayı**
(Bölüm 6) ekranlarında görünür:

| Değer | Renk | Anlamı |
|---|---|---|
| **Aktif (Active)** | Yeşil | Kiracının hesabı normal şekilde aktif kullanımdadır. |
| **Deneme (Trial)** | Mor | Kiracı, deneme (trial) süreci içindedir. |
| **Askıya alınmış (Suspended)** | Kırmızı | Kiracının hesabı askıya alınmıştır. |

> **Önemli — askıya alma/yeniden etkinleştirme düğmesi yoktur:** **Askıya
> alınmış (Suspended)** durumu ekranlarda bir rozet olarak **görüntülenir**,
> ancak Ditto Admin arayüzünün **hiçbir yerinde** bir kiracıyı askıya almak
> (Suspend) veya askıdan çıkarıp yeniden etkinleştirmek (Reactivate) için bir
> **düğme veya işlem bulunmaz**. Bir kiracı denetim (Activity) geçmişinde
> "askıya alındı"/"yeniden etkinleştirildi" türü kayıtlar görülebilir, ancak
> bunlar yalnızca geçmiş kayıtlardır — bu durumu Süper Admin panelinden siz
> **tetikleyemezsiniz**. Bu, eksik bir özellik değil, mevcut arayüzün bir
> sınırıdır; bu kılavuzda var olmayan bir düğmeyi aramayın.

### 11.2 Cihaz durumu (Device status)

Bu rozet **Cihaz Filosu** (Bölüm 7), **Cihaz Detayı** (Bölüm 7) ve **Müşteri
Detayı**'ndaki (Bölüm 6) atanmış cihazlar tablosunda görünür:

| Değer | Renk | Anlamı |
|---|---|---|
| **Çevrimiçi (Online)** | Yeşil (bazı yerlerde nabız/pulse animasyonlu) | Cihaz şu anda ulaşılabilir ve tetiklemeye hazırdır. |
| **Çevrimdışı (Offline)** | Gri | Cihaza ulaşılamıyor. |
| **Duraklatılmış (Paused)** | Amber (turuncu-sarı) | Cihaz kasıtlı olarak duraklatılmıştır. |

**Etkin durum (effective status)** aşağıdaki öncelik sırasına göre
hesaplanır (bkz. Bölüm 7, Cihaz Detayı):

1. Cihaz **duraklatılmışsa (paused)**, gösterilen durum her zaman
   **Duraklatılmış (Paused)**'dır — bu her koşulda önceliklidir.
2. Duraklatılmamışsa ve cihaz hiç görülmemişse ya da son görülmesinin
   üzerinden **15 dakikadan fazla** geçmişse, durum **Çevrimdışı
   (Offline)** olur.
3. Yukarıdaki iki durum da geçerli değilse, durum **Çevrimiçi (Online)**'dır.

### 11.3 Müşteri sağlığı (Customer/tenant health)

Bu gösterge **Müşteriler** (Bölüm 5) ve **Müşteri Detayı**'nda (Bölüm 6)
görünür; her zaman çevrimiçi/toplam cihaz sayısıyla (`online/total`, örn.
"(4/6)") birlikte gösterilir:

| Değer | Renk | Anlamı |
|---|---|---|
| **Sağlıklı (Healthy)** | Yeşil | Kiracının cihaz filosu sorunsuz çalışıyor. |
| **Uyarı (Warning)** | Amber (turuncu-sarı) | Filoda kısmi bir sorun var (örn. bazı cihazlar çevrimdışı, takılı kalmış işlemler veya uzun süredir hareketsizlik). |
| **Kritik (Critical)** | Kırmızı | Filodaki hiçbir cihaza ulaşılamıyor. |

### 11.4 Ürün yazılımı güncelleme rozeti (Firmware update pill)

Bu **amber (turuncu-sarı)** renkli küçük rozet, **Cihaz Filosu** (Bölüm 7)
tablosunda ve **Cihaz Detayı**'ndaki (Bölüm 7) ürün yazılımı bilgisinin
yanında görünür. Bir cihazın o an çalıştırdığı ürün yazılımı sürümü,
**Ürün Yazılımı (Firmware)** ekranında (Bölüm 8) yayınlanmış **en yeni
(latest)** sürümden farklıysa görüntülenir; cihazın yeni bir sürüme OTA ile
güncellenebileceğini belirtir.

### İpuçları ve dikkat edilecekler

- **Kiracı durumu (Tenant status)** ile **Müşteri sağlığı (Customer health)**
  farklı kavramlardır: biri hesabın ticari/idari durumunu, diğeri cihaz
  filosunun teknik durumunu gösterir (bkz. Bölüm 5).
- **Askıya alınmış (Suspended)** rozetini gördüğünüzde, bunu değiştirebilecek
  bir düğme aramayın — arayüzde böyle bir kontrol **yoktur** (bkz. 11.1).
- **Etkin durum (effective status)** hesaplamasında **duraklatma her zaman
  önceliklidir** — bir cihaz hem duraklatılmış hem de uzun süredir
  görülmemiş olsa bile gösterilen durum **Paused**'dır, **Offline** değil.

## 12. Sözlük (Terimler)

Bu bölüm, kılavuz boyunca kullanılan temel terimleri kısaca tanımlar.

- **Kiracı (Tenant / Organization):** Ditto'yu kullanan bir müşteri firma;
  sistemde bir "organizasyon" olarak temsil edilir. Her kiracının kendi
  mağazaları, cihazları ve kullanıcıları vardır (bkz. Bölüm 2.2).
- **Süper Admin (platform_admin):** Herhangi bir kiracıya üye olmadan, tüm
  platformu yönetme yetkisine sahip kullanıcı rolü; kullanıcının kendi
  hesabında tanımlı, kiracıdan bağımsız bir yetkidir (bkz. Bölüm 2.3).
- **Kredi (Credit):** Ditto'nun ön ödemeli ücretlendirme biriminde,
  başarıyla tamamlanan her tetiklemenin (activation) kiracıya mal olduğu
  birim; başarılı bir tetikleme 1 krediye mal olur (bkz. Bölüm 2.6).
- **Tetikleme (Trigger):** Yetkilendirilmiş bir çağıran tarafın, bir cihazda
  belirli bir URL'nin QR kodunun gösterilmesini istediği API isteği
  (bkz. Bölüm 2.5).
- **Aktivasyon (Activation):** Bir tetiklemenin cihaz tarafından başarıyla
  işlenip müşteriye QR kodun gösterilmesiyle sonuçlanan tamamlanmış işlem;
  KPI kartlarında ve grafiklerde sayılan birimdir.
- **Cihaz / Yazıcı (Device / Printer):** Müşteriye taranacak QR kodu
  ekranında gösteren fiziksel donanım; Ditto'da "cihaz" olarak anılsa da
  aslında bir yazıcıdır (bkz. Bölüm 2.4).
- **Eşleştirme kodu (Pairing code):** Yeni sağlanan bir cihaza fiziksel
  olarak girilen, cihazı ilgili kiracı/mağazaya bağlayan tek kullanımlık
  kod; cihaz bu kodla eşleşene kadar çevrimdışı (offline) görünür
  (bkz. Bölüm 6, Cihaz sağlama).
- **Ürün yazılımı / OTA (Firmware / OTA):** Cihazların çalıştırdığı,
  uzaktan (kablosuz) güncellenebilen yazılım; OTA (Over-The-Air), bu
  güncellemenin kablosuz olarak iletilmesi anlamına gelir (bkz. Bölüm 2.7,
  Bölüm 8).
- **Kredi defteri (Ledger):** Bir kiracının kredi hesabındaki her hareketin
  (yükleme, rezervasyon, kesin düşüm, serbest bırakma) kaydedildiği hareket
  dökümü tablosu (bkz. Bölüm 6, Krediler kartı).
- **Etkin durum (Effective status):** Bir cihazın ham (kaydedilmiş)
  durumundan bağımsız olarak, duraklatma ve son görülme zamanına göre
  hesaplanan, o an ekranda gösterilen fiili durum (bkz. Bölüm 7 ve 11.2).
- **Takılı kalmış, bekleyen (Stuck pending):** Belirlenen süre eşiğini
  (30 dakika) aşmasına rağmen hâlâ "beklemede (pending)" durumunda kalmış,
  tamamlanmamış bir işlem (bkz. Bölüm 9).

## 13. Sık Sorulanlar / Sorun Giderme

**Bir cihaz neden "Çevrimdışı (Offline)" görünüyor?**
Bir cihaz, ya hiç görülmemişse ya da en son görülme zamanının üzerinden
**15 dakikadan fazla** geçmişse "Çevrimdışı (Offline)" olarak gösterilir
(bkz. Bölüm 7 ve 11.2, effective status kuralı). Cihaz ayrıca **duraklatılmış
(Paused)** durumdaysa, kaç dakika görülmediğine bakılmaksızın durum her
zaman "Paused" olarak gösterilir — "Paused" bir cihaz asla "Offline" olarak
görünmez.

**Bir kiracıya nasıl kredi yüklenir?**
**Müşteriler (Customers)** ekranından (Bölüm 5) ilgili kiracıya tıklayarak
**Müşteri Detayı (Customer Detail)** sayfasına gidin (Bölüm 6). Buradaki
**Krediler (Credits)** kartındaki **Kredi yükleme formu (Grant credits)**
alanına yüklemek istediğiniz miktarı (1 ile 1.000.000 arasında bir tam sayı)
girip **Grant credits** düğmesine tıklayın (ayrıntılı adımlar için bkz.
Bölüm 6, "Adım adım: Kredi yükleme").

**Bir ürün yazılımı (firmware) güncellemesi cihaza ne zaman ulaşır?**
Anında ulaşmaz. **Ürün Yazılımı (Firmware)** ekranında (Bölüm 8) yeni bir
sürüm yayınladığınızda, bu sürüm yalnızca cihazların **bir sonraki bağlantı
kontrolünde (check-in / poll)** OTA hedefi olarak görülür; cihaz kendi
yoklama (polling) döngüsünde sunucuya bağlandığında yeni sürümü fark eder ve
güncellemeyi indirir. Aynı şekilde, **Cihaz Detayı** ekranındaki (Bölüm 7)
**Ürün yazılımını güncelle (Update firmware)** komutu da anında değil,
cihazın bir sonraki check-in'inde işlenir.

**Neden bir kiracıyı askıya alamıyorum (veya askıdan çıkaramıyorum)?**
Çünkü Ditto Admin arayüzünde bunu yapacak bir düğme veya işlem
**bulunmamaktadır**. **Askıya alınmış (Suspended)** durumu ekranlarda bir
rozet olarak görüntülenir (bkz. Bölüm 11.1) ve denetim (Activity) geçmişinde
bu yöndeki geçmiş kayıtlara rastlayabilirsiniz, ancak Süper Admin panelinden
bir kiracının durumunu askıya alma veya yeniden etkinleştirme yönünde
değiştirebileceğiniz herhangi bir kontrol yoktur. Bu, kılavuzun bir eksikliği
değil, uygulamanın mevcut arayüzünün bir sınırıdır.
