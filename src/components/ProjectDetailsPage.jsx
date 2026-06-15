const capabilityCards = [
  {
    eyebrow: 'Görev',
    title: 'Dar bant hayat koridoru',
    text:
      'ARES-Reflect, afet sonrası çöken haberleşme altyapısında geniş bant internet vaat etmez; bunun yerine SOS, GPS ve kısa mesaj gibi kritik veriler için doğrudan uyduya ulaşabilen dar bant bir iletişim koridoru açmayı hedefler.',
  },
  {
    eyebrow: 'RF yaklaşımı',
    title: 'RIS/IRS ile engel aşma',
    text:
      'Doğrudan görüş hattı enkaz veya ayakta kalan binalar nedeniyle kapanınca sistem, yeniden yapılandırılabilir akıllı yüzeyleri kullanarak sinyali iki bacaklı bir hat üzerinden yönlendirir: Terminal → IRS ve IRS → hedef.',
  },
  {
    eyebrow: 'Mühendislik çıktısı',
    title: '5-10 dB marjinal kazanç',
    text:
      'ÖTR’de anlatılan hedef, ütopik sinyal seviyeleri üretmek değil; zayıflamış bağlantıyı minimum iletişim eşiğinin üstüne taşıyacak kadar gerçekçi bir kazanç sağlamaktır. Bu yüzden kalite puanları da “çalışır mı, ne kadar temiz çalışır?” sorusuna göre yorumlanır.',
  },
  {
    eyebrow: 'Platform',
    title: 'Hareketli ve kararlı terminal',
    text:
      'Fiziksel terminal; 20 kg ve 140 W kısıtına uyumlu, doğrudan tahrikli BLDC motorlar, sensör füzyonu, EKF ve kaskad kontrol ile sarsıntı altında dahi yönelimini koruyacak şekilde düşünülmüştür.',
  },
]

const factCards = [
  { value: '3GPP R17/18', label: 'Doğrudan cihaza NTN vizyonu' },
  { value: '5-10 dB', label: 'Hedeflenen marjinal bağlantı kazancı' },
  { value: '20 kg / 140 W', label: 'ÖTR tasarım kısıtı' },
  { value: '±8°', label: 'Sarsıntı altında bastırma hedefi' },
  { value: '< 8 sn', label: 'Yeniden kilitlenme hedefi' },
  { value: '360°', label: 'Slipring ile sürekli azimuth dönüşü' },
]

const workflowSteps = [
  {
    step: '1',
    title: 'Sahne verisi hazırlanır',
    text:
      'Haritadaki depremzedeler ve kullanıcı tarafından işaretlenen enkaz bölgeleri alınır. Bina verisi haritadan yüklenir ve bozuk poligonlar ayıklanır.',
  },
  {
    step: '2',
    title: 'Engel modeli kurulur',
    text:
      'Enkaz olarak işaretlenmeyen ayakta binalar engel kabul edilir. Böylece açık hat ve blokaj hesabı hem analizde hem çizgilerde aynı kurala göre yapılır.',
  },
  {
    step: '3',
    title: 'Depremzedeler kümelenir',
    text:
      'Deterministik k-means ile depremzedeler üç kümeye ayrılır. Aynı sahne her zaman aynı kümeleri ve aynı terminal başlangıcını üretir.',
  },
  {
    step: '4',
    title: 'Terminal adayları aranır',
    text:
      'Her küme için enkaz çevresinde, koridor boyunca ve açık görüş potansiyeli yüksek bölgelerde terminal adayları taranır. Yakınlık tek başına yeterli değildir; IRS çıkarabilen ve açık hat sunan aday öne geçer.',
  },
  {
    step: '5',
    title: 'IRS adayları doğrulanır',
    text:
      'IRS adayları için iki bacak ayrı ayrı test edilir: Terminal → IRS açık mı, IRS → hedef hattı açık mı? Terminal → IRS blokluysa aday doğrudan elenir.',
  },
  {
    step: '6',
    title: 'En iyi geçerli çözüm seçilir',
    text:
      'Geçerli IRS setleri kalite, kapsama, dağılım ve yol uzunluğu dengesine göre optimize edilir. Ardından sonuç kartları, çizgiler ve açıklamalar aynı veri yapısından beslenir.',
  },
]

