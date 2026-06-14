import { useEffect } from 'react'

export default function ValidationModal({ validation, onClose, onReanalyze }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const res = validation?.result
  if (!res || res.source !== 'gemini') return null

  const valid = res.valid === true
  const failed = res.valid === false
  const color = valid ? '#22c55e' : failed ? '#ef4444' : '#eab308'
  const title = valid ? 'Yerleşim Doğrulandı' : failed ? 'Yerleşim Uyarısı' : 'Doğrulama Sonucu'

  return (
    <div
      className="fixed inset-0 z-[1500] flex items-center justify-center bg-[#040a14]/70 p-4 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl border bg-panel shadow-glow-lg"
        style={{ borderColor: `${color}66` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-border bg-card px-5 py-4">
          <div className="flex items-center gap-3">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-lg text-lg font-bold"
              style={{ backgroundColor: `${color}22`, color, border: `1px solid ${color}66` }}
            >
              {valid ? 'OK' : '!'}
            </span>
            <div>
              <h2 className="font-head text-xl font-bold tracking-wide text-text">{title}</h2>
              <div className="font-head text-[11px] uppercase tracking-[0.25em] text-muted">
                Gemini Görsel Doğrulama
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted transition-colors hover:border-debris hover:text-debris"
            aria-label="Kapat"
          >
            x
          </button>
        </div>

        <div className="px-5 py-4">
          <div className="flex items-center gap-4">
            <div className="flex items-baseline gap-1">
              <span className="font-head text-3xl font-bold tabular-nums" style={{ color }}>
                %{res.confidence ?? 0}
              </span>
              <span className="font-head text-xs text-muted">GÜVEN</span>
            </div>
            <span
              className="rounded-md px-2.5 py-1 font-head text-xs font-bold uppercase tracking-wide"
              style={{ backgroundColor: `${color}1f`, color }}
            >
              {valid ? 'Geçerli' : failed ? 'Geçersiz' : 'Belirsiz'}
            </span>
          </div>

          {res.recommendation && <p className="mt-3 text-sm leading-relaxed text-text">{res.recommendation}</p>}

          <div className="mt-4">
            <div className="mb-1.5 font-head text-[11px] uppercase tracking-[0.25em] text-muted">
              Tespit edilen sorunlar
            </div>
            {res.issues && res.issues.length > 0 ? (
              <ul className="list-disc space-y-1 rounded-md border border-border bg-card p-3 pl-7 text-[13px] leading-snug text-text/90">
                {res.issues.map((it, i) => (
                  <li key={i}>{it}</li>
                ))}
              </ul>
            ) : (
              <div className="rounded-md border border-border bg-card p-3 text-[13px] text-los">
                Görsel olarak belirgin bir sorun bulunamadı.
              </div>
            )}
          </div>

          {failed && (
            <button
              onClick={() => {
                onClose()
                onReanalyze()
              }}
              className="mt-4 w-full rounded-md border border-accent/35 bg-card px-4 py-2 font-head text-sm font-bold tracking-wide text-accent transition-all duration-200 hover:bg-card-hover hover:shadow-glow"
            >
              Tüm Pipeline'ı Yeniden Çalıştır
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
