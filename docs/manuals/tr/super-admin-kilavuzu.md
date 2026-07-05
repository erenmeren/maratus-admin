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

- **Device ID (Cihaz kimliği):** Tıklanabilir bir bağlantıdır; ilgili
  cihazın **Cihaz Detayı (Device Detail)** sayfasına
  (**`/admin/devices/{id}`**) götürür.
- **Customer (Müşteri):** Cihazın bağlı olduğu müşteri (kiracı).
- **Store (Mağaza):** Cihazın bağlı olduğu mağaza.
- **Status (Durum):** Renkli bir nokta ile birlikte cihazın durumu
  (Online/Paused/Offline).
- **Last seen (Son görülme):** Cihazın en son ne zaman görüldüğü.
- **Firmware (Ürün yazılımı):** `v{sürüm}` biçiminde geçerli ürün yazılımı
  sürümü. Cihazın sürümünden daha yeni bir yayınlanmış sürüm varsa, sürümün
  yanında **amber (turuncu-sarı) renkli bir "update" ("güncelleme")
  rozeti** görünür.
- **Activations (mo.) (Tetiklemeler (ay)):** Cihazın bu ayki toplam
  tetikleme sayısı.
- En sağda, satır işlemleri için bir menü düğmesi bulunur (aşağıya bakınız).

