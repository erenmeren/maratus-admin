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

## 4. Panel (Dashboard)

### Bu ekran ne işe yarar?

Giriş yaptıktan sonra kiracı kullanıcısı olarak indiğiniz ilk ekran, **Panel
(Dashboard)** ekranıdır (adres: **`/tenant`**). Bu ekran, kiracınızın
(mağaza zincirinizin) o günkü ve son 30 günkü **kağıtsız ödeme/QR akışı**
performansını tek bakışta özetler: kaç aktivasyon yapıldığını, kaç yazıcının
çevrimiçi olduğunu, çevresel etkiyi ve hangi mağazaların en yoğun olduğunu
gösterir. **Bu ekranda herhangi bir işlem yapılmaz** — yalnızca bilgi
kartları ve bağlantılar (linkler) bulunur; veri ekleyen, değiştiren veya
silen hiçbir kontrol yoktur.

### Ekranda neler var?

- **Başlık ve açıklama:** Üstte "**Welcome back, {adınız}**" biçiminde
  kişiselleştirilmiş bir karşılama başlığı ve altında "**Here's how
  {kiracı adınız}'s paperless checkout is doing today.**" açıklaması yer
  alır.
- **Tarih çipi:** Başlığın yanında bir takvim ikonuyla birlikte bir tarih
  görürsünüz. **Önemli:** Bu tarih çipi **sabit (hardcoded) olarak
  "May 30, 2026" yazar** — ekranı hangi gün açarsanız açın değişmez ve
  **gerçek/güncel tarihi yansıtmaz**. Bunu bir hata veya bilgi olarak
  değerlendirmeyin; gerçek tarih için bilgisayarınızın/tarayıcınızın kendi
  saatine bakın.
- **3 KPI (temel performans göstergesi) kartı:**
  - **Bugünkü aktivasyonlar (Activations today):** O güne ait aktivasyon
    sayısı. Kartta bir de "**+6.4%**" delta (değişim) rozeti ve "**vs.
    yesterday**" (dünle karşılaştırma) ibaresi görünür. **Önemli:** Bu
    **+6.4% değeri sabittir (hardcoded)** — gerçek bir "dünle
    karşılaştırma" hesaplaması **değildir**, ekranı her açtığınızda aynı
    rakamı görürsünüz.
  - **Bu ayki aktivasyonlar (Activations this month):** O aya ait toplam
    aktivasyon sayısı. Delta rozeti "**+12.1%**", ibare "**vs. last
    month**" (geçen ayla karşılaştırma). **Önemli:** Bu **+12.1% değeri
    de sabittir (hardcoded)**, gerçek zamanlı bir hesap değildir.
  - **Aktif cihazlar (Active devices):** "**{çevrimiçi sayısı}/{toplam
    sayı}**" biçiminde gösterilir, altında "**printers online now**"
    (şu anda çevrimiçi yazıcılar) ibaresi bulunur. Bu değer, diğer ikisinin
    aksine **gerçek/canlı** bir sayımdır.
- **"Aktivasyonlar zaman içinde (Activations over time)" kartı:**
  Açıklaması "**Daily activations, last 30 days**" (son 30 günün günlük
  aktivasyonları); bir **alan grafiği (area chart)** ile gösterilir.
- **"Eko etki (Eco impact)" kartı:** Üstte "**From {n} paperless documents
  this month.**" (bu ay {n} kağıtsız belgeden) açıklaması bulunur. Altında
  4 istatistik kutusu vardır:
  - **Ağaç (trees)** — kurtarılan kağıt miktarının kaç ağaca denk geldiği,
  - **Kâğıt (paper)** — basılmamış kağıt miktarı,
  - **Su (water)** — tasarruf edilen su miktarı,
  - **CO₂e** — önlenen CO₂e (karbon eşdeğeri) emisyonu.
- **"En yoğun mağazalar (Busiest stores)" kartı:** Açıklaması "**Activations
  this month, by branch**" (bu ay mağaza bazında aktivasyonlar). Kartın
  sağ üst köşesinde **"Tüm mağazalar (All stores)"** bağlantısı bulunur;
  bu bağlantı sizi **Mağazalar (Stores)** ekranına (**`/tenant/stores`**)
  götürür. Kartın içinde, aylık aktivasyon sayısına göre en yoğun **en
  fazla 4 mağaza** birer döşeme (tile) olarak listelenir; her döşemede
  mağaza adı, "**{n} printers · {n} online**" (yazıcı sayısı ve çevrimiçi
  sayısı) bilgisi, o ayki aktivasyon sayısı ve bir **durum rozeti (status
  badge)** görünür. Bir döşemeye tıklarsanız ilgili mağazanın detay
  sayfasına gidersiniz.

### İpuçları

- Panel ekranındaki hiçbir kart veya sayı üzerinde düzenleme yapamazsınız;
  bu ekran salt bilgilendirme amaçlıdır. Mağaza eklemek/düzenlemek gibi
  işlemler için **Mağazalar (Stores)** ekranına gidin (bkz. Bölüm 5).
- Tarih çipinin ve iki KPI kartındaki yüzde delta değerlerinin **sabit
  (hardcoded)** olduğunu unutmayın — bunları gerçek zamanlı veri gibi
  yorumlamayın. Sadece **Aktif cihazlar** KPI'ı ve grafikteki/mağaza
  kartlarındaki sayılar gerçek veriye dayanır.
- En yoğun mağazaları tam listesiyle görmek için "**Tüm mağazalar (All
  stores)**" bağlantısını kullanın.

## 5. Mağazalar (Stores)

### Bu ekran ne işe yarar?

**Mağazalar (Stores)** ekranı (adres: **`/tenant/stores`**), kiracınıza
bağlı tüm **mağazaları (şubeleri)** bir tablo halinde listeler. Buradan
mevcut mağazaların yazıcı/aktivasyon durumunu görebilir; **Sahip (Owner)**
veya **Yönetici (Admin)** rolündeyseniz yeni mağaza ekleyebilir ve mevcut
mağazaların bilgilerini düzenleyebilirsiniz. **Üye (Member)** rolündeki
kullanıcılar bu ekranı yalnızca **salt-okunur (read-only)** olarak görür.

### Ekranda neler var?

- **Başlık ve açıklama:** Başlık "**Stores**"; açıklama "**{n} branches ·
  {çevrimiçi}/{toplam} printers online**" (n şube, çevrimiçi/toplam yazıcı
  sayısı) biçimindedir.
- **"Mağaza ekle (Add store)" düğmesi:** Ekranın sağ üst köşesinde yer
  alır ve **yalnızca Sahip (Owner)/Yönetici (Admin) rolündeki
  kullanıcılara görünür**; Üye (Member) rolündeki kullanıcılar bu düğmeyi
  görmez.
- **Mağaza tablosu**, şu sütunlardan oluşur:
  - **Mağaza (Store)** — mağaza adı (bir simge ve mağaza adına tıklanabilir
    bağlantıyla birlikte),
  - **Adres (Address)** — mağazanın adresi,
  - **Yazıcılar (Printers)** — "**{çevrimiçi}/{toplam}**" biçiminde, bir
    durum noktası (status dot) ile birlikte,
  - **Aktivasyonlar/ay (Activations (mo.))** — o ayki toplam aktivasyon
    sayısı,
  - **Durum (Status)** — bir **durum rozeti (status badge)**: **Çevrimiçi
    (Online)**, **Çevrimdışı (Offline)** veya **Duraklatılmış (Paused)**,
  - Son sütun, satıra özel **işlem (actions)** alanıdır.
- **Satır işlemleri:**
  - **Sahip (Owner)/Yönetici (Admin)** rolündeki kullanıcılar için, satırın
    sonunda bir **kebap menüsü (⋮)** bulunur; bu menüde **"Mağazayı aç (Open
    store)"** ve **"Mağazayı düzenle (Edit store)"** seçenekleri yer alır.
  - **Üye (Member)** rolündeki kullanıcılar için bu kebap menüsü yerine,
    satıra tıklandığında mağaza detayına götüren basit bir ok/bağlantı
    görünür — yani üyeler mağaza bilgisini **görüntüleyebilir** ama
    **düzenleyemez**.

### Adım adım: Mağaza ekleme (Add store)

> Bu adımlar yalnızca **Sahip (Owner)** veya **Yönetici (Admin)**
> rolündeki kullanıcılar için geçerlidir.

1. **Mağazalar (Stores)** ekranında sağ üstteki **"Mağaza ekle (Add
   store)"** düğmesine tıklayın.
2. Açılan **"Mağaza ekle (Add store)"** diyaloğunda ("Create a new branch.
   You can claim printers into it afterwards." — yeni bir şube oluşturun,
   ardından yazıcıları bu şubeye bağlayabilirsiniz), aşağıdaki alanları
   doldurun:
   - **Mağaza adı (Store name)** — **zorunlu** bir alandır (örnek yer
     tutucu metin: "e.g. Downtown Flagship"). Bu alan boş bırakılırsa
     "**Store name is required.**" (mağaza adı zorunludur) hata mesajı
     alırsınız.
   - **Adres (Address)** — isteğe bağlıdır.
   - **Saat dilimi (Timezone)** — önceden seçili bir varsayılan değerle
     gelir; altında "**Used for busiest-times analytics.**" (en yoğun
     saat analitiği için kullanılır) açıklaması bulunur.
3. Vazgeçmek isterseniz **İptal (Cancel)** düğmesine tıklayın; kaydetmek
   için **"Mağaza ekle (Add store)"** düğmesine tıklayın (işlem sürerken
   düğme metni "**Adding…**" olarak değişir).
4. İşlem başarılı olursa, "**Store added**" başlıklı bir bildirim ile
   birlikte "**{mağaza adı} is ready for printers.**" (mağaza yazıcılar
   için hazır) açıklaması görünür ve yeni mağaza tabloya eklenir.
5. Bu işlemi yapmaya yetkiniz yoksa (Üye/Member rolündeyseniz), "**You
   don't have permission to add stores.**" (mağaza ekleme yetkiniz yok)
   hata mesajı alırsınız.

### Adım adım: Mağaza düzenleme (Edit store)

> Bu adımlar yalnızca **Sahip (Owner)** veya **Yönetici (Admin)**
> rolündeki kullanıcılar için geçerlidir.

1. **Mağazalar (Stores)** tablosunda düzenlemek istediğiniz mağazanın
   satırındaki kebap menüsünü (⋮) açın ve **"Mağazayı düzenle (Edit
   store)"** seçeneğine tıklayın.