const glossarySections = [
  {
    title: 'Haritadaki öğeler',
    items: [
      [
        'Depremzede',
        'Yardım bekleyen hedef kullanıcıyı temsil eder. Sistem kapsama ve kümelenme hesabını bu noktalar üzerinden yapar.',
      ],
      [
        'Enkaz',
        'Yıkılmış veya görev senaryosunda çökme kabul edilen alanı temsil eder. Enkaz, blokaj hesabında ayakta bina gibi engel sayılmaz.',
      ],
      [
        'Terminal',
        'Uyduya erişim sağlayan ana düğümdür. Konumu; IRS seti kalitesi, açık görüş koridoru, kapsama ve erişilebilirlik birlikte düşünülerek seçilir.',
      ],
      [
        'IRS',
        'Sinyali yeniden yönlendiren akıllı yansıtıcı konumudur. Her IRS önerisi iki bacaklı bir haberleşme koridorunun kalitesini temsil eder.',
      ],
      [
        'Engelleyen bina',
        'Terminal-IRS veya IRS-hedef hattını kesen, enkaz dışındaki ayakta binadır. Uygulama mümkün olduğunda bu binanın kimliğini ve adını da saklar.',
      ],
    ],
  },
  {
    title: 'Kalite metrikleri',
    items: [
      [
        'quality_score',
        '0 ile 100 arasına ölçeklenen mutlak kalite puanıdır. Açık hat, kapsama, toplam yol, bağlantı kazancı ve yansıma verimi birlikte değerlendirilir.',
      ],
      [
        'term_los',
        'Terminal ile IRS arasındaki açıklık oranıdır. Düşükse, ilk bacakta fiziksel engel veya zayıf koridor vardır.',
      ],
      [
        'vic_los',
        'IRS ile hedef kümesi arasındaki açıklık oranıdır. Yüksek olması, IRS’nin gerçekten işe yarayan bir yansıtma koridoru sunduğunu gösterir.',
      ],
      [
        'survivors_covered_clear',
        'Açık hatla ulaşılabilen depremzede sayısıdır. Sadece teorik yakınlık değil, gerçekten temiz erişim sayılır.',
      ],
      [
        'total_path_m',
        'Terminal → IRS ve IRS → hedef yollarının toplam uzunluğudur. Aynı kalite bandındaki daha kısa yol genelde daha verimli kabul edilir.',
      ],
      [
        'link_gain_db',
        'Tahmini bağlantı kazancıdır. Pozitife yaklaştıkça veya pozitife çıktıkça sinyal kalitesi daha güven verici hale gelir.',
      ],
      [
        'reflection_efficiency',
        'IRS yüzeyinin o geometride sinyali verimli yansıtma kapasitesini özetler. Düşükse aday genelde sınırda ya da geçersiz kalır.',
      ],
    ],
  },
  {
    title: 'Karar ve açıklama alanları',
    items: [
      [
        'validity_status',
        'Önerinin geçerli, sınırda veya geçersiz olduğunu söyler. Bloklu bir hat taşıyan IRS yüksek puan alsa bile geçerli sayılmaz.',
      ],
      [
        'constrained_reason',
        'Aday neden sınırda kaldı sorusunun kısa mühendislik cevabıdır. Genelde zayıf koridor, uzun yol veya düşük yansıma gibi nedenleri özetler.',
      ],
      [
        'selection_reason',
        'Bu IRS neden tutuldu sorusunun yerel motor tarafından üretilen kısa açıklamasıdır.',
      ],
      [
        'Yerleşim: Yerel',
        'Konum seçimi her zaman yerel, deterministik geometri motoru ile yapılır. LLM koordinat belirlemez.',
      ],
      [
        'Açıklama / Rerank / Doğrulama',
        'Gemini açıksa yalnızca açıklama dili, eşdeğer geçerli çözümler arasında sıralama ve görsel denetim tarafında rol alır.',
      ],
    ],
  },
]

