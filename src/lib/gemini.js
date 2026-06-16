// ============================================================
// gemini.js - Gemini integration for explanations and visual validation
//
// Placement is always produced by the deterministic local engine.
// Gemini only reranks already-valid local outputs, upgrades explanation text,
// and performs optional visual checks.
// ============================================================

const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])
const MAX_ATTEMPTS = 3

async function callGemini(
  apiKey,
  { system, parts, temperature = 0.35, json = true, maxTokens, timeoutMs = 8000 }
) {
  const body = JSON.stringify({
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature,
      thinkingConfig: { thinkingBudget: 0 },
      ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
      ...(json ? { responseMimeType: 'application/json' } : {}),
    },
  })

  let lastErr
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort('timeout'), timeoutMs)
    try {
      res = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      })
    } catch (e) {
      clearTimeout(timer)
      lastErr =
        e?.name === 'AbortError' || String(e?.message || e).toLowerCase().includes('timeout')
          ? new Error('timeout')
          : e
      break
    }
    clearTimeout(timer)

    if (res.ok) {
      const data = await res.json()
      const cand = data?.candidates?.[0]
      const text = cand?.content?.parts?.map((p) => p.text).filter(Boolean).join('') ?? ''
      if (!text) {
        lastErr = new Error(`Boş yanıt (finishReason=${cand?.finishReason ?? 'bilinmiyor'})`)
        break
      }
      return { text, model: GEMINI_MODEL, finishReason: cand?.finishReason }
    }

    if (res.status === 404) {
      throw new Error(`Model kullanılamıyor (${GEMINI_MODEL})`)
    }

    const responseText = await res.text().catch(() => '')
    lastErr = new Error(`Gemini HTTP ${res.status} ${responseText.slice(0, 120)}`)
    if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_ATTEMPTS) {
      await sleep(500 * attempt)
      continue
    }
    if (!RETRYABLE_STATUS.has(res.status)) throw lastErr
  }

  throw lastErr || new Error('Gemini erişilemedi')
}

function parseJsonLoose(text) {
  if (!text) return null
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    // fall through
  }

  const range = (open, close) => {
    const start = cleaned.indexOf(open)
    const end = cleaned.lastIndexOf(close)
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1))
      } catch {
        return null
      }
    }
    return null
  }

  return range('{', '}') ?? range('[', ']')
}

const pct = (x) => Math.round((x ?? 0) * 100)

const EXPLANATION_PROMPT =
  'Sen, ARES-Reflect sisteminde yalnızca yerel motorun hesapladığı ve fiziksel olarak geçerli bulduğu IRS konumlarını açıklayan bir afet haberleşmesi uzmanısın. ' +
  'Konum seçimi sana ait değil. Sana verilen kısa sayısal özeti kullanarak her IRS için yalnızca doğal Türkçe bir kullanıcı açıklaması üret. ' +
  'JSON dizi döndür. Her öğe şu alanları içersin: id, summary. ' +
  'Summary 2-4 cümle olsun. Sayıları koru, yeni sayı uydurma. Aynı kalıbı tekrar etme; kapsama, kalite, link kazancı veya kısıt bilgisinden hangisi öne çıkıyorsa onu vurgula. ' +
  'Türkçe karakterleri düzgün kullan.'

const RERANK_PROMPT =
  'Sen, zaten fiziksel olarak geçerli olduğu yerel motor tarafından kanıtlanmış terminal çözümlerini yalnızca operasyonel öncelik için sıralıyorsun. ' +
  'Yeni koordinat üretme, geçersiz çözüm önerme ve fiziksel kuralları değiştirme. ' +
  'JSON nesnesi dön: { "terminal_order": ["T-A", ...], "reasons": [{ "id": "T-A", "reason": "..." }] }. ' +
  'Gerekçeyi kısa ve Türkçe yaz.'

function qualityBandText(score) {
  const value = pct(score)
  if (value >= 85) return 'güçlü kalite bandında'
  if (value >= 70) return 'uygun kalite bandında'
  if (value >= 55) return 'sınırda ama kullanılabilir kalite bandında'
  return 'düşük kalite bandında'
}