2. Açılan **"Mağazayı düzenle (Edit store)"** diyaloğunda ("Update this
   branch's details." — bu şubenin bilgilerini güncelleyin), **Mağaza adı
   (Store name)**, **Adres (Address)** ve **Saat dilimi (Timezone)**
   alanları mağazanın mevcut bilgileriyle önceden doldurulmuş olarak
   gelir; dilediğinizi değiştirin.
3. Vazgeçmek isterseniz **İptal (Cancel)** düğmesine tıklayın; kaydetmek
   için **"Değişiklikleri kaydet (Save changes)"** düğmesine tıklayın
   (işlem sürerken düğme metni "**Saving…**" olarak değişir).
4. İşlem başarılı olursa "**Store updated**" (mağaza güncellendi)
   bildirimi görünür ve tablo güncellenir.

### İpuçları

- **Üye (Member)** rolündeyseniz bu ekran sizin için tamamen
  **salt-okunur (read-only)**'dur: **"Mağaza ekle (Add store)"** düğmesini
  görmez, satırlarda **"Mağazayı düzenle (Edit store)"** seçeneğine erişemezsiniz;
  yalnızca mağaza detayına gidebilirsiniz.
- **Mağaza adı (Store name)** her iki diyalogda da **zorunlu** tek alandır;
  **Adres (Address)** boş bırakılabilir.
- **Saat dilimi (Timezone)** seçimi yalnızca kozmetik değildir — mağazanın
  en yoğun saat analitiğini doğru hesaplamak için kullanılır, bu nedenle
  mağazanın gerçek saat dilimini seçmeniz önerilir.

## 6. Mağaza Detayı ve Cihaz Yönetimi

### Bu ekran ne işe yarar?

**Mağaza detayı** ekranı (adres: **`/tenant/stores/{storeId}`**), tek bir
mağazanın (şubenin) ayrıntılı görünümüdür: o mağazadaki tüm **cihazları
(yazıcıları)**, mağazaya özgü aktivasyon/eko istatistiklerini ve zaman içi
grafiklerini bir arada gösterir. Bu ekran aynı zamanda yeni bir yazıcının
mağazaya **sahiplenilmesi (claim)** ve mevcut yazıcıların **duraklatılıp
etkinleştirilmesi** için giriş noktasıdır. **Sahip (Owner)** ve **Yönetici
(Admin)** rolündeki kullanıcılar burada yazıcı sahiplenebilir ve mağaza
bilgilerini düzenleyebilir; **Üye (Member)** rolündeki kullanıcılar ekranı
yalnızca **görüntüleyebilir**.

Bir mağazanın adına (Mağazalar tablosundan veya bir Panel döşemesinden)
tıklayarak bu ekrana ulaşırsınız. Aradığınız mağaza kiracınıza ait değilse
veya bulunamazsa, uygulama sizi bir **404 (bulunamadı)** sayfasına
yönlendirir.

### Ekranda neler var?

- **Geri bağlantısı:** Ekranın en üstünde **"Stores"** yazan bir bağlantı
  bulunur; bu bağlantı sizi **Mağazalar (Stores)** ekranına geri götürür.
- **Başlık:** Mağazanın adı, yanında mağazanın genel durumunu özetleyen bir
  **durum rozeti (status badge)** ile birlikte gösterilir — **Çevrimiçi
  (Online)**, **Çevrimdışı (Offline)** veya **Duraklatılmış (Paused)**. Bu
  rozet, mağazadaki cihazların **toplu (rollup)** durumunu yansıtır: en az
  bir cihaz çevrimiçiyse rozet **Çevrimiçi**, çevrimiçi cihaz yoksa ama
  duraklatılmış cihaz varsa **Duraklatılmış**, hiçbiri değilse
  **Çevrimdışı** görünür.
- **Sahip (Owner)/Yönetici (Admin)** rolündeki kullanıcılar için başlığın
  yanında iki düğme daha bulunur: **Mağazayı düzenle (Edit store)** (bkz.
  Bölüm 5) ve **Yazıcı sahiplen (Claim printer)** (aşağıda anlatılır). Üye
  (Member) rolündeki kullanıcılar bu iki düğmeyi görmez.
- Başlığın altında bir harita pini ikonuyla birlikte mağazanın **adresi**
  yer alır.
- **KPI (temel performans göstergesi) satır 1** — 4 kart:
  - **Yazıcılar (Printers):** "**{çevrimiçi}/{toplam}**" biçiminde, altında
    "**online**" ibaresi.
  - **Bugünkü aktivasyonlar (Activations today).**
  - **Bu ayki aktivasyonlar (Activations this month).**
  - **Yazıcı başına ortalama (Avg / printer):** altında "**activations
    this month**" ibaresi.
- **KPI satır 2** — 4 kart daha:
  - **Bu ayki aktivasyonlar (Activations this month):** bu kartta bir
    **delta (değişim) rozeti** ve "**vs last month**" (geçen ayla
    karşılaştırma) ibaresi bulunur. **Önemli:** Panel (Dashboard)
    ekranındaki delta değerlerinin aksine (bkz. Bölüm 4), buradaki delta
    **sabit değildir** — mağazanın gerçek geçen-ay verisiyle
    karşılaştırılarak hesaplanan **gerçek** bir yüzdedir.
  - **Kağıt tasarrufu (Paper saved):** "**{kg} kg**" biçiminde, altında
    "**this month**" (bu ay) ibaresi.
  - **En yoğun gün (Busiest day):** altında "**last 90 days**" (son 90 gün)
    ibaresi.
  - **Yoğunluk saati (Peak hour):** altında "**last 90 days**" (son 90 gün)
    ibaresi.
- **"Aktivasyonlar zaman içinde (Activations over time)" kartı:** açıklaması
  "**Daily activations, last 30 days**" (son 30 günün günlük
  aktivasyonları); bir alan grafiği (area chart) ile gösterilir.
- **"Yoğun zamanlar (Busiest times)" kartı:** açıklaması "**Activations by
  day of week and hour, last 90 days**" (haftanın günü ve saatine göre
  aktivasyonlar, son 90 gün); bir **ısı haritası (heatmap)** ile gösterilir.
- **"Bu mağazadaki yazıcılar (Printers in this store)" bölümü:** mağazaya
  bağlı her cihaz için bir **cihaz kartı** gösteren bir ızgara
  (grid). Mağazada henüz cihaz yoksa "**No printers here yet**" (henüz
  buraya ait yazıcı yok) mesajı görünür; Sahip/Yönetici rolündeyseniz
  altında ayrıca "**Claim a printer with its pairing code to start issuing
  activations at this store.**" (bir yazıcıyı eşleştirme koduyla
  sahiplenerek bu mağazada aktivasyon üretmeye başlayın) açıklaması
  görünür.
- **"Sahiplenilmemiş yazıcılar (Unclaimed printers)" kartı:** yalnızca
  **Sahip (Owner)/Yönetici (Admin)** rolündeki kullanıcılara ve yalnızca
  kiracınızda henüz bir mağazaya bağlanmamış (sahiplenilmemiş) cihaz
  varsa görünür. Kart, kaç cihazın sahiplenilmeyi beklediğini belirtir ve
  her cihaz için adını ve mono (eşit aralıklı) yazı tipiyle gösterilen
  **eşleştirme kodunu (pairing code)** listeler.

### Adım adım: Yazıcı sahiplenme (Claim printer)

> Bu adımlar yalnızca **Sahip (Owner)** veya **Yönetici (Admin)**
> rolündeki kullanıcılar için geçerlidir.

1. Mağaza detayı ekranında başlığın yanındaki **"Yazıcı sahiplen (Claim
   printer)"** düğmesine tıklayın.
2. Açılan **"Bir yazıcı sahiplen (Claim a printer)"** diyaloğunda ("Enter
   the pairing code shown on the printer screen to bind it to this store."
   — yazıcının ekranında görünen eşleştirme kodunu girerek onu bu mağazaya
   bağlayın), **Eşleştirme kodu (Pairing code)** alanına yazıcının
   ekranında gördüğünüz kodu girin. Bu alan **zorunludur**; girdiğiniz
   metin otomatik olarak **BÜYÜK HARFE** çevrilir ve yer tutucu biçimi
   "**XXXX-XXXX**" şeklindedir. Alanın altında "**Find it under Settings →
   Pairing on the device.**" (cihazda Settings → Pairing altında bulabilirsiniz)
   yardım metni bulunur.
3. Vazgeçmek isterseniz **İptal (Cancel)** düğmesine tıklayın; onaylamak
   için **"Yazıcı sahiplen (Claim printer)"** düğmesine tıklayın (işlem
   sürerken düğme metni "**Claiming…**" olarak değişir).
4. İşlem başarılı olursa diyalog, "**{cihaz adı} claimed**" başlığıyla
   birlikte "**It will activate automatically within a few seconds — watch
   the printer screen return to the home screen.**" (birkaç saniye içinde
   otomatik olarak etkinleşecektir — yazıcı ekranının ana ekrana dönmesini
   izleyin) açıklamasını gösteren bir başarı görünümüne geçer.
5. Bu başarı görünümünde, katlanabilir bir **"Manuel kurulum (gelişmiş)
   (Manual setup (advanced))"** bölümü bulunur. Bu bölümü açtığınızda, o
   cihaza ait **tek seferlik (one-time)** bir **Cihaz anahtarı (Device
   key)** görürsünüz (mono yazı tipiyle, yanında bir **kopyala (copy)**
   düğmesiyle). Bu bölümün üstünde şu **kritik uyarı** yer alır: "**Only
   needed if the device doesn't activate on its own. This key is shown
   once and can't be retrieved later — for security, Ditto only keeps a
   hashed copy.**" (Yalnızca cihaz kendiliğinden etkinleşmezse gerekir. Bu
   anahtar yalnızca bir kez gösterilir ve daha sonra tekrar alınamaz —
   güvenlik nedeniyle Ditto yalnızca anahtarın hash'lenmiş (özetlenmiş) bir
   kopyasını saklar.) **Bu anahtarı bu ekrandan ayrılmadan önce mutlaka
   kopyalayıp güvenli bir yere kaydedin; diyaloğu kapattıktan sonra bir
   daha görüntüleyemezsiniz.**
6. İşlemi bitirmek için **Bitti (Done)** düğmesine tıklayın.

**Olası hata mesajları:**

- "**No device found with that pairing code.**" (bu eşleştirme koduyla
  eşleşen bir cihaz bulunamadı) — kod yanlış girilmiş veya cihaz mevcut
  değil.
- "**That device has already been claimed.**" (bu cihaz zaten
  sahiplenilmiş).
- "**That device belongs to another account.**" (bu cihaz başka bir hesaba
  ait).
- "**Enter a pairing code.**" (bir eşleştirme kodu girin) — alan boş
  bırakılırsa.
- "**You don't have permission to claim devices.**" (cihaz sahiplenme
  yetkiniz yok) — Üye (Member) rolündeyken bu işlemi denerseniz.

### Adım adım: Cihazı duraklatma/etkinleştirme

1. **"Bu mağazadaki yazıcılar (Printers in this store)"** ızgarasında,
   durumunu değiştirmek istediğiniz cihazın kartını bulun. Kartın altında
   bir **anahtar (switch)** ve yanında cihazın o anki durumunu gösteren bir
   etiket bulunur: **Etkin (Active)**, **Duraklatıldı (Paused)** veya
   **Erişilemez (Unreachable)**.
2. Anahtarı açıp kapatarak cihazı **duraklatabilir** veya **yeniden
   etkinleştirebilirsiniz**. **Önemli:** Cihaz **çevrimdışı (Unreachable)**
   ise bu anahtar **devre dışıdır** — çevrimdışı bir cihazın durumu
   değiştirilemez.
3. İşlem başarılı olursa "**{cihaz adı} resumed**" (etkinleştirildiyse) veya
   "**{cihaz adı} paused**" (duraklatıldıysa) biçiminde bir bildirim
   görünür, açıklamasında da "**{cihaz id} is now {durum}.**" yazar.
4. İşlem başarısız olursa anahtar **eski durumuna geri döner (rollback)** ve
   "**Couldn't update device**" (cihaz güncellenemedi) hata bildirimi
   görünür.

Aynı anahtar, aşağıda anlatılan **Cihaz Detayı** ekranındaki **Duraklat
kontrolü** kartında da (farklı bir görünümle, Pause/Activate düğmesi olarak)
karşınıza çıkar.

### Cihaz Detayı (Device Detail)

Bir cihaz kartına tıkladığınızda, o cihaza ait **Cihaz Detayı (Device
Detail)** ekranına gidersiniz (adres:
**`/tenant/stores/{storeId}/{deviceId}`**). Cihaz kiracınıza ait değilse
uygulama bir **404** sayfası gösterir.

- **Geri bağlantısı:** mağazanın adını gösterir; tıklayınca mağaza detayına
  döner.
- **Başlık:** cihazın adı, altında "**Printer in {mağaza adı}**" (bu
  mağazadaki yazıcı) açıklaması.
- **2 KPI kartı:** **Bugünkü aktivasyonlar (Activations today)** ve **Bu
  ayki aktivasyonlar (Activations this month)**.
- **"Cihaz bilgileri (Device details)" kartı:** dört alan listeler:
  - **Cihaz kimliği (Device ID)** — mono yazı tipiyle.
  - **IP adresi (IP address)** — mono yazı tipiyle.
  - **Bağlantı (Connection)** — Wi-Fi veya Ethernet.
  - **Ürün yazılımı (Firmware)** — "**v{sürüm}**" biçiminde; daha yeni bir
    sürüm mevcutsa yanında "**→ v{en yeni sürüm} available**" (v{en yeni
    sürüm} kullanılabilir) ibaresi eklenir.
- **Duraklat kontrolü kartı:** solda bir durum noktası ve o anki durumu
  ("**Çevrimiçi (Online)**"/"**Duraklatıldı (Paused)**"/"**Çevrimdışı
  (Offline)**" — cihaz kartındaki **Etkin (Active)/Duraklatıldı
  (Paused)/Erişilemez (Unreachable)** etiketinden **farklı olarak**, bu
  kartta cihazın durumu doğrudan gösterilir), altında durumu açıklayan bir
  alt metin: "**Accepting documents**" (belge kabul ediyor —
  çevrimiçiyken), "**Paused — not accepting documents**" (duraklatıldı —
  belge kabul etmiyor) veya "**Device is unreachable**" (cihaza
  ulaşılamıyor — çevrimdışıyken). Sağda bir **Duraklat (Pause)/Etkinleştir
  (Activate)** düğmesi bulunur; bu düğme de cihaz çevrimdışıyken **devre
  dışıdır**.
- **"Bağlantı (Connectivity)" kartı:** üç satır listeler: **Son görülme
  (Last seen)**, **Mağaza (Store)** ve **Ürün yazılımı (Firmware)**
  (yalnızca sürüm numarası, güncelleme bilgisi olmadan).

### Adım adım: Uzaktan komut gönderme

Cihaz Detayı ekranının altında **"Uzaktan kontrol (Remote control)"**
bölümü bulunur.

1. Şu 4 düğmeden birine tıklayın: **Yeniden başlat (Reboot)**,
   **Ayarları yenile (Refresh config)**, **Tanımla (Identify)** veya
   **Ürün yazılımını güncelle (Update firmware)**.