const scoreBands = [
  { range: '85-100', label: 'Güçlü', color: 'text-los', tone: 'border-los/35 bg-los/10' },
  { range: '70-84', label: 'Uygun', color: 'text-accent', tone: 'border-accent/35 bg-accent/10' },
  { range: '55-69', label: 'Sınırda ama geçerli', color: 'text-amber-300', tone: 'border-amber-400/35 bg-amber-400/10' },
  { range: '0-54', label: 'Geçersiz veya gösterilmez', color: 'text-debris', tone: 'border-debris/35 bg-debris/10' },
]

export default function ProjectDetailsPage({ geminiEnabled = false }) {
  return (
    <main className="relative z-10 min-h-0 flex-1 overflow-y-auto bg-panel">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-6 lg:px-8 lg:py-8">
        <section className="overflow-hidden rounded-[28px] border border-border bg-card shadow-glow-lg">
          <div className="grid gap-0 lg:grid-cols-[1.4fr_0.9fr]">
            <div className="border-b border-border px-6 py-6 lg:border-b-0 lg:border-r lg:px-8 lg:py-8">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 font-head text-[11px] font-semibold uppercase tracking-[0.26em] text-accent">
                ÖTR Bazlı Teknik Özet
              </div>
              <h1 className="max-w-3xl font-head text-3xl font-bold leading-tight text-text lg:text-[2.35rem]">
                ARES-Reflect, enkaz gölgesinde kalan cihazlar için dar bant uydu koridoru açan akıllı yerleşim ve yönlendirme sistemidir.
              </h1>
              <p className="mt-4 max-w-3xl text-[15px] leading-7 text-muted">
                Bu sayfa, klasöre yüklenen ÖTR dokümanındaki sistem vizyonunu ve uygulamadaki yerleşim motorunu aynı çerçevede açıklar.
                Amaç; sahada terminalin nereye kurulacağını, hangi IRS noktalarının gerçekten işe yaradığını ve ekranda gördüğünüz puanların
                neyi temsil ettiğini açık biçimde göstermektir.
              </p>
              <div className="mt-5 flex flex-wrap gap-2.5">
                <InlineBadge label="Yerleşim motoru deterministik" tone="accent" />
                <InlineBadge label="IRS ile iki bacaklı koridor" tone="irs" />
                <InlineBadge label="Enkaz dışı binalar engel sayılır" tone="terminal" />
                <InlineBadge label={geminiEnabled ? 'Gemini destek katmanı açık' : 'Gemini destek katmanı isteğe bağlı'} tone="muted" />
              </div>
            </div>

            <div className="grid gap-px bg-border">
              {factCards.map((item) => (
                <div key={item.label} className="bg-card px-6 py-5 lg:px-7">
                  <div className="font-head text-2xl font-bold tracking-wide text-text">{item.value}</div>
                  <div className="mt-1 text-sm leading-6 text-muted">{item.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
          {capabilityCards.map((card) => (
            <article
              key={card.title}
              className="rounded-2xl border border-border bg-card px-5 py-5 shadow-glow"
            >
              <div className="font-head text-[11px] font-semibold uppercase tracking-[0.22em] text-accent">
                {card.eyebrow}
              </div>
              <h2 className="mt-2 font-head text-xl font-bold text-text">{card.title}</h2>
              <p className="mt-3 text-sm leading-7 text-muted">{card.text}</p>
            </article>
          ))}
        </section>

        <section className="rounded-[24px] border border-border bg-card px-5 py-6 shadow-glow lg:px-7">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="font-head text-[11px] font-semibold uppercase tracking-[0.24em] text-accent">
                Sistem Akışı
              </div>
              <h2 className="mt-1 font-head text-2xl font-bold text-text">Bu yazılım sahada hangi kararı nasıl veriyor?</h2>
            </div>
            <p className="max-w-2xl text-sm leading-7 text-muted">
              ÖTR’deki fiziksel sistem; terminal, IRS, sensör füzyonu ve stabilizasyon katmanlarını anlatıyor. Bu ekrandaki yazılım ise bunun
              saha yerleşim kararını üreten kısmı: önce geometrik olarak geçerli çözümleri buluyor, sonra bunların en iyisini öneriyor.
            </p>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {workflowSteps.map((item) => (
              <article key={item.step} className="rounded-2xl border border-border bg-panel/70 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full border border-accent/30 bg-accent/10 font-head text-sm font-bold text-accent">
                    {item.step}
                  </div>
                  <h3 className="font-head text-lg font-bold text-text">{item.title}</h3>
                </div>
                <p className="mt-3 text-sm leading-7 text-muted">{item.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <article className="rounded-[24px] border border-border bg-card px-5 py-6 shadow-glow lg:px-7">
            <div className="font-head text-[11px] font-semibold uppercase tracking-[0.24em] text-accent">
              Donanım ve Kontrol
            </div>
            <h2 className="mt-1 font-head text-2xl font-bold text-text">ÖTR’de anlatılan fiziksel sistemin ana omurgası</h2>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <InfoPanel
                title="Doğrudan tahrikli terminal"
                text="BLDC motorlar ve manyetik enkoderler ile dişli boşluğu azaltılır. Böylece terminal, sarsıntı altında bile daha temiz yönelim korur."
              />
              <InfoPanel
                title="EKF ve sensör füzyonu"
                text="IMU’dan gelen gürültülü veriler EKF ile filtrelenir. Yazılımın güvenilir yönelim tahmini üretmesi, fiziksel beamsteering başarısı için kritiktir."
              />
              <InfoPanel
                title="Kaskad kontrol"
                text="Dış döngü konumu, iç döngü ise hız ve bozucu bastırmayı kontrol eder. Amaç, ±8° sınıfı sarsıntıda dahi sıfıra yakın kalıcı hata ile kilitte kalmaktır."
              />
              <InfoPanel
                title="RIS/IRS beamsteering"
                text="Sinyal mekanik olarak döndürülmez; akıllı yüzeyin faz yapısı ile elektronik olarak hedefe odaklanır. Yerleşim motorunun iyi IRS noktası aramasının sebebi de budur."
              />
            </div>
          </article>

          <article className="rounded-[24px] border border-border bg-card px-5 py-6 shadow-glow lg:px-7">
            <div className="font-head text-[11px] font-semibold uppercase tracking-[0.24em] text-accent">
              Puan Rehberi
            </div>
            <h2 className="mt-1 font-head text-2xl font-bold text-text">Skorlar nasıl okunmalı?</h2>
            <p className="mt-3 text-sm leading-7 text-muted">
              Ekrandaki puanlar göreli sıralama değil, mutlak kalite yorumu taşır. Bir IRS adayının yüksek görünmesi için iki bacağın da açık
              olması, yolunun mantıklı kalması ve yeterli kapsama üretmesi gerekir.
            </p>
            <div className="mt-5 grid gap-3">
              {scoreBands.map((band) => (
                <div key={band.range} className={`rounded-2xl border px-4 py-3 ${band.tone}`}>
                  <div className="flex items-center justify-between gap-3">
                    <span className={`font-head text-lg font-bold ${band.color}`}>{band.range}</span>
                    <span className={`font-head text-xs font-semibold uppercase tracking-[0.22em] ${band.color}`}>
                      {band.label}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 rounded-2xl border border-border bg-panel/70 p-4 text-sm leading-7 text-muted">
              <span className="font-head font-bold text-text">Önemli not:</span> Terminal → IRS hattı blokluysa aday doğrudan elenir.
              IRS → hedef tarafı blokluysa veya kalite eşiği <span className="font-semibold text-text">%55</span> altında kalıyorsa sonuç kartında öneri olarak tutulmaz.
            </div>
          </article>
        </section>

        <section className="rounded-[24px] border border-border bg-card px-5 py-6 shadow-glow lg:px-7">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="font-head text-[11px] font-semibold uppercase tracking-[0.24em] text-accent">
                Veri Sözlüğü
              </div>
              <h2 className="mt-1 font-head text-2xl font-bold text-text">Sistemde gördüğünüz veriler ne anlama geliyor?</h2>
            </div>
            <p className="max-w-3xl text-sm leading-7 text-muted">
              Bu bölüm, sonuç kartları, modal pencereler ve PDF çıktısında gördüğünüz alanların gerçek karşılığını özetler. Böylece puanların
              rastgele değil, fiziksel anlam taşıyan ölçülerden türediği daha net okunur.
            </p>
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-3">
            {glossarySections.map((section) => (
              <article key={section.title} className="rounded-2xl border border-border bg-panel/70 p-4">
                <h3 className="font-head text-lg font-bold text-text">{section.title}</h3>
                <dl className="mt-4 space-y-4">
                  {section.items.map(([term, desc]) => (
                    <div key={term}>
                      <dt className="font-head text-sm font-bold uppercase tracking-[0.12em] text-accent">{term}</dt>
                      <dd className="mt-1 text-sm leading-7 text-muted">{desc}</dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <article className="rounded-[24px] border border-border bg-card px-5 py-6 shadow-glow lg:px-7">
            <div className="font-head text-[11px] font-semibold uppercase tracking-[0.24em] text-accent">
              Açıklama Katmanı
            </div>
            <h2 className="mt-1 font-head text-2xl font-bold text-text">Gemini sistemin neresinde yer alır?</h2>
            <div className="mt-4 space-y-3 text-sm leading-7 text-muted">
              <p>
                Konumlandırma kararını veren katman her zaman yerel geometri motorudur. Yani terminal ve IRS koordinatları; bina blokajı,
                koridor açıklığı, mesafe ve kalite hesabı ile belirlenir.
              </p>
              <p>
                Gemini açıksa sonradan devreye girer: kullanıcıya daha akıcı açıklama üretir, yerel motorun zaten geçerli bulduğu çözümler
                arasında eşdeğer bir yeniden sıralama deneyebilir ve istenirse görsel denetim yapar.
              </p>
              <p>
                Bu ayrım önemlidir; çünkü jüriye gösterilen konumların fiziksel geçerliliği bir LLM yorumuna değil, deterministik geometri
                hesabına dayanır.
              </p>
            </div>
          </article>

          <article className="rounded-[24px] border border-border bg-card px-5 py-6 shadow-glow lg:px-7">
            <div className="font-head text-[11px] font-semibold uppercase tracking-[0.24em] text-accent">
              Sahaya Dönük Yorum
            </div>
            <h2 className="mt-1 font-head text-2xl font-bold text-text">Bu uygulama neden kritik?</h2>
            <p className="mt-3 text-sm leading-7 text-muted">
              ÖTR’deki vizyon, afet sahasında “en güçlü interneti” vermek değil, bağlantının tamamen koptuğu anda en kritik iletişimi yeniden
              mümkün kılmaktır. Bu yüzden sistem; açık görüş koridoru, mantıklı IRS yansıtması ve hızlı kurulabilir terminal yerleşimi üzerine
              kuruludur.
            </p>
            <div className="mt-4 rounded-2xl border border-accent/20 bg-accent/8 px-4 py-4 text-sm leading-7 text-muted">
              Haritadaki her öneri şu soruya cevap verir: <span className="font-semibold text-text">“Bu konum gerçekten çalışır mı, yoksa sadece yakın göründüğü için mi seçildi?”</span>
              Yerleşim motorunun amacı, yakın görünen ama bloklu çözümleri elemek; gerçekten açık koridor kurabilen güçlü yerleşimleri öne çıkarmaktır.
            </div>
          </article>
        </section>
      </div>
    </main>
  )
}

function InlineBadge({ label, tone = 'accent' }) {
  const tones = {
    accent: 'border-accent/30 bg-accent/10 text-accent',
    irs: 'border-irs/30 bg-irs/10 text-irs',
    terminal: 'border-terminal/30 bg-terminal/10 text-terminal',
    muted: 'border-border bg-panel/70 text-muted',
  }

  return (
    <span className={`rounded-full border px-3 py-1 font-head text-[11px] font-semibold uppercase tracking-[0.16em] ${tones[tone]}`}>
      {label}
    </span>
  )
}

function InfoPanel({ title, text }) {
  return (
    <div className="rounded-2xl border border-border bg-panel/70 p-4">
      <h3 className="font-head text-lg font-bold text-text">{title}</h3>
      <p className="mt-2 text-sm leading-7 text-muted">{text}</p>
    </div>
  )
}
