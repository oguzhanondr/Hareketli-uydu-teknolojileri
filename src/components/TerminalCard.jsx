import { useState } from 'react'

function mountLabel(mount) {
  if (!mount) return null
  if (mount.type === 'acik alan') return `Açık alan - serbest direk - ~${mount.mount_height_m} m`
  const host = mount.host_building_name || 'Bina'
  if (mount.type === 'cati') return `${host} - çatı - ~${mount.mount_height_m} m`
  return `${host} - ${mount.facade} cephe - ~${mount.mount_height_m} m`
}

export default function TerminalCard({ terminal, selected, onSelect, index }) {
  const [expanded, setExpanded] = useState(false)
  const mount = terminal.mount
  const label = mountLabel(mount)
  const showIrs = mount && mount.type !== 'acik alan' && mount.irs_total > 0
  const borderlineCount = terminal.irs?.filter((u) => u.validity_status === 'borderline').length ?? 0
  const description = terminal.description || ''
  const hasLongDescription = description.length > 90

  const handleToggleExpanded = (e) => {
    e.stopPropagation()
    onSelect(terminal.id)
    setExpanded((v) => !v)
  }

  return (
    <button
      onClick={() => onSelect(terminal.id)}
      style={{ animationDelay: `${index * 100}ms` }}
      className={`group flex w-full flex-col items-start rounded-lg border p-3 text-left animate-fadeInUp transition-all duration-200 ${
        selected
          ? 'border-accent/40 bg-card shadow-glow'
          : 'border-border bg-card hover:border-accent/40 hover:bg-card-hover hover:shadow-glow'
      }`}
    >
      <div className="flex w-full items-center justify-between">
        <span className="font-head text-base font-bold tracking-wide text-text">{terminal.name}</span>
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-full font-head text-xs font-bold ${
            selected ? 'bg-terminal text-white shadow-sm' : 'bg-terminal/14 text-terminal'
          }`}
        >
          {terminal.label}
        </span>
      </div>

      <div className="mt-1 flex items-baseline gap-1">
        <span className="font-head text-2xl font-bold text-accent tabular-nums">
          {terminal.scorePct}
        </span>
        <span className="font-head text-xs text-muted">/100 PUAN</span>
      </div>

      {label && (
        <span className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded-md border border-terminal/40 bg-terminal/10 px-1.5 py-0.5 font-head text-[10px] leading-tight tracking-wide text-terminal">
          <span className="truncate">{label}</span>
          {showIrs && (
            <span className="shrink-0 text-muted">
              {' '}
              - {mount.irs_visible}/{mount.irs_total} IRS
            </span>
          )}
        </span>
      )}

      <span
        className={`mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-head text-[10px] uppercase tracking-wide ${
          terminal.validIrsCount > 0
            ? 'border border-los/40 bg-los/10 text-los'
            : 'border border-debris/40 bg-debris/10 text-debris'
        }`}
      >
        {terminal.validIrsCount} geçerli IRS
      </span>

      {borderlineCount > 0 && (
        <span className="mt-1 inline-flex items-center gap-1 rounded-md border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 font-head text-[10px] uppercase tracking-wide text-amber-300">
          {borderlineCount} sınırda aday
        </span>
      )}

      <div className="mt-1.5 w-full">
        <div className="relative">
          <p
            onClick={hasLongDescription ? handleToggleExpanded : undefined}
            title={hasLongDescription ? (expanded ? 'Daha az göster' : 'Devamını oku') : undefined}
            className={`text-[11px] leading-snug text-muted transition-all ${
              expanded ? '' : 'line-clamp-2'
            } ${hasLongDescription ? 'cursor-pointer' : ''}`}
          >
            {description}
          </p>
          {hasLongDescription && !expanded && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-card via-card/95 to-transparent" />
          )}
        </div>

        {hasLongDescription && (
          <div className="mt-1 flex justify-end">
            <button
              type="button"
              onClick={handleToggleExpanded}
              aria-expanded={expanded}
              className="inline-flex items-center gap-1 font-head text-[10px] font-semibold uppercase tracking-[0.16em] text-accent transition-colors duration-200 hover:text-accent/80"
            >
              <span>{expanded ? 'Daha az göster' : 'Devamını oku'}</span>
              <ChevronIcon open={expanded} />
            </button>
          </div>
        )}
      </div>
    </button>
  )
}

function ChevronIcon({ open }) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      className={`h-3 w-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.25 4.5 6 8.25 9.75 4.5" />
    </svg>
  )
}
