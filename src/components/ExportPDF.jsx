import { jsPDF } from 'jspdf'
import { pct, nlosLabel } from '../lib/ui.js'

const NAVY = [10, 15, 30]
const ACCENT = [0, 150, 199]
const INK = [24, 32, 48]
const MUTED = [110, 122, 145]
const LINE = [210, 220, 235]

const MARGIN = 42
const PAGE_W = 595.28
const PAGE_H = 841.89
const CONTENT_W = PAGE_W - MARGIN * 2

const TR_MAP = new Map([
  ['\u0131', 'i'],
  ['\u0130', 'I'],
  ['\u015f', 's'],
  ['\u015e', 'S'],
  ['\u011f', 'g'],
  ['\u011e', 'G'],
  ['\u00f6', 'o'],
  ['\u00d6', 'O'],
  ['\u00fc', 'u'],
  ['\u00dc', 'U'],
  ['\u00e7', 'c'],
  ['\u00c7', 'C'],
  ['\u00e2', 'a'],
  ['\u00ee', 'i'],
  ['\u00fb', 'u'],
])
const tr = (s) =>
  String(s).replace(/[\u0131\u0130\u015f\u015e\u011f\u011e\u00f6\u00d6\u00fc\u00dc\u00e7\u00c7\u00e2\u00ee\u00fb]/g, (c) => TR_MAP.get(c) || c)

