// ============================================================
// scoring.js - composite score calculations
//
// Terminal scoring uses bounded sub-metrics in [0,1] so the grid search stays
// stable across scenarios rather than depending on candidate-set min/max.
//
// IRS scoring evaluates the relay as a TWO-LEG channel (Terminal->IRS and
// IRS->survivor must BOTH be open), combining seven components and subtracting
// obstruction penalties.
// ============================================================
import { clamp, distanceM, elevationAngleScore } from './geometry.js'

export const COVERAGE_SCALE = 120 // meters; soft radius for inverse-distance coverage
export const DEBRIS_SCALE = 30 // meters; debris proximity sensitivity

export const IRS_WEIGHTS = {
  termLoS: 0.25,
  vicLoS: 0.25,
  distance: 0.15,
  height: 0.1,
  facade: 0.1,
  linkBudget: 0.1,
  covered: 0.05,
}
export const IRS_PENALTY = {
  blockage: 0.06,
  fresnel: 0.2,
}

/**
 * Bounded terminal sub-metrics for a single candidate point. All four are
 * already oriented into [0,1], so no candidate-set normalization is needed.
 *
 * @param candidate {lat,lng}
 * @param survivors [{lat,lng}]
 * @param debris    [{lat,lng}]
 * @param weights   per-survivor coverage weights (cluster density), same order
 */
export function terminalSubScores(candidate, survivors, debris, weights) {
  let coverage = 0
  let totalWeight = 0
  for (let i = 0; i < survivors.length; i++) {
    const d = distanceM(candidate, survivors[i])
    const w = weights ? weights[i] : 1
    coverage += w / (1 + d / COVERAGE_SCALE)
    totalWeight += w
  }
  coverage = totalWeight > 0 ? coverage / totalWeight : 0

  let nearest = Infinity
  for (const dp of debris) {
    const d = distanceM(candidate, dp)
    if (d < nearest) nearest = d
  }
  if (!Number.isFinite(nearest)) nearest = COVERAGE_SCALE * 2
  const avoidance = clamp(nearest / (DEBRIS_SCALE * 4))

  const elevation = elevationAngleScore(candidate, debris)
  const access = clamp(nearest / (COVERAGE_SCALE * 1.5))

  return { coverage, avoidance, elevation, access }
}

/**
 * Combine the IRS components into a composite score in [0,1], then subtract
 * obstruction penalties.
 */
export function irsCompositeScore({
  termLoS = 0,
  vicLoS = 0,
  distanceNorm = 0,
  heightScore = 0,
  facadeAlignNorm = 0,
  linkBudgetNorm = 0,
  coveredNorm = 0,
  blockageCount = 0,
  fresnelViolation = 0,
}) {
  const base =
    IRS_WEIGHTS.termLoS * termLoS +
    IRS_WEIGHTS.vicLoS * vicLoS +
    IRS_WEIGHTS.distance * distanceNorm +
    IRS_WEIGHTS.height * heightScore +
    IRS_WEIGHTS.facade * facadeAlignNorm +
    IRS_WEIGHTS.linkBudget * linkBudgetNorm +
    IRS_WEIGHTS.covered * coveredNorm
  const penalty = IRS_PENALTY.blockage * blockageCount + IRS_PENALTY.fresnel * fresnelViolation
  return Math.max(0, base - penalty)
}