Tablonun altında "Showing {n} of {total} devices." ("{total} cihazdan {n}
tanesi gösteriliyor.") biçiminde bir sayaç metni yer alır. Filtrelere uyan
hiçbir cihaz yoksa, tablo yerine "No devices match your filters." ("Filtrelerinize
uyan cihaz yok.") mesajı görüntülenir.

### Cihaz satır eylemleri (Row actions)

Tablodaki her satırın en sağındaki **üç nokta (More)** menü düğmesine
tıkladığınızda aşağıdaki eylemler açılır:

- **Pause (Duraklat) / Activate (Etkinleştir):** Cihaz çevrimiçiyse **Pause**,
  duraklatılmışsa **Activate** seçeneği görünür ve tıklandığında durum
  karşılıklı olarak değişir (Duraklatılınca "Device paused" ["Cihaz
  duraklatıldı"], etkinleştirilince "Device activated" ["Cihaz etkinleştirildi"]
  bildirimi görünür). **Önemli:** Cihaz **çevrimdışı (offline)** ise bu seçenek
  menüde hiç görünmez — çevrimdışı bir cihazın duraklatma/etkinleştirme durumu
  değiştirilemez.
- **Rename (Yeniden adlandır):** Açılan pencerede tek bir alan bulunur:
  **Device name (Cihaz adı)**. Yeni adı girip **Save (Kaydet)** düğmesine
  tıkladığınızda, işlem başarılı olursa "Device renamed" ("Cihaz yeniden
  adlandırıldı") bildirimi görünür.
- **Move to store (Mağazaya taşı):** Yalnızca bir mağaza listesi mevcut
  olduğunda menüde görünür. Açılan pencerede **Store (Mağaza)** açılır listesinden
  hedef mağazayı seçip **Move (Taşı)** düğmesine tıklarsınız; başarılı olursa
  "Device moved" ("Cihaz taşındı") bildirimi görünür.
- **Unassign (Atamayı kaldır):** Cihazın mağaza atamasını kaldırır ve cihazı
  **çevrimdışı (offline)** durumuna getirir. Başarılı olursa "Device unassigned"
  ("Cihaz ataması kaldırıldı") bildirimi görünür.
- **Delete (Sil):** **Yıkıcı (destructive)** bir eylemdir; tıklandığında bir
  onay penceresi açılır: başlık "Delete device?" ("Cihaz silinsin mi?"),
  açıklama "This permanently removes {ad} and its document history. This
  can't be undone." ("Bu, {ad} adlı cihazı ve belge geçmişini kalıcı olarak
  kaldırır. Bu işlem geri alınamaz."). Onaylarsanız cihaz kalıcı olarak
  silinir ve "Device deleted" ("Cihaz silindi") bildirimi görünür.

### Cihaz Detayı (Device Detail)

Cihaz Filosu tablosundaki **Device ID** bağlantısına tıkladığınızda, tek bir
cihaza ait ayrıntıları gösteren **Cihaz Detayı (Device Detail)** ekranına
gidersiniz; adresi **`/admin/devices/{deviceId}`**'dir. Belirtilen kimliğe
sahip bir cihaz bulunamazsa ekran **404 (bulunamadı)** hatası döner.

Ekranın en üstünde **Cihaz Filosu**'na dönmenizi sağlayan bir **"← Device
Fleet"** geri bağlantısı bulunur. Başlık, cihazın adıdır; alt açıklama ise
"Printer at {mağaza}" ("{mağaza}'daki yazıcı") biçimindedir.

Ekranda şu bölümler yer alır:

- **KPI kartları:** **Activations today** (Bugünkü tetiklemeler) ve
  **Activations this month** (Bu ayki tetiklemeler).
- **Cihaz ayrıntıları (Device details) kartı:** **Device ID** (cihaz
  kimliği), **IP address** (IP adresi), **Connection** (bağlantı türü —
  "Wi-Fi" veya "Ethernet") ve **Firmware** (`v{sürüm}`; daha yeni bir sürüm
  varsa yanında "→ v{en yeni sürüm} available" ["→ v{en yeni sürüm}
  mevcut"] ibaresi) bilgilerini gösterir.
- **Durum ve yönetim (Status & management) kartı:** **Status** (etkin/efektif
  durum), **Customer** (müşteriye giden bir bağlantı), **Store** (mağaza),
  **Last seen** (son görülme) ve **Actions** (Cihaz Filosu tablosundakiyle
  **aynı satır eylemleri menüsü** — Pause/Activate, Rename, Move to store,
  Unassign, Delete) satırlarını içerir.

> **Önemli — etkin durum (effective status) kuralı:** Bu ekranda gösterilen
> **Status** değeri, aşağıdaki kurala göre hesaplanır:
> 1. Cihaz **duraklatılmışsa (paused)**, durum her zaman **Paused**'dır
>    (başka hiçbir koşul bunu değiştirmez — duraklatma önceliklidir).
> 2. Duraklatılmamışsa ve cihaz **hiç görülmemişse** ya da **en son görülme
>    zamanının üzerinden 15 dakikadan fazla** geçmişse, durum **Offline**
>    olarak hesaplanır.
> 3. Yukarıdaki iki koşuldan hiçbiri geçerli değilse, durum **Online**'dır.

### Adım adım: Uzaktan komut gönderme

Cihaz Detayı ekranındaki **Remote control** ("Uzaktan kontrol") bölümü, dört
düğme içerir: **Reboot** (Yeniden başlat), **Refresh config** (Yapılandırmayı
yenile), **Identify** (Tanımla) ve **Update firmware** (Ürün yazılımını
güncelle).

1. **Remote control** bölümünde, göndermek istediğiniz komuta karşılık gelen
   düğmeye tıklayın: **Reboot**, **Refresh config**, **Identify** veya
   **Update firmware**.
2. Komut sıraya alınır (kuyruğa eklenir); ekranda "{komut} queued — the device
   will pick it up on its next check-in." ("{komut} kuyruğa alındı — cihaz bir
   sonraki bağlantı kontrolünde bunu alacak.") mesajı görünür. Yani komut
   **anında** cihaza iletilmez; cihaz bir sonraki kez sunucuyu yokladığında
   (poll ettiğinde) komutu alır.
3. Gönderdiğiniz komut, bölümün altındaki **komut geçmişi (command history)**
   tablosuna yeni bir satır olarak eklenir. Bu tablonun sütunları: **Command**
   (komut türü), **Status** (durum) ve **Queued** (kuyruğa alınma zamanı).

### İpuçları ve dikkat edilecekler

- **Çevrimdışı (Offline)** bir cihazda **Pause/Activate** seçeneği menüde hiç
  görünmez; bu tür bir cihazın duraklatma durumunu değiştirmek isterseniz,
  önce cihazın çevrimiçi olmasını (görülmesini) beklemeniz gerekir.
- **Move to store (Mağazaya taşı)** seçeneği yalnızca uygun bir mağaza listesi
  varsa menüde görünür; hiç mağaza yoksa bu seçeneği göremezsiniz.
- **Unassign (Atamayı kaldır)** işlemi cihazın mağaza bağlantısını kaldırır
  **ve** cihazı çevrimdışı durumuna getirir; bu geri alınabilir bir işlemdir
  (cihazı **Move to store** ile tekrar bir mağazaya atayabilirsiniz).
- **Delete (Sil)** işlemi **kalıcıdır ve geri alınamaz**; her zaman bir onay
  penceresi ister. Silmeden önce doğru cihazı seçtiğinizden emin olun.
- Cihaz Detayı ekranındaki **etkin durum (effective status)** kuralında,
  **duraklatma (paused) her zaman önceliklidir** — bir cihaz hem
  duraklatılmış hem de 15 dakikadan uzun süredir görülmemiş olsa bile,
  gösterilen durum yine **Paused**'dır, **Offline** değil.
- **Remote control** düğmeleriyle gönderdiğiniz komutlar **anında
  yürütülmez**; cihaz komutu ancak bir sonraki bağlantı kontrolünde (poll)
  alır ve işler. Komutun ne zaman işlendiğini görmek için **komut geçmişi
  (command history)** tablosundaki **Status** sütununu kontrol edin.

## 8. Firmware

Bu bölüm, cihazlara yüklenecek ürün yazılımı (firmware) sürümlerini yönetmek
için kullanılan **Firmware (Ürün Yazılımı)** ekranını anlatır. Bu ekranın
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

- **Version (Sürüm):** Sürüm numarası; en üstteki (en yeni) satırın yanında
  **"(latest)"** ("(en yeni)") ibaresi eklenir.
- **Size (Boyut):** Yayınlanan ikili dosyanın boyutu, KB (kilobayt) cinsinden.
- **SHA-256:** Dosyanın SHA-256 özetinin (hash) ilk 12 karakteri, ardından
  "…" ile kısaltılmış biçimde.
- **Published (Yayınlanma tarihi):** Sürümün yayınlandığı tarih/saat.

Hiç sürüm yayınlanmamışsa, tablo yerine "No releases yet." ("Henüz sürüm
yok.") mesajı görüntülenir.

### Adım adım: Firmware yayımlama

1. Firmware ekranındaki yayımlama formunda **Version** ("Version (e.g.
   0.3.0-m6b)" — "Sürüm (örn. 0.3.0-m6b)") alanına yayınlamak istediğiniz
   sürüm numarasını girin. Bu alan **zorunludur**.
2. **file** dosya seçme alanından yayınlamak istediğiniz **`.bin`** (ikili)
   dosyasını seçin. Bu alan da **zorunludur**; boş bir dosya veya dosya
   seçilmemesi kabul edilmez.
3. **Publish firmware** ("Firmware yayımla") düğmesine tıklayın. İşlem
   sürerken düğme metni **"Publishing…"** ("Yayımlanıyor…") olarak değişir.
4. İşlem başarılı olursa "Published {sürüm}." ("{sürüm} yayınlandı.") mesajı
   görünür ve form sıfırlanır; yeni sürüm tabloya eklenir.

Yayımlama sırasında aşağıdaki kurallar uygulanır ve bunlardan herhangi biri
karşılanmazsa yayımlama reddedilir (bir hata mesajıyla birlikte):

- **Version** alanı **zorunludur** ve girilen sürüm numarasının, yüklenen
  ikili dosyanın içindeki **CONFIG_DITTO_FW_VERSION** değeriyle **eşleşmesi**
  gerekir.
- Boş olmayan, geçerli bir **`.bin`** dosyası seçilmiş olmalıdır.
- Dosya boyutu **8 MB'ı aşamaz**; aşarsa yayımlama reddedilir.
- Aynı sürüm numarası **daha önce yayınlanmışsa**, yeni yayımlama girişimi
  reddedilir — "Version {sürüm} is already published." ("{sürüm} sürümü
  zaten yayınlanmış.") mesajı görünür; **yinelenen (duplicate) sürümler
  kabul edilmez.**

### Adım adım: Firmware sürümü silme

1. Silmek istediğiniz sürümün satırındaki **Delete** ("Sil") düğmesine
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
- Yayımlamadan önce girdiğiniz **Version** değerinin, yüklediğiniz ikili
  dosyanın **CONFIG_DITTO_FW_VERSION** değeriyle **birebir eşleştiğinden**
  emin olun; eşleşmezse cihazlar üzerinde tutarsızlık oluşabilir.
- Dosya boyutu sınırını (**8 MB**) aşan bir dosya yüklemeye çalışmayın —
  reddedilir.
- Aynı sürüm numarasını **iki kez** yayımlayamazsınız; her sürüm numarası
  yalnızca bir kez kullanılabilir.
- **En yeni (latest)** bir sürümü silerken dikkatli olun: bu sürümü
  silmek, cihazların OTA hedefinin bir önceki sürüme **geri düşmesine**
  neden olur — uyarı penceresi bunu size özellikle hatırlatır.