function coverageSentence(u) {
  if (u.survivors_covered_clear >= 3) {
    return `Açık hatla ${u.survivors_covered_clear} depremzedeye doğrudan ulaşıyor ve toplam görünen kapsama ${u.survivors_covered} kişiye çıkıyor.`
  }
  if (u.survivors_covered_clear === 2) {
    return `İki depremzedeye açık hat kurabiliyor; toplam görünen kapsama ${u.survivors_covered} kişi seviyesinde kalıyor.`
  }
  if (u.survivors_covered_clear === 1) {
    return 'Yalnızca 1 depremzedeye net açık hat veriyor; bu nedenle kapsama katkısı daha sınırlı kalıyor.'
  }
  return 'Açık hatlı bir depremzede üretmediği için bu konum daha çok yedek veya dengeleyici bir aday gibi davranıyor.'
}

function reflectionSentence(u) {
  const gain = `${u.link_gain_db >= 0 ? '+' : ''}${u.link_gain_db} dB`
  if (u.link_gain_db >= 0) {
    return `Link kazancı ${gain} olduğu için sinyal bütçesi tarafında daha rahat bir tablo çiziyor.`
  }
  if (u.link_gain_db >= -6) {
    return `Link kazancı ${gain} seviyesinde; yani konum çalışabilir olsa da çok güçlü bir marj bırakmıyor.`
  }
  return `Link kazancı ${gain} seviyesine düştüğü için konum fiziksel olarak geçerli olsa da saha dayanıklılığı açısından daha hassas kalıyor.`
}

function blockerSentence(u) {
  const blocker = u.blocker_building_name || u.term_blocker_name || u.vic_blocker_name
  return blocker ? ` Kritik kısımda ${blocker} binası etkili olduğu için bu nokta dikkat etiketiyle yorumlanmalı.` : ''
}

function decisionSentence(u) {
  const score = u.quality_score ?? u.composite_score
  if (u.validity_status === 'borderline') {
    return 'Yerel motor bu konumu geçerli kabul etti; ancak kalite sınırda kaldığı için daha güçlü adayların gerisinde tutuyor.'
  }
  if (score >= 0.8 && u.survivors_covered_clear >= 2) {
    return 'Açık hat, kalite ve kapsama dengesi birlikte güçlü olduğu için terminal tarafında öncelikli adaylardan biri haline geliyor.'
  }
  if (u.survivors_covered_clear >= 2) {
    return 'Kapsama katkısı anlamlı olduğu için toplam set kalitesine destek veren dengeli bir aday olarak öne çıkıyor.'
  }
  return 'Bu nokta zirve kalite sunmuyor; yine de terminal setinin dağılım ve erişim dengesine katkısı olduğu için listede tutuluyor.'
}

function buildExplanationRequest(payload) {
  return payload.irs_list.map((u) => ({
    id: u.id,
    name: u.name,
    terminal_name: u.terminal_name,
    rank_in_terminal: u.rank_in_terminal,
    quality_score_pct: pct(u.quality_score ?? u.composite_score),
    validity_status: u.validity_status,
    survivors_covered_clear: u.survivors_covered_clear,
    survivors_covered: u.survivors_covered,
    distance_to_terminal_m: u.distance_to_terminal,
    total_path_m: u.total_path_m,
    reflection_efficiency_pct: pct(u.reflection_efficiency),
    link_gain_db: u.link_gain_db,
    blocker:
      u.blocker_building_name || u.term_blocker_name || u.vic_blocker_name || null,
    mount:
      u.mount_type === 'cephe'
        ? `${u.facade} cephe / ~${u.mount_height_m} m`
        : `serbest direk / ~${u.mount_height_m} m`,
    selection_reason: u.selection_reason,
  }))
}