2. Komut gönderilir gönderilmez, düğmelerin altında "**{komut türü} queued
   — the device will pick it up on its next check-in.**" ({komut türü}
   kuyruğa alındı — cihaz bir sonraki bağlantı kontrolünde bunu alacak)
   biçiminde bir bilgi mesajı görünür. Komut, cihaza **anında** iletilmez;
   cihaz periyodik olarak sunucuya bağlanıp bekleyen komutları
   yokladığında (poll) uygulanır.
3. Bu işlem sırasında düğmeler geçici olarak **devre dışı** kalır (komut
   gönderilirken).
4. Bu bölümün altında, o cihaza daha önce gönderilmiş komutları listeleyen
   bir tablo bulunur; sütunları **Komut (Command)**, **Durum (Status)** ve
   **Kuyruğa alındı (Queued)** (tarih/saat) şeklindedir. **Önemli:** Bu
   tablodaki **Komut (Command)** ve **Durum (Status)** sütunlarındaki
   değerler **Türkçeleştirilmemiştir** — burada "reboot", "refresh",
   "identify", "firmware-update" gibi ham (İngilizce, teknik) komut türü
   metinleri ve "pending", "acked" gibi ham durum metinleri **olduğu gibi**
   görünür; kılavuzun diğer bölümlerindeki gibi kullanıcı dostu Türkçe
   etiketlere çevrilmemiştir.
5. Bu düğmelere Üye (Member) rolündeyken tıklarsanız komut kuyruğa
   alınmaz; mesaj alanında kısa bir "**Not allowed.**" (izin verilmiyor)
   hata mesajı görürsünüz.

### İpuçları

- Bu bölümdeki tüm **yönetimsel** işlemler — **Yazıcı sahiplen (Claim
  printer)**, **Mağazayı düzenle (Edit store)** ve **Uzaktan kontrol
  (Remote control)** komutları — yalnızca **Sahip (Owner)** ve **Yönetici
  (Admin)** rolündeki kullanıcılar için çalışır; Üye (Member) rolündeki
  kullanıcılar bu düğmeleri ya hiç görmez (Claim printer/Edit store) ya da
  tıklandığında bir izin hatası alır (Remote control).
- Buna karşılık, cihaz kartındaki ve Cihaz Detayı ekranındaki **Duraklat
  (Pause)/Etkinleştir (Activate)** anahtarını rolünüz ne olursa olsun
  kullanabilirsiniz — bu kontrol için herhangi bir rol kısıtlaması
  gözlenmemiştir; tek kısıtlama cihazın **çevrimdışı** olmamasıdır.
- **Cihaz anahtarını (Device key)** kaybederseniz geri getirilemez — Ditto
  yalnızca hash'lenmiş bir kopyasını saklar. Cihaz zaten kendiliğinden
  etkinleşeceği için bu anahtara normal şartlarda ihtiyacınız olmaz;
  yalnızca cihaz otomatik etkinleşmezse "Manuel kurulum (gelişmiş)"
  bölümünden bakmanız gerekir.
- Uzaktan gönderilen komutlar **anında** çalışmaz; cihaz bir sonraki
  bağlantı kontrolünde (check-in) komutu alıp uygular — bu nedenle bir
  komutun etkisini görmek biraz zaman alabilir.
- Komut geçmişi tablosundaki İngilizce ham `type`/`status` değerlerini
  yorumlarken şunu unutmayın: **"reboot"** = yeniden başlatma, **"refresh"**
  = ayarları yenileme, **"identify"** = tanımlama, **"firmware-update"** =
  ürün yazılımı güncelleme; durum olarak genellikle **"pending"**
  (bekliyor) veya **"acked"** (onaylandı) görürsünüz.

## 7. Marka (Branding)

### Bu ekran ne işe yarar?

**Marka (Branding)** ekranı (adres: **`/tenant/branding`**) — başlığı
"**Branding**", açıklaması "**Customize how your printers look to customers.
Changes preview live.**" (yazıcılarınızın müşterilere nasıl göründüğünü
özelleştirin; değişiklikler canlı önizlenir) — kiracınızın yazıcı
ekranlarındaki görünümü (vurgu rengi, tema renkleri, ekran içerikleri,
personel PIN'i) tek bir "marka stüdyosu" arayüzünden düzenlemenizi sağlar.
Yaptığınız her değişiklik sağ taraftaki canlı önizlemede anında görünür;
kaydetmeden önce sonucu görebilirsiniz. **Sahip (Owner)** ve **Yönetici
(Admin)** rolündeki kullanıcılar bu ekranı düzenleyebilir; **Üye (Member)**
rolündeki kullanıcılar için ekran **salt-okunur (view-only)**'dur — tüm
alanlar devre dışı görünür ve üstte "**You have view-only access. Only
owners and admins can edit branding.**" (yalnızca görüntüleme erişiminiz
var; markayı yalnızca sahipler ve yöneticiler düzenleyebilir) uyarısı
bulunur.

### Ekranda neler var?

Ekran iki ana sütuna ayrılır: solda düzenleme paneli, sağda **Canlı
önizleme (Live preview)**.

**Sol panel — akordeon (üç bölüm; sayfa açıldığında varsayılan olarak
"Screen" bölümü açık gelir):**

- **Marka (Brand) bölümü:**
  - **Logo metni (Logo text) — "Logo text (preview fallback)"** alanı, yer
    tutucu metni "**Your brand**". **Önemli — bu alan yalnızca önizleme
    içindir, KAYDEDİLMEZ:** buraya yazdığınız metin yalnızca sağdaki canlı
    önizlemede logo yerine geçen bir metin olarak görünür; **Markayı
    kaydet (Save branding)** düğmesine bassanız bile bu değer kalıcı
    olarak saklanmaz ve sayfa yeniden yüklendiğinde (reload) **eski haline
    sıfırlanır**. Bu alanı yalnızca önizlemede nasıl görüneceğini test
    etmek için kullanın.
  - **Vurgu rengi (Accent color) — "Accent color (hex)"** alanı: bir renk
    seçici (color picker) ve yanında hex kodunu doğrudan yazabileceğiniz
    bir metin alanı bulunur; geçersiz bir hex değeri girerseniz alanın
    kenarlığı **kırmızı** olur. Altında, tek tıkla seçilebilen **7 hazır
    renk (preset)** karesi sıralanır.
  - **Gelişmiş tema (Advanced theme):** "leave as-is for the default
    look" (varsayılan görünüm için olduğu gibi bırakın) notuyla birlikte
    üç ek renk alanı: **Arka plan (Background)**, **Metin (Text)** ve
    **Soluk metin (Muted text)** — her biri kendi renk seçicisi ve hex
    alanına sahiptir.
- **Ekran (Screen) bölümü:** Yazıcı ekranındaki nesneleri (logo, metin, ikon,
  görsel gibi) düzenlediğiniz alandır. Nesneleri **sürükleyerek
  taşıyabilir**, bir metin nesnesine **çift tıklayarak** içeriğini
  düzenleyebilirsiniz. Bir ikon veya görsel yüklemek isterseniz **yükleme
  (upload)** kontrolünü kullanın. **Sınır:** yüklediğiniz dosya **görsel
  (image) türünde** olmalı ve **2 MB'ın altında** olmalıdır; aksi halde
  sırasıyla "**Icon must be an image.**" (ikon bir görsel olmalı)
  / "**Icon must be under 2 MB.**" (ikon 2 MB'ın altında olmalı)
  ya da görsel nesneleri için "**Image must be an image file.**" /
  "**Image must be under 2 MB.**" hata mesajlarını alırsınız.
- **Güvenlik (Security) bölümü:** **Personel PIN'i (Staff PIN)** alanı — yalnızca
  rakam kabul eder, **en çok 6 hane** uzunluğundadır, yanındaki göz
  simgesiyle (Eye/EyeOff) PIN'i **göster/gizle**yebilirsiniz.

**Sağ panel — Canlı önizleme (Live preview):**

- Başlık "**Live preview**", altında "**4″ printer · 720 × 720 · 100% ≈
  actual size**" (4 inç yazıcı · 720 × 720 · %100 ≈ gerçek boyut) açıklaması
  bulunur.
- **Önizleme (Preview)** düğmesi, o an seçili ekranı **tam ekran** bir
  diyalog içinde, düzenleme araçları olmadan (temiz biçimde) gösterir.
- **Ekran seçici (screen selector)** — açılır bir liste (dropdown) olarak,
  aşağıdaki **7 yazıcı ekranından** birini seçmenizi sağlar:
  1. **Boşta / hazır (Idle / ready)**
  2. **İşleniyor (Processing)**
  3. **Belge hazır (Document ready)**
  4. **Gönderildi ✓ (Sent ✓)**
  5. **Hata / çevrimdışı (Error / offline)**
  6. **Duraklatıldı (Paused)**
  7. **Kurulum / eşleştirme (Setup / pairing)**
- **Yakınlaştırma (Zoom) kaydırıcısı:** eksi/artı düğmeleriyle veya
  kaydırıcının kendisiyle önizlemeyi büyütüp küçültebilirsiniz; yanında
  o anki yüzde değeri ("**{n}%**") görünür.
- Yalnızca **Idle / ready** ekranı seçiliyken önizlemenin altında "**Drag
  to arrange the idle screen — double-click any text to edit it. Swipe or
  use the arrows to switch screens.**" (Idle ekranını sürükleyerek
  düzenleyin — herhangi bir metne çift tıklayarak düzenleyin. Ekranlar
  arasında geçmek için kaydırın veya okları kullanın) ipucu metni; diğer
  ekranlarda "**Swipe or use the arrows to switch screens. The QR shown is
  illustrative.**" (Ekranlar arasında geçmek için kaydırın veya okları
  kullanın. Gösterilen QR temsilidir) metni görünür.

**Kaydet çubuğu (sticky, ekranın altına yapışık):** solda bir renkli nokta
ve "**Unsaved changes**" (kaydedilmemiş değişiklikler) / "**All changes
saved**" (tüm değişiklikler kaydedildi) durumu; sağda **Sıfırla (Reset)**
ve **Markayı kaydet (Save branding)** düğmeleri (kaydetme sürerken
"**Saving…**" yazar). Her iki düğme de değişiklik yoksa (dirty=false)
devre dışıdır.

### Adım adım: Markayı düzenleme ve kaydetme

> Bu adımlar yalnızca **Sahip (Owner)** veya **Yönetici (Admin)**
> rolündeki kullanıcılar için geçerlidir; **Üye (Member)** rolündeyseniz
> tüm alanlar devre dışıdır.

1. Sol menüden **Marka (Branding)** ekranına gidin.
2. **Brand** bölümünde dilerseniz **Logo metni (Logo text)** alanını
   deneyin — **unutmayın, bu alan yalnızca önizleme içindir ve
   kaydedilmez**. Kalıcı olarak değiştirmek istediğiniz **Vurgu rengi
   (Accent color)**'ı hazır renklerden seçin veya hex kodunu doğrudan
   yazın; gerekirse **Advanced theme** altındaki Background/Text/Muted
   text renklerini de ayarlayın.
3. **Screen** bölümünü açıp yazıcı ekranındaki nesneleri sürükleyerek
   düzenleyin; bir metni değiştirmek için üzerine çift tıklayın. İkon veya
   görsel yüklerken dosyanızın **görsel formatında** ve **2 MB'ın altında**
   olduğundan emin olun.
4. **Security** bölümünde isterseniz **Personel PIN'i (Staff PIN)**'ni
   girin (en çok 6 hane); göz simgesiyle girdiğinizi doğrulayabilirsiniz.
5. Değişikliklerinizi sağdaki **Canlı önizleme (Live preview)** panelinden,
   gerekirse **Ekran seçici** ile farklı ekranlara geçerek ve **Önizleme
   (Preview)** düğmesiyle tam ekran kontrol edin.
6. Vazgeçmek isterseniz **Sıfırla (Reset)** düğmesine basarak tüm alanları
   son kaydedilmiş duruma döndürebilirsiniz.
7. Kaydetmek için **Markayı kaydet (Save branding)** düğmesine tıklayın.
   - **Vurgu rengi** alanına geçersiz bir hex değeri girilmişse "**Enter a
     valid hex color first.**" (önce geçerli bir hex renk girin) hatası
     alırsınız ve kayıt gerçekleşmez.
   - İşlem başarılı olursa "**Branding saved**" başlıklı bir bildirim ile
     birlikte "**Your printers will update on next sync.**" (yazıcılarınız
     bir sonraki senkronizasyonda güncellenecek) açıklaması görünür.
   - İşlem başarısız olursa "**Couldn't save branding**" (marka
     kaydedilemedi) hata bildirimi, altında sunucudan gelen ayrıntılı hata
     mesajıyla birlikte görünür.
   - Bu işlemi yapmaya yetkiniz yoksa "**You don't have permission to edit
     branding.**" (marka düzenleme yetkiniz yok) hatası alırsınız.

### İpuçları

