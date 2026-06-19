import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const root = path.resolve(import.meta.dirname, '../..')
const shots = path.join(root, 'artifacts', 'yeni-rapor', 'screenshots')
const statusShot = 'C:/Users/oguzh/AppData/Local/Temp/codex-clipboard-0bf7c342-9e07-48be-b676-829396cb23ec.png'
const scenarioShot = 'C:/Users/oguzh/AppData/Local/Temp/codex-clipboard-bb6cc022-eb9f-452c-9379-aac0a171ec79.png'
const outDir = path.join(root, 'output', 'pdf')
const qaDir = path.join(root, 'artifacts', 'yeni-rapor', 'rendered-html')
const pdfPath = path.join(outDir, 'ARES-Reflect_Akademik_Arayuz_ve_Teknik_Mimari.pdf')
const htmlPath = path.join(root, 'artifacts', 'yeni-rapor', 'academic-report-preview.html')

const imageData = async (file) => {
  const ext = path.extname(file).slice(1).replace('jpg', 'jpeg')
  const bytes = await fs.readFile(file)
  return `data:image/${ext};base64,${bytes.toString('base64')}`
}

const [status, scenarios, inputs, results, irs, validation, details] = await Promise.all([
  imageData(statusShot),
  imageData(scenarioShot),
  imageData(path.join(shots, '02-saha-girdileri.png')),
  imageData(path.join(shots, '03-terminal-ve-irs-sonuclari.png')),
  imageData(path.join(shots, '04-irs-ozet-penceresi.png')),
  imageData(path.join(shots, '06-gorsel-dogrulama.png')),
  imageData(path.join(shots, '07-proje-detaylari.png')),
])

const bullet = (text) => `<li>${text}</li>`
const figure = (src, caption, cls = '') =>
  `<figure class="${cls}"><img src="${src}"><figcaption>${caption}</figcaption></figure>`
const callout = (title, text, cls = '') =>
  `<div class="callout ${cls}"><strong>${title}</strong><p>${text}</p></div>`
const page = (number, title, content, cls = '') => `
  <section class="page ${cls}">
    <header>ARES-Reflect&nbsp;&nbsp;|&nbsp;&nbsp;Arayüz ve Sistem Çalışma Akışı</header>
    <main>${title ? `<h1>${title}</h1>` : ''}${content}</main>
    <footer>${number}</footer>
  </section>`