export function buildFallback(payload) {
  const byTerminal = {}
  for (const u of payload.irs_list) (byTerminal[u.terminal_id] ||= []).push(u)

  return payload.irs_list.map((u) => {
    const rankText =
      u.rank_in_terminal === 1 ? 'en güçlü' : u.rank_in_terminal === 2 ? 'ikinci' : 'üçüncü'
    const terminalCount = byTerminal[u.terminal_id]?.length || 0

    const summary =
      `${u.name}, ${u.terminal_name} için önerilen ${rankText} IRS konumudur ve kalite puanı %${pct(
        u.quality_score ?? u.composite_score
      )} ile ${qualityBandText(u.quality_score ?? u.composite_score)} görünüyor. ` +
      `${coverageSentence(u)} ` +
      `Terminale ${u.distance_to_terminal} m uzaklıkta kalırken yansıma verimi %${pct(
        u.reflection_efficiency
      )} ve toplam yol ${u.total_path_m} m olarak hesaplandı. ` +
      `${reflectionSentence(u)} ` +
      `${decisionSentence(u)}` +
      blockerSentence(u)

    const technical =
      `İki bacaklı kanal ayrı ayrı hesaplandı: terminal-IRS görüşü ${u.term_los}, IRS-hedef görüşü ${u.vic_los}. ` +
      'Bu, her iki hatta ayakta bina olup olmadığının doğrudan kontrol edildiği anlamına gelir; enkaz binaları blokaj sayılmaz. ' +
      `Panel ${u.mount_type === 'cephe' ? `${u.facade} cephede` : 'serbest direkte'} yaklaşık ${u.mount_height_m} m seviyesinde konumlanır; cephe hizası ${u.facade_alignment} değerindedir. ` +
      `Gelme ve çıkış açıları ${u.theta_in} / ${u.theta_out} derece, bu da panelin sinyali ne kadar verimli büküldüğünü gösterir. ` +
      `Fresnel açıklığı ${u.fresnel_clear}, link kazancı ${u.link_gain_db >= 0 ? '+' : ''}${u.link_gain_db} dB ve kalite puanı %${pct(
        u.quality_score ?? u.composite_score
      )} birlikte yorumlanır.`

    const comparison =
      `${u.terminal_name} içindeki ${terminalCount} geçerli IRS arasında ${u.name}, kalite puanı %${pct(
        u.quality_score ?? u.composite_score
      )} ile ${rankText} sıradadır.`

    return { id: u.id, name: u.name, summary, technical, comparison }
  })
}

export async function generateExplanations(payload, apiKey) {
  const fallback = buildFallback(payload)
  if (!apiKey) return { items: fallback, source: 'local' }

  try {
    const compact = buildExplanationRequest(payload)
    const { text, model } = await callGemini(apiKey, {
      system: EXPLANATION_PROMPT,
      parts: [{ text: JSON.stringify(compact) }],
      temperature: 0.25,
      maxTokens: 1800,
      timeoutMs: 14000,
    })

    const arr = parseJsonLoose(text)
    if (!Array.isArray(arr) || arr.length === 0) throw new Error('Yanıt çözümlenemedi')

    const byId = new Map(
      arr
        .filter((x) => x && x.id)
        .map((x) => [String(x.id), { summary: String(x.summary || '').trim() }])
    )

    const items = fallback.map((f) => {
      const generated = byId.get(f.id)
      return generated?.summary
        ? {
            ...f,
            summary: generated.summary,
          }
        : f
    })

    return { items, source: 'gemini', model }
  } catch (err) {
    return { items: fallback, source: 'local', error: String(err?.message || err) }
  }
}