- **Logo metni (Logo text)** alanının **kaydedilmediğini** unutmayın —
  sayfayı yenilediğinizde veya başka bir ekrana geçip geri döndüğünüzde bu
  alan sıfırlanır. Kalıcı bir marka adı/logosu göstermek istiyorsanız
  **Screen** bölümündeki nesneleri (metin/logo/görsel) kullanın.
  Yayınlanmadan önce mutlaka önizleyip kontrol edin.
- İkon/görsel yüklerken **2 MB** sınırını ve **yalnızca görsel dosya**
  kuralını unutmayın; bu sınırın üzerindeki veya görsel olmayan bir dosya
  reddedilir.
- **Üye (Member)** rolündeyseniz bu ekranın tamamı salt-okunurdur; herhangi
  bir alanı düzenleyemez veya kaydedemezsiniz.
- Kaydettiğiniz değişiklikler yazıcılara **anında** yansımaz; yazıcılar bir
  sonraki senkronizasyonda (sync) yeni yapılandırmayı alır.

## 8. Cihaz Ayarları (Device Settings)

### Bu ekran ne işe yarar?

**Cihaz Ayarları (Device Settings)** ekranı (adres:
**`/tenant/device-settings`**) — başlığı "**Device Settings**", açıklaması
"**Policies applied to every device in your organization. Devices update
automatically.**" (organizasyonunuzdaki her cihaza uygulanan politikalar;
cihazlar otomatik olarak güncellenir) — kiracınıza bağlı **tüm cihazlar
için ortak** olarak geçerli olan davranış ayarlarını (QR kodunun ne kadar
süre ekranda kalacağı, ekran parlaklığı, ekran uykusu ve cihaz üzerindeki
Ayarlar sayfasının PIN korumasını) tek bir yerden yönetmenizi sağlar. Bu
ayarlar mağaza veya cihaz bazında değil, **organizasyon genelinde**
uygulanır. **Sahip (Owner)** ve **Yönetici (Admin)** rolündeki kullanıcılar
bu ekranı düzenleyebilir; **Üye (Member)** rolündeki kullanıcılar için
ekran **salt-okunur (read-only)**'dur.

### Ekranda neler var?

- **QR kodu görünürlük süresi (QR code visible for):** bir kaydırıcı
  (slider), **15–180 saniye** aralığında, **5'er saniyelik** adımlarla
  ayarlanır; yanında o anki değer "**{n}s**" biçiminde gösterilir. Altında
  "**How long the document QR code stays on screen before the device
  returns to idle (15–180s).**" (belge QR kodunun, cihaz boşta durumuna
  dönmeden önce ekranda ne kadar süre kalacağı) açıklaması bulunur.
- **Ekran parlaklığı (Screen brightness):** bir kaydırıcı, **%10–%100**
  aralığında, **%1'lik** adımlarla ayarlanır; yanında o anki değer
  "**{n}%**" biçiminde gösterilir.
- **Ekran uykusu (Screen sleep):** bir açma/kapama anahtarı (toggle).
  Altında "**Turn the display off after inactivity. The device stays
  online and wakes on touch or when a new document prints.**" (hareketsizlik
  sonrası ekranı kapatır; cihaz çevrimiçi kalmaya devam eder ve dokunuşla
  veya yeni bir belge geldiğinde uyanır) açıklaması bulunur. Bu anahtar
  **açıkken**, altında ek olarak **Şu süre sonra uykuya geç (Sleep
  after)** başlıklı bir açılır liste (dropdown) belirir; seçenekleri şöyledir:
  **30 sn (30 seconds)**, **1 dk (1 minute)**, **2 dk (2 minutes)**,
  **5 dk (5 minutes)**, **10 dk (10 minutes)**, **15 dk (15 minutes)**,
  **30 dk (30 minutes)**, **60 dk (60 minutes)**.
- **Cihaz Ayarları PIN'i (Device Settings PIN):** cihazın kendi ekranındaki
  Ayarlar sayfasını korumak için kullanılan, **4 ile 12 hane arası**
  sayısal bir PIN alanıdır (şifre tipinde giriş; yer tutucu, PIN daha önce
  ayarlanmışsa "**Enter new PIN to change**", ayarlanmamışsa "**Set a
  PIN**"). Halihazırda bir PIN ayarlıysa, alanın altında **PIN'i kaldır
  (Remove PIN — leave Settings page unlocked)** onay kutusu (checkbox) da
  görünür.
- **Kaydet çubuğu (sticky, ekranın altına yapışık):** solda bir renkli
  nokta ve durum metni — düzenleme yetkiniz yoksa **"Read only"** (salt
  okunur), varsa **"Unsaved changes"** (kaydedilmemiş değişiklikler) veya
  **"All changes saved"** (tüm değişiklikler kaydedildi); sağda **Sıfırla
  (Reset)** ve **Kaydet (Save)** düğmeleri (kaydetme sürerken "**Saving…**"
  yazar). Değişiklik yoksa veya yetkiniz yoksa her iki düğme de devre
  dışıdır.

### Adım adım: Cihaz politikalarını ayarlama

> Bu adımlar yalnızca **Sahip (Owner)** veya **Yönetici (Admin)**
> rolündeki kullanıcılar için geçerlidir; **Üye (Member)** rolündeyseniz
> kaydet çubuğunda "**Read only**" görürsünüz ve alanları değiştiremezsiniz.

1. Sol menüden **Cihaz Ayarları (Device Settings)** ekranına gidin.
2. **QR kodu görünürlük süresi (QR code visible for)** kaydırıcısını
   **15–180 saniye** arasında, 5'er saniyelik adımlarla istediğiniz değere
   getirin.
3. **Ekran parlaklığı (Screen brightness)** kaydırıcısını **%10–%100**
   arasında, %1'lik adımlarla ayarlayın.
4. Gerekiyorsa **Ekran uykusu (Screen sleep)** anahtarını açın; açıldığında
   beliren **"Sleep after"** açılır listesinden bir süre seçin (30 sn (30
   seconds) ile 60 dk (60 minutes) arasındaki seçeneklerden biri).
5. Cihazın kendi ekranındaki Ayarlar sayfasını korumak istiyorsanız
   **Cihaz Ayarları PIN'i (Device Settings PIN)** alanına **4 ile 12 hane
   arası** bir PIN girin. Zaten bir PIN ayarlıysa ve kaldırmak istiyorsanız
   **"Remove PIN (leave Settings page unlocked)"** onay kutusunu işaretleyin.
6. Vazgeçmek isterseniz **Sıfırla (Reset)** düğmesine basarak tüm alanları
   son kaydedilmiş duruma döndürebilirsiniz.
7. Kaydetmek için **Kaydet (Save)** düğmesine tıklayın.
   - Girdiğiniz PIN 4–12 hane kuralına uymuyorsa "**PIN must be 4–12
     digits.**" (PIN 4 ile 12 hane arasında olmalı) hatası alırsınız ve
     kayıt gerçekleşmez.
   - İşlem başarılı olursa "**Device settings saved. Devices will update on
     next check-in.**" (cihaz ayarları kaydedildi; cihazlar bir sonraki
     bağlantı kontrolünde güncellenecek) başarı bildirimi görünür ve sayfa
     otomatik olarak yenilenir.
   - Bu işlemi yapmaya yetkiniz yoksa "**You don't have permission to edit
     device settings.**" (cihaz ayarlarını düzenleme yetkiniz yok) hatası
     alırsınız.

### İpuçları

- Bu ekrandaki tüm ayarlar **organizasyon genelindedir** — belirli bir
  mağaza veya cihaz için ayrı bir değer ayarlayamazsınız; yaptığınız
  değişiklik kiracınıza bağlı **tüm cihazları** etkiler.
- Kaydettiğiniz ayarlar cihazlara **anında** yansımaz; her cihaz bir
  sonraki bağlantı kontrolünde (check-in) yeni ayarları alır.
- **Cihaz Ayarları PIN'i**'ni kaldırırsanız, cihazın kendi ekranındaki
  Ayarlar sayfası **kilitsiz** hale gelir — bu sayfaya fiziksel erişimi
  olan herkes ayarlara ulaşabilir.
- **Üye (Member)** rolündeyseniz bu ekranın tamamı salt-okunurdur; kaydet
  çubuğunda her zaman "**Read only**" görürsünüz.

## 9. Üyeler (Members)

### Bu ekran ne işe yarar?

**Üyeler (Members)** ekranı (adres: **`/tenant/members`**, başlığı
"**Members**") kiracınızda (organizasyonunuzda) çalışan kullanıcıları
yönetmenizi sağlar: yeni bir kişiyi e-posta ile davet etmek, mevcut
üyelerin **rolünü** değiştirmek, bir üyeyi kiracıdan çıkarmak ve bekleyen
davetleri iptal etmek. **Sahip (Owner)** ve **Yönetici (Admin)** rolündeki
kullanıcılar bu ekranı yönetebilir; **Üye (Member)** rolündeki kullanıcılar
için ekran tamamen **salt-okunur (read-only)**'dur — davet formunu ve hiçbir
işlem düğmesini görmezler, yalnızca üye ve davet listelerini görüntüleyebilirler.

### Ekranda neler var?

- **Başlık:** "**Members**" — bu ekranda ayrıca bir alt açıklama metni
  bulunmaz.
- **Davet formu** (yalnızca Sahip/Yönetici rolündeki kullanıcılara görünür):
  - **E-posta (Email)** alanı — **zorunlu**, yer tutucu metni
    "**teammate@company.com**".
  - **Rol (Role)** açılır listesi (dropdown) — iki seçenek sunar: **Üye
    (Member)** (varsayılan seçili değer) ve **Yönetici (Admin)**. Bir davet
    yalnızca bu iki rolden biriyle verilebilir; **Sahip (Owner)** rolü davet
    yoluyla **hiçbir zaman** atanamaz.
  - **Davet et (Invite)** düğmesi — form gönderilirken (işlem sürerken)
    devre dışı kalır; düğme metni değişmez.
  - Form gönderiminde bir hata oluşursa (örn. geçersiz e-posta), formun
    altında kırmızı bir hata metni görünür: "**Enter a valid email.**"
    (geçerli bir e-posta girin).
  - **Önemli:** Davet başarıyla gönderildiğinde ekranda herhangi bir başarı
    bildirimi (toast) **görünmez** — yalnızca **E-posta (Email)** alanı
    otomatik olarak temizlenir. Davet e-postası alıcıya gönderilir ve yeni
    davet, aşağıda anlatılan **"Bekleyen davetler (Pending invitations)"**
    listesinde görünür.
- **Üyeler tablosu:** tablonun üstünde "**Members**" başlıklı bir bölüm
  başlığı bulunur (sayfa başlığıyla aynı metni tekrarlar). Tablonun kendisi
  ise **sütun başlığı satırı içermez** — her satırda sırasıyla şu bilgiler
  yer alır:
  - Üyenin **adı**,
  - Üyenin **e-postası**,
  - Üyenin **rolü** — **Önemli:** bu değer **Türkçeleştirilmemiştir**;
    ekranda ham (İngilizce) "**owner**", "**admin**" veya "**member**"
    metni olduğu gibi görünür.
  - Sahip (Owner)/Yönetici (Admin) rolündeki kullanıcılar için, **owner
    olmayan** her satırın sonunda iki bağlantı-düğme bulunur: **"Yönetici
    yap (Make admin)"** (satırdaki kişi şu an üye ise) veya **"Üye yap (Make
    member)"** (satırdaki kişi şu an yönetici ise), ve yanında **"Kaldır
    (Remove)"** (kırmızı renkte). **Owner (sahip) rolündeki satırda bu iki
    düğme hiç görünmez** — bu, sahibin kazayla rolünün değiştirilmesini veya
    kiracıdan çıkarılmasını engelleyen bir korumadır. (Arka planda sunucu
    tarafında da aynı koruma vardır: bu işlemler owner'a zorlanmaya
    çalışılırsa sırasıyla "**Cannot remove the owner.**" (sahip
    kaldırılamaz) ve "**Cannot change the owner's role.**" (sahibin rolü
    değiştirilemez) hatalarını döndürür.)
- **Bekleyen davetler (Pending invitations)** bölümü — yalnızca bekleyen en
  az bir davet varsa görünür. Bölüm başlığı "**Pending invitations**".
  Tablo, üyeler tablosu gibi **sütun başlığı satırı içermez**; her satırda
  sırasıyla: davet edilen kişinin **e-postası**, verilen **rolü** (yine
  **Türkçeleştirilmemiş** ham "admin"/"member" metni) ve — yalnızca Sahip/
  Yönetici rolündeki kullanıcılar için — bir **"İptal (Cancel)"** bağlantı-
  düğmesi (kırmızı renkte) yer alır.

### Adım adım: Üye davet etme

> Bu adımlar yalnızca **Sahip (Owner)** veya **Yönetici (Admin)** rolündeki
> kullanıcılar için geçerlidir; **Üye (Member)** rolündeyseniz davet formunu
> hiç görmezsiniz.

1. Sol menüden **Üyeler (Members)** ekranına gidin.
2. **E-posta (Email)** alanına davet etmek istediğiniz kişinin e-posta
   adresini girin.