function buildPdf(result, meta) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  let y = 0
  let page = 1

  const pageHeader = (title) => {
    doc.setFillColor(...NAVY)
    doc.rect(0, 0, PAGE_W, 64, 'F')
    doc.setFillColor(...ACCENT)
    doc.rect(0, 64, PAGE_W, 3, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(16)
    doc.text('ARES-Reflect', MARGIN, 30)
    doc.setTextColor(0, 200, 255)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.text(tr('TERMİNAL YERLEŞİM SİSTEMİ'), MARGIN, 44)
    doc.setTextColor(180, 195, 220)
    doc.text(tr(title), PAGE_W - MARGIN, 30, { align: 'right' })
    doc.text(new Date().toLocaleString('tr-TR'), PAGE_W - MARGIN, 44, { align: 'right' })
    y = 90
  }

  const ensure = (need) => {
    if (y + need > PAGE_H - MARGIN) {
      doc.addPage()
      page += 1
      pageHeader('Rapor (devam)')
    }
  }

  const heading = (text, color = ACCENT, size = 13) => {
    ensure(26)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(size)
    doc.setTextColor(...color)
    doc.text(tr(text), MARGIN, y)
    y += 8
    doc.setDrawColor(...LINE)
    doc.line(MARGIN, y, PAGE_W - MARGIN, y)
    y += 14
  }

  const body = (text, { size = 10, color = INK, indent = 0, gap = 4, font = 'normal' } = {}) => {
    doc.setFont('helvetica', font)
    doc.setFontSize(size)
    doc.setTextColor(...color)
    const lines = doc.splitTextToSize(tr(text), CONTENT_W - indent)
    for (const ln of lines) {
      ensure(size + 3)
      doc.text(ln, MARGIN + indent, y)
      y += size + 3
    }
    y += gap
  }

  const kvRow = (pairs) => {
    ensure(16)
    doc.setFontSize(9)
    const colW = CONTENT_W / pairs.length
    pairs.forEach((p, i) => {
      const x = MARGIN + i * colW
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...MUTED)
      doc.text(tr(p[0]), x, y)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...INK)
      doc.text(tr(String(p[1])), x, y + 12)
    })
    y += 26
  }

  pageHeader('Görev Raporu')

  doc.setFillColor(245, 248, 252)
  doc.setDrawColor(...LINE)
  doc.roundedRect(MARGIN, y, CONTENT_W, 72, 4, 4, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...INK)
  doc.text(tr('Senaryo Özeti'), MARGIN + 12, y + 18)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...MUTED)
  const irsTotal = result.terminals.reduce((a, t) => a + t.irs.length, 0)
  doc.text(
    tr(`Depremzede: ${meta.survivors}    Enkaz: ${meta.debris}    Kume: ${result.clusters.length}    Terminal: ${result.terminals.length}    IRS: ${irsTotal}`),
    MARGIN + 12,
    y + 36
  )
  doc.text(tr(`Yerleşim motoru: ${meta.placementSource === 'local' ? 'Yerel' : meta.placementSource}`), MARGIN + 12, y + 52)
  doc.text(tr(`Açıklama kaynağı: ${meta.explanationSource === 'gemini' ? 'Gemini' : 'Yerel motor'}`), MARGIN + 12, y + 66)
  doc.text(tr(`Rerank: ${meta.rerankSource === 'gemini' ? 'Gemini' : 'Kapalı'}`), MARGIN + 250, y + 66)
  y += 92

  heading('Terminal Yerleşimleri')
  for (const t of result.terminals) {
    body(`${t.name}  -  Puan ${t.scorePct}/100`, { font: 'bold', size: 11, gap: 2 })
    kvRow([
      ['ENLEM', t.lat.toFixed(6)],
      ['BOYLAM', t.lng.toFixed(6)],
      ['IRS BIRIMI', t.irs.length],
      ['KUME', `#${t.clusterIndex + 1}`],
    ])
    body(t.description, { color: MUTED, size: 9, gap: 10 })
  }

  for (const t of result.terminals) {
    heading(`${t.name}  -  IRS Birimleri`, ACCENT, 12)
    for (const u of t.irs) {
      ensure(40)
      body(`${u.name}    -    Kalite ${pct(u.quality_score ?? u.composite_score)}/100    -    ${nlosLabel(u.nlos_status)}`, {
        font: 'bold',
        size: 10,
        gap: 2,
      })
      kvRow([
        ['T->IRS', `%${pct(u.term_los)}`],
        ['IRS->HEDEF', `%${pct(u.vic_los)}`],
        ['TOPLAM YOL', `${u.total_path_m} m`],
        ['TAH. KAZANC', `${u.link_gain_db >= 0 ? '+' : ''}${u.link_gain_db} dB`],
      ])
      kvRow([
        ['ACIK KAPSAMA', u.survivors_covered_clear],
        ['TOPLAM KAPSAMA', u.survivors_covered],
        ['YANSIMA', `%${pct(u.reflection_efficiency)}`],
        ['FRESNEL', `%${pct(u.fresnel_clear)}`],
      ])
      kvRow([
        ['MONTAJ', u.mount_type === 'cephe' ? `${u.facade} ${u.facade_bearing}°` : 'Serbest direk'],
        ['MONTAJ YUK.', `${u.mount_height_m} m`],
        ['BINA YUK.', u.building_height_m ? `${u.building_height_m} m` : '-'],
        ['DURUM', u.validity_status === 'borderline' ? 'Sınırda ama geçerli' : 'Geçerli öneri'],
      ])
      if (u.decision) body(`Karar gerekcesi: ${u.decision}`, { size: 9, color: ACCENT, gap: 4 })
      body(`Özet: ${u.summary}`, { size: 9, gap: 4 })
      body(`Teknik: ${u.technical}`, { size: 9, color: [60, 72, 92], gap: 4 })
      if (u.comparison) body(`Karşılaştırma: ${u.comparison}`, { size: 9, color: MUTED, gap: 10 })
    }
  }

  const total = page
  for (let p = 1; p <= total; p++) {
    doc.setPage(p)
    doc.setFontSize(8)
    doc.setTextColor(...MUTED)
    doc.text(`Sayfa ${p} / ${total}`, PAGE_W - MARGIN, PAGE_H - 20, { align: 'right' })
    doc.text(tr('ARES-Reflect  -  TEKNOFEST Mobil Uydu Terminali Yarışması'), MARGIN, PAGE_H - 20)
  }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  doc.save(`ARES-Reflect-Rapor-${stamp}.pdf`)
}

export default function ExportPDF({ result, meta }) {
  const disabled = !result
  return (
    <button
      disabled={disabled}
      onClick={() => result && buildPdf(result, meta)}
      title={disabled ? 'Önce analiz çalıştırın' : 'PDF raporu dışa aktar'}
      className={`flex items-center gap-2 rounded-md px-4 py-1.5 font-head text-sm font-semibold tracking-wide transition-all duration-200 ${
        disabled
          ? 'cursor-not-allowed border border-border bg-card text-muted'
          : 'border border-accent bg-accent/10 text-accent hover:bg-accent/20 hover:shadow-glow'
      }`}
    >
      <span>PDF</span> PDF Dışa Aktar
    </button>
  )
}
