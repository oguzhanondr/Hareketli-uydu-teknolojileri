import { useEffect, useRef, useState } from 'react'
import { SCENARIOS } from '../data/scenarios.js'

const DIFFICULTY_COLOR = {
  Basit: '#22c55e',
  Orta: '#38bdf8',
  Zor: '#eab308',
  Aşırı: '#ef4444',
}

export default function DemoScenarios({ onLoad }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="group flex items-center gap-2 rounded-md border border-border bg-card px-2.25 py-1.25 font-head text-[12px] font-semibold tracking-[0.02em] text-text shadow-sm transition-all duration-200 hover:border-accent/40 hover:shadow-glow whitespace-nowrap"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-accent/20 bg-accent/5 text-accent transition-all duration-200 group-hover:border-accent/35 group-hover:bg-accent/10">
          <PresetIcon />
        </span>
        <span className="leading-none">Demo Senaryolar</span>
        <span className={`text-[10px] text-muted transition-all duration-200 group-hover:text-accent ${open ? 'rotate-180' : ''}`}>
          <ChevronIcon />
        </span>
      </button>

      {open && (
        <div className="absolute left-0 z-[1200] mt-2 w-80 overflow-hidden rounded-2xl border border-border bg-panel shadow-glow-lg">
          {SCENARIOS.map((s, i) => (
            <button
              key={s.id}
              onClick={() => {
                onLoad(s)
                setOpen(false)
              }}
              style={{ animationDelay: `${i * 40}ms` }}
              className="flex w-full animate-fadeInUp items-start gap-3 border-b border-border/60 px-4 py-2.5 text-left transition-colors last:border-0 hover:bg-card-hover"
            >
              <span
                className="mt-0.5 rounded px-1.5 py-0.5 font-head text-[9px] font-bold uppercase tracking-wide"
                style={{
                  color: DIFFICULTY_COLOR[s.difficulty],
                  backgroundColor: `${DIFFICULTY_COLOR[s.difficulty]}1f`,
                }}
              >
                {s.difficulty}
              </span>
              <span className="flex-1">
                <span className="block font-head text-sm font-semibold text-text">{s.name}</span>
                <span className="block text-[11px] leading-snug text-muted">{s.description}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function PresetIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5" fill="none">
      <rect x="4.25" y="5" width="9.5" height="7.25" rx="1.6" stroke="currentColor" strokeWidth="1.4" opacity="0.55" />
      <rect x="6.75" y="7.75" width="9" height="7.25" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8.8 10.35h4.9M8.8 12.45h3.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.25 4.5 6 8.25 9.75 4.5" />
    </svg>
  )
}