3. **Rol (Role)** açılır listesinden **Üye (Member)** veya **Yönetici
   (Admin)** seçin (varsayılan **Üye (Member)**'dir).
4. **Davet et (Invite)** düğmesine tıklayın.
5. Girdiğiniz e-posta geçerli bir biçimde değilse "**Enter a valid
   email.**" hatası alırsınız ve davet gönderilmez.
6. İşlem başarılı olursa **E-posta (Email)** alanı otomatik olarak
   temizlenir (herhangi bir başarı bildirimi görünmez); davet edilen kişiye
   bir davet e-postası gider ve yeni davet **"Bekleyen davetler (Pending
   invitations)"** listesinde görünür.

### Adım adım: Rol değiştirme / üye kaldırma

> Bu adımlar yalnızca **Sahip (Owner)** veya **Yönetici (Admin)** rolündeki
> kullanıcılar için geçerlidir; **owner** rolündeki satırlar için bu
> işlemlerin ikisi de kullanılamaz (düğmeler görünmez).

1. **Üyeler tablosunda**, rolünü değiştirmek veya kaldırmak istediğiniz
   **owner olmayan** üyenin satırını bulun.
2. Rolünü değiştirmek için **"Yönetici yap (Make admin)"** veya **"Üye yap
   (Make member)"** bağlantı-düğmesine tıklayın; değişiklik anında
   uygulanır — onay diyaloğu veya başarı bildirimi çıkmaz, tablo doğrudan
   güncellenir.
3. Üyeyi kiracıdan çıkarmak için **"Kaldır (Remove)"** bağlantı-düğmesine
   tıklayın; kaldırma işlemi de anında uygulanır, onay diyaloğu çıkmaz.
4. İşlem başarısız olursa, form alanının üstünde kırmızı bir hata metni
   görünür (örn. yetkiniz yoksa "**Not allowed.**").
5. Bekleyen bir daveti iptal etmek için, **"Bekleyen davetler (Pending
   invitations)"** listesindeki ilgili satırda **"İptal (Cancel)"**
   bağlantı-düğmesine tıklayın; davet anında iptal edilir ve listeden
   kaldırılır.

### İpuçları

- Üyeler ve bekleyen davetler tablolarının **sütun başlığı satırı yoktur**;
  her satırdaki bilgilerin sırasını (ad → e-posta → rol / e-posta → rol)
  takip ederek okuyun.
- Tablolardaki **rol (role)** değerleri ("owner"/"admin"/"member")
  **Türkçeleştirilmemiştir**; ham İngilizce metin olarak görünür — Bölüm
  6'daki komut geçmişi tablosuna benzer bir istisnadır.
- Bu ekranda hiçbir işlem (davet gönderme, rol değiştirme, üye kaldırma,
  davet iptali) bir **onay diyaloğu** göstermez ve çoğu başarılı işlem bir
  **başarı bildirimi (toast)** de göstermez — sonucu doğrudan tablonun
  güncellenmesinden anlarsınız.
- **Sahip (Owner)** rolü ne davetle verilebilir ne de sonradan
  değiştirilebilir/kaldırılabilir — bu rol her zaman korunur.
- **Üye (Member)** rolündeyseniz bu ekran sizin için tamamen
  salt-okunurdur: davet formunu göremez, hiçbir satırda işlem düğmesi
  göremezsiniz.

## 10. Raporlar (Reports)

### Bu ekran ne işe yarar?

**Raporlar (Reports)** ekranı (adres: **`/tenant/reports`**) — başlığı
"**Reports**", açıklaması "**Activations, breakdowns, and eco savings across
your fleet.**" (filonuz genelinde aktivasyonlar, kırılımlar ve eko
tasarruflar) — kiracınızın tüm mağaza ve cihazları genelindeki aktivasyon
verilerini zaman içinde, mağazaya göre ve cihaza göre kırılımlarla birlikte
gösterir; ayrıca eko (çevresel) tasarruf verilerini sunar ve tüm bu verileri
tek bir CSV dosyası olarak dışa aktarmanızı sağlar. **Bu ekranda herhangi bir
düzenleme kontrolü yoktur** — salt bilgilendirme ve dışa aktarma amaçlıdır;
**Sahip (Owner)**, **Yönetici (Admin)** ve **Üye (Member)** rolündeki tüm
kullanıcılar bu ekranı **aynı şekilde** görür, rol kısıtlaması yoktur.

### Ekranda neler var?

- **Başlık ve açıklama:** "**Reports**" / "**Activations, breakdowns, and
  eco savings across your fleet.**"; sağ üstte **"Raporu dışa aktar (Export
  report)"** düğmesi (bir indirme simgesiyle birlikte).
- **"Aktivasyonlar zaman içinde (Activations over time)" kartı:** açıklaması
  "**Monthly activations, last 9 months**" (son 9 ayın aylık
  aktivasyonları); bir alan grafiği (area chart) ile gösterilir.
- İki sütunlu bir ızgara:
  - **"Mağazaya göre (By store)" kartı:** açıklaması "**Activations this
    month, per branch**" (bu ay, şube bazında aktivasyonlar); yatay bir çubuk
    grafiği (bar chart) ile gösterilir. Mağazalar, bu ayki aktivasyon
    sayısına göre **çoktan aza** sıralanır.
  - **"Cihaza göre (By device)" kartı:** açıklaması "**Top printers by
    activations this month**" (bu ay en çok aktivasyon yapan yazıcılar); yine
    çubuk grafiği ile, bu ayki aktivasyona göre en yoğun **en fazla 8 cihaz**
    listelenir. Her çubuğun etiketi "**{mağaza adının ilk kelimesi} ·
    {cihaz adı}**" biçimindedir.
- 3 sütunlu bir ızgara (ilk kart 2 sütun kaplar):
  - **"Zaman içinde eko tasarruf (Eco savings over time)" kartı:** açıklaması
    "**Paper saved per month (kg)**" (ay bazında tasarruf edilen kağıt, kg);
    bir alan grafiği ile gösterilir.
  - **"Eko etki (Eco impact)" kartı:** Panel (Dashboard) ekranındaki (bkz.
    Bölüm 4) aynı karttır — "**From {n} paperless documents {dönem}.**"
    açıklaması ve **Ağaç (trees)**, **Kâğıt (paper)**, **Su (water)**, **CO₂e**
    istatistik kutuları. **Fark:** burada dönem metni "**last 9 months**"
    (son 9 ay) yazar — Panel ekranındaki "this month" (bu ay) yerine, son 9
    aylık toplam aktivasyona göre hesaplanır.
- **QUIRK — düşük öncelikli not:** **"Mağazaya göre (By store)"** kartında
  (ve dışa aktarılan CSV'nin **"Mağazaya göre (By store)"** bölümünde) mağaza
  adlarının
  başındaki sabit "**Roastwell **" öneki otomatik olarak kırpılır. Bu, bir
  demo kalıntısıdır ve yalnızca bu tam metinle başlayan mağaza adlarını
  etkiler; "Cihaza göre (By device)" kartındaki etiketler bu kırpmadan
  etkilenmez.

### Adım adım: Raporu dışa aktarma (CSV)

1. Sol menüden **Raporlar (Reports)** ekranına gidin.
2. Sağ üstteki **"Raporu dışa aktar (Export report)"** düğmesine tıklayın.
3. Tarayıcınız herhangi bir diyalog göstermeden anında bir **CSV** dosyası
   indirir; dosya adı **`{kiracı-adının-küçük-harfli-tireli-hali}-report.csv`**
   biçimindedir (örnek: "Roastwell Coffee" adlı bir kiracı için
   "**roastwell-coffee-report.csv**").
4. CSV dosyasının sütunları **Bölüm (Section)**, **Etiket (Label)**,
   **Aktivasyonlar (Activations)**'tır; tek dosya içinde 3 bölüm art arda yer
   alır: **Aylık (Monthly)** (Aktivasyonlar zaman içinde kartındaki 9 aylık
   veriyle eşleşir), **Mağazaya göre (By store)** (Mağazaya göre kartıyla
   eşleşir, "Roastwell " öneki kırpılmış olarak) ve **Cihaza göre (By
   device)** (Cihaza göre kartındaki en fazla 8 satırla eşleşir).
5. İndirme tamamlandığında ekranın altında **"Export ready"** (dışa aktarma
   hazır) başlıklı bir başarı bildirimi görünür; açıklamasında "**{n} rows →
   {dosya adı}**" (kaç satırın hangi dosyaya aktarıldığı) yazar.

### İpuçları

- Bu ekranda **hiçbir rol kısıtlaması yoktur** — Sahip, Yönetici ve Üye
  rolündeki herkes aynı kartları görür ve raporu aynı şekilde dışa aktarabilir.
- Dışa aktarma tamamen tarayıcı içinde (istemci tarafında) gerçekleşir;
  sunucuya ayrı bir istek gitmez, indirme anında başlar.
- **"Eko etki (Eco impact)"** kartındaki 4 istatistik kutusunun (Ağaç/Kâğıt/
  Su/CO₂e) ayrıntılı açıklaması için Bölüm 4'e bakın; buradaki tek fark
  dönemin "son 9 ay" olmasıdır.
- "Roastwell " önek kırpma davranışı yalnızca kozmetik bir demo kalıntısıdır;
  bir hata olarak yorumlamayın.

## 11. Analitik (Analytics)

### Bu ekran ne işe yarar?

**Analitik (Analytics)** ekranı (adres: **`/tenant/analytics`**) — başlığı
"**Analytics**", açıklaması "**Compare activation volume and trends across
your stores.**" (mağazalarınız arasındaki aktivasyon hacmini ve eğilimlerini
karşılaştırın) — kiracınıza bağlı **mağazaları birbiriyle karşılaştırmanızı**
sağlar: her mağazanın bu ayki aktivasyon sayısı, geçen aya göre eğilimi
(artış/azalış/yeni) ve son 9 aylık aylık seyri (trajectory). Raporlar
ekranı gibi bu ekran da **salt bilgilendirme ve dışa aktarma** amaçlıdır;
**Sahip (Owner)**, **Yönetici (Admin)** ve **Üye (Member)** rolündeki tüm
kullanıcılar aynı görünümü görür, rol kısıtlaması yoktur.

### Ekranda neler var?

- **Başlık ve açıklama:** "**Analytics**" / "**Compare activation volume
  and trends across your stores.**"; sağ üstte **"Analitiği dışa aktar
  (Export analytics)"** düğmesi — bu düğme, aşağıda anlatılan boş durumda
  bile her zaman görünür.
- **Boş durum:** kiracınızda hiç mağaza yoksa, ortalanmış bir kart içinde
  "**No store data yet**" (henüz mağaza verisi yok) başlığı ve altında
  "**Once your stores start showing QR codes, comparisons show up here.**"
  (mağazalarınız QR kod göstermeye başladığında karşılaştırmalar burada
  görünür) açıklaması gösterilir.
- Mağazanız varsa, sırasıyla 3 kart görünür (tüm kartlarda mağazalar bu ayki
  aktivasyon sayısına göre **çoktan aza** sıralanır):
  - **"Mağazaya göre aktivasyonlar (Activations by store)" kartı:**
    açıklaması "**This month, highest first**" (bu ay, en yüksekten
    başlayarak); çubuk grafiği (bar chart) ile gösterilir.
  - **"Mağaza karşılaştırması (Store comparison)" kartı:** açıklaması
    "**This month vs last, per store**" (mağaza bazında bu ay - geçen ay
    karşılaştırması); her mağaza için bir satır listeler. Her satırda solda
    mağaza adı ve altında "**{n} activations**" (bu ayki aktivasyon sayısı)
    yer alır; sağda bir **eğilim (trend)** etiketi bulunur:
    - Mağazanın **geçen ay** hiç aktivasyonu yoksa (sayı 0 ise; bu, yeni
      eklenmiş bir mağaza için de geçerli olabilir ya da geçen ay basitçe
      hiç aktivasyon üretmemiş olabilir), etiket gri renkte **"yeni
      (new)"** yazar.
    - Aksi halde, bu ayki sayı geçen aya göre **artmışsa** yeşil renkte bir
      **▲** oku ile birlikte yüzde değişim ("**▲ {n}%**") gösterilir;
      **azalmışsa** kırmızı renkte bir **▼** oku ile birlikte yüzde
      değişimin mutlak değeri ("**▼ {n}%**") gösterilir.
  - **"Yörüngeler (Trajectories)" kartı:** açıklaması "**Monthly activations
    per store, last 9 months**" (mağaza bazında son 9 ayın aylık
    aktivasyonları); her mağaza için ayrı bir çizgiyle son 9 aylık seyri
    gösteren bir grafikle sunulur.

### Adım adım: Analitiği dışa aktarma (CSV)

1. Sol menüden **Analitik (Analytics)** ekranına gidin.
2. Sağ üstteki **"Analitiği dışa aktar (Export analytics)"** düğmesine
   tıklayın.