export async function rerankTerminals(payload, apiKey) {
  const fallbackOrder = payload.terminals.map((t) => t.id)
  if (!apiKey) return { source: 'local', terminalOrder: fallbackOrder, reasons: {} }

  try {
    const compact = {
      terminals: payload.terminals.map((t) => ({
        id: t.id,
        name: t.name,
        score_pct: t.score_pct,
        valid_irs_count: t.valid_irs_count,
        avg_quality: t.avg_quality,
        coverage_ratio: t.coverage_ratio,
      })),
    }
    const { text, model } = await callGemini(apiKey, {
      system: RERANK_PROMPT,
      parts: [{ text: JSON.stringify(compact) }],
      temperature: 0.2,
      maxTokens: 512,
      timeoutMs: 6000,
    })
    const parsed = parseJsonLoose(text)
    if (!parsed || typeof parsed !== 'object') throw new Error('Rerank yanıtı çözümlenemedi')

    const validIds = new Set(fallbackOrder)
    const proposed = Array.isArray(parsed.terminal_order)
      ? parsed.terminal_order.map(String).filter((id) => validIds.has(id))
      : []
    const ordered = [...proposed, ...fallbackOrder.filter((id) => !proposed.includes(id))]

    const reasons = Object.fromEntries(
      Array.isArray(parsed.reasons)
        ? parsed.reasons
            .filter((x) => x && validIds.has(String(x.id)))
            .map((x) => [String(x.id), String(x.reason || '')])
        : []
    )

    return { source: 'gemini', model, terminalOrder: ordered, reasons }
  } catch (err) {
    return {
      source: 'local',
      terminalOrder: fallbackOrder,
      reasons: {},
      error: String(err?.message || err),
    }
  }
}

const VALIDATE_PROMPT =
  'You are reviewing a deterministic satellite terminal and IRS placement. ' +
  'Blue markers are terminals, colored teardrops are IRS units, red buildings are debris, and lines show signal paths. ' +
  'Return JSON with valid (boolean), issues (array of Turkish strings), confidence (0-100), and recommendation (Turkish sentence).'

export async function validatePlacementVisually(mapElement, placementData, apiKey) {
  if (!apiKey) {
    return {
      valid: null,
      issues: [],
      confidence: 0,
      recommendation: 'Görsel doğrulama atlandı (Gemini kapalı).',
      source: 'skipped',
    }
  }
  if (!mapElement) {
    return {
      valid: null,
      issues: [],
      confidence: 0,
      recommendation: 'Harita öğesi bulunamadı.',
      source: 'error',
    }
  }

  let base64
  try {
    const html2canvas = (await import('html2canvas')).default
    const canvas = await html2canvas(mapElement, {
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#0a0f1e',
      logging: false,
      scale: 0.45,
    })
    base64 = canvas.toDataURL('image/jpeg', 0.72).split(',')[1]
    if (!base64) throw new Error('boş görüntü')
  } catch (e) {
    return {
      valid: null,
      issues: [],
      confidence: 0,
      recommendation: 'Harita görüntüsü alınamadı: ' + String(e?.message || e),
      source: 'error',
    }
  }

  try {
    const { text } = await callGemini(apiKey, {
      parts: [
        { text: VALIDATE_PROMPT + '\n\nPlacement metadata (JSON): ' + JSON.stringify(placementData) },
        { inlineData: { mimeType: 'image/jpeg', data: base64 } },
      ],
      temperature: 0.2,
      timeoutMs: 15000,
    })
    const parsed = parseJsonLoose(text)
    if (!parsed || typeof parsed !== 'object') throw new Error('Yanıt çözümlenemedi')
    return {
      valid: typeof parsed.valid === 'boolean' ? parsed.valid : String(parsed.valid) === 'true',
      issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : [],
      confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 0)),
      recommendation: String(parsed.recommendation || ''),
      source: 'gemini',
    }
  } catch (e) {
    const message = String(e?.message || e)
    if (message.toLowerCase().includes('timeout')) {
      return {
        valid: null,
        issues: [],
        confidence: 0,
        recommendation:
          'Gemini görsel doğrulama zaman aşımına düştü. Yerleşim sonucu yerel geometri motoru tarafından korunuyor.',
        source: 'timeout',
      }
    }
    return {
      valid: null,
      issues: [],
      confidence: 0,
      recommendation: 'Görsel doğrulama yapılamadı: ' + String(e?.message || e),
      source: 'error',
    }
  }
}
