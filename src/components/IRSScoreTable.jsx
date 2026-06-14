import { pct, qualityBadge, nlosColor } from '../lib/ui.js'

const TH = 'px-2 py-2 font-head text-[10px] font-semibold uppercase tracking-wide text-muted whitespace-nowrap'
const TD = 'px-2 py-1.5 whitespace-nowrap'

function statusText(irs) {
  if (irs.validity_status === 'borderline') return { label: 'Sinirda', color: '#eab308' }
  return { label: 'Gecerli', color: '#22c55e' }
}

export default function IRSScoreTable({ irs, onOpen }) {
  if (!irs?.length) return null

  return (
    <div className="mb-3 overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full border-collapse text-left text-[11px]">
        <thead>
          <tr>
            <th className={TH}>Aday</th>
            <th className={TH}>T-&gt;IRS</th>
            <th className={TH}>IRS-&gt;Hedef</th>
            <th className={TH}>Durum</th>
            <th className={TH}>Acik Kapsama</th>
            <th className={TH}>Kazanc</th>
            <th className={TH}>Kalite</th>
          </tr>
        </thead>
        <tbody>
          {irs.map((u) => {
            const badge = qualityBadge(u.quality_score ?? u.composite_score)
            const state = statusText(u)
            return (
              <tr
                key={u.id}
                onClick={() => onOpen(u)}
                title="Detaylari ac"
                className="cursor-pointer border-t border-border/60 tabular-nums transition-colors hover:bg-card-hover"
              >
                <td className={`${TD} font-head font-bold text-text`}>
                  <span
                    className="mr-1.5 inline-block h-2 w-2 rotate-45 rounded-[1px] align-middle"
                    style={{ backgroundColor: badge.color }}
                  />
                  {u.name}
                </td>
                <td className={TD} style={{ color: nlosColor(u.term_los_status) }}>
                  %{pct(u.term_los)}
                </td>
                <td className={TD} style={{ color: nlosColor(u.vic_los_status) }}>
                  %{pct(u.vic_los)}
                </td>
                <td className={TD} style={{ color: state.color }}>
                  {state.label}
                </td>
                <td className={`${TD} text-muted`}>{u.survivors_covered_clear}</td>
                <td className={`${TD} text-accent`}>
                  {u.link_gain_db >= 0 ? '+' : ''}
                  {u.link_gain_db} dB
                </td>
                <td className={`${TD} font-head font-bold`} style={{ color: badge.color }}>
                  %{pct(u.quality_score ?? u.composite_score)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