3. Tarayıcınız anında sabit adlı bir **CSV** dosyası indirir: **`store-
   analytics.csv`** — Raporlar ekranının aksine, bu dosya adı kiracınıza
   göre değişmez, her zaman aynıdır.
4. CSV dosyasının sütunları **Mağaza (Store)**, **Aktivasyonlar (bu ay)
   (Activations (this month))**, **Trend yüzdesi (Trend %)** ve **Kâğıt
   tasarrufu (kg) (Paper saved (kg))**'dır; her mağaza için bir satır bulunur.
   Bir mağaza "yeni (new)" durumundaysa (geçen ay verisi yoksa), **Trend
   yüzdesi** sütununda bir yüzde yerine tire ("**—**") görünür.
5. İndirme tamamlandığında "**Export ready**" başarı bildirimi görünür;
   açıklamasında "**{n} rows → store-analytics.csv**" yazar. Boş durumda
   (hiç mağaza yoksa) bu işlem yine de çalışır ama **0 satır** içeren bir
   dosya indirir.

### İpuçları

- Eğilim rozetlerini yorumlarken şunu unutmayın: gri **"yeni (new)"**
  etiketi yalnızca "yeni açılmış mağaza" anlamına gelmez — mağazanın **geçen
  ay** hiç aktivasyonu olmadığı her durumda görünür.
- **"Mağazaya göre aktivasyonlar"** ve **"Mağaza karşılaştırması"**
  kartlarındaki mağaza sıralaması aynıdır: bu ayki aktivasyon sayısına göre
  çoktan aza.
- **"Analitiği dışa aktar (Export analytics)"** düğmesi, hiç mağaza
  verisi olmasa (boş durumda) bile her zaman görünür ve tıklanabilir.
- Bu ekranda da hiçbir düzenleme kontrolü yoktur; rolünüz ne olursa olsun
  (Sahip/Yönetici/Üye) aynı verileri görür ve aynı şekilde dışa
  aktarabilirsiniz.

## 12. Faturalandırma & Krediler (Billing)

### Bu ekran ne işe yarar?

**Faturalandırma (Billing)** ekranı (adres: **`/tenant/billing`**, başlığı "**Billing**",
açıklaması "**Manage your prepaid credit balance.**" — ön ödemeli kredi
bakiyenizi yönetin) kiracınızın **kredi bakiyesini** görüntülemenizi, yeni
kredi **satın almanızı** ve bu ayki kredi harcamasını **cihaz bazında**
incelemenizi sağlar. Ditto'da faturalandırma tamamen **ön ödemeli krediye**
dayanır: bu ekranda fatura (invoice), abonelik (subscription) veya kayıtlı
ödeme yöntemi (payment method) gibi bir kavram **yoktur** — yalnızca
bakiye, satın alma ve kullanım özeti bulunur. Sayfada herhangi bir rol
kısıtlaması yoktur; **Sahip (Owner)**, **Yönetici (Admin)** ve **Üye
(Member)** rolündeki tüm kullanıcılar bu ekranı aynı şekilde görür ve
kredi satın alma dahil aynı işlemleri yapabilir.

> **Önemli — kredi satın alma bölümü hiç görünmeyebilir:** Aşağıda
> anlatılan **"Krediler (Credits)"** bölümü, kurulumunuzda **Stripe
> yapılandırılmamışsa** ekranda **hiçbir şekilde görünmez** — ne başlığı ne
> de satın alma düğmeleri çıkar, herhangi bir uyarı ya da boş-durum mesajı
> da gösterilmez, bölüm sanki hiç yokmuş gibi tamamen atlanır. Bu, iki
> durumdan **herhangi biri** gerçekleştiğinde olur: (1) Stripe'ın herkese
> açık (yayın) anahtarı ortamda tanımlı değilse, **veya** (2) hiç kredi
> paketi (fiyatlandırılmış paket) yapılandırılmamışsa. Kurulumunuzda kredi
> satın alma düğmelerini göremiyorsanız, bu bir hata değildir — muhtemelen
> kurulumunuzda Stripe henüz etkinleştirilmemiştir; bu durumda krediler
> yalnızca platform tarafından manuel olarak tanımlanabilir (örn. kayıt
> sırasında verilen başlangıç kredileri).

### Ekranda neler var?

- **Başlık ve açıklama:** "**Billing**" / "**Manage your prepaid credit
  balance.**".
- **"Krediler (Credits)" bölümü** (Stripe yapılandırılmışsa ve en az bir
  kredi paketi varsa görünür; yukarıdaki notu bkz.):
  - "**Credits**" bölüm başlığı ve altında **Kullanılabilir (Available):**
    etiketiyle birlikte güncel kredi bakiyeniz.
  - Yapılandırılan her kredi paketi için **{n} kredi satın al (Buy {n}
    credits)** düğmesi (örn. "Buy 100 credits") — paketteki kredi sayısı
    `{n}` yerine geçer. Bir satın alma işlemi sürerken tıklanan düğmenin
    metni geçici olarak "**Loading…**" olur ve diğer tüm paket düğmeleri
    devre dışı kalır.
  - Bir paket seçildiğinde düğmelerin yerini **"Purchasing {n} credits"**
    (satın alınmakta olan kredi miktarı) metni ve hemen altında Stripe'ın
    yerleşik (inline) ödeme formu alır: bir kart/ödeme bilgisi alanı, bir
    **Şimdi öde (Pay now)** düğmesi (işlem sürerken metni
    "**Processing…**" olur) ve altında küçük bir **"Vazgeç (Cancel)"**
    düğmesi (satın almadan vazgeçip paket seçim ekranına döner).
  - Ödeme başarılı olursa **sayfa otomatik olarak yeniden yüklenir**
    (herhangi bir başarı bildirimi/toast görünmez; güncel bakiyeyi yenilenen
    sayfada görürsünüz). Ödeme başarısız olursa, formun altında kırmızı bir
    hata metni görünür ve ödeme formunda kalırsınız.
- **"Bu ayki kredi kullanımı (Credit usage this month)" bölümü:**
  - Başlığın altında **Kullanılabilir {n} (Available {n})** yazar; eğer şu
    anda **rezerve edilmiş (tutulan)** krediniz varsa (bir tetikleme işlemi
    sonuçlanmayı beklerken), yanına **"· Tutulan {n} (Held {n})"** eklenir —
    tutulan krediniz yoksa bu kısım hiç görünmez.
  - Bu ay hiç kredi harcaması yoksa: "**No credit usage this month.**"
    (bu ay kredi kullanımı yok) metni görünür.
  - Aksi halde bir tablo görünür, sütunları **Cihaz (Device)**, **Kredi
    (Credits)** ve **Tetikleme (Triggers)**'dır:
    - **Cihaz (Device)** sütununda cihazın adı yazar; harcama hangi cihaza
      ait olduğu belirlenemiyorsa (örn. cihaz sonradan silinmiş olabilir)
      bu hücrede **"Unattributed"** (sahibi belirlenemeyen) yazar.
    - **Kredi (Credits)** sütunu o cihaz için bu ay harcanan toplam kredi
      miktarını gösterir; satırlar bu sütuna göre **çoktan aza** sıralanır.
    - **Tetikleme (Triggers)** sütunu o cihaz için bu ay yapılan tetikleme
      (trigger) sayısını gösterir.
    - Tablonun en altında kalın yazılmış bir **Toplam (Total)** satırı
      bulunur; bu satır tüm cihazlardaki toplam kredi harcamasını gösterir
      (Tetikleme sütunu bu satırda boştur).

### Adım adım: Kredi satın alma

> Bu adımlar yalnızca kurulumunuzda Stripe yapılandırılmışsa ve en az bir
> kredi paketi tanımlıysa geçerlidir; aksi halde **"Krediler (Credits)"**
> bölümünü hiç göremezsiniz (yukarıdaki nota bakın).

1. Sol menüden **Faturalandırma (Billing)** ekranına gidin.
2. **"Krediler (Credits)"** bölümünde, **Kullanılabilir (Available):**
   etiketinin yanında güncel kredi bakiyenizi görün.
3. Satın almak istediğiniz paketin **{n} kredi satın al (Buy {n}
   credits)** düğmesine tıklayın (örn. "Buy 100 credits").
4. Düğme kısa süreliğine "**Loading…**" gösterir, ardından yerini
   **"Purchasing {n} credits"** metni ve Stripe'ın yerleşik ödeme formuna
   bırakır.
5. Ödeme bilgilerinizi girin ve **Şimdi öde (Pay now)** düğmesine
   tıklayın (işlem sürerken düğme metni "**Processing…**" olur).
6. Ödeme başarılı olursa sayfa otomatik olarak yeniden yüklenir ve güncel
   bakiyeniz **Kullanılabilir (Available):** etiketinin yanında görünür.
7. Ödeme sırasında bir hata oluşursa, formun altında kırmızı bir hata metni
   görünür; isterseniz **"Vazgeç (Cancel)"** düğmesiyle işlemden vazgeçip
   paket seçim ekranına dönebilirsiniz.

### İpuçları

- Kurulumunuzda kredi satın alma düğmelerini göremiyorsanız, bu bir arıza
  değildir: Stripe yapılandırılmamış veya hiç kredi paketi tanımlanmamış
  demektir (yukarıdaki nota bakın).
- Bu ekranda fatura (invoice), abonelik (subscription) ya da kayıtlı ödeme
  yöntemi (payment method) yönetimi **yoktur** — Ditto'da tek ödeme yolu
  ön ödemeli krediler satın almaktır.
- **"Bu ayki kredi kullanımı (Credit usage this month)"** tablosundaki
  **"Unattributed"** satırı, hangi cihaza ait olduğu belirlenemeyen bir
  harcamayı temsil eder; bunu bir hata olarak yorumlamayın.
- Satın alma dahil bu ekrandaki tüm işlemler için rol kısıtlaması yoktur;
  Sahip, Yönetici ve Üye rolündeki herkes aynı bakiyeyi görür ve kredi satın
  alabilir.
- **"Tutulan {n} (Held {n})"** ifadesi, henüz sonuçlanmamış (bekleyen) bir
  tetikleme işlemi için geçici olarak rezerve edilmiş krediyi gösterir;
  işlem sonuçlandığında (başarı ya da hata) bu tutar serbest kalır veya
  kesin olarak harcanır.

## 13. API

### Bu ekran ne işe yarar?

