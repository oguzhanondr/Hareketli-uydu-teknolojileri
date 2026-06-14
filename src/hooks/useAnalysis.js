import { useCallback, useRef, useState } from 'react'
import { runAnalysis, finalizeTerminals, buildExplanationPayload } from '../lib/algorithm.js'
import { generateExplanations, rerankTerminals, validatePlacementVisually } from '../lib/gemini.js'

/**
 * Orchestrates the local-first pipeline:
 *   1. local math + deterministic trio selection
 *   2. immediate result render
 *   3. Gemini explanations upgrade the result in the background
 *   4. visual validation runs post-render via runValidation()
 */
export function useAnalysis() {
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [source, setSource] = useState('local')
  const [rerankSource, setRerankSource] = useState('local')
  const [selectionReasoning, setSelectionReasoning] = useState(null)
  const [error, setError] = useState(null)
  const [selectedTerminalId, setSelectedTerminalId] = useState(null)
  const [validation, setValidation] = useState({ status: 'idle', result: null })
  const requestRef = useRef(0)

  const analyze = useCallback(async (survivors, debris, buildings, apiKey) => {
    const requestId = ++requestRef.current
    setLoading(true)
    setError(null)
    setValidation({ status: 'idle', result: null })
    setStatusMessage('Yerel analiz yapılıyor...')

    try {
      await new Promise((r) => setTimeout(r, 30))
      const base = runAnalysis(survivors, debris, buildings)
      const terminals = finalizeTerminals(base.terminals, null, buildings, debris, base.context)
      const payload = buildExplanationPayload(terminals, base.clusters, {
        survivors: survivors.length,
        debris: debris.length,
      })

      const reasoning = Object.fromEntries(
        terminals.map((t) => {
          const borderline = t.irs.filter((u) => u.validity_status === 'borderline').length
          const count = t.irs.length
          const text =
            count === 0
              ? 'Yerel motor bu terminal için fiziksel olarak geçerli IRS bulamadı; bu nedenle terminal puanı düşük kaldı.'
              : borderline > 0
                ? `Yerel motor bu terminal için ${count} geçerli IRS buldu; ${borderline} aday sınırda kalite bandında olduğu için dikkat etiketiyle tutuldu.`
                : `Yerel motor bu terminal için ${count} geçerli IRS buldu ve açık hat, kapsama ve dağılım dengesine göre en iyi seti seçti.`
          return [t.id, text]
        })
      )

      const localResult = { id: Date.now(), clusters: base.clusters, terminals, payload }
      setResult(localResult)
      setSelectedTerminalId(terminals[0]?.id ?? null)
      setSelectionReasoning(reasoning)
      setSource(apiKey ? 'pending' : 'local')
      setRerankSource(apiKey ? 'pending' : 'local')
      setLoading(false)
      setStatusMessage('')

      const [rerank, explanation] = await Promise.all([
        rerankTerminals(payload, apiKey),
        generateExplanations(payload, apiKey),
      ])
      if (requestRef.current !== requestId) return

      setResult((current) => {
        if (!current || current.id !== localResult.id) return current
        const orderIndex = new Map((rerank.terminalOrder || []).map((id, idx) => [id, idx]))
        const byId = new Map(explanation.items.map((it) => [it.id, it]))
        const nextTerminals = current.terminals
          .map((t) => ({
            ...t,
            reranked_by_gemini: rerank.source === 'gemini',
            rerank_reason: rerank.reasons?.[t.id] || '',
            irs: t.irs.map((u) => ({
              ...u,
              ...(byId.get(u.id) || {}),
              explanation_source: explanation.source === 'gemini' ? 'gemini' : 'local',
              reranked_by_gemini: rerank.source === 'gemini',
            })),
          }))
          .sort((a, b) => (orderIndex.get(a.id) ?? 999) - (orderIndex.get(b.id) ?? 999))
        return { ...current, terminals: nextTerminals }
      })
      setSelectedTerminalId((current) => rerank.terminalOrder?.[0] || current)
      setSource(explanation.source)
      setRerankSource(rerank.source)
      if (explanation.error) setError(explanation.error)
      else if (rerank.error) setError(rerank.error)
    } catch (err) {
      setError(String(err?.message || err))
      setResult(null)
      setLoading(false)
      setStatusMessage('')
    }
  }, [])

  const runValidation = useCallback(async (mapElement, apiKey, placementData) => {
    setValidation({ status: 'running', result: null })
    const res = await validatePlacementVisually(mapElement, placementData, apiKey)
    const status =
      res.source === 'gemini'
        ? 'done'
        : res.source === 'timeout'
          ? 'timeout'
          : res.source === 'skipped'
            ? 'skipped'
            : 'error'
    setValidation({ status, result: res })
  }, [])

  const reset = useCallback(() => {
    requestRef.current += 1
    setResult(null)
    setSource('local')
    setRerankSource('local')
    setSelectionReasoning(null)
    setError(null)
    setSelectedTerminalId(null)
    setValidation({ status: 'idle', result: null })
  }, [])

  return {
    result,
    loading,
    statusMessage,
    source,
    rerankSource,
    placementSource: 'local',
    selectionReasoning,
    error,
    selectedTerminalId,
    setSelectedTerminalId,
    validation,
    analyze,
    runValidation,
    reset,
  }
}
