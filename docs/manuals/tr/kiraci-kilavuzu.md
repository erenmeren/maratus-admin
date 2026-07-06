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
