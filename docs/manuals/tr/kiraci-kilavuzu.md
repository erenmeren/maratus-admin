# Kiracı Yöneticisi Kullanım Kılavuzu

*Ditto Admin — Kiracı (Mağaza Zinciri) Yöneticisi Rehberi*

## 1. Giriş & Bu Kılavuz Hakkında

Bu kılavuz, Ditto Admin uygulamasının **Kiracı (Tenant)** bölümünü kullanacak
kişiler için hazırlanmıştır: bir mağaza zincirinin (kiracının) **sahibi
(owner)**, **yöneticisi (admin)** veya **üyesi (member)** olarak sisteme
giren herkes. Ditto'yu daha önce hiç kullanmamış olduğunuzu varsayarak en
temel kavramlardan başlar ve adım adım ilerler; hiçbir ön bilgi gerektirmez.

Ditto Admin uygulamasının arayüzü **İngilizce**'dir; bu kılavuz Türkçe
yazılmış olsa da uygulamanın kendisi Türkçeleştirilmemiştir. Bu nedenle bir
ekran adı, düğme veya alan adı ilk kez geçtiğinde, "**Türkçe karşılığı
(İngilizce arayüz metni)**" biçiminde verilir — örneğin **Panel
(Dashboard)**, **Mağazalar (Stores)**. Parantez içindeki İngilizce metin,
ekranda aynen göreceğiniz metindir; parantezden önceki Türkçe kısım ise
bunun açıklaması/çevirisidir.

Kılavuzu okurken şu sırayı izlemenizi öneririz: önce **kavramları** öğrenin
(Ditto nedir, kiracı/mağaza/cihaz ne demek, tetikleme→QR akışı nasıl işler,
kredi sistemi nasıl çalışır, kiracı içindeki roller nelerdir), ardından
uygulamaya nasıl gireceğinizi ve ana gezinme yapısını keşfedin. Bu sıralama,
ekranlarda gördüğünüz her düğme ve alanın "neden" orada olduğunu anlamanızı
kolaylaştırır.

## 2. Ditto Nedir? (Kiracı Bakışıyla)

### 2.1 Ditto ne işe yarar?

Ditto, işletmelerin kağıt belge basmak yerine müşterilerine bir **QR kod**
gösterebilmesini sağlayan bir sistemdir. Müşteri, yazıcının ekranındaki bu QR
kodu telefonuyla tarar. Böylece kağıt kullanımına gerek kalmaz.

### 2.2 Kiracı = Organizasyon (bir mağaza zinciri)

Sizin firmanız, Ditto Admin içinde bir **organizasyon** olarak temsil edilir;
bu kılavuzda buna **kiracı (tenant)** denir. Bir kiracı, tek bir mağazayı
değil, tipik olarak **bir mağaza zincirinin tamamını** kapsar: birden çok
mağaza, bu mağazalara bağlı cihazlar ve bu kiracıda çalışan kullanıcılar,
hep aynı kiracının altında yer alır.

### 2.3 Cihaz = Yazıcı (Printer)

Ditto'da bahsedilen "cihaz (device)", fiziksel bir **yazıcı** donanımıdır. Bu
donanım kağıda bir şey basmaz; ekranında müşteriye taranacak QR kodu
gösterir.

### 2.4 Tetikleme → QR akışı

Bir cihazın müşteriye QR kod gösterebilmesi için şu akış izlenir:

1. Yetkilendirilmiş bir çağıran taraf (bir **API** çağrısı), belirli bir
   **URL**'nin QR kodunun gösterilmesi için cihazı **tetikler (trigger)**.
2. Bu tetikleme karşılığında kiracının kredi bakiyesinden **1 kredi rezerve
   edilir** (henüz kesin olarak düşülmez, sadece ayrılır).
3. Cihaz, komutu alır ve ekranında ilgili URL'nin QR kodunu gösterir.
4. Cihaz, işlemi tamamladığını bildirir (**ack**); bu bildirim **başarılı**
   olursa rezerve edilen kredi kalıcı olarak düşülür.

### 2.5 Ön ödemeli kredi sistemi (Prepaid Credits)

Ditto, kullanım başına **ön ödemeli kredi** modeliyle ücretlendirilir: her
**tetikleme**, kiracıya **1 kredi**ye mal olur. Krediler önce rezerve edilir,
işlem başarıyla tamamlanınca (ack ile) kesin olarak düşülür.

### 2.6 Kiracı içindeki roller (Owner / Admin / Member)

Bir kiracı içindeki her kullanıcının bir **rolü** vardır:

- **Sahip (Owner)** ve **Yönetici (Admin)** rolündeki kullanıcılar kiracıyı
  **yönetebilir** — mağaza, cihaz, üye gibi kaynaklar üzerinde işlem
  yapabilirler.
- **Üye (Member)** rolündeki kullanıcılar **salt-okunur (read-only)**
  erişime sahiptir; yönetimsel işlem yapamazlar.

Yeni bir kullanıcı davet edildiğinde, davet yalnızca **Yönetici (Admin)**
veya **Üye (Member)** rolüyle verilebilir; **Sahip (Owner)** rolü davet
yoluyla atanamaz — bu rol korunur.

## 3. Başlarken (Giriş ve Gezinme)

Bu bölümde Ditto Admin'e kiracı kullanıcısı olarak nasıl giriş yapacağınızı,
giriş sonrası nereye yönlendirileceğinizi, erişim kurallarını ve ana gezinme
yapısını (sol menü, üst çubuk, çalışma alanı değiştirici, hesap menüsü)
öğreneceksiniz.

