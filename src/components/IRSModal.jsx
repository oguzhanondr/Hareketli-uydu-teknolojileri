import { useEffect, useState } from 'react'
import { pct, rankColor, nlosColor, nlosLabel, qualityBadge } from '../lib/ui.js'

function DataRow({ label, value, accent }) {
  return (
    <div className="flex items-center justify-between border-b border-border/60 py-2.5">
      <span className="font-head text-sm uppercase tracking-wide text-muted">{label}</span>
      <span
        className="font-head text-base font-semibold tabular-nums"
        style={{ color: accent || 'var(--text)' }}
      >
        {value}
      </span>
    </div>
  )
}

export default function IRSModal({ irs, onClose }) {
  const [showTech, setShowTech] = useState(false)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!irs) return null

  const badge = rankColor(irs.rank)
  const quality = qualityBadge(irs.quality_score ?? irs.composite_score)
  const onFacade = irs.mount_type === 'cephe'
  const mountLabel = onFacade ? `${irs.facade} cephe (${irs.facade_bearing} deg)` : 'Serbest direk'
  const blockerSummary = [
    irs.term_blocker_name ? `Terminal-IRS: ${irs.term_blocker_name}` : null,
    irs.vic_blocker_name ? `IRS-Hedef: ${irs.vic_blocker_name}` : null,
  ]
    .filter(Boolean)
    .join('  -  ')

  return (
    <div
      className="fixed inset-0 z-[1500] flex items-center justify-center bg-[#040a14]/70 p-4 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-accent/40 bg-panel shadow-glow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-border bg-card px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 rotate-45 items-center justify-center rounded-[5px] bg-irs">
              <span className="-rotate-45 font-head text-xs font-bold text-white">IRS</span>
            </span>
            <div>
              <h2 className="font-head text-2xl font-bold tracking-wide text-text">{irs.name}</h2>
              <div className="font-head text-xs uppercase tracking-[0.25em] text-muted">
                Akilli Yansitici Yuzey
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span
              className="rounded-lg px-3.5 py-1.5 font-head text-xl font-bold tabular-nums"
              style={{ backgroundColor: `${badge}22`, color: badge, border: `1px solid ${badge}66` }}
            >
              {pct(irs.quality_score ?? irs.composite_score)}
            </span>
            <button
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-lg text-muted transition-colors hover:border-debris hover:text-debris"
              aria-label="Kapat"
            >
              x
            </button>
          </div>
        </div>

        <div className="px-6 py-5">
          <p className="text-[15px] leading-7 text-text">{irs.summary || irs.selection_reason}</p>

          <div
            className="mt-4 inline-flex rounded-md border px-3 py-1 font-head text-xs font-semibold uppercase tracking-wide"
            style={{
              color: quality.color,
              borderColor: `${quality.color}55`,
              backgroundColor: `${quality.color}14`,
            }}
          >
            Kalite bandi: {quality.label}
          </div>

          {irs.validity_status === 'borderline' && (
            <div className="mt-4 rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-[13px] leading-relaxed text-amber-100">
              Bu IRS onerisi fiziksel olarak gecerli; ancak kalite puani sinirda kalmistir.
              {irs.constrained_reason ? ` ${irs.constrained_reason}` : ''}
            </div>
          )}

          {irs.decision && (
            <div className="mt-4 rounded-lg border border-accent/40 bg-accent/5 px-4 py-3">
              <div className="font-head text-xs font-semibold uppercase tracking-wide text-accent">
                Neden secildi
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-text">{irs.decision}</p>
            </div>
          )}

          <div className="mt-5 rounded-lg border border-border bg-card px-5 py-1.5">
            <DataRow
              label="Terminal -> IRS"
              value={`%${pct(irs.term_los)}`}
              accent={nlosColor(irs.term_los_status)}
            />
            <DataRow
              label="IRS -> Hedef"
              value={`%${pct(irs.vic_los)}`}
              accent={nlosColor(irs.vic_los_status)}
            />
            <DataRow
              label="Kalite Puani"
              value={`%${pct(irs.quality_score ?? irs.composite_score)}`}
              accent="var(--accent)"
            />
            <DataRow label="Durum" value={quality.label} accent={quality.color} />
            <DataRow label="Terminale Uzaklik" value={`${irs.distance_to_terminal} m`} />
            <DataRow label="Toplam Sinyal Yolu" value={`${irs.total_path_m} m`} />
            <DataRow
              label="Tahmini Link Kazanci"
              value={`${irs.link_gain_db >= 0 ? '+' : ''}${irs.link_gain_db} dB`}
              accent="var(--accent)"
            />
            <DataRow label="Acik Kapsama" value={`${irs.survivors_covered_clear} depremzede`} />
            <DataRow label="Toplam Kapsama" value={`${irs.survivors_covered} depremzede`} />
            <DataRow
              label="Hat Durumu"
              value={nlosLabel(irs.nlos_status)}
              accent={nlosColor(irs.nlos_status)}
            />
            <DataRow
              label="Montaj"
              value={mountLabel}
              accent={onFacade ? 'var(--accent)' : undefined}
            />
            <DataRow label="Montaj Yuksekligi" value={`${irs.mount_height_m} m`} />
            {onFacade && irs.host_building_name && (
              <DataRow label="Bina" value={irs.host_building_name} />
            )}
            {blockerSummary && (
              <DataRow label="Engelleyen Bina" value={blockerSummary} accent="#f59e0b" />
            )}
          </div>

          {irs.comparison && (
            <p className="mt-4 text-sm italic leading-relaxed text-muted">{irs.comparison}</p>
          )}

          <button
            onClick={() => setShowTech((v) => !v)}
            className="mt-5 w-full rounded-md border border-accent/50 bg-accent/10 px-4 py-2.5 font-head text-base font-semibold tracking-wide text-accent transition-all duration-200 hover:bg-accent/20"
          >
            {showTech ? 'Teknik Detaylari Gizle ^' : 'Teknik Detaylar v'}
          </button>
          {showTech && (
            <div className="mt-3 rounded-md border border-accent/20 bg-card p-5 shadow-inner animate-fadeInUp">
              <div className="mb-2 font-head text-xs uppercase tracking-[0.25em] text-accent">
                Muhendislik Analizi
              </div>
              <p className="text-[14px] leading-7 text-text">
                {irs.technical || 'Teknik aciklama bu birim icin yuklenemedi.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
