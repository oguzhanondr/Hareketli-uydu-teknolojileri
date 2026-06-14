import { useEffect, useRef, useState } from 'react'
import { SCENARIOS } from '../data/scenarios.js'

const DIFFICULTY_COLOR = {
  Basit: '#22c55e',
  Orta: '#38bdf8',
  Zor: '#eab308',
  Asiri: '#ef4444',
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
        className="flex items-center gap-2 rounded-md border border-border bg-card px-4 py-1.5 font-head text-sm font-semibold tracking-wide text-text transition-all duration-200 hover:border-accent hover:text-accent"
      >
        <span className="text-accent">[ ]</span> Demo Senaryolar
        <span className={`text-xs transition-transform ${open ? 'rotate-180' : ''}`}>v</span>
      </button>

      {open && (
        <div className="absolute left-1/2 z-[1200] mt-2 w-80 -translate-x-1/2 overflow-hidden rounded-lg border border-accent/40 bg-panel shadow-glow-lg">
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
