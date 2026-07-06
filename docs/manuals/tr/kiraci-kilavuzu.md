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
performansını tek bakışta özetler: kaç tetikleme yapıldığını, kaç yazıcının
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
  - **Bugünkü aktivasyonlar (Activations today):** O güne ait tetikleme
    sayısı. Kartta bir de "**+6,4%**" delta (değişim) rozeti ve "**vs.
    yesterday**" (dünle karşılaştırma) ibaresi görünür. **Önemli:** Bu
    **+6,4% değeri sabittir (hardcoded)** — gerçek bir "dünle
    karşılaştırma" hesaplaması **değildir**, ekranı her açtığınızda aynı
    rakamı görürsünüz.
  - **Bu ayki aktivasyonlar (Activations this month):** O aya ait toplam
    tetikleme sayısı. Delta rozeti "**+12,1%**", ibare "**vs. last
    month**" (geçen ayla karşılaştırma). **Önemli:** Bu **+12,1% değeri
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
    sonunda bir **kebap menü (⋮)** bulunur; bu menüde **"Mağazayı aç (Open
    store)"** ve **"Mağazayı düzenle (Edit store)"** seçenekleri yer alır.
  - **Üye (Member)** rolündeki kullanıcılar için bu kebap menü yerine,
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
   satırındaki kebap menüyü (⋮) açın ve **"Mağazayı düzenle (Edit
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

- **Brand bölümü:**
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
  - **Advanced theme (gelişmiş tema):** "leave as-is for the default
    look" (varsayılan görünüm için olduğu gibi bırakın) notuyla birlikte
    üç ek renk alanı: **Background (Arka plan)**, **Text (Metin)** ve
    **Muted text (Soluk metin)** — her biri kendi renk seçicisi ve hex
    alanına sahiptir.
- **Screen bölümü:** Yazıcı ekranındaki nesneleri (logo, metin, ikon,
  görsel gibi) düzenlediğiniz alandır. Nesneleri **sürükleyerek
  taşıyabilir**, bir metin nesnesine **çift tıklayarak** içeriğini
  düzenleyebilirsiniz. Bir ikon veya görsel yüklemek isterseniz **yükleme
  (upload)** kontrolünü kullanın. **Sınır:** yüklediğiniz dosya **görsel
  (image) türünde** olmalı ve **2 MB'ın altında** olmalıdır; aksi halde
  sırasıyla "**Icon must be an image file.**" (ikon bir görsel dosyası
  olmalı) / "**Icon must be under 2 MB.**" (ikon 2 MB'ın altında olmalı)
  ya da görsel nesneleri için "**Image must be an image file.**" /
  "**Image must be under 2 MB.**" hata mesajlarını alırsınız.
- **Security bölümü:** **Personel PIN'i (Staff PIN)** alanı — yalnızca
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
  1. **Idle / ready**
  2. **Processing**
  3. **Document ready**
  4. **Sent ✓**
  5. **Error / offline**
  6. **Paused**
  7. **Setup / pairing**
- **Zoom (yakınlaştırma) kaydırıcısı:** eksi/artı düğmeleriyle veya
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
  **açıkken**, altında ek olarak **"Sleep after" (şu süre sonra uykuya
  geç)** başlıklı bir açılır liste (dropdown) belirir; seçenekleri şöyledir:
  **30 sn**, **1 dk**, **2 dk**, **5 dk**, **10 dk**, **15 dk**, **30 dk**,
  **60 dk**.
- **Cihaz Ayarları PIN'i (Device Settings PIN):** cihazın kendi ekranındaki
  Ayarlar sayfasını korumak için kullanılan, **4 ile 12 hane arası**
  sayısal bir PIN alanıdır (şifre tipinde giriş; yer tutucu, PIN daha önce
  ayarlanmışsa "**Enter new PIN to change**", ayarlanmamışsa "**Set a
  PIN**"). Halihazırda bir PIN ayarlıysa, alanın altında **"Remove PIN
  (leave Settings page unlocked)"** (PIN'i kaldır — Ayarlar sayfasını
  kilitsiz bırak) onay kutusu (checkbox) da görünür.
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
   beliren **"Sleep after"** açılır listesinden bir süre seçin (30 sn ile
   60 dk arasındaki seçeneklerden biri).
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
