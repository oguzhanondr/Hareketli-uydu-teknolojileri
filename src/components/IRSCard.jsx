import { pct, rankColor, nlosColor, nlosLabel, qualityBadge } from '../lib/ui.js'

export default function IRSCard({ irs, index, onOpen }) {
  const score = pct(irs.quality_score ?? irs.composite_score)
  const badge = rankColor(irs.rank)
  const quality = qualityBadge(irs.quality_score ?? irs.composite_score)

  return (
    <button
      onClick={() => onOpen(irs)}
      style={{ animationDelay: `${index * 100}ms` }}
      className="flex w-full flex-col rounded-lg border border-border bg-card p-3 text-left animate-fadeInUp transition-all duration-200 hover:border-accent/60 hover:bg-card-hover hover:shadow-glow"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rotate-45 rounded-[2px] bg-irs" />
          <span className="font-head text-sm font-bold tracking-wide text-text">{irs.name}</span>
        </div>
        <span
          className="rounded-md px-2 py-0.5 font-head text-xs font-bold tabular-nums"
          style={{ backgroundColor: `${badge}22`, color: badge, border: `1px solid ${badge}55` }}
        >
          {score}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-head uppercase tracking-wide">
        <span style={{ color: nlosColor(irs.nlos_status) }}>● {nlosLabel(irs.nlos_status)}</span>
        <span className="text-muted">·</span>
        <span className="text-muted">{irs.survivors_covered_clear} acik kapsama</span>
        <span className="text-muted">·</span>
        <span className="text-muted">{irs.distance_to_terminal} m</span>
        {typeof irs.link_gain_db === 'number' && (
          <>
            <span className="text-muted">·</span>
            <span className="text-accent">
              {irs.link_gain_db >= 0 ? '+' : ''}
              {irs.link_gain_db} dB
            </span>
          </>
        )}
      </div>

      <div className="mt-1 flex items-center gap-2 text-[10px] font-head uppercase tracking-wide">
        <span style={{ color: quality.color }}>{quality.label}</span>
        <span className="text-muted">·</span>
        <span className="text-accent">
          {irs.mount_type === 'cephe'
            ? `${irs.facade} cephe · ~${irs.mount_height_m} m`
            : `Serbest direk · ~${irs.mount_height_m} m`}
        </span>
      </div>

      {irs.validity_status === 'borderline' && irs.constrained_reason && (
        <div className="mt-1 text-[10px] font-head uppercase tracking-wide text-amber-300">
          Sinirda: {irs.constrained_reason}
        </div>
      )}

      <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-muted">
        {irs.summary || irs.selection_reason}
      </p>
    </button>
  )
}