const html = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<style>
  @page { size: Letter; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #1f2937; font-family: Calibri, Arial, sans-serif; background: white; }
  .page { width: 8.5in; height: 11in; padding: .58in .82in .48in; page-break-after: always; position: relative; overflow: hidden; }
  header { height: .27in; font-size: 8.5pt; font-weight: 700; color: #667085; }
  main { height: 9.62in; }
  footer { position: absolute; right: .82in; bottom: .25in; color: #667085; font-size: 8.5pt; }
  h1 { margin: .18in 0 .17in; color: #142033; font-size: 17pt; line-height: 1.1; }
  h2 { margin: .21in 0 .09in; color: #2f6fff; font-size: 13.5pt; }
  p { margin: 0 0 .09in; font-size: 10.6pt; line-height: 1.42; text-align: justify; }
  ul { margin: .05in 0 .12in .22in; padding-left: .18in; }
  li { margin: 0 0 .055in; font-size: 10.15pt; line-height: 1.34; }
  figure { margin: .08in auto .14in; text-align: center; }
  figure img { max-width: 100%; max-height: 4.05in; object-fit: contain; }
  figure.tall img { max-height: 4.55in; }
  figure.short img { max-height: 1.05in; }
  figcaption { margin-top: .045in; color: #667085; font-size: 8.7pt; font-style: italic; }
  .callout { margin: .12in 0; padding: .12in .15in; background: #eafbfd; border-left: 4px solid #10b8c8; }
  .callout strong { display: block; color: #00a9b9; font-size: 10.2pt; margin-bottom: .045in; }
  .callout p { margin: 0; font-size: 9.8pt; line-height: 1.35; }
  .callout.blue { background: #f3f6fa; border-color: #2f6fff; }
  .callout.blue strong { color: #2f6fff; }
  .callout.amber { background: #fff8e8; border-color: #c68a00; }
  .callout.amber strong { color: #c68a00; }
  .cover main { padding-top: .65in; text-align: center; }
  .cover .kicker { color: #10b8c8; font-size: 11pt; font-weight: 700; }
  .cover .brand { margin: .35in 0 .2in; color: #142033; font-size: 31pt; font-weight: 700; }
  .cover .subtitle { color: #2f6fff; font-size: 19pt; font-weight: 700; }
  .cover .lead { margin: .42in auto .36in; width: 85%; color: #667085; font-size: 12pt; text-align: center; line-height: 1.45; }
  .cover .callout { text-align: left; }
  .cover h2 { text-align: left; }
  .cover ul { text-align: left; }
  .date { margin-top: .18in; color: #667085; font-size: 9.5pt; font-weight: 700; }
  .status-page figure { margin-top: .35in; margin-bottom: .22in; }
</style>
</head>
<body>
${page(1, '', `
  <div class="kicker">TEKNOFEST HAREKETLİ UYDU TERMİNALİ PROJESİ</div>
  <div class="brand">ARES-Reflect</div>
  <div class="subtitle">Arayüz Tabanlı Teknik Mimari ve Karar Destek İş Akışı</div>
  <div class="lead">Afet sonrası NLoS haberleşme bölgelerinde akıllı yansıtıcı yüzey destekli erişim koridorlarının; coğrafi veri işleme, deterministik uzamsal optimizasyon ve yükseklik duyarlı görüş hattı denetimiyle oluşturulması</div>
  ${callout('SİSTEM SINIFI VE KAPSAM', 'ARES-Reflect; OSM bina geometrileri, afet düğümleri ve enkaz sınıflandırmasını aynı jeo-uzamsal sahne modelinde birleştiren, kural tabanlı ve deterministik bir karar destek yazılımıdır. Fiziksel koordinat üretimi yerel çözücüye aittir.')}
  <h2>Teknik işlem zinciri</h2>
  <ul>
    ${bullet('Jeo-uzamsal veri normalizasyonu, bina poligon topolojisi ve enkaz/sağlam yapı ayrıştırması')}
    ${bullet('Deterministik K-Means ile hedef düğümlerin üç servis bölgesine bölünmesi')}
    ${bullet('Izgara, halka ve koridor örneklemesiyle aday uzayının oluşturulması')}
    ${bullet('Cephe normal vektörü, azimut uyumu ve montaj yüksekliğiyle IRS aday üretimi')}
    ${bullet('CLEAR, PARTIAL_NLoS ve FULL_NLoS sınıflandırmasıyla iki-atlamalı kanal denetimi')}
    ${bullet('Katı fiziksel kısıtlar ile çok ölçütlü kalite fonksiyonunun birlikte uygulanması')}
  </ul>
  <div class="date">Haziran 2026</div>
`, 'cover')}

${page(2, '1. Hesaplama kökeni, veri soyu ve durum telemetrisi', `
  ${figure(status, 'Şekil 1. Yerleşim çözücüsü, açıklama üreticisi, yeniden sıralama ve görsel doğrulama servislerinin durum telemetrisi.', 'short')}
  <p>Üst durum şeridi, hesaplama zincirindeki işlevlerin veri kökenini ve çalışma durumunu görünür kılar. Koordinatlar; deterministik kümeleme, aday tarama, poligon-kesişim testi ve kısıtlı optimizasyon sonucunda üretilir.</p>
  <ul>
    ${bullet('<b>Açıklama servisi:</b> özellik vektörünü doğal dil gerekçesine dönüştürür; geometri durumunu değiştiremez.')}
    ${bullet('<b>Reranking servisi:</b> yalnızca uygunluk filtresini geçmiş çözüm kümesinde çalışır.')}
    ${bullet('<b>Görsel doğrulama:</b> render edilmiş haritanın semantik tutarlılığını inceler; RF kanal kestirimi değildir.')}
    ${bullet('<b>PDF dışa aktarma:</b> analiz anındaki durum vektörünü değişmez saha kayıt paketine dönüştürür.')}
  </ul>
  ${callout('Yerel-öncelikli orkestrasyon', 'Sonuç, çevrim içi yapay zekâ yanıtı beklenmeden oluşturulur. Bu mimari kesintili afet haberleşmesinde düşük gecikmeli, çevrim dışı ve fail-safe çalışma sağlar.', 'blue')}
`, 'status-page')}

${page(3, '2. Senaryo uzayı ve parametrik stres seviyeleri', `
  ${figure(scenarios, 'Şekil 2. Düğüm yoğunluğu, enkaz sayısı ve kentsel blokaj karmaşıklığı artırılan deterministik deney senaryoları.', 'tall')}
  <p>Deney kümeleri farklı saha yüklerinde karşılaştırma sağlar. Zorluk; düğüm sayısı, engel yoğunluğu, aday cephe sayısı, mekânsal yayılım, rota kapanması ve NLoS oluşma olasılığının birlikte yükselmesiyle belirlenir.</p>
  <ul>
    ${bullet('Basit sınıf: seyrek engel alanı ve geniş uygulanabilir çözüm bölgesi.')}
    ${bullet('Orta sınıf: artan küme varyansı, cephe seçimi belirsizliği ve kapsama çakışması.')}
    ${bullet('Zor sınıf: dar görünürlük koridorları, kısıtlı montaj yüzeyi ve yüksek yol sapması.')}
    ${bullet('Aşırı sınıf: büyük aday uzayı, yoğun poligon-kesişim yükü ve kombinatoryal set seçimi.')}
  </ul>
  ${callout('Deneysel geçerlilik sınırı', 'Fresnel bölgesi açıklığı, çok yollu sönümleme, gölgelenme dağılımı, atmosferik kayıp ve ölçüm tabanlı kanal kestirimi mevcut modelin dışındadır.', 'amber')}
`)}

${page(4, '3. Jeo-uzamsal sahne modeli ve giriş verisi', `
  ${figure(inputs, 'Şekil 3. Afet düğümleri, enkaz sınıfları ve OSM bina ayak izlerinden oluşan jeo-uzamsal sahne modeli.')}
  <p>Harita katmanı; enlem-boylam koordinatlı afet düğümleri, enkaz yapıları ve OSM bina poligonlarını ortak sahne modelinde birleştirir. Poligon merkezi, bounding box, yaklaşık yarıçap ve varsa yükseklik/kat bilgisi normalize edilir.</p>
  <ul>
    ${bullet('Enkaz sınıfı yapısal engel listesinden çıkarılır; ayakta kalan yapılar obstrüksiyon geometrisi olarak korunur.')}
    ${bullet('Geometrik uygunluk iki ayrı testle denetlenir: nokta-poligon testi, önerilen terminal veya IRS konumunun bina ayak izi içinde kalıp kalmadığını; doğru parçası-poligon testi ise besleme ve yansıtılmış erişim güzergâhlarının sağlam bina ayak izleriyle kesişip kesişmediğini belirler.')}
    ${bullet('Eksik yüksekliklerde varsayılan değer kullanıldığından model ayrıntılı 3B yerine indirgenmiş 2.5B yaklaşımıdır.')}
    ${bullet('Deterministik başlangıç merkezleri aynı giriş sahnesinde aynı kümeleme sonucunu üretir.')}
  </ul>
`)}

${page(5, '4. Kısıtlı uzamsal optimizasyon ve aday seçimi', `
  ${figure(results, 'Şekil 4. Çok ölçütlü amaç fonksiyonuyla seçilen terminal düğümleri, yansıtıcı yüzeyler ve röle koridorları.')}
  <p>Deterministik K-Means sonrasında centroid, enkaz çeperi, koridor doğrultusu ve yerel bina halkası çevresinde aday örnekleme yapılır. Çözücü; saha uygunluğu, erişilebilirlik, kapsama, set kalitesi ve mekânsal ayrışmayı bileşik amaç fonksiyonunda değerlendirir.</p>
  <ul>
    ${bullet('<b>Katı kısıtlar:</b> yapı içinde kalmama, güvenlik çeperi, blokajsız besleme, açık hedef ve farklı sağlam cepheler.')}
    ${bullet('<b>Yumuşak ölçütler:</b> toplam yol, kapsama oranı, minimum/ortalama kalite, uydu azimutuna erişim ve centroid yakınlığı.')}
    ${bullet('Cepheler dış normal vektörü boyunca örneklenir; normal doğrultusu kaynak, hedef küme ve uydu azimutuyla karşılaştırılır.')}
    ${bullet('Set optimizasyonu mekânsal çeşitlilik, marjinal kapsama katkısı ve farklı bina zorunluluğunu birlikte gözetir.')}
  </ul>
  ${callout('Kanal modeli tanımı', 'İki-atlamalı yol yalnızca burada Terminal→IRS ve IRS→depremzede bacakları olarak tanımlanır. Sonraki bölümlerde “besleme bacağı” ve “yansıtılmış erişim bacağı” terimleri kullanılır.', 'blue')}
`)}

${page(6, '5. IRS mühendislik metrikleri ve kanal uygunluğu', `
  ${figure(irs, 'Şekil 5. Seçilen yansıtıcı yüzey için kanal, kapsama, montaj ve kalite metrikleri.', 'tall')}
  <p>Ayrıntı penceresi özellik vektörünü operasyonel mühendislik özetine dönüştürür. Besleme bacağındaki LoS ikili fiziksel uygunluğu; yansıtılmış erişim oranı kapsama yarıçapındaki açık hedef oranını temsil eder.</p>
  <ul>
    ${bullet('Kanal durumu CLEAR, PARTIAL_NLoS ve FULL_NLoS sınıflarıyla raporlanır.')}
    ${bullet('Yansıma verimi, gelme ve çıkış açılarının kosinüs tabanlı bileşimiyle kestirilir.')}
    ${bullet('Kestirimsel link kazancı; açıklık kazancı, minimum LoS faktörü ve toplam yol sapma kaybını birleştirir.')}
    ${bullet('Bileşik skor; LoS, mesafe normu, montaj yüksekliği, cephe hizası, link bütçesi ve kapsamanın ağırlıklı toplamıdır.')}
  </ul>
  ${callout('Model yorumu', 'dB değeri tam uydu link bütçesi değildir. EIRP, G/T, alıcı gürültü sıcaklığı, polarizasyon kaybı, yağmur zayıflaması ve bant genişliği modele dahil değildir.', 'amber')}
`)}

${page(7, '6. Görsel doğrulama ve karar otoritesi sınırı', `
  ${figure(validation, 'Şekil 6. Render edilmiş saha çözümünün ikincil semantik tutarlılık denetimi.', 'tall')}
  <p>Görsel katman beklenen nesne sınıflarını, işaretçi dağılımını ve bağlantı çizgilerinin genel tutarlılığını inceler. Koordinatları, kanal sınıflarını veya uygunluk kararını değiştiremez.</p>
  <ul>
    ${bullet('Yerel motor: koordinat üretimi, kısıt kontrolü, amaç fonksiyonu, set seçimi ve nihai uygunluk.')}
    ${bullet('Açıklama katmanı: sayısal çıktının denetlenebilir doğal dil gerekçesine dönüştürülmesi.')}
    ${bullet('Reranking katmanı: yalnızca eşik ve kısıt kontrollerini geçen çözümlerin önceliklendirilmesi.')}
    ${bullet('Görsel denetim: eksik işaretçi veya sunum anomalilerinin bildirilmesi.')}
  </ul>
  ${callout('Fail-safe ilke', 'Yapay zekâ servisi yanıt vermese de sistem yerel açıklama ve yerel sıralamayla çalışır; haberleşme bağımlılığı kaynaklı tek hata noktası oluşmaz.')}
`)}

${page(8, '7. ÖTR sistemiyle mühendislik bağlamı', `
  ${figure(details, 'Şekil 7. Yazılım yerleşim motoru ile fiziksel hareketli uydu terminali alt sistemlerinin bağlamsal eşleştirilmesi.')}
  <p>ÖTR bağlamında fiziksel platform; 3GPP Release 17/18 NTN hedefleri, doğrudan tahrikli BLDC motorlar, manyetik enkoder, IMU sensör füzyonu, Genişletilmiş Kalman Filtresi, kaskad PI/PID kontrolü ve slipring üzerinden sürekli azimut hareketiyle ilişkilidir.</p>
  <ul>
    ${bullet('Mekanik yönelim katmanı, bozucu hareket altında ±8° bastırma ve 8 saniyenin altında yeniden kilitlenme hedefleri taşır.')}
    ${bullet('RIS/IRS beamsteering, hücre faz profilini değiştirerek yansıtılan dalga cephesini hedef doğrultuya yönlendirir.')}
    ${bullet('Yerleşim motoru mekanik kontrol döngüsünü simüle etmez; üst seviye görev planlaması ve kurulum geometrisi üretir.')}
    ${bullet('20 kg / 140 W bütçesi fiziksel prototip kısıtıdır; yazılım skoru doğrudan kütle veya güç hesabı içermez.')}
  </ul>
  <h2>Akademik sonuç</h2>
  <p>ARES-Reflect; deterministik jeo-uzamsal analiz, kısıtlı kombinatoryal seçim ve açıklanabilir çok ölçütlü puanlamayı birleştiren yerel-öncelikli bir karar destek mimarisidir. Nihai kabul için 3B ışın izleme, ayrıntılı RF link bütçesi, Fresnel açıklığı, yapısal montaj analizi ve prototip ölçümleri gereklidir.</p>
`)}
</body>
</html>`

await fs.mkdir(outDir, { recursive: true })
await fs.mkdir(qaDir, { recursive: true })
await fs.writeFile(htmlPath, html, 'utf8')

const browser = await chromium.launch({ headless: true })
const pageHandle = await browser.newPage({ viewport: { width: 816, height: 1056 }, deviceScaleFactor: 1.5 })
await pageHandle.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' })
await pageHandle.pdf({
  path: pdfPath,
  format: 'Letter',
  printBackground: true,
  margin: { top: '0', right: '0', bottom: '0', left: '0' },
})

const pages = pageHandle.locator('.page')
const count = await pages.count()
for (let i = 0; i < count; i += 1) {
  await pages.nth(i).screenshot({ path: path.join(qaDir, `page-${String(i + 1).padStart(2, '0')}.png`) })
}
await browser.close()
console.log(JSON.stringify({ pdfPath, htmlPath, pages: count }))