**API anahtarları (API keys)** ekranı (adres: **`/tenant/api`**, başlığı "**API keys**",
açıklaması "**Read-only keys for the Ditto public API.**" — Ditto genel
API'si için salt-okunur anahtarlar) kiracınız adına Ditto'nun genel (public)
API'sine erişim için **API anahtarları (API keys)** oluşturmanızı,
listelemenizi ve iptal etmenizi sağlar. Anahtar oluşturma ve iptal etme
işlemleri yalnızca **Sahip (Owner)** ve **Yönetici (Admin)** rolündeki
kullanıcılara açıktır; **Üye (Member)** rolündeki kullanıcılar bu ekranı
**salt-okunur** olarak görür — anahtar listesini görebilirler ama
**"API anahtarı oluştur (Create API key)"** düğmesini ve satırlardaki iptal
işlemini göremezler.

> **Önemli — başlıktaki "Read-only" ifadesi yanıltıcıdır:** Ekranın
> açıklaması "**Read-only keys**" (salt-okunur anahtarlar) dese de, bu
> **tam olarak doğru değildir**. Bir API anahtarına **`devices:trigger`**
> kapsamı (izni) verilirse, bu anahtar yalnızca veri **okumakla**
> kalmaz — gerçekten bir **cihazı tetikleyebilir** (`POST
> /api/v1/devices/{deviceId}/trigger` uç noktası üzerinden) ve bu işlem
> kiracınızın **kredi bakiyesinden kredi harcar**. Yani `devices:trigger`
> kapsamına sahip bir anahtar aslında bir **yazma (write)** eylemi
> gerçekleştirir ve gerçek para/kredi karşılığı olan bir işlemi tetikler —
> ekran başlığındaki "Read-only" (salt-okunur) ifadesiyle çelişir. Bu
> kapsamı hangi anahtarlara verdiğinize dikkat edin.

### Ekranda neler var?

- **Başlık ve açıklama:** "**API keys**" / "**Read-only keys for the Ditto
  public API.**"; yalnızca Sahip/Yönetici rolündeki kullanıcılar için sağ
  üstte bir **"API anahtarı oluştur (Create API key)"** düğmesi bulunur
  (Üye rolündeyseniz bu düğme hiç görünmez).
- **"API'yi kullanma (Using the API)" kartı:** API'yi nasıl çağıracağınızı
  özetler:
  - Temel URL (base URL): `/api/v1` (kod olarak, olduğu gibi kullanılır).
  - Kimlik doğrulama: her istekte `Authorization: Bearer <key>` başlığı
    (header) gönderilir (`<key>` yerine kendi API anahtarınızı yazarsınız).
  - Örnek uç noktalar (endpoints): `GET /usage` (kredi kullanım özeti) ve
    `POST /api/v1/devices/{deviceId}/trigger` (bir cihaz eylemini tetikler,
    örn. kendi barındırdığınız bir URL için QR kod gösterme).
  - Tam şema (schema) için bir bağlantı: **`/api/v1/openapi.json`**.
- **Anahtarlar tablosu**, sütunları **Ad (Name)**, **Anahtar (Key)**, **Son
  kullanım (Last used)** ve **Oluşturuldu (Created)**'dur:
  - **Ad (Name):** anahtara verdiğiniz isim.
  - **Anahtar (Key):** anahtarın tamamı **asla** yeniden gösterilmez; bu
    sütunda yalnızca anahtarın kısa bir **öneki** ve ardından "**…**"
    görünür (örn. `dk_live_ab12…`), gerçek anahtar değeri değil.
  - **Son kullanım (Last used):** anahtarın en son kullanıldığı tarih, veya
    hiç kullanılmadıysa **Hiç (Never)**.
  - **Oluşturuldu (Created):** anahtarın oluşturulduğu tarih.
  - Yalnızca Sahip/Yönetici rolündeki kullanıcılar için, her satırın sonunda
    bir çöp kutusu simgeli **İptal et (Revoke)** düğmesi bulunur (yalnızca
    simge, görünür metin yoktur; erişilebilirlik için gizli etiketi
    "Revoke {ad}" biçimindedir).
  - Hiç API anahtarı yoksa: "**No API keys yet.**" (henüz API anahtarı yok)
    metni görünür.
- **"API anahtarı oluştur (Create API key)" diyaloğu** (Sahip/Yönetici):
  - Başlık "**Create API key**", açıklama "**Create an API key scoped to
    this organization. Choose its permissions below.**" (bu organizasyona
    özel bir API anahtarı oluşturun; izinlerini aşağıdan seçin).
  - **Ad (Name)** alanı — **zorunlu**, en fazla 100 karakter, yer tutucu
    metni "**e.g. Analytics export**".
  - **"İzinler (Permissions)"** bölümü — iki onay kutusu (checkbox)
    sunar, her ikisi de kod biçiminde (literal) gösterilir:
    - **`usage:read`** — varsayılan olarak **işaretlidir**.
    - **`devices:trigger`** — varsayılan olarak **işaretli değildir**; hemen
      altında bir uyarı metni bulunur: "**devices:trigger lets this key
      trigger devices and spend credits.**" (devices:trigger bu anahtarın
      cihazları tetiklemesine ve kredi harcamasına izin verir).
  - Alt kısımda **"İptal (Cancel)"** ve **"Anahtar oluştur (Create key)"**
    düğmeleri (ikincisi işlem sürerken bir dönen simge ile birlikte
    "**Creating…**" gösterir).
  - Anahtar adı boş bırakılırsa (veya sunucu başka bir doğrulama hatası
    döndürürse) örneğin "**Key name is required.**" (anahtar adı zorunlu)
    gibi bir hata mesajı görünür ve diyalog açık kalır.
  - Anahtar başarıyla oluşturulunca diyalog içeriği değişir: başlık
    **API anahtarı oluşturuldu (API key created)**, açıklama "**Copy it
    now — you won't be able to see it again.**" (şimdi kopyalayın — bir
    daha göremeyeceksiniz) olur; altında anahtarın **tam değeri** kod
    biçiminde bir kutuda gösterilir, yanında bir kopyala simgesi düğmesi
    bulunur (kopyalandığında simge kısa süre bir onay işaretine döner ve
    **Panoya kopyalandı (Copied to clipboard)** bildirimi çıkar). En altta
    bir **"Tamam (Done)"** düğmesi diyaloğu kapatır.
- **"API anahtarını iptal et (Revoke API key)" diyaloğu** (Sahip/Yönetici,
  satırdaki çöp kutusu simgesine tıklanınca açılır):
  - Başlık "**Revoke API key**", açıklama "**{ad}**" will stop working
    immediately. This can't be undone." (bu anahtar hemen çalışmayı
    durduracak; bu işlem geri alınamaz).
  - **"Vazgeç (Cancel)"** ve **"İptal et (Revoke)"** düğmeleri; ikincisi
    kırmızı (yıkıcı) renktedir ve işlem sürerken bir dönen simge ile
    birlikte "**Revoking…**" gösterir.
  - İşlem başarılı olunca diyalog kapanır, bir **Anahtar iptal edildi (Key
    revoked)** başarı bildirimi (toast) görünür ve anahtar listeden
    kaybolur.

### Adım adım: API anahtarı oluşturma

> Bu adımlar yalnızca **Sahip (Owner)** veya **Yönetici (Admin)** rolündeki
> kullanıcılar için geçerlidir.

1. Sol menüden **API anahtarları (API keys)** ekranına gidin.
2. Sağ üstteki **"API anahtarı oluştur (Create API key)"** düğmesine
   tıklayın.
3. Açılan diyalogda **Ad (Name)** alanına anahtar için tanımlayıcı bir isim
   girin (örn. "Analytics export"); bu alan zorunludur.
4. **"İzinler (Permissions)"** bölümünde hangi kapsamların (scope) bu
   anahtara verileceğini seçin: `usage:read` varsayılan olarak işaretlidir;
   anahtarın cihazları tetikleyip **kredi harcamasına** izin vermek
   istiyorsanız `devices:trigger` kutusunu da işaretleyin (bu izin
   varsayılan olarak kapalıdır ve dikkatli kullanılmalıdır).
5. **"Anahtar oluştur (Create key)"** düğmesine tıklayın.
6. Ad alanı boşsa veya başka bir doğrulama hatası olursa (örn. "Key name is
   required."), hatayı düzeltip tekrar deneyin.
7. Anahtar oluşturulunca, gösterilen **tam anahtar değerini** hemen
   kopyalayın ("**Copy it now — you won't be able to see it again.**")
   — kopyala simgesine tıklayarak panoya alabilirsiniz.
8. **"Tamam (Done)"** düğmesine tıklayarak diyaloğu kapatın; yeni anahtar
   artık tabloda görünür (yalnızca öneki + "…" olarak; tam değeri bir daha
   gösterilmez).

### Adım adım: API anahtarını iptal etme

> Bu adımlar yalnızca **Sahip (Owner)** veya **Yönetici (Admin)** rolündeki
> kullanıcılar için geçerlidir.

1. Sol menüden **API anahtarları (API keys)** ekranına gidin.
2. İptal etmek istediğiniz anahtarın satırında, sağ uçtaki çöp kutusu
   simgesine tıklayın.
3. Açılan diyalogda anahtar adının ve "bu işlem geri alınamaz" uyarısının
   doğru olduğunu kontrol edin.
4. **"İptal et (Revoke)"** düğmesine tıklayın (işlem sürerken düğme metni
   "**Revoking…**" olur).
5. İşlem tamamlanınca **Anahtar iptal edildi (Key revoked)** başarı bildirimi görünür ve anahtar
   listeden kaybolur; bu anahtarla yapılan API çağrıları **hemen** başarısız
   olmaya başlar.
6. Vazgeçmek isterseniz, işlemi onaylamadan **"Vazgeç (Cancel)"** düğmesine
   tıklayın; anahtar değişmeden kalır.

### İpuçları

- Ekran başlığındaki "Read-only" (salt-okunur) ifadesine güvenmeyin:
  `devices:trigger` kapsamı verilen bir anahtar hem cihaz tetikleyebilir hem
  de kredi harcayabilir — bu kapsamı yalnızca gerçekten cihaz tetiklemesi
  gereken entegrasyonlara verin.
- Bir anahtarın tam değerini yalnızca **oluşturulduğu anda** görebilirsiniz;
  kapattıktan sonra bir daha gösterilmez — kaybederseniz eski anahtarı iptal
  edip yenisini oluşturmanız gerekir.
- **Üye (Member)** rolündeyseniz bu ekranda hiçbir işlem yapamazsınız;
  yalnızca mevcut anahtarların listesini (Ad/Anahtar öneki/Son kullanım/
  Oluşturuldu) görüntüleyebilirsiniz.
- Anahtarlar tablosundaki **Anahtar (Key)** sütununda gördüğünüz değer
  yalnızca bir **önektir**; güvenlik nedeniyle anahtarın tamamı hiçbir zaman
  yeniden görüntülenmez.
- API'nin tam şeması (tüm uç noktalar, parametreler ve yanıt biçimleri)
  için **"API'yi kullanma (Using the API)"** kartındaki **`/api/v1/openapi.json`** bağlantısını
  kullanın.

## 14. Etkinlik (Activity)

### Bu ekran ne işe yarar?

**Etkinlik (Activity)** ekranı (adres: **`/tenant/activity`**, başlığı "**Activity**")
kiracınızda gerçekleşen önemli işlemlerin **kronolojik denetim günlüğünü
(audit log)** gösterir — kim, ne zaman, hangi eylemi yaptı ve bu eylem
hangi kayda uygulandı. Bu ekran tamamen **salt-okunurdur**; hiçbir
düzenleme/silme kontrolü içermez ve **Sahip (Owner)**, **Yönetici (Admin)**
ve **Üye (Member)** rolündeki tüm kullanıcılar aynı listeyi görür, rol
kısıtlaması yoktur.

### Ekranda neler var?

- **Başlık:** "**Activity**" — bu ekranda ayrıca bir alt açıklama metni
  bulunmaz.
- **Etkinlik tablosu**, sütunları **Ne zaman (When)**, **İşlem (Action)**,
  **Yapan (Actor)** ve **Hedef (Target)**'tir:
  - **Ne zaman (When):** olayın ne kadar süre önce gerçekleştiğini gösteren
    göreli bir zaman ifadesi (örn. "3 hours ago" gibi; tam tarih değil).
  - **İşlem (Action):** olayı açıklayan insan-okur bir etiket. **Önemli:**
    bu etiketler uygulama tarafından üretilen **İngilizce** metinlerdir ve
    **Türkçeleştirilmemiştir** — ekranda olduğu gibi İngilizce görünürler.
    Görebileceğiniz örnek etiketlerden bazıları: **"Store created"**,
    **"Store updated"**, **"Device claimed"**, **"Device paused"**,
    **"Device resumed"**, **"Command sent to device"**, **"Device went
    offline"**, **"API key created"**, **"API key revoked"**, **"Branding
    updated"**, **"Device settings updated"**, **"Member invited"**,
    **"Member added"**, **"Member removed"**, **"Member role changed"**,
    **"Invitation canceled"**, **"Credits purchased"** ve **"Credits
    granted"**. (Bu listede yer almayan bir eylem türü için ekran, eylem
    adından otomatik türetilmiş genel bir etiket gösterir.)
  - **Yapan (Actor):** eylemi gerçekleştiren kişi veya sistemin adı; eylemi
    yapan bir **kullanıcı değilse** (örn. bir cihaz veya otomatik bir
    sistem süreci ise), adın yanında küçük, büyük harfli bir rozet
    görünür — örn. "**device**" veya "**system**" (bu rozet metinleri de
    **Türkçeleştirilmemiştir**, olduğu gibi görünür). Eylemi bir kullanıcı
    yaptıysa herhangi bir rozet görünmez.
  - **Hedef (Target):** eylemin uygulandığı kaydın kısa (mono/eş aralıklı
    yazı tipiyle gösterilen) kimliği; eylemin belirli bir hedefi yoksa bu
    hücrede tire ("**—**") görünür.
  - Hiç etkinlik kaydı yoksa: "**No activity yet.**" (henüz etkinlik yok)
    metni görünür.
- **Sayfalama (pagination):** tablonun altında solda "**Page {p} of
  {n}**" (kaçıncı sayfada olduğunuzu ve toplam sayfa sayısını gösterir)
  yazar; sağda **"Önceki (Previous)"** ve **"Sonraki (Next)"** bağlantıları
  bulunur. İlk sayfadaysanız **"Önceki (Previous)"** tıklanamaz hale gelir
  (gri, bağlantı değildir); son sayfadaysanız aynı şekilde **"Sonraki
  (Next)"** tıklanamaz hale gelir. Sayfa numarası adres çubuğunda
  `?page={n}` sorgu parametresi olarak tutulur.

### İpuçları

- **İşlem (Action)** sütunundaki etiketler ve **Yapan (Actor)** sütunundaki
  rozet metinleri (device/system) **Türkçeleştirilmemiştir**; Bölüm 6'daki
  komut geçmişi tablosuna ve Bölüm 9'daki rol değerlerine benzer bir
  istisnadır.
- **Hedef (Target)** sütunundaki tire ("—") bir hata değildir; yalnızca o
  eylemin belirli bir kayda uygulanmadığını gösterir (örn. bazı
  organizasyon geneli ayar değişiklikleri).
- Bu ekranda arama veya filtreleme kontrolü yoktur; kayıtları yalnızca
  sayfa sayfa (**Önceki/Sonraki**) gezerek inceleyebilirsiniz.
