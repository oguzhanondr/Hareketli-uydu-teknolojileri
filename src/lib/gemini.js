// ============================================================
// gemini.js - Gemini integration for explanations and visual validation
//
// Placement is always produced by the deterministic local engine.
// Gemini only reranks already-valid local outputs, upgrades explanation text,
// and performs optional visual checks.
// The project now uses a single explicit model: gemini-3.5-flash.
// ============================================================

const GEMINI_MODEL = 'gemini-3.5-flash'
const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])
const MAX_ATTEMPTS = 3

async function callGemini(
  apiKey,
  { system, parts, temperature = 0.4, json = true, maxTokens, timeoutMs = 3200 }
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
      lastErr = e
      break
    }
    clearTimeout(timer)

    if (res.ok) {
      const data = await res.json()
      const cand = data?.candidates?.[0]
      const text = cand?.content?.parts?.map((p) => p.text).filter(Boolean).join('') ?? ''
      if (!text) {
        lastErr = new Error(`Bos yanit (finishReason=${cand?.finishReason ?? 'bilinmiyor'})`)
        break
      }
      return { text, model: GEMINI_MODEL, finishReason: cand?.finishReason }
    }

    if (res.status === 404) {
      throw new Error(`Model kullanilamiyor (${GEMINI_MODEL})`)
    }

    const t = await res.text().catch(() => '')
    lastErr = new Error(`Gemini HTTP ${res.status} ${t.slice(0, 120)}`)
    if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_ATTEMPTS) {
      await sleep(500 * attempt)
      continue
    }
    if (!RETRYABLE_STATUS.has(res.status)) throw lastErr
  }

  throw lastErr || new Error('Gemini erisilemedi')
}

function parseJsonLoose(text) {
  if (!text) return null
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  try {
    return JSON.parse(t)
  } catch {
    // fall through
  }

  const range = (open, close) => {
    const s = t.indexOf(open)
    const e = t.lastIndexOf(close)
    if (s >= 0 && e > s) {
      try {
        return JSON.parse(t.slice(s, e + 1))
      } catch {
        return null
      }
    }
    return null
  }
  return range('{', '}') ?? range('[', ']')
}

const pct = (x) => Math.round((x ?? 0) * 100)

const SYSTEM_PROMPT =
  'Sen, ARES-Reflect sisteminde yalnizca YEREL motorun hesapladigi ve fiziksel olarak gecerli bulunan IRS konumlarini aciklayan bir afet haberlesmesi uzmansin. ' +
  'Konum secimi sana ait degil; sadece verilen sayisal verileri daha acik Turkce ile yorumla. ' +
  'Her IRS icin gecerli bir JSON dizisi don. Her oge: id, name, summary, technical, comparison alanlarini icersin. ' +
  'Summary 3-5 cumlelik acik ve sade Turkce olsun. Teknik aciklama sayisal degerleri kullansin ama gunluk dilde ne anlama geldiklerini de soylesin. ' +
  'Sinirda kalan onerilerde bunu acikca belirt. Asla yeni sayi uydurma.'

const RERANK_PROMPT =
  'Sen, zaten fiziksel olarak GECERLI oldugu yerel motor tarafindan kanitlanmis terminal cozumlerini yalnizca operasyonel oncelik icin siraliyorsun. ' +
  'Yeni koordinat uretme, gecersiz cozum onermeye kalkma ve fiziksel kurallari degistirme. ' +
  'JSON nesnesi don: { "terminal_order": ["T-A", ...], "reasons": [{ "id": "T-A", "reason": "..." }] }. ' +
  'Gerekceyi kisa ve Turkce yaz.'

