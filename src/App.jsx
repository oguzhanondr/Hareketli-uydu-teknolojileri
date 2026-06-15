import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Navbar from './components/Navbar.jsx'
import MapPanel from './components/Map.jsx'
import TerminalCard from './components/TerminalCard.jsx'
import IRSCard from './components/IRSCard.jsx'
import IRSScoreTable from './components/IRSScoreTable.jsx'
import IRSModal from './components/IRSModal.jsx'
import ValidationModal from './components/ValidationModal.jsx'
import LoadingOverlay from './components/LoadingOverlay.jsx'
import ProjectDetailsPage from './components/ProjectDetailsPage.jsx'
import { useTheme } from './hooks/useTheme.js'
import { useMarkers } from './hooks/useMarkers.js'
import { useAnalysis } from './hooks/useAnalysis.js'
import { SCENARIOS, resolveScenario } from './data/scenarios.js'
import { ELBISTAN_CENTER, DEFAULT_ZOOM } from './lib/buildings.js'

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || ''
const DETAILS_HASH = '#proje-detaylari'

export default function App() {
  const { isDark, toggle } = useTheme()
  const markers = useMarkers()
  const analysis = useAnalysis()
  const [modalIRS, setModalIRS] = useState(null)
  const [validationOpen, setValidationOpen] = useState(false)
  const [flyTo, setFlyTo] = useState(null)
  const [demoError, setDemoError] = useState(null)
  const [page, setPage] = useState(() =>
    window.location.hash === DETAILS_HASH ? 'details' : 'main'
  )

  useEffect(() => {
    const syncPage = () => setPage(window.location.hash === DETAILS_HASH ? 'details' : 'main')
    window.addEventListener('hashchange', syncPage)
    syncPage()
    return () => window.removeEventListener('hashchange', syncPage)
  }, [])

  const handleOpenProjectDetails = useCallback(() => {
    if (window.location.hash === DETAILS_HASH) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
      setPage('main')
      return
    }
    window.location.hash = DETAILS_HASH
  }, [])

  const resetBefore = useCallback(
    (action) =>
      (...args) => {
        if (analysis.result) analysis.reset()
        action(...args)
      },
    [analysis]
  )

  const handleMapClick = useMemo(
    () => resetBefore((latlng) => markers.addSurvivorAt(latlng)),
    [markers, resetBefore]
  )

  const handleRemoveSurvivor = useMemo(
    () => resetBefore((id) => markers.removeSurvivor(id)),
    [markers, resetBefore]
  )

  const handleToggleEnkaz = useMemo(
    () => resetBefore((id) => markers.toggleEnkaz(id)),
    [markers, resetBefore]
  )

  const handleRemoveEnkaz = useMemo(
    () => resetBefore((id) => markers.removeEnkaz(id)),
    [markers, resetBefore]
  )

  const handleClear = useCallback(() => {
    analysis.reset()
    markers.clearAll()
  }, [analysis, markers])

  const handleAnalyze = useCallback(() => {
    if (!markers.canAnalyze) return
    analysis.analyze(markers.survivors, markers.debris, markers.buildings, API_KEY)
  }, [analysis, markers])

  const handleValidate = useCallback(
    (mapEl) => {
      const r = analysis.result
      if (!r) return
      const placementData = {
        survivor_count: markers.counts.survivors,
        debris_count: markers.counts.enkaz,
        terminals: r.terminals.map((t) => ({
          name: t.name,
          lat: Number(t.lat.toFixed(5)),
          lng: Number(t.lng.toFixed(5)),
          irs: t.irs.map((u) => ({
            name: u.name,
            rank: u.rank,
            quality_score: u.quality_score,
            term_los: u.term_los,
            vic_los: u.vic_los,
            validity_status: u.validity_status,
          })),
        })),
      }
      analysis.runValidation(mapEl, API_KEY, placementData)
    },
    [analysis, markers]
  )

  const pendingDemo = useRef(null)
  const buildingsRef = useRef([])
  useEffect(() => {
    buildingsRef.current = markers.buildings
  }, [markers.buildings])

  const applyDemoIfReady = useCallback(() => {
    const pd = pendingDemo.current
    if (!pd) return
    const res = resolveScenario(pd.scenario, buildingsRef.current)
    if (res.enkazIds.length > 0) {
      if (pd.timer) clearTimeout(pd.timer)
      pendingDemo.current = null
      setDemoError(null)
      markers.setScene(res.survivors, res.enkazIds)
    }
  }, [markers])

  useEffect(() => {
    applyDemoIfReady()
  }, [markers.buildings, applyDemoIfReady])

  const handleLoadScenario = useCallback(
    (scenario) => {
      analysis.reset()
      markers.clearAll()
      setDemoError('Demo senaryosu için bina verisi yükleniyor. Lütfen kısa bir süre bekleyin.')
      if (pendingDemo.current?.timer) clearTimeout(pendingDemo.current.timer)
      const timer = setTimeout(() => {
        const pd = pendingDemo.current
        if (!pd) return
        pendingDemo.current = null
        const res = resolveScenario(pd.scenario, buildingsRef.current)
        if (res.enkazIds.length > 0) markers.setScene(res.survivors, res.enkazIds)
        else {
          setDemoError(
            'Bina verisi henüz alınamadı. Haritada biraz yakınlaştırıp 10-20 saniye bekledikten sonra demo senaryoyu tekrar seçin.'
          )
        }
      }, 25000)
      pendingDemo.current = { scenario, timer }
      setFlyTo({ center: ELBISTAN_CENTER, zoom: DEFAULT_ZOOM, token: Date.now() })
      setTimeout(applyDemoIfReady, 200)
    },
    [analysis, markers, applyDemoIfReady]
  )

  useEffect(
    () => () => {
      if (pendingDemo.current?.timer) clearTimeout(pendingDemo.current.timer)
    },
    []
  )

  const pendingAnalyze = useRef(false)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const demo = p.get('demo')
    if (!demo) return
    const sc = SCENARIOS.find((s) => s.id === demo)
    if (!sc) return
    handleLoadScenario(sc)
    if (p.get('analyze') === '1') pendingAnalyze.current = true
  }, [handleLoadScenario])

  useEffect(() => {
    if (pendingAnalyze.current && markers.canAnalyze && !analysis.loading && !analysis.result) {
      pendingAnalyze.current = false
      analysis.analyze(markers.survivors, markers.debris, markers.buildings, API_KEY)
    }
  }, [markers.canAnalyze, markers.survivors, markers.debris, analysis])

  const selectedTerminal = useMemo(
    () => analysis.result?.terminals.find((t) => t.id === analysis.selectedTerminalId) || null,
    [analysis.result, analysis.selectedTerminalId]
  )

  const meta = {
    survivors: markers.counts.survivors,
    debris: markers.counts.enkaz,
    placementSource: analysis.placementSource,
    explanationSource: analysis.source,
    rerankSource: analysis.rerankSource,
  }

  const aiStatus = {
    hasKey: !!API_KEY,
    placement: analysis.placementSource,
    explanation: analysis.source,
    rerank: analysis.rerankSource,
    validation: analysis.validation.status,
    error: analysis.error,
  }

  return (
    <div className="relative flex h-full flex-col">
      <Navbar
        isDark={isDark}
        onToggleTheme={toggle}
        aiStatus={aiStatus}
        result={analysis.result}
        meta={meta}
        currentPage={page}
        onOpenProjectDetails={handleOpenProjectDetails}
      />

      {page === 'details' ? (
        <ProjectDetailsPage geminiEnabled={!!API_KEY} />
      ) : (
      <main className="relative z-10 flex min-h-0 flex-1">
        <section className="h-full w-[60%] border-r border-border">
          <MapPanel
            survivors={markers.survivors}
            buildings={markers.buildings}
            enkazIds={markers.enkazIds}
            debris={markers.debris}
            mode={markers.mode}
            onMapClick={handleMapClick}
            onRemoveSurvivor={handleRemoveSurvivor}
            onToggleEnkaz={handleToggleEnkaz}
            onRemoveEnkaz={handleRemoveEnkaz}
            onBuildingsLoaded={markers.mergeBuildings}
            toggleMode={markers.toggleMode}
            onClear={handleClear}
            onAnalyze={handleAnalyze}
            canAnalyze={markers.canAnalyze}
            counts={markers.counts}
            loading={analysis.loading}
            result={analysis.result}
            selectedTerminalId={analysis.selectedTerminalId}
            flyTo={flyTo}
            onValidate={handleValidate}
            validation={analysis.validation}
            onOpenValidation={() => setValidationOpen(true)}
            onLoadScenario={handleLoadScenario}
          />
        </section>

        <section className="flex h-full w-[40%] flex-col overflow-hidden bg-panel">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <h2 className="font-head text-base font-bold uppercase tracking-[0.2em] text-text">
              Analiz Sonuçları
            </h2>
          </div>

          {demoError && (
            <div className="flex items-center justify-between gap-2 border-b border-debris/40 bg-debris/10 px-4 py-2 text-xs text-debris">
              <span>{demoError}</span>
              <button onClick={() => setDemoError(null)} className="font-bold">
                x
              </button>
            </div>
          )}

          {!analysis.result ? (
            <EmptyState markers={markers} />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
              <div>
                <div className="mb-2 font-head text-[11px] uppercase tracking-[0.25em] text-muted">
                  Terminaller
                </div>
                <div className="grid grid-cols-3 items-start gap-2.5">
                  {analysis.result.terminals.map((t, i) => (
                    <TerminalCard
                      key={t.id}
                      terminal={t}
                      index={i}
                      selected={t.id === analysis.selectedTerminalId}
                      onSelect={analysis.setSelectedTerminalId}
                    />
                  ))}
                </div>
              </div>

              {selectedTerminal && (
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="font-head text-[11px] uppercase tracking-[0.25em] text-muted">
                      {selectedTerminal.name}  -  {selectedTerminal.irs.length} Geçerli IRS
                    </span>
                    <span className="h-px flex-1 bg-border" />
                  </div>
                  {analysis.selectionReasoning?.[selectedTerminal.id] && (
                    <p className="mb-2 text-[11px] italic leading-snug text-muted">
                      Yerel seçim: {analysis.selectionReasoning[selectedTerminal.id]}
                    </p>
                  )}
                  {selectedTerminal.rerank_reason && analysis.rerankSource === 'gemini' && (
                    <p className="mb-2 text-[11px] leading-snug text-accent">
                      Gemini rerank: {selectedTerminal.rerank_reason}
                    </p>
                  )}

                  <IRSScoreTable irs={selectedTerminal.irs} onOpen={setModalIRS} />

                  {selectedTerminal.irs[0]?.decision && (
                    <div className="mb-3 rounded-lg border border-accent/20 bg-card-hover px-3 py-2 text-[11px] leading-snug text-text">
                      <span className="font-head font-semibold text-accent">Karar gerekcesi: </span>
                      {selectedTerminal.irs[0].decision}
                    </div>
                  )}

                  {selectedTerminal.irs.length > 0 ? (
                    <div className="flex flex-col gap-2.5">
                      {selectedTerminal.irs.map((u, i) => (
                        <IRSCard key={u.id} irs={u} index={i} onOpen={setModalIRS} />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-[12px] leading-snug text-amber-100">
                      Bu terminal için fiziksel olarak geçerli IRS bulunamadı. Terminal puanı gösteriliyor ama
                      sahaya önerilecek IRS çıkmadı.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      </main>
      )}

      {analysis.loading && <LoadingOverlay message={analysis.statusMessage} />}
      {modalIRS && <IRSModal irs={modalIRS} onClose={() => setModalIRS(null)} />}
      {validationOpen && (
        <ValidationModal
          validation={analysis.validation}
          onClose={() => setValidationOpen(false)}
          onReanalyze={handleAnalyze}
        />
      )}
    </div>
  )
}

function EmptyState({ markers }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-accent/25 bg-card text-2xl text-accent shadow-glow">
        o
      </div>
      <h3 className="font-head text-lg font-bold tracking-wide text-text">Henüz analiz yok</h3>
      <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted">
        <span className="font-semibold text-debris">Enkaz Seç</span> ile haritadaki binalara tıklayıp
        çökmüş binaları işaretleyin, <span className="font-semibold text-survivor">Depremzede Ekle</span>{' '}
        ile depremzede bırakın, gerekirse <span className="font-semibold text-text">Kaldır</span> modu ile
        hatalı işaretleri silin ve sonra <span className="font-bold text-accent">Analiz Et</span>'e basın.
      </p>
      <div className="mt-5 flex items-center gap-4 font-head text-xs">
        <Req ok={markers.counts.survivors >= 3} label={`Depremzede ${markers.counts.survivors}/3`} />
        <Req ok={markers.counts.enkaz >= 1} label={`Enkaz ${markers.counts.enkaz}/1`} />
      </div>
    </div>
  )
}

function Req({ ok, label }) {
  return (
    <span className={`flex items-center gap-1.5 ${ok ? 'text-los' : 'text-muted'}`}>
      <span>{ok ? 'OK' : 'o'}</span>
      {label}
    </span>
  )
}