### Adım adım: Giriş yapma

1. Tarayıcınızda uygulamanın giriş sayfasına, yani **`/login`** adresine
   gidin.
2. **E-posta (Email)** alanına hesabınızın e-posta adresini girin.
3. **Şifre (Password)** alanına şifrenizi girin.
4. **Giriş yap (Sign in)** düğmesine tıklayın.

### Giriş sonrası yönlendirme ve erişim kuralı

`/tenant` ile başlayan bölümün tamamı `requireTenant()` adlı bir kontrol ile
korunur:

- Oturumu açık olmayan (giriş yapmamış) bir kullanıcı bu bölüme erişmeye
  çalışırsa **`/login`** sayfasına yönlendirilir.
- Başarılı bir girişten sonra, kiracı kullanıcısı otomatik olarak
  **`/tenant`** adresine iner; hesabı **platform_admin** olan bir kullanıcı
  ise **`/admin`** adresine yönlendirilir.
- Kullanıcının **aktif bir organizasyonu (aktif kiracısı)** yoksa,
  **`/login`** sayfasına yönlendirilir; bu kullanıcı aynı zamanda
  platform_admin ise **`/admin`** adresine yönlendirilir.

### Sol menü — "Çalışma Alanı (Workspace)" grubu

Giriş yaptıktan sonra sol taraftaki gezinme menüsünde **"Çalışma Alanı
(Workspace)"** adlı bir grup görürsünüz. Bu grup, aşağıdaki sırayla şu
ekranları içerir:

1. **Panel (Dashboard)**
2. **Mağazalar (Stores)**
3. **Marka (Branding)**
4. **Cihaz Ayarları (Device Settings)**
5. **Üyeler (Members)**
6. **Raporlar (Reports)**
7. **Analitik (Analytics)**
8. **Faturalandırma (Billing)**
9. **API**
10. **Etkinlik (Activity)**

Bu ekranların her biri, kılavuzun ilerleyen bölümlerinde ayrıntılı olarak
anlatılacaktır.

### Üst çubuk (Top bar)

Panelin üst kısmında şu ortak kontroller bulunur:

- Sol tarafta, bulunduğunuz ekranı gösteren bir başlık: **"Workspace /
  {ekran adı}"** biçiminde.
- **Tema değiştirici (Theme toggle):** Açık/koyu tema arasında geçiş
  yapmanızı sağlar.
- **Hesap menüsü (Account menu):** Oturum açmış kullanıcının hesabına
  ilişkin bir açılır menü sunar (ayrıntılar aşağıda).

### Çalışma alanı değiştirici (Workspace switcher)

Üst kısımda, aktif organizasyonunuzun adını ve **"Kiracı Çalışma Alanı
(Tenant Workspace)"** etiketini gösteren bir **çalışma alanı değiştirici
(workspace switcher)** bulunur. Bu kontrole tıkladığınızda açılan menüde:

- Kullanıcının üye olduğu **tüm organizasyonlar**, adları ve o
  organizasyondaki rolüyle (owner/admin/member) birlikte listelenir; o an
  aktif olan organizasyonun yanında bir **onay işareti** görünür.
- Listeden başka bir organizasyon seçildiğinde, `setActive()` çağrısıyla o
  organizasyon **aktif organizasyon** yapılır ve **`/tenant`** adresine
  yönlendirilirsiniz.
- Hesabınız aynı zamanda **platform_admin** ise, menüde ayrıca **"Ditto
  Merkez / Süper Yönetici (Ditto HQ / Super Admin)"** adlı bir seçenek
  görünür; bu seçenek sizi **`/admin`** adresine götürür.

### Hesap menüsü

Üst çubuktaki hesap menüsünü açtığınızda, kullanıcının **avatarı, adı ve
rolü** görüntülenir. Menüde ayrıca şu öğeler bulunur: **Profil (Profile)**,
**Ayarlar (Settings)**, bir **tema değiştirici (ThemeToggle)** ve **Çıkış
yap (Sign out)**.

> **Önemli — işlevsiz menü öğeleri:** Hesap menüsündeki **Profil (Profile)**
> ve **Ayarlar (Settings)** öğeleri **işlevsizdir** — bu öğelere tıklamanın
> herhangi bir etkisi yoktur, herhangi bir sayfa açılmaz. **Çıkış yap (Sign
> out)** öğesi ise gerçek bir oturum kapatma işlemi **çağırmaz**; yalnızca
> sizi **`/login`** sayfasına yönlendirir.

### İpuçları

- Uygulamanın arayüzü İngilizce olduğu için, ekranlarda gördüğünüz metinleri
  bu kılavuzdaki "Türkçe karşılığı (İngilizce arayüz metni)" eşleşmelerinden
  takip edebilirsiniz.
- Birden fazla organizasyona üyeyseniz, hangi kiracı üzerinde işlem
  yaptığınızı her zaman üst kısımdaki **çalışma alanı değiştirici**
  üzerinden kontrol edin.
- Hesap menüsündeki **Profil (Profile)**, **Ayarlar (Settings)** ve **Çıkış
  yap (Sign out)** öğelerinin yukarıda açıklanan sınırlamalarını unutmayın;
  gerçek bir oturum kapatma için tarayıcınızın kendi araçlarına (örn.
  çerezleri temizleme) ihtiyaç duyabilirsiniz.