export function buildFallback(payload) {
  const byTerminal = {}
  for (const u of payload.irs_list) (byTerminal[u.terminal_id] ||= []).push(u)

  return payload.irs_list.map((u) => {
    const peers = byTerminal[u.terminal_id]
    const rankText =
      u.rank_in_terminal === 1 ? 'en guclu' : u.rank_in_terminal === 2 ? 'ikinci' : 'ucuncu'
    const blockerText =
      u.blocker_building_name || u.term_blocker_name || u.vic_blocker_name
        ? ` Aradaki kritik engel ${u.term_blocker_name || u.vic_blocker_name} olarak goruluyor.`
        : ''
    const constrainedText = u.validity_status === 'borderline'
      ? ' Bu yerlesim fiziksel olarak gecerli; ancak kalite bandi sinirda kaldigi icin dikkatli yorumlanmalidir.'
      : ' Bu yerlesim acik hat ve kalite puani bakimindan guclu bir secim.'
    const terminalCount = byTerminal[u.terminal_id]?.length || 0

    const summary =
      `${u.name}, ${u.terminal_name} icin onerilen ${rankText} IRS konumudur ve kalite puani %${pct(
        u.quality_score ?? u.composite_score
      )} seviyesindedir. ` +
      `Terminale ${u.distance_to_terminal} m mesafede kalirken acik hatla ${u.survivors_covered_clear} depremzedeye ulasabiliyor; toplam gorulen kapsama ${u.survivors_covered}. ` +
      `Yansima verimi %${pct(u.reflection_efficiency)}, tahmini link kazanci ${u.link_gain_db >= 0 ? '+' : ''}${u.link_gain_db} dB ve toplam yol ${u.total_path_m} m olarak hesaplandi.` +
      constrainedText +
      blockerText

    const technical =
      `Iki bacakli kanal ayri ayri hesaplandi: terminal-IRS gorusu ${u.term_los}, IRS-hedef gorusu ${u.vic_los}. ` +
      `Bu, her iki hatta ayakta bina olup olmadiginin dogrudan kontrol edildigi anlamina gelir; enkaz binalari blokaj sayilmaz. ` +
      `Panel ${u.mount_type === 'cephe' ? `${u.facade} cephede` : 'serbest direkte'} yaklasik ${u.mount_height_m} m seviyesinde konumlanir; cephe hizasi ${u.facade_alignment} degerindedir. ` +
      `Gelme ve cikis acilari ${u.theta_in} / ${u.theta_out} derece, bu da panelin sinyali ne kadar verimli buktugunu gosterir. ` +
      `Fresnel acikligi ${u.fresnel_clear}, link kazanci ${u.link_gain_db >= 0 ? '+' : ''}${u.link_gain_db} dB ve kalite puani %${pct(
        u.quality_score ?? u.composite_score
      )} birlikte yorumlanir.`

    const comparison =
      `${u.terminal_name} icindeki ${terminalCount} gecerli IRS arasinda ${u.name}, kalite puani %${pct(
        u.quality_score ?? u.composite_score
      )} ile ${rankText} siradadir.`

    return { id: u.id, name: u.name, summary, technical, comparison }
  })
}

export async function generateExplanations(payload, apiKey) {
  const fallback = buildFallback(payload)
  if (!apiKey) return { items: fallback, source: 'local' }

  try {
    const { text, model } = await callGemini(apiKey, {
      system: SYSTEM_PROMPT,
      parts: [{ text: JSON.stringify(payload) }],
      temperature: 0.35,
      maxTokens: 4096,
      timeoutMs: 3200,
    })
    const arr = parseJsonLoose(text)
    if (!Array.isArray(arr) || arr.length === 0) throw new Error('Yanit cozumlenemedi')

    const byId = new Map(arr.filter((x) => x && x.id).map((x) => [x.id, x]))
    const items = fallback.map((f) => {
      const g = byId.get(f.id)
      return g
        ? {
            id: f.id,
            name: f.name,
            summary: g.summary || f.summary,
            technical: g.technical || f.technical,
            comparison: g.comparison || f.comparison,
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
      timeoutMs: 2200,
    })
    const parsed = parseJsonLoose(text)
    if (!parsed || typeof parsed !== 'object') throw new Error('Rerank yaniti cozumlenemedi')

    const validIds = new Set(fallbackOrder)
    const proposed = Array.isArray(parsed.terminal_order)
      ? parsed.terminal_order.map(String).filter((id) => validIds.has(id))
      : []
    const ordered = [
      ...proposed,
      ...fallbackOrder.filter((id) => !proposed.includes(id)),
    ]

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
      recommendation: 'Gorsel dogrulama atlandi (Gemini kapali).',
      source: 'skipped',
    }
  }
  if (!mapElement) {
    return {
      valid: null,
      issues: [],
      confidence: 0,
      recommendation: 'Harita ogesi bulunamadi.',
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
      scale: 0.6,
    })
    base64 = canvas.toDataURL('image/png').split(',')[1]
    if (!base64) throw new Error('bos goruntu')
  } catch (e) {
    return {
      valid: null,
      issues: [],
      confidence: 0,
      recommendation: 'Harita goruntusu alinamadi: ' + String(e?.message || e),
      source: 'error',
    }
  }

  try {
    const { text } = await callGemini(apiKey, {
      parts: [
        { text: VALIDATE_PROMPT + '\n\nPlacement metadata (JSON): ' + JSON.stringify(placementData) },
        { inlineData: { mimeType: 'image/png', data: base64 } },
      ],
      temperature: 0.2,
      timeoutMs: 4200,
    })
    const parsed = parseJsonLoose(text)
    if (!parsed || typeof parsed !== 'object') throw new Error('Yanit cozumlenemedi')
    return {
      valid: typeof parsed.valid === 'boolean' ? parsed.valid : String(parsed.valid) === 'true',
      issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : [],
      confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 0)),
      recommendation: String(parsed.recommendation || ''),
      source: 'gemini',
    }
  } catch (e) {
    return {
      valid: null,
      issues: [],
      confidence: 0,
      recommendation: 'Gorsel dogrulama yapilamadi: ' + String(e?.message || e),
      source: 'error',
    }
  }
}
