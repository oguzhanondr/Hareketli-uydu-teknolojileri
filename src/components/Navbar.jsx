import DemoScenarios from './DemoScenarios.jsx'
import ExportPDF from './ExportPDF.jsx'

function StatusPill({ label, value, color, title }) {
  return (
    <div
      title={title}
      className="flex items-center gap-2 rounded-md border px-3 py-1.5 font-head text-xs font-semibold tracking-wide"
      style={{ borderColor: `${color}66`, color, backgroundColor: `${color}14` }}
    >
      <span
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }}
      />
      {label}: {value}
    </div>
  )
}

function EngineStatus({ status }) {
  const explanationValue =
    status.explanation === 'gemini'
      ? 'Gemini'
      : status.explanation === 'pending'
        ? 'Calisiyor'
        : status.hasKey
          ? 'Yerel'
          : 'Kapali'
  const explanationColor =
    status.explanation === 'gemini'
      ? '#22c55e'
      : status.explanation === 'pending'
        ? '#00d4ff'
        : status.hasKey
          ? '#eab308'
          : '#8aa0c6'
  const rerankValue =
    status.rerank === 'gemini'
      ? 'Gemini'
      : status.rerank === 'pending'
        ? 'Calisiyor'
        : status.hasKey
          ? 'Yerel'
          : 'Kapali'
  const rerankColor =
    status.rerank === 'gemini'
      ? '#22c55e'
      : status.rerank === 'pending'
        ? '#00d4ff'
        : status.hasKey
          ? '#eab308'
          : '#8aa0c6'
  const validationValue =
    !status.hasKey
      ? 'Kapali'
      : status.validation === 'running'
        ? 'Calisiyor'
        : status.validation === 'done'
          ? 'Gemini'
          : status.validation === 'error'
            ? 'Hata'
            : 'Hazir'
  const validationColor =
    validationValue === 'Gemini'
      ? '#22c55e'
      : validationValue === 'Calisiyor'
        ? '#00d4ff'
        : validationValue === 'Hata'
          ? '#ef4444'
          : status.hasKey
            ? '#eab308'
            : '#8aa0c6'

  return (
    <div className="flex items-center gap-2">
      <StatusPill
        label="Yerlesim"
        value="Yerel"
        color="#00d4ff"
        title="Konumlandirma her zaman yerel ve deterministik motorla yapilir."
      />
      <StatusPill
        label="Aciklama"
        value={explanationValue}
        color={explanationColor}
        title={
          status.explanation === 'gemini'
            ? 'Aciklamalar Gemini ile uretildi.'
            : status.explanation === 'pending'
              ? 'Yerel sonuc gosterildi; Gemini arka planda aciklama uretiyor.'
            : status.error
              ? `Gemini kullanilamadi: ${status.error}`
              : status.hasKey
                ? 'Gemini denendi; su an ekranda yerel aciklama gosteriliyor.'
                : 'Gemini kapali, aciklamalar yerel motorla sunuluyor.'
        }
      />
      <StatusPill
        label="Rerank"
        value={rerankValue}
        color={rerankColor}
        title={
          status.rerank === 'gemini'
            ? 'Gecerli yerel cozumler arasindaki sunum sirasi Gemini ile iyilestirildi.'
            : status.rerank === 'pending'
              ? 'Yerel siralama gosterildi; Gemini arka planda yeniden siralamayi deniyor.'
            : status.hasKey
              ? 'Gemini devrede; ancak yalnizca gecerli yerel cozumleri yeniden siralar.'
              : 'Gemini kapali oldugu icin yerel siralama korunuyor.'
        }
      />
      <StatusPill
        label="Dogrulama"
        value={validationValue}
        color={validationColor}
        title={
          !status.hasKey
            ? 'Gemini anahtari olmadigi icin gorsel dogrulama kapali.'
            : status.validation === 'running'
              ? 'Harita goruntusu Gemini ile dogrulaniyor.'
              : status.validation === 'done'
                ? 'Gorsel dogrulama tamamlandi.'
                : status.validation === 'error'
                  ? status.error
                    ? `Gemini kullanilamadi: ${status.error}`
                    : 'Gorsel dogrulama tamamlanamadi.'
                  : 'Analizden sonra gorsel dogrulama calismaya hazir.'
        }
      />
    </div>
  )
}

export default function Navbar({ onLoadScenario, isDark, onToggleTheme, aiStatus, result, meta }) {
  return (
    <header className="relative z-[1100] flex items-center gap-4 border-b border-border bg-panel px-4 py-2.5">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-md border border-accent/50 bg-accent/10 shadow-glow">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="#00d4ff" strokeWidth="1.7">
            <rect x="9.5" y="9.5" width="5" height="5" rx="1" fill="#00d4ff" fillOpacity="0.3" />
            <path d="M9.5 9.5 L5.5 5.5 M4 7 L7 4 M4 4 L7 7" strokeLinecap="round" />
            <path d="M14.5 14.5 L18.5 18.5 M17 20 L20 17 M17 17 L20 20" strokeLinecap="round" />
            <path d="M12 4 a8 8 0 0 1 8 8" strokeOpacity="0.6" />
          </svg>
        </div>
        <div className="leading-tight">
          <div className="font-head text-lg font-bold tracking-wide text-text">
            ARES<span className="text-accent">-Reflect</span>
          </div>
          <div className="font-head text-[9px] uppercase tracking-[0.3em] text-muted">
            Terminal Yerlesim Sistemi
          </div>
        </div>
      </div>

      <div className="mx-auto">
        <DemoScenarios onLoad={onLoadScenario} />
      </div>

      <div className="flex items-center gap-2.5">
        <EngineStatus status={aiStatus} />
        <button
          onClick={onToggleTheme}
          title="Temayi degistir"
          className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-base transition-all duration-200 hover:border-accent hover:text-accent"
        >
          {isDark ? 'Light' : 'Dark'}
        </button>
        <ExportPDF result={result} meta={meta} />
      </div>
    </header>
  )
}