- Rolünüz ne olursa olsun (Sahip/Yönetici/Üye) bu ekranı aynı şekilde
  görürsünüz; hiçbir işlem düğmesi veya düzenleme kontrolü hiçbir role
  görünmez.

## 15. Rozetler ve Terimler (Sözlük)

Bu bölüm, kılavuz boyunca karşınıza çıkan durum rozetlerini ve rolleri tek
bir referans tablosunda toplar, ardından sık kullanılan terimleri kısaca
tanımlar. Her rozetin/rolün nerede ve nasıl kullanıldığı önceki bölümlerde
(özellikle Bölüm 2, 5, 6) ayrıntılı olarak anlatılmıştır; burada yalnızca
hızlı bir başvuru kaynağı sunulur.

### 15.1 Cihaz durumu (Device status)

Bu durum, **Cihaz Detayı** ekranındaki (Bölüm 6) Duraklat kontrolü kartında
doğrudan gösterilir ve **Mağaza detayı**'ndaki (Bölüm 6) cihaz kartlarının
altında **Etkin (Active)/Duraklatıldı (Paused)/Erişilemez (Unreachable)**
etiketiyle farklı bir görünümde de karşınıza çıkar (bkz. Bölüm 6):

| Değer | Renk | Anlamı |
|---|---|---|
| **Çevrimiçi (Online)** | Yeşil | Cihaza ulaşılabilir; belge (QR) kabul eder — tetiklemeye hazırdır. |
| **Çevrimdışı (Offline)** | Gri | Cihaza ulaşılamıyor; duraklat/etkinleştir kontrolü **devre dışıdır** — "Device is offline and can't be changed." (cihaz çevrimdışı ve durumu değiştirilemez). |
| **Duraklatıldı (Paused)** | Amber (turuncu-sarı) | Cihaz çevrimiçidir ama kasıtlı olarak duraklatılmıştır — belge (QR) kabul **etmez**. |

**Öncelik kuralı:** Bir cihaz hem duraklatılmış hem de uzun süredir
görülmemiş olsa bile, gösterilen durum her zaman **Duraklatıldı
(Paused)**'dır — duraklatma her koşulda önceliklidir; "Duraklatıldı" bir
cihaz asla "Çevrimdışı" olarak görünmez.

### 15.2 Mağaza durumu (rollup)

**Mağazalar (Stores)** tablosundaki (Bölüm 5) ve **Mağaza detayı**
başlığındaki (Bölüm 6) durum rozeti, aynı üç değeri (**Çevrimiçi (Online)**
/ **Çevrimdışı (Offline)** / **Duraklatılmış (Paused)**) kullanır, ancak bu
değer tek bir cihazın değil, mağazadaki **tüm cihazların toplu (rollup)**
durumundan türetilir:

1. Mağazadaki cihazlardan **en az biri çevrimiçiyse**, mağaza rozeti
   **Çevrimiçi**'dir.
2. Çevrimiçi cihaz **yoksa** ama **en az bir cihaz duraklatılmışsa**, mağaza
   rozeti **Duraklatılmış**'tır.
3. Yukarıdaki iki durum da geçerli değilse (yani tüm cihazlar çevrimdışıysa
   veya mağazada hiç cihaz yoksa), mağaza rozeti **Çevrimdışı**'dır.

### 15.3 Roller (Owner / Admin / Member)

| Rol | Yetkiler |
|---|---|
| **Sahip (Owner)** | Kiracıdaki tüm yönetimsel işlemleri yapabilir. Bu rol **silinemez** ve **davet/rol değiştirme yoluyla asla düşürülemez** — sunucu tarafında da korunur (bkz. Bölüm 9). |
| **Yönetici (Admin)** | Sahip (Owner) ile **aynı yönetimsel yetkilere** sahiptir: mağaza ekleme/düzenleme, yazıcı sahiplenme, marka/cihaz ayarlarını düzenleme, üye davet etme/rol değiştirme/kaldırma, API anahtarı oluşturma/iptal etme. |
| **Üye (Member)** | Çoğu ekranda **salt-okunur (read-only)**'dur: mağaza ekleyemez/düzenleyemez, marka veya cihaz ayarlarını düzenleyemez, üye yönetemez, API anahtarı oluşturamaz/iptal edemez, uzaktan komut gönderemez. **Aşağıdaki önemli istisnaya bakın.** |

> **Önemli istisna — Üye (Member) de cihazı duraklatabilir/etkinleştirebilir:**
> "Üye (Member) rolü salt-okunurdur" kuralının **tek istisnası**, cihaz
> kartındaki ve Cihaz Detayı ekranındaki **Duraklat (Pause)/Etkinleştir
> (Activate)** kontrolüdür (bkz. Bölüm 6). Bu işlem **rol bazında
> kısıtlanmamıştır** — Üye (Member) rolündeki bir kullanıcı da, tıpkı Sahip
> (Owner) veya Yönetici (Admin) gibi, çevrimiçi bir cihazı duraklatabilir
> veya yeniden etkinleştirebilir. Buna karşılık aynı Üye, aynı ekranda
> **mağaza eklemek/düzenlemek**, **yazıcı sahiplenmek (Claim printer)**,
> **marka veya cihaz ayarlarını düzenlemek**, **üye yönetmek** ya da
> **uzaktan komut göndermek** gibi diğer tüm işlemleri **yapamaz**. Tek
> kısıtlama, cihazın **çevrimdışı** olmamasıdır — çevrimdışı bir cihazın
> durumu hiçbir rol tarafından değiştirilemez (bkz. 15.1).

### 15.4 Sözlük (Terimler)

- **Kiracı (Tenant / Organization):** Ditto Admin'de sizin firmanızı temsil
  eden organizasyon; tipik olarak bir mağaza zincirinin tamamını kapsar
  (bkz. Bölüm 2.2).
- **Mağaza (Store / Branch):** Kiracıya bağlı tek bir şube/lokasyon; kendi
  adresi, cihazları ve aktivasyon istatistikleri vardır (bkz. Bölüm 5).
- **Cihaz / Yazıcı (Device / Printer):** Müşteriye taranacak QR kodu
  ekranında gösteren fiziksel donanım; "cihaz" olarak anılsa da aslında bir
  yazıcıdır (bkz. Bölüm 2.3).
- **Tetikleme (Trigger):** Yetkilendirilmiş bir çağıran tarafın, bir cihazda
  belirli bir URL'nin QR kodunun gösterilmesini istediği **API isteğinin
  kendisi** — henüz tamamlanmamış olabilir (bkz. Bölüm 2.4).
- **Aktivasyon (Activation):** Bir tetiklemenin cihaz tarafından başarıyla
  işlenip müşteriye QR kodun gösterilmesiyle sonuçlanan **tamamlanmış ve
  sayılan** işlem; KPI kartlarında ve grafiklerde ("Activations today/this
  month", vb.) gösterilen sayı budur. **Kısaca:** Tetikleme = istek,
  Aktivasyon = bu isteğin başarıyla tamamlanıp sayılan hâli.
- **Kredi (Credit — ön ödemeli/prepaid):** Ditto'nun ücretlendirme birimi;
  her tetikleme kiracının bakiyesinden 1 kredi rezerve eder, işlem
  başarıyla tamamlanınca (ack ile) bu kredi kesin olarak düşülür
  (bkz. Bölüm 2.5, Bölüm 12).
- **Eşleştirme kodu (Pairing code):** Sahiplenilmemiş bir cihazın ekranında
  görünen, o cihazı bir mağazaya bağlamak (claim) için kullanılan kod
  (bkz. Bölüm 6, Yazıcı sahiplenme).
- **Cihaz anahtarı (Device key):** Bir cihaz sahiplenildiğinde yalnızca
  **bir kez** gösterilen anahtar; Ditto yalnızca bunun hash'lenmiş bir
  kopyasını saklar, kaybedilirse tekrar görüntülenemez (bkz. Bölüm 6).
- **Ürün yazılımı (Firmware):** Cihazın çalıştırdığı, uzaktan
  güncellenebilen yazılım; Cihaz Detayı ekranında sürüm numarasıyla
  gösterilir (bkz. Bölüm 6).
- **Uzaktan komut (Remote command):** Cihaz Detayı ekranındaki "Uzaktan
  kontrol (Remote control)" bölümünden gönderilen (Reboot/Refresh
  config/Identify/Update firmware) komutlardan biri; cihaza anında değil,
  cihazın bir sonraki bağlantı kontrolünde (check-in) ulaşır (bkz. Bölüm 6).
- **Eko etki (Eco impact):** Kağıtsız aktivasyonların tahmini çevresel
  karşılığı; Ağaç (trees), Kâğıt (paper), Su (water) ve CO₂e istatistik
  kutularıyla Panel ve Raporlar ekranlarında gösterilir (bkz. Bölüm 4,
  Bölüm 10).

## 16. Sık Sorulanlar / Sorun Giderme

**Bir cihaz neden "Çevrimdışı (Offline)" görünüyor?**
Bir cihaz, ya hiç görülmemişse ya da son görülme zamanının üzerinden
**15 dakikadan fazla** geçmişse "Çevrimdışı (Offline)" olarak gösterilir.
Cihaz ayrıca **duraklatılmış (Paused)** durumdaysa, kaç dakikadır
görülmediğine bakılmaksızın durum her zaman "Duraklatıldı (Paused)" olarak
gösterilir — duraklatma her koşulda önceliklidir, "Duraklatıldı" bir cihaz
asla "Çevrimdışı" görünmez (bkz. Bölüm 15.1).

**Kredi nasıl satın alınır?**
**Faturalandırma (Billing)** ekranına gidin (Bölüm 12) ve **"Krediler
(Credits)"** bölümündeki paketlerden birinin **"{n} kredi satın al (Buy {n}
credits)"** düğmesine tıklayın. **Önemli:** Kurulumunuzda Stripe
yapılandırılmamışsa veya hiç kredi paketi tanımlanmamışsa, bu satın alma
bölümü ekranda **hiç görünmez** — bu bir hata değildir, bu durumda krediler
yalnızca platform tarafından manuel olarak tanımlanabilir (bkz. Bölüm 12'deki
"Önemli" notu).

**Bir yazıcıyı nasıl eklerim?**
Yazıcılar **Mağazalar (Stores)** ekranından değil, ilgili mağazanın **Mağaza
detayı** ekranından eklenir (Bölüm 6). **Sahip (Owner)** veya **Yönetici
(Admin)** rolündeyseniz, mağaza detayında **"Yazıcı sahiplen (Claim
printer)"** düğmesine tıklayın ve yazıcının kendi ekranında gördüğünüz
**eşleştirme kodunu (pairing code)** girin. Cihaz birkaç saniye içinde
otomatik olarak etkinleşir (bkz. Bölüm 6, "Adım adım: Yazıcı sahiplenme").
**Üye (Member)** rolündeyseniz bu düğmeyi göremezsiniz.

**Markadaki logo metni neden kaydedilmiyor?**
**Marka (Branding)** ekranındaki **Logo metni (Logo text — "Logo text
(preview fallback)")** alanı, tasarım gereği **yalnızca sağdaki canlı
önizleme içindir**. **"Markayı kaydet (Save branding)"** düğmesine bassanız
bile bu değer kalıcı olarak saklanmaz; sayfa yeniden yüklendiğinde eski
haline sıfırlanır. Kalıcı bir marka adı/logosu göstermek için **Screen**
bölümündeki nesneleri (metin/logo/görsel) kullanmanız gerekir (bkz.
Bölüm 7).

**API anahtarı "read-only" deniyor ama neden cihaz tetikleyip kredi
harcayabiliyor?**
**API anahtarları (API keys)** ekranının açıklaması "**Read-only keys**"
dese de, bu tam olarak doğru değildir: bir anahtara **`devices:trigger`**
kapsamı (izni) verilirse, bu anahtar `POST
/api/v1/devices/{deviceId}/trigger` uç noktası üzerinden gerçekten bir
cihazı tetikleyebilir ve bu işlem kiracınızın **kredi bakiyesinden kredi
harcar** — yani "salt-okunur" değil, gerçek bir **yazma (write)** eylemidir.
Bu kapsamı yalnızca gerçekten cihaz tetiklemesi gereken entegrasyonlara
verin (bkz. Bölüm 13'teki "Önemli" notu).

**Bir üyeyi neden admin yapamıyorum / kaldıramıyorum?**
İki olası neden vardır: (1) Rol değiştirme ve kaldırma işlemlerini yalnızca
**Sahip (Owner)** veya **Yönetici (Admin)** rolündeki kullanıcılar
yapabilir — **Üye (Member)** rolündeyseniz bu işlemleri hiç göremezsiniz.
(2) Değiştirmeye/kaldırmaya çalıştığınız kişi **Sahip (Owner)**
rolündeyse, bu işlem **hiçbir zaman** yapılamaz — owner rolü hem davetle
verilemez hem de sonradan değiştirilemez/kaldırılamaz; bu ekranda o satırda
işlem düğmeleri hiç görünmez, sunucu tarafında da aynı koruma vardır
(bkz. Bölüm 9).
