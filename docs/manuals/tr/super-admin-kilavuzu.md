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

#### Adım adım: Giriş yapma

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

1. **Bu ay yapılan tetiklemeler (Activations this month):** Bu ay platform
   genelinde gerçekleşen toplam tetikleme (activation) sayısını gösterir; ipucu
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
içinde tetiklemeler (Activations over time)**. Bu kart "Monthly activations,
all customers" ("Tüm müşteriler için aylık tetiklemeler") açıklamasıyla, bir
**alan grafiği (area chart)** üzerinde tetiklemelerin zaman içindeki seyrini
gösterir.

Grafiğin altında iki **tablo kartı (table card)** bulunur:

- **En çok tetikleme yapan müşteriler (Top customers):** "By activations this
  month" ("Bu ayki tetiklemelere göre") açıklamasıyla, en çok tetikleme yapan
  müşterileri listeler. Sütunları: **Müşteri (Customer)**, **Mağazalar
  (Stores)**, **Cihazlar (Devices)**, **Tetiklemeler (Activations)**. Tablodaki
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

1. **En çok tetikleme yapan müşteriler (Top customers)** kartındaki listede,
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
- **Bu ay yapılan tetiklemeler (Activations this month)** kartındaki
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
- **Tetiklemeler (ay) (Activations (mo.)):** O müşterinin bu ayki toplam
  tetikleme sayısı.
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

**Başlık kartı (Header card):** Müşterinin adını ve hesap **durum rozetini
(status badge** — bkz. Bölüm 5, **Durum (Status)** sütunu: Aktif/Deneme/
Askıya alınmış) gösterir. Altında iki iletişim bilgisi yer alır: **e-posta
adresi** (bir zarf simgesiyle, **Mail**) ve **telefon numarası** (bir ahize
simgesiyle, **Phone**). Kartın sağında **Şube ekle (Add branch)** düğmesi
bulunur.

**Sağlık özeti şeridi (Health summary strip):** Renkli bir nokta ve bir
seviye etiketiyle müşterinin cihaz filosunun genel sağlığını gösterir —
**Sağlıklı (Healthy)**, **Uyarı (Warning)** veya **Kritik (Critical)** (bkz.
Bölüm 5). Bunun yanında dört sayaç yer alır: **Çevrimiçi (Online)**,
**Çevrimdışı (Offline)**, **Duraklatılmış (Paused)** ve **Takılı kalmış,
bekleyen (Stuck pending)**.

**KPI kartları:** Üç kart yer alır: **Mağazalar (Stores)**, **Cihazlar
(Devices)** ve **Bu ay yapılan tetiklemeler (Activations this month)**.

**Grafik kartı — Mağazaya göre tetiklemeler (Activations by store):** "This
month, per branch" ("Bu ay, şubeye göre") açıklamasıyla, her şubenin bu ayki
tetikleme sayısını **yatay çubuk grafik (horizontal bar chart)** olarak
gösterir.

**Krediler kartı (Credits card):** Başlığın altında müşterinin güncel kredi
durumu özetlenir: **Available:** (kullanılabilir kredi) {n} ve **Held:**
(rezerve/tutulan kredi) {n}. Bu kartın içinde iki bölüm bulunur:

- **Kredi yükleme formu (Grant credits):** **Credits** (sayı, zorunlu, en az
  1 en çok 1.000.000, yer tutucu "e.g. 100") ve **Note (optional)** (isteğe
  bağlı not, yer tutucu "e.g. promotional grant") alanlarından oluşur;
  gönder düğmesi **Grant credits** ("Granting…" durumuna geçer). Başarılı
  olursa "Credits granted." ("Kredi yüklendi.") mesajı görünür; geçersiz bir
  miktar girilirse "Enter a whole credit amount between 1 and 1,000,000."
  ("1 ile 1.000.000 arasında tam sayı bir kredi miktarı girin.") hata mesajı
  görünür.
- **Kredi hareket dökümü (ledger) tablosu:** Kayıt varsa şu sütunlarla
  listelenir: **Kind** (hareket türü), **Credits** (miktar), **Device**
  (ilgili cihaz varsa), **Note** (not) ve **Time** (zaman). Hiç kayıt yoksa
  "No ledger entries yet." ("Henüz kredi hareketi yok.") mesajı gösterilir.

**Atanmış cihazlar kartı (Assigned devices card):** Başlığın altında "{N}
printers across all stores" ("Tüm mağazalarda {N} yazıcı") açıklaması,
sağ üstte ise **Cihaz ekle (Add device)** düğmesi bulunur. Tablo sütunları:
**Device** (cihaz kimliği), **Store** (mağaza), **Status** (durum, bir renkli
nokta ile), **Last seen** (son görülme), **Activations (mo.)** (bu ayki
tetiklemeler) ve en sağda her satır için bir **satır işlemleri menüsü
(row-actions menu)**.

**Etkinlik (Activity) bölümü:** Bu müşteriye ait en fazla **50** denetim
(audit) olayını, insan tarafından okunabilir etiketlerle listeler — örneğin
"Customer created" ("Müşteri oluşturuldu"), "Device provisioned" ("Cihaz
sağlandı"), "Credits granted" ("Kredi yüklendi"), "Device paused/resumed"
("Cihaz duraklatıldı/devam ettirildi"). Hiç etkinlik yoksa "No activity yet."
("Henüz etkinlik yok.") mesajı gösterilir.

### Adım adım: Kredi yükleme (Grant credits)

1. Müşteri Detayı ekranında **Krediler (Credits)** kartına gidin.
2. **Credits** alanına yüklemek istediğiniz kredi miktarını girin — bu alan
   **zorunludur** ve **1 ile 1.000.000 arasında bir tam sayı** olmalıdır
   (yer tutucu: "e.g. 100").
3. İsterseniz **Note (optional)** alanına bu yüklemeyle ilgili bir açıklama
   yazın (örn. "promotional grant" — "promosyon amaçlı yükleme").
4. **Grant credits** düğmesine tıklayın. İşlem sürerken düğme metni
   **"Granting…"** ("Yükleniyor…") olarak değişir.
5. İşlem başarılı olursa "Credits granted." ("Kredi yüklendi.") mesajı
   görünür ve **Available** (kullanılabilir) bakiye güncellenir. Girdiğiniz
   miktar 1–1.000.000 aralığı dışındaysa veya tam sayı değilse, "Enter a
   whole credit amount between 1 and 1,000,000." hata mesajı görünür ve
   yükleme gerçekleşmez.
6. Başarılı her yükleme, kartın altındaki **kredi hareket dökümü (ledger)**
   tablosuna yeni bir satır olarak eklenir; bu satırda hareketin türü
   (**Kind**), miktarı (**Credits**), ilişkili cihaz varsa **Device**,
   yazdığınız not (**Note**) ve zamanı (**Time**) görüntülenir.

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
