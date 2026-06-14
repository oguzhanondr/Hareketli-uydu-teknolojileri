export default function LoadingOverlay({ message }) {
  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-[#060b16]/80 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-6">
        <div className="relative h-20 w-20">
          <div className="absolute inset-0 rounded-full border-2 border-border" />
          <div
            className="absolute inset-0 rounded-full border-2 border-transparent border-t-accent border-r-accent"
            style={{ animation: 'overlay-spin 0.9s linear infinite' }}
          />
          <div className="absolute inset-3 rounded-full bg-accent/10 animate-pulseGlow" />
        </div>
        <div className="text-center">
          <div className="font-head text-lg font-semibold tracking-wide text-accent">
            {message || 'İşleniyor...'}
          </div>
          <div className="mt-1 font-head text-xs uppercase tracking-[0.3em] text-muted">
            ARES-Reflect - Yerel Optimizasyon
          </div>
        </div>
      </div>
    </div>
  )
}
