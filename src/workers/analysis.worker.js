import {
  runAnalysis,
  finalizeTerminals,
  buildExplanationPayload,
} from '../lib/algorithm.js'

self.onmessage = (event) => {
  const { requestId, survivors, debris, buildings } = event.data

  try {
    const base = runAnalysis(survivors, debris, buildings)
    const terminals = finalizeTerminals(base.terminals, null, buildings, debris, base.context)
    const payload = buildExplanationPayload(terminals, base.clusters, {
      survivors: survivors.length,
      debris: debris.length,
    })

    const uiTerminals = terminals.map((terminal) => {
      const {
        candidates,
        preferredCandidateIds,
        globalChosen,
        ...uiTerminal
      } = terminal
      return uiTerminal
    })

    self.postMessage({
      requestId,
      result: { clusters: base.clusters, terminals: uiTerminals, payload },
    })
  } catch (error) {
    self.postMessage({
      requestId,
      error: String(error?.message || error),
    })
  }
}
