// Shared presentation helpers for cards, modal, and the PDF report.

export const pct = (x) => Math.round((x ?? 0) * 100)

export function rankColor(rank) {
  if (rank === 1) return '#22c55e'
  if (rank === 2) return '#eab308'
  return '#ef4444'
}

export function qualityBadge(score) {
  const pctScore = typeof score === 'number' ? Math.round(score * 100) : 0
  if (pctScore >= 85) return { label: 'Guclu', color: '#22c55e' }
  if (pctScore >= 70) return { label: 'Uygun', color: '#00d4ff' }
  if (pctScore >= 55) return { label: 'Sinirda', color: '#eab308' }
  return { label: 'Gecersiz', color: '#ef4444' }
}

export const NLOS = {
  CLEAR: { color: '#22c55e', label: 'Acik Hat' },
  PARTIAL_NLoS: { color: '#eab308', label: 'Kismi Engelli Hat' },
  FULL_NLoS: { color: '#ef4444', label: 'Engelli Hat' },
}

export function nlosColor(status) {
  return (NLOS[status] || NLOS.CLEAR).color
}

export function nlosLabel(status) {
  return (NLOS[status] || { label: status }).label
}
