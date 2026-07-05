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
metni)**" biçiminde verilir — örneğin **Genel Bakış (Overview)**. Uygulamada
gördüğünüz metin her zaman İngilizce olan kısımdır; parantez içindeki, ekranda
aynen o şekilde görmeyi beklemeyin.

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
her kiracıya başlangıçta **50 ücretsiz kredi** tanımlanır.

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

Deneme/demo amaçlı bir Süper Admin hesabı şu şekildedir:

- **E-posta:** `admin@ditto.app`
- **Şifre:** `123456`

Giriş sayfasında ayrıca bir **"Demo hesapları" (Demo accounts)** paneli
bulunur; bu panel platform admin demo hesabını listeler.

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
  e-posta adresini ve rolünü ("**Süper Admin / Super Admin**") gösterir.
