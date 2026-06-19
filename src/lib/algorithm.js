// ============================================================
// algorithm.js - the placement optimization pipeline
//
// Step 1  Deterministic K-Means clustering of survivor coordinates (3 clusters)
// Step 2  Terminal candidate search around cluster + debris corridors
// Step 3  IRS candidate generation + absolute quality scoring
// Step 4  Joint terminal + IRS set optimization
// Step 5  Package a structured payload for explanations / validation
// ============================================================
import { mean } from 'simple-statistics'
import {
  distanceM,
  bearing,
  destinationPoint,
  localXY,
  angularDiff,
  clamp,
  reflectionEfficiency,
  firstBlockingBuilding,
  firstBlockingBuildingAtHeights,
  estimateLinkGainDb,
  buildingFacades,
  facadeAlignment,
  cardinalTR,
  DEBRIS_FOOTPRINT_M,
  pointInBuilding,
  distanceToBuildingM,
} from './geometry.js'
import { terminalSubScores, irsCompositeScore } from './scoring.js'
import { DEBUG } from '../config.js'

const K = 3
const TERMINAL_MIN_SEP_M = 100
const TERMINAL_HARD_MIN_SEP_M = 40
const TERMINAL_ABSOLUTE_MIN_SEP_M = 2
const TERMINAL_SHORTLIST_SPACING_M = 30
const TERMINAL_RING_DISTANCES_M = [18, 36, 54, 72, 90]
const TERMINAL_RING_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315]
const TERMINAL_CORRIDOR_FRACTIONS = [0.2, 0.35, 0.5, 0.65]
const TERMINAL_CORRIDOR_SIDE_OFFSETS_M = [-18, 0, 18]
const TERMINAL_BETWEEN_FRACTIONS = [0.25, 0.4, 0.55, 0.7]
const TERMINAL_BETWEEN_SIDE_OFFSETS_M = [-8, 0, 8]
const TERMINAL_DEBRIS_MAX_M = 220
const TERMINAL_DEBRIS_EDGE_MIN_M = 8
const TERMINAL_DEBRIS_EDGE_IDEAL_MAX_M = 45
const TERMINAL_DEBRIS_EDGE_MAX_M = 75
const TERMINAL_BUILDING_EDGE_MIN_M = 4
const TERMINAL_BUILDING_EDGE_IDEAL_MAX_M = 35
const TERMINAL_BUILDING_EDGE_MAX_M = 70
const TERMINAL_BETWEEN_MIN_ANGLE_DEG = 125
const TERMINAL_BETWEEN_IDEAL_ANGLE_DEG = 165
const TERMINAL_PAIR_SEARCH_M = 150
const TERMINAL_PROXIMITY_MAX_M = 220
const TERMINAL_SHORTLIST_PER_CLUSTER = 12
const TERMINAL_SCORE_WEIGHTS = {
  irsSet: 0.15,
  corridor: 0.1,
  site: 0.5,
  coverage: 0.1,
  satAccess: 0.05,
  proximity: 0.1,
}

const IRS_COVERAGE_RADIUS_M = 150
const SITE_CLEARANCE_MIN_M = 10
const LOW_REFLECTION_MIN = 0.4

const FACADE_OFFSET_M = 1.5
const DEFAULT_BUILDING_HEIGHT_M = 12
const MOUNT_BELOW_ROOF_M = 2
const MOUNT_MIN_HEIGHT_M = 6
const MAST_HEIGHT_M = 8
const HEIGHT_IDEAL_M = 15

const TRIO_MIN_SEPARATION_M = 45
const CROSS_TERMINAL_IRS_DUPLICATE_M = 18
const TRIO_SHORTLIST_PER_CLUSTER = 4
const TRIO_SHORTLIST_MAX = 12
const VALID_QUALITY_THRESHOLD = 0.55
const GOOD_QUALITY_THRESHOLD = 0.7
const STRONG_QUALITY_THRESHOLD = 0.85

const TOTAL_PATH_GOOD_M = 90
const TOTAL_PATH_BAD_M = 360
const LINK_GAIN_BAD_DB = -5
const LINK_GAIN_GOOD_DB = 10
const TERMINAL_LABELS = ['A', 'B', 'C']
const REQUIRED_IRS_PER_TERMINAL = 3
const LOCAL_BUILDING_RING_MAX = 16
const LOCAL_BUILDING_RING_MIN = 6
const LOCAL_DEBRIS_ANCHOR_MAX = 3
const IRS_BUILDING_SHORTLIST_PER_HOST = 3
const IRS_DISTINCT_BUILDING_MIN_SEP_M = 12
const round = (v, p = 3) => Number(v.toFixed(p))

function comparePoints(a, b) {
  if (a.lng !== b.lng) return a.lng - b.lng
  if (a.lat !== b.lat) return a.lat - b.lat
  return 0
}

function stableSortPoints(points) {
  return [...points].sort(comparePoints)
}

function pointKey(p) {
  return `${Number(p.lat).toFixed(6)}:${Number(p.lng).toFixed(6)}`
}

function sortClusters(clusters) {
  return [...clusters].sort((a, b) => {
    if (a.centroid.lng !== b.centroid.lng) return a.centroid.lng - b.centroid.lng
    if (a.centroid.lat !== b.centroid.lat) return a.centroid.lat - b.centroid.lat
    return b.members.length - a.members.length
  })
}

// ============================================================
// STEP 1 - Deterministic K-Means (Lloyd + farthest-first init)
// ============================================================
function deterministicInit(pts, k) {
  const ordered = stableSortPoints(pts)
  const centroid = {
    lat: mean(ordered.map((p) => p.lat)),
    lng: mean(ordered.map((p) => p.lng)),
  }
  const first =
    [...ordered].sort((a, b) => {
      const da = distanceM(a, centroid)
      const db = distanceM(b, centroid)
      if (db !== da) return db - da
      return comparePoints(a, b)
    })[0] || ordered[0]

  const centers = [{ lat: first.lat, lng: first.lng }]
  while (centers.length < k) {
    const next =
      [...ordered].sort((a, b) => {
        const minA = Math.min(...centers.map((c) => distanceM(a, c)))
        const minB = Math.min(...centers.map((c) => distanceM(b, c)))
        if (minB !== minA) return minB - minA
        return comparePoints(a, b)
      })[0]
    if (!next) break
    if (!centers.some((c) => c.lat === next.lat && c.lng === next.lng)) {
      centers.push({ lat: next.lat, lng: next.lng })
    } else {
      break
    }
  }
  while (centers.length < k) {
    const fallback = ordered[centers.length % ordered.length]
    centers.push({ lat: fallback.lat, lng: fallback.lng })
  }
  return centers
}

function assignAndScore(pts, centers) {
  const assignments = new Array(pts.length)
  let distortion = 0
  for (let i = 0; i < pts.length; i++) {
    let best = Infinity
    let bestC = 0
    for (let c = 0; c < centers.length; c++) {
      const v = localXY(centers[c], pts[i])
      const d = v.x * v.x + v.y * v.y
      if (d < best - 1e-9 || (Math.abs(d - best) < 1e-9 && c < bestC)) {
        best = d
        bestC = c
      }
    }
    assignments[i] = bestC
    distortion += best
  }
  return { assignments, distortion }
}

function recomputeCenters(pts, assignments, centers) {
  const nextCenters = []
  for (let c = 0; c < centers.length; c++) {
    const members = pts.filter((_, i) => assignments[i] === c)
    if (members.length === 0) {
      const used = new Set(nextCenters.map((p) => `${p.lat}:${p.lng}`))
      const fallback =
        stableSortPoints(pts).find((p) => !used.has(`${p.lat}:${p.lng}`)) ||
        stableSortPoints(pts)[0]
      nextCenters.push({ lat: fallback.lat, lng: fallback.lng })
    } else {
      nextCenters.push({
        lat: mean(members.map((m) => m.lat)),
        lng: mean(members.map((m) => m.lng)),
      })
    }
  }
  return nextCenters
}

export function kMeans(pts, k = K) {
  const kk = Math.min(k, pts.length)
  let centers = deterministicInit(pts, kk)
  let assignments = []

  for (let it = 0; it < 50; it++) {
    const res = assignAndScore(pts, centers)
    assignments = res.assignments
    const next = recomputeCenters(pts, assignments, centers)
    const stable = next.every(
      (c, i) => Math.abs(c.lat - centers[i].lat) < 1e-9 && Math.abs(c.lng - centers[i].lng) < 1e-9
    )
    centers = next
    if (stable) break
  }

  const clusters = []
  for (let c = 0; c < centers.length; c++) {
    const members = pts.filter((_, i) => assignments[i] === c)
    const centroid =
      members.length > 0
        ? { lat: mean(members.map((m) => m.lat)), lng: mean(members.map((m) => m.lng)) }
        : centers[c]
    const avgSpread =
      members.length > 0 ? mean(members.map((m) => distanceM(centroid, m))) || 0 : 0
    const density = members.length / (1 + avgSpread / 50)
    clusters.push({ centroid, members, density })
  }
  return sortClusters(clusters)
}

// ============================================================
// Shared helpers
// ============================================================
function mountInfoFor(building) {
  if (!building) {
    return { building_height_m: null, mount_height_m: MAST_HEIGHT_M, height_source: 'mast' }
  }
  const known = typeof building.heightM === 'number' && building.heightM > 0
  const height = known ? building.heightM : DEFAULT_BUILDING_HEIGHT_M
  const mount = Math.max(
    MOUNT_MIN_HEIGHT_M,
    Math.min(round(height - MOUNT_BELOW_ROOF_M, 0), round(height, 0))
  )
  return {
    building_height_m: round(height, 0),
    mount_height_m: round(mount, 0),
    height_source: known ? 'osm' : 'estimate',
  }
}

export function getIntactBuildings(buildings = [], debris = []) {
  const debrisIds = new Set(debris.map((d) => d.id).filter(Boolean))
  return buildings.filter(
    (b) => b.latlngs && Number.isFinite(b.lat) && Number.isFinite(b.lng) && !debrisIds.has(b.id)
  )
}

function buildNameIndex(buildings = []) {
  return new Map(buildings.map((b) => [b.id, b.name || `Bina ${b.id}`]))
}

function buildAnalysisContext(buildings = [], debris = []) {
  const debrisIds = new Set(debris.map((d) => d.id).filter(Boolean))
  const debrisBuildings = buildings.filter((b) => b.latlngs && debrisIds.has(b.id))
  const debrisById = new Map(debrisBuildings.map((b) => [b.id, b]))
  const intactObstacles = getIntactBuildings(buildings, debris)
  const buildingById = new Map(buildings.map((b) => [b.id, b]))
  const buildingNames = buildNameIndex(buildings)
  const blockerCache = new Map()

  const blockerFor = (a, b, options = {}) => {
    const ka = pointKey(a)
    const kb = pointKey(b)
    const startHeightM = options.startHeightM ?? 1.5
    const endHeightM = options.endHeightM ?? 1.5
    const excludedIds = [...new Set(options.excludedIds || [])].sort()
    const optionKey = `${round(startHeightM, 1)}:${round(endHeightM, 1)}:${excludedIds.join(',')}`
    const key =
      ka < kb
        ? `${ka}|${kb}|${optionKey}`
        : `${kb}|${ka}|${round(endHeightM, 1)}:${round(startHeightM, 1)}:${excludedIds.join(',')}`
    if (!blockerCache.has(key)) {
      blockerCache.set(
        key,
        firstBlockingBuildingAtHeights(
          a,
          b,
          startHeightM,
          endHeightM,
          intactObstacles,
          { excludedIds }
        )
      )
    }
    return blockerCache.get(key)
  }

  return {
    buildings,
    intactObstacles,
    debrisBuildings,
    debrisById,
    buildingById,
    buildingNames,
    blockerFor,
  }
}

function analysisContextOf(buildingsOrContext = [], debris = []) {
  if (buildingsOrContext && typeof buildingsOrContext === 'object' && 'blockerFor' in buildingsOrContext) {
    return buildingsOrContext
  }
  return buildAnalysisContext(buildingsOrContext, debris)
}

function placeTerminalMount(terminal, irsUnits = []) {
  const irsTotal = irsUnits.length
  if (terminal.mount_type === 'cati' && terminal.host_building_id) {
    return {
      type: 'cati',
      host_building_id: terminal.host_building_id,
      host_building_name: terminal.host_building_name,
      facade: null,
      facade_bearing: null,
      building_height_m: terminal.building_height_m,
      mount_height_m: terminal.mount_height_m,
      height_source: terminal.height_source,
      irs_visible: irsTotal,
      irs_total: irsTotal,
      lat: terminal.lat,
      lng: terminal.lng,
      roof_slot: terminal.roof_slot || null,
      fallback_reason: null,
    }
  }
  return {
    type: 'acik alan',
    host_building_id: null,
    host_building_name: null,
    facade: null,
    facade_bearing: null,
    mount_height_m: MAST_HEIGHT_M,
    height_source: 'mast',
    irs_visible: irsTotal,
    irs_total: irsTotal,
    lat: terminal.lat,
    lng: terminal.lng,
    fallback_reason: terminal.open_area_fallback_reason || 'Yerel bina halkasında uygun çatı bulunamadı.',
    roof_slot: null,
  }
}

function terminalMountHeightM(terminal) {
  return terminal?.mount_height_m || terminal?.mount?.mount_height_m || MAST_HEIGHT_M
}

function terminalHostId(terminal) {
  return terminal?.host_building_id || terminal?.mount?.host_building_id || null
}

function linkBlocker(context, a, b, startHeightM, endHeightM, excludedIds = []) {
  return context.blockerFor(a, b, {
    startHeightM,
    endHeightM,
    excludedIds: excludedIds.filter(Boolean),
  })
}

function targetCoverageRatio(clearCovered, targetCount) {
  return clamp(clearCovered / Math.max(targetCount || 1, 1))
}

function pathScore(totalPathM) {
  return clamp((TOTAL_PATH_BAD_M - totalPathM) / (TOTAL_PATH_BAD_M - TOTAL_PATH_GOOD_M))
}

function linkScore(gainDb) {
  return clamp((gainDb - LINK_GAIN_BAD_DB) / (LINK_GAIN_GOOD_DB - LINK_GAIN_BAD_DB))
}

function validityStatusFor(candidate) {
  if (
    candidate.term_blocked ||
    candidate.vic_blocked ||
    candidate.survivors_covered_clear <= 0 ||
    candidate.quality_score < VALID_QUALITY_THRESHOLD
  ) {
    return 'invalid'
  }
  if (candidate.quality_score < GOOD_QUALITY_THRESHOLD) return 'borderline'
  return 'valid'
}

function isSelectableIrsCandidate(candidate) {
  return (
    candidate &&
    !candidate.term_blocked &&
    !candidate.vic_blocked &&
    candidate.survivors_covered_clear > 0 &&
    candidate.quality_score >= VALID_QUALITY_THRESHOLD &&
    candidate.validity_status !== 'invalid'
  )
}

function clearCoveredSurvivors(candidate, context = null) {
  return (candidate?.coveredSurvivors || []).filter(
    (s) =>
      s.nlos === 'CLEAR' &&
      (!context ||
        !linkBlocker(
          context,
          candidate,
          s,
          candidate.mount_height_m || MOUNT_MIN_HEIGHT_M,
          1.5,
          [candidate.host_building_id]
        ))
  )
}

function hasCrossTerminalDuplicate(candidate, selectedPoints = [], thresholdM = CROSS_TERMINAL_IRS_DUPLICATE_M) {
  return selectedPoints.some((p) => distanceM(p, candidate) < thresholdM)
}

function annotateCandidate(candidate, targetCount) {
  const coverageScore = targetCoverageRatio(candidate.survivors_covered_clear, targetCount)
  const distanceScore = pathScore(candidate.total_path_m)
  const linkBudgetScore = linkScore(candidate.link_gain_db)
  const heightScore = clamp(candidate.mount_height_m / HEIGHT_IDEAL_M)
  const reasons = []

  let quality = irsCompositeScore({
    termLoS: candidate.term_los,
    vicLoS: candidate.vic_los,
    distanceNorm: distanceScore,
    heightScore,
    facadeAlignNorm: candidate.facade_alignment,
    linkBudgetNorm: linkBudgetScore,
    coveredNorm: coverageScore,
    blockageCount: candidate.blockage_count,
    fresnelViolation: candidate.fresnel_violation,
  })

  if (candidate.siteClearance < 0) {
    quality *= 0.12
    reasons.push('IRS noktası enkaz alanının içine düşüyor.')
  } else if (candidate.siteClearance < SITE_CLEARANCE_MIN_M) {
    quality *= 0.55
    reasons.push('IRS noktası enkaza fazla yakın.')
  }
  if (candidate.reflection_efficiency < LOW_REFLECTION_MIN) {
    quality *= 0.45
    reasons.push('Yansıma açısı verimsiz kaldığı için link zayıflıyor.')
  }
  if (candidate.term_blocked || candidate.vic_blocked) {
    quality = Math.min(quality, 0.24)
    reasons.push('Iki bacaktan biri ayakta bina ile bloklu.')
  }
  if (coverageScore <= 0) {
    quality *= 0.5
    reasons.push('Açık kapsama oluşmadı.')
  }

  candidate.coverage_score = round(coverageScore)
  candidate.distance_score = round(distanceScore)
  candidate.link_budget_score = round(linkBudgetScore)
  candidate.height_score = round(heightScore)
  candidate.quality_score = round(quality)
  candidate.composite_score = candidate.quality_score
  candidate.reflection_efficiency = round(candidate.reflection_efficiency)
  candidate.term_los = round(candidate.term_los)
  candidate.vic_los = round(candidate.vic_los)
  candidate.fresnel_clear = round(candidate.fresnel_clear)
  candidate.fresnel_violation = round(candidate.fresnel_violation)
  candidate.theta_in = round(candidate.theta_in, 1)
  candidate.theta_out = round(candidate.theta_out, 1)
  candidate.distance_to_terminal = round(candidate.distance_to_terminal, 1)
  candidate.distance_irs_victim = round(candidate.distance_irs_victim, 1)
  candidate.total_path_m = round(candidate.total_path_m, 1)
  candidate.link_gain_db = round(candidate.link_gain_db, 1)
  candidate.facade_alignment = round(candidate.facade_alignment)
  candidate.validity_status = validityStatusFor(candidate)
  candidate.constrained = candidate.validity_status === 'borderline'
  candidate.constrained_reason =
    candidate.validity_status === 'invalid'
      ? reasons[0] || 'Fiziksel olarak geçerli bir iki bacaklı hat kurulamadı.'
      : candidate.validity_status === 'borderline'
        ? reasons[0] || 'Açık iki bacak var; ancak kalite sınırda kaldı.'
        : ''
  candidate.blocker_building_id = candidate.term_blocker_id || candidate.vic_blocker_id || null
  candidate.blocker_building_name = candidate.term_blocker_name || candidate.vic_blocker_name || null
  candidate.eliminated = candidate.validity_status === 'invalid'
}

function trioCoverageScore(trio, totalSurvivors) {
  const visible = new Set()
  for (const c of trio) {
    for (const s of c.coveredSurvivors) {
      if (s.nlos === 'CLEAR' && s.id) visible.add(s.id)
    }
  }
  return clamp(visible.size / Math.max(totalSurvivors || 1, 1))
}

function trioClusterSpread(trio) {
  return new Set(trio.map((c) => c.clusterIndex)).size / Math.min(3, trio.length)
}

function trioSeparationScore(trio) {
  if (trio.length < 2) return { min: Infinity, score: 1, ok: true }
  let min = Infinity
  for (let i = 0; i < trio.length; i++) {
    for (let j = i + 1; j < trio.length; j++) {
      min = Math.min(min, distanceM(trio[i], trio[j]))
    }
  }
  return {
    min,
    score: clamp((min - 20) / (TRIO_MIN_SEPARATION_M - 20)),
    ok: min >= TRIO_MIN_SEPARATION_M,
  }
}

function buildShortlist(candidates) {
  const grouped = new Map()
  for (const c of [...candidates].sort((a, b) => b.quality_score - a.quality_score)) {
    const list = grouped.get(c.clusterIndex) || []
    if (list.length < TRIO_SHORTLIST_PER_CLUSTER) list.push(c)
    grouped.set(c.clusterIndex, list)
  }

  const merged = []
  const seen = new Set()
  for (const list of grouped.values()) {
    for (const c of list) {
      if (!seen.has(c.id)) {
        merged.push(c)
        seen.add(c.id)
      }
    }
  }
  for (const c of [...candidates].sort((a, b) => b.quality_score - a.quality_score)) {
    if (merged.length >= TRIO_SHORTLIST_MAX) break
    if (!seen.has(c.id)) {
      merged.push(c)
      seen.add(c.id)
    }
  }
  return merged
}

function setSelectionReason(candidate) {
  candidate.selection_reason =
    candidate.quality_score >= STRONG_QUALITY_THRESHOLD
      ? 'Açık iki bacak, güçlü kalite puanı ve farklı kapsama katkısı sağlıyor.'
      : candidate.quality_score >= GOOD_QUALITY_THRESHOLD
        ? 'Açık iki bacak ve dengeli kapsama ile geçerli bir öneridir.'
        : 'Açık iki bacak var; ancak kapsama veya link kalitesi sınırda kaldığı için dikkatli kullanılmalıdır.'
}

export function selectBestIrsSet(candidates, totalSurvivors = 0, maxCount = 3, options = {}) {
  if (!candidates?.length) return []
  const excludedPoints = options.excludedPoints || []
  const selectableAll = candidates.filter(isSelectableIrsCandidate)
  const selectable = selectableAll.filter((c) => !hasCrossTerminalDuplicate(c, excludedPoints))
  if (!selectable.length && selectableAll.length && excludedPoints.length) return []
  if (!selectable.length) return []
  const ranked = [...selectable].sort((a, b) => b.quality_score - a.quality_score)
  const shortlist = buildShortlist(ranked)
  const limit = Math.min(maxCount, shortlist.length)
  const evaluated = []

  const consider = (bucket, option) => {
    if (
      !bucket ||
      option.score > bucket.score + 1e-9 ||
      (Math.abs(option.score - bucket.score) < 1e-9 && option.qualityFloor > bucket.qualityFloor) ||
      (Math.abs(option.score - bucket.score) < 1e-9 && option.coverage > bucket.coverage)
    ) {
      return option
    }
    return bucket
  }

  const visit = (current, start) => {
    if (current.length > 0) {
      const qualityAvg = mean(current.map((c) => c.quality_score))
      const qualityFloor = Math.min(...current.map((c) => c.quality_score))
      const coverage = trioCoverageScore(current, totalSurvivors)
      const spread = trioClusterSpread(current)
      const separation = trioSeparationScore(current)
      const score =
        qualityAvg * 0.56 +
        qualityFloor * 0.16 +
        coverage * 0.18 +
        spread * 0.05 +
        separation.score * 0.05 -
        (separation.ok ? 0 : 0.08)

      evaluated.push({
        chosen: [...current],
        count: current.length,
        score,
        qualityFloor,
        coverage,
        separation,
      })
    }

    if (current.length === limit) return
    for (let i = start; i < shortlist.length; i++) {
      current.push(shortlist[i])
      visit(current, i + 1)
      current.pop()
    }
  }

  visit([], 0)
  if (!evaluated.length) return []

  // IRS adedi sabit bir kota değildir. Önce en fazla kaç depremzedenin
  // kapsanabildiğini bul, sonra aynı kapsama tavanına ulaşan en küçük seti seç.
  // Böylece ikinci/üçüncü IRS yalnızca yeni açık kapsama sağlıyorsa eklenir.
  const coverageCeiling = Math.max(...evaluated.map((entry) => entry.coverage))
  const minimumRequiredCount = Math.min(
    ...evaluated
      .filter((entry) => Math.abs(entry.coverage - coverageCeiling) < 1e-9)
      .map((entry) => entry.count)
  )
  const required = evaluated.filter(
    (entry) =>
      entry.count === minimumRequiredCount &&
      Math.abs(entry.coverage - coverageCeiling) < 1e-9
  )
  let bestStrict = null
  let bestRelaxed = null
  for (const entry of required) {
    if (entry.separation.ok) bestStrict = consider(bestStrict, entry)
    bestRelaxed = consider(bestRelaxed, entry)
  }

  const chosen = (bestStrict?.chosen || bestRelaxed?.chosen || ranked.slice(0, 1))
    .slice()
    .sort((a, b) => b.quality_score - a.quality_score)
  chosen.forEach(setSelectionReason)
  return chosen
}

export function selectBestIrsTrio(candidates, totalSurvivors = 0) {
  return selectRequiredIrsTrio(candidates, totalSurvivors)
}

export function selectRequiredIrsTrio(candidates, totalSurvivors = 0, options = {}) {
  const excludedPoints = options.excludedPoints || []
  const terminalBuildingId = options.terminalBuildingId || null
  const selectable = (candidates || []).filter(
    (candidate) =>
      isSelectableIrsCandidate(candidate) &&
      candidate.mount_type === 'cephe' &&
      candidate.host_building_id &&
      candidate.host_building_id !== terminalBuildingId &&
      !hasCrossTerminalDuplicate(candidate, excludedPoints)
  )
  if (selectable.length < REQUIRED_IRS_PER_TERMINAL) return []

  const byBuilding = new Map()
  for (const candidate of selectable.sort((a, b) => b.quality_score - a.quality_score)) {
    const list = byBuilding.get(candidate.host_building_id) || []
    if (list.length < IRS_BUILDING_SHORTLIST_PER_HOST) list.push(candidate)
    byBuilding.set(candidate.host_building_id, list)
  }
  if (byBuilding.size < REQUIRED_IRS_PER_TERMINAL) return []

  const shortlist = [...byBuilding.values()].flat()
  let best = null
  for (let i = 0; i < shortlist.length - 2; i++) {
    for (let j = i + 1; j < shortlist.length - 1; j++) {
      for (let k = j + 1; k < shortlist.length; k++) {
        const chosen = [shortlist[i], shortlist[j], shortlist[k]]
        if (new Set(chosen.map((candidate) => candidate.host_building_id)).size !== 3) continue
        const separation = trioSeparationScore(chosen)
        if (separation.min < IRS_DISTINCT_BUILDING_MIN_SEP_M) continue

        const qualityAvg = mean(chosen.map((candidate) => candidate.quality_score))
        const qualityFloor = Math.min(...chosen.map((candidate) => candidate.quality_score))
        const coverage = trioCoverageScore(chosen, totalSurvivors)
        const spread = trioClusterSpread(chosen)
        const score =
          qualityAvg * 0.5 +
          qualityFloor * 0.15 +
          coverage * 0.25 +
          spread * 0.05 +
          clamp(separation.min / TRIO_MIN_SEPARATION_M) * 0.05

        if (
          !best ||
          score > best.score + 1e-9 ||
          (Math.abs(score - best.score) < 1e-9 && coverage > best.coverage) ||
          (Math.abs(score - best.score) < 1e-9 && qualityFloor > best.qualityFloor)
        ) {
          best = { chosen, score, coverage, qualityFloor }
        }
      }
    }
  }

  const chosen = (best?.chosen || []).slice().sort((a, b) => b.quality_score - a.quality_score)
  chosen.forEach(setSelectionReason)
  return chosen
}

// ============================================================
// STEP 2 - Joint terminal search around cluster + debris corridors
// ============================================================
function buildSurvivorWeights(clusters, survivors) {
  const maxDensity = Math.max(...clusters.map((c) => c.density), 1e-6)
  const survivorWeight = new Map()
  for (const cl of clusters) {
    for (const m of cl.members) survivorWeight.set(m, cl.density / maxDensity)
  }
  return survivors.map((s) => survivorWeight.get(s) ?? 0.5)
}

function pushUniquePoint(points, seen, pt) {
  const key = pointKey(pt)
  if (!seen.has(key)) {
    seen.add(key)
    points.push(pt)
  }
}

function clusterDebrisAnchors(cluster, debris) {
  if (!debris.length) return []
  const nearby = [...debris]
    .map((d) => ({ point: d, distance: distanceM(cluster.centroid, d) }))
    .sort((a, b) => a.distance - b.distance)
  const filtered = nearby.filter((d) => d.distance <= TERMINAL_DEBRIS_MAX_M)
  return (filtered.length ? filtered : nearby.slice(0, 2))
    .slice(0, LOCAL_DEBRIS_ANCHOR_MAX)
    .map((d) => d.point)
}

function edgeBandScore(distance, min, idealMax, max) {
  if (distance < min || distance > max) return 0
  if (distance <= idealMax) return 1
  return clamp(1 - (distance - idealMax) / Math.max(max - idealMax, 1))
}

function localBuildingRing(debrisAnchor, context) {
  const candidates = context.intactObstacles
    .map((building) => ({
      building,
      edgeDistanceM: distanceToBuildingM(debrisAnchor, building),
    }))
    .filter(({ building }) => {
      const obstacles = context.intactObstacles.filter((item) => item.id !== building.id)
      return !firstBlockingBuilding(debrisAnchor, building, obstacles)
    })
    .sort((a, b) => a.edgeDistanceM - b.edgeDistanceM)

  if (!candidates.length) return []
  const nearest = candidates[0].edgeDistanceM
  const adaptiveLimit = nearest + Math.max(35, nearest * 1.5)
  const ring = candidates.filter(
    (entry, index) =>
      index < LOCAL_BUILDING_RING_MIN || entry.edgeDistanceM <= adaptiveLimit
  )
  return ring.slice(0, LOCAL_BUILDING_RING_MAX).map((entry, index) => ({
    ...entry,
    rank: index + 1,
  }))
}

function roofMountPoints(building) {
  const center = { lat: building.lat, lng: building.lng }
  const points = [{ ...center, roof_slot: 'merkez' }]
  const facades = buildingFacades(building.latlngs)
    .sort((a, b) => b.length - a.length)
    .slice(0, 2)
  facades.forEach((facade, index) => {
    points.push({
      lat: center.lat + (facade.mid.lat - center.lat) * 0.45,
      lng: center.lng + (facade.mid.lng - center.lng) * 0.45,
      roof_slot: `cati-${index + 1}`,
    })
  })
  return points
}

function terminalSiteEvaluation(point, anchors, context) {
  if (point.mount_type === 'cati' && point.host_building_id) {
    const building = context.buildingById.get(point.host_building_id)
    const debrisAnchor =
      context.debrisById.get(point.related_debris_id) ||
      anchors.find((anchor) => anchor.id === point.related_debris_id)
    if (!building || !debrisAnchor) return { valid: false, reason: 'unknown-roof-site' }

    const ring = localBuildingRing(debrisAnchor, context)
    const ringEntry = ring.find((entry) => entry.building.id === building.id)
    if (!ringEntry) return { valid: false, reason: 'roof-outside-local-ring' }
    const actualDebrisEdgeM = distanceToBuildingM(point, debrisAnchor)
    if (
      actualDebrisEdgeM < TERMINAL_DEBRIS_EDGE_MIN_M ||
      actualDebrisEdgeM > TERMINAL_DEBRIS_EDGE_MAX_M
    ) {
      return { valid: false, reason: 'roof-outside-debris-safety-band' }
    }
    const obstacles = context.intactObstacles.filter((item) => item.id !== building.id)
    if (firstBlockingBuilding(building, debrisAnchor, obstacles)) {
      return { valid: false, reason: 'roof-not-facing-debris' }
    }

    const localityScore = clamp(1 - (ringEntry.rank - 1) / Math.max(ring.length - 1, 1))
    const debrisScore = clamp(
      1 - actualDebrisEdgeM / Math.max(ring[ring.length - 1]?.edgeDistanceM || 1, 1)
    )
    return {
      valid: true,
      placementType: 'roof',
      score: round(localityScore * 0.65 + debrisScore * 0.35),
      debrisId: debrisAnchor.id,
      terminalBuildingId: building.id,
      terminalBuildingName: building.name || null,
      debrisEdgeM: round(actualDebrisEdgeM, 1),
      buildingEdgeM: 0,
      betweenAngleDeg: 180,
      balanceRatio: 0,
      clearanceM: round(ringEntry.edgeDistanceM, 1),
      ringRank: ringEntry.rank,
      ringBuildingIds: ring.map((entry) => entry.building.id),
    }
  }

  const allFootprints = [...context.intactObstacles, ...context.debrisBuildings]
  if (allFootprints.some((building) => pointInBuilding(point, building))) {
    return { valid: false, reason: 'building-footprint' }
  }

  let best = null
  for (const debrisAnchor of anchors) {
    const debrisBuilding = context.debrisById.get(debrisAnchor.id) || debrisAnchor
    const debrisEdgeM = distanceToBuildingM(point, debrisBuilding)
    if (
      debrisEdgeM < TERMINAL_DEBRIS_EDGE_MIN_M ||
      debrisEdgeM > TERMINAL_DEBRIS_EDGE_MAX_M
    ) {
      continue
    }
    if (firstBlockingBuilding(point, debrisAnchor, context.intactObstacles)) continue

    for (const intact of context.intactObstacles) {
      if (distanceM(point, intact) > TERMINAL_PAIR_SEARCH_M + (intact.radius || 0)) continue
      const buildingEdgeM = distanceToBuildingM(point, intact)
      if (
        buildingEdgeM < TERMINAL_BUILDING_EDGE_MIN_M ||
        buildingEdgeM > TERMINAL_BUILDING_EDGE_MAX_M
      ) {
        continue
      }

      const betweenAngleDeg = angularDiff(
        bearing(point, debrisAnchor),
        bearing(point, intact)
      )
      if (betweenAngleDeg < TERMINAL_BETWEEN_MIN_ANGLE_DEG) continue

      const ratio = debrisEdgeM / Math.max(debrisEdgeM + buildingEdgeM, 1)
      if (ratio < 0.12 || ratio > 0.88) continue

      const debrisScore = edgeBandScore(
        debrisEdgeM,
        TERMINAL_DEBRIS_EDGE_MIN_M,
        TERMINAL_DEBRIS_EDGE_IDEAL_MAX_M,
        TERMINAL_DEBRIS_EDGE_MAX_M
      )
      const buildingScore = edgeBandScore(
        buildingEdgeM,
        TERMINAL_BUILDING_EDGE_MIN_M,
        TERMINAL_BUILDING_EDGE_IDEAL_MAX_M,
        TERMINAL_BUILDING_EDGE_MAX_M
      )
      const angleScore = clamp(
        (betweenAngleDeg - TERMINAL_BETWEEN_MIN_ANGLE_DEG) /
          (180 - TERMINAL_BETWEEN_MIN_ANGLE_DEG)
      )
      const idealAngleScore = clamp(
        (betweenAngleDeg - TERMINAL_BETWEEN_MIN_ANGLE_DEG) /
          (TERMINAL_BETWEEN_IDEAL_ANGLE_DEG - TERMINAL_BETWEEN_MIN_ANGLE_DEG)
      )
      const balanceScore = clamp(1 - Math.abs(ratio - 0.5) / 0.38)
      const score =
        debrisScore * 0.3 +
        buildingScore * 0.2 +
        angleScore * 0.2 +
        idealAngleScore * 0.15 +
        balanceScore * 0.15

      const option = {
        valid: true,
        placementType: 'open',
        score: round(score),
        debrisId: debrisAnchor.id || null,
        intactBuildingId: intact.id || null,
        debrisEdgeM: round(debrisEdgeM, 1),
        buildingEdgeM: round(buildingEdgeM, 1),
        betweenAngleDeg: round(betweenAngleDeg, 1),
        balanceRatio: round(ratio),
        clearanceM: round(Math.min(debrisEdgeM, buildingEdgeM), 1),
        ringBuildingIds: localBuildingRing(debrisAnchor, context).map(
          (entry) => entry.building.id
        ),
      }
      if (!best || option.score > best.score) best = option
    }
  }

  return best || { valid: false, reason: 'no-building-debris-corridor' }
}

function buildTerminalCandidatePoints(cluster, debris, context, terminalIndex = 0) {
  const points = []
  const seen = new Set()

  for (const anchor of clusterDebrisAnchors(cluster, debris)) {
    const ring = localBuildingRing(anchor, context)
    for (const { building, rank, edgeDistanceM } of ring) {
      const mountInfo = mountInfoFor(building)
      const roofPoints = roofMountPoints(building)
      const roofPoint = roofPoints[terminalIndex % roofPoints.length]
      pushUniquePoint(points, seen, {
        ...roofPoint,
        mount_type: 'cati',
        host_building_id: building.id,
        host_building_name: building.name || null,
        building_height_m: mountInfo.building_height_m,
        mount_height_m: mountInfo.building_height_m,
        height_source: mountInfo.height_source,
        related_debris_id: anchor.id,
        local_ring_rank: rank,
        debris_edge_m: round(edgeDistanceM, 1),
      })
    }

    const br = bearing(anchor, cluster.centroid)
    const corridorDist = distanceM(anchor, cluster.centroid)
    for (const frac of TERMINAL_CORRIDOR_FRACTIONS) {
      const step = Math.max(
        TERMINAL_DEBRIS_EDGE_MIN_M,
        Math.min(TERMINAL_DEBRIS_MAX_M * 0.6, corridorDist * frac)
      )
      const centerline = destinationPoint(anchor, step, br)
      pushUniquePoint(points, seen, {
        ...centerline,
        mount_type: 'acik alan',
        related_debris_id: anchor.id,
        open_area_fallback_reason: 'Yerel bina halkasında tam üç IRS sağlayan uygun çatı bulunamadı.',
      })
      for (const side of TERMINAL_CORRIDOR_SIDE_OFFSETS_M) {
        if (side === 0) continue
        pushUniquePoint(
          points,
          seen,
          {
            ...destinationPoint(centerline, Math.abs(side), side > 0 ? br + 90 : br + 270),
            mount_type: 'acik alan',
            related_debris_id: anchor.id,
            open_area_fallback_reason:
              'Yerel bina halkasında tam üç IRS sağlayan uygun çatı bulunamadı.',
          }
        )
      }
    }
    for (const dist of TERMINAL_RING_DISTANCES_M) {
      for (const ang of TERMINAL_RING_ANGLES) {
        pushUniquePoint(points, seen, {
          ...destinationPoint(anchor, dist, ang),
          mount_type: 'acik alan',
          related_debris_id: anchor.id,
          open_area_fallback_reason:
            'Yerel bina halkasında tam üç IRS sağlayan uygun çatı bulunamadı.',
        })
      }
    }

    const nearbyIntact = context.intactObstacles
      .map((building) => ({ building, distance: distanceM(anchor, building) }))
      .filter((item) => item.distance <= TERMINAL_PAIR_SEARCH_M + (item.building.radius || 0))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 10)

    for (const { building, distance } of nearbyIntact) {
      const pairBearing = bearing(anchor, building)
      for (const fraction of TERMINAL_BETWEEN_FRACTIONS) {
        const centerline = destinationPoint(anchor, distance * fraction, pairBearing)
        for (const side of TERMINAL_BETWEEN_SIDE_OFFSETS_M) {
          pushUniquePoint(
            points,
            seen,
            side === 0
              ? {
                  ...centerline,
                  mount_type: 'acik alan',
                  related_debris_id: anchor.id,
                  open_area_fallback_reason:
                    'Yerel bina halkasında tam üç IRS sağlayan uygun çatı bulunamadı.',
                }
              : {
                  ...destinationPoint(
                    centerline,
                    Math.abs(side),
                    side > 0 ? pairBearing + 90 : pairBearing + 270
                  ),
                  mount_type: 'acik alan',
                  related_debris_id: anchor.id,
                  open_area_fallback_reason:
                    'Yerel bina halkasında tam üç IRS sağlayan uygun çatı bulunamadı.',
                }
          )
        }
      }
    }
  }

  return stableSortPoints(points)
}

function clusterVisibilityScore(terminal, cluster, context) {
  if (!cluster.members.length) return 0
  let clear = 0
  for (const member of cluster.members) {
    if (
      !linkBlocker(
        context,
        terminal,
        member,
        terminalMountHeightM(terminal),
        1.5,
        [terminalHostId(terminal)]
      )
    ) {
      clear += 1
    }
  }
  return clamp(clear / cluster.members.length)
}

function potentialIrsHostCount(terminal, survivors, context) {
  const ringIds = new Set(terminal.siteEvaluation?.ringBuildingIds || [])
  const terminalBuildingId = terminalHostId(terminal)
  let count = 0
  for (const building of context.intactObstacles) {
    if (!ringIds.has(building.id) || building.id === terminalBuildingId) continue
    const mount = mountInfoFor(building)
    const usable = buildingFacades(building.latlngs).some((facade) => {
      const point = destinationPoint(facade.mid, FACADE_OFFSET_M, facade.normalBearing)
      if (
        linkBlocker(
          context,
          terminal,
          point,
          terminalMountHeightM(terminal),
          mount.mount_height_m,
          [terminalBuildingId, building.id]
        )
      ) {
        return false
      }
      return survivors.some(
        (survivor) =>
          distanceM(point, survivor) <= IRS_COVERAGE_RADIUS_M &&
          !linkBlocker(
            context,
            point,
            survivor,
            mount.mount_height_m,
            1.5,
            [building.id]
          )
      )
    })
    if (usable) count += 1
    if (count >= REQUIRED_IRS_PER_TERMINAL) return count
  }
  return count
}

function terminalCandidateMetrics(parts, cluster, terminal, chosen, totalSurvivors, context, anchors) {
  const validCount = chosen.length
  const qualityAvg = validCount ? mean(chosen.map((c) => c.quality_score)) : 0
  const qualityFloor = validCount ? Math.min(...chosen.map((c) => c.quality_score)) : 0
  const coverage = validCount ? trioCoverageScore(chosen, totalSurvivors) : 0
  const irsCorridor = validCount > 0 ? mean(chosen.map((c) => Math.min(c.term_los, c.vic_los))) : 0
  const directVisibility = clusterVisibilityScore(terminal, cluster, context)
  const site = terminal.siteEvaluation || terminalSiteEvaluation(terminal, anchors, context)
  const debrisFitness = site.valid
    ? edgeBandScore(
        site.debrisEdgeM,
        TERMINAL_DEBRIS_EDGE_MIN_M,
        TERMINAL_DEBRIS_EDGE_IDEAL_MAX_M,
        TERMINAL_DEBRIS_EDGE_MAX_M
      )
    : 0
  const corridor = irsCorridor * 0.55 + directVisibility * 0.45
  const validCountScore = validCount > 0 ? 1 : 0
  const irsSetQuality = qualityAvg * 0.6 + coverage * 0.4
  const satAccess = parts.elevation
  const proximity = clamp(1 - distanceM(terminal, cluster.centroid) / TERMINAL_PROXIMITY_MAX_M)
  const score =
    TERMINAL_SCORE_WEIGHTS.irsSet * irsSetQuality +
    TERMINAL_SCORE_WEIGHTS.corridor * corridor +
    TERMINAL_SCORE_WEIGHTS.site * (site.valid ? site.score : 0) +
    TERMINAL_SCORE_WEIGHTS.coverage * parts.coverage +
    TERMINAL_SCORE_WEIGHTS.satAccess * satAccess +
    TERMINAL_SCORE_WEIGHTS.proximity * proximity

  return {
    score: round(score),
    validCount,
    qualityAvg: round(qualityAvg),
    qualityFloor: round(qualityFloor),
    coverage: round(coverage),
    corridor: round(corridor),
    directVisibility: round(directVisibility),
    debrisFitness: round(debrisFitness),
    siteScore: round(site.valid ? site.score : 0),
    site,
    validCountScore: round(validCountScore),
    satAccess: round(satAccess),
    proximity: round(proximity),
    irsSetQuality: round(irsSetQuality),
  }
}

function evaluateTerminalCandidate(
  candidate,
  cluster,
  clusters,
  survivors,
  debris,
  context,
  weights,
  anchors,
  exhaustive = false
) {
  const parts = terminalSubScores(candidate, survivors, debris, weights)
  const allIrs = optimizeIRS(candidate, clusters, survivors, debris, context, { exhaustive })
  const validIrs = allIrs.filter(isSelectableIrsCandidate)
  const chosen = selectRequiredIrsTrio(validIrs, survivors.length, {
    terminalBuildingId: terminalHostId(candidate),
  })
  const metrics = terminalCandidateMetrics(
    parts,
    cluster,
    candidate,
    chosen,
    survivors.length,
    context,
    anchors
  )

  return {
    parts,
    allIrs,
    validIrs,
    chosen,
    metrics,
  }
}

function shortlistTerminalEvaluations(evaluations) {
  const chosen = []
  for (const entry of evaluations) {
    if (chosen.length >= TERMINAL_SHORTLIST_PER_CLUSTER) break
    if (chosen.some((picked) => distanceM(picked.candidate, entry.candidate) < TERMINAL_SHORTLIST_SPACING_M)) {
      continue
    }
    chosen.push(entry)
  }
  for (const entry of evaluations) {
    if (chosen.length >= TERMINAL_SHORTLIST_PER_CLUSTER) break
    if (!chosen.includes(entry)) chosen.push(entry)
  }
  return chosen
}

function shortlistTerminalSites(entries, cluster, maxCount = 40) {
  const ranked = [...entries].sort((a, b) => {
    if (b.site.score !== a.site.score) return b.site.score - a.site.score
    return distanceM(a.pt, cluster.centroid) - distanceM(b.pt, cluster.centroid)
  })
  const chosen = []
  for (const entry of ranked) {
    if (chosen.length >= maxCount) break
    if (chosen.some((picked) => distanceM(picked.pt, entry.pt) < 7)) continue
    chosen.push(entry)
  }
  for (const entry of ranked) {
    if (chosen.length >= maxCount) break
    if (!chosen.includes(entry)) chosen.push(entry)
  }
  return chosen
}

function terminalSeparationScore(entries) {
  if (entries.length < 2) return { min: Infinity, score: 1, ok: true }
  let min = Infinity
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      min = Math.min(min, distanceM(entries[i].candidate, entries[j].candidate))
    }
  }
  return {
    min,
    score: clamp((min - 40) / (TERMINAL_MIN_SEP_M - 40)),
    ok: min >= TERMINAL_MIN_SEP_M,
  }
}

function assignUniqueIrsForEntries(entries, totalSurvivors) {
  const assignments = new Map()
  const ordered = [...entries].sort((a, b) => {
    const aValid = a.validIrs?.length || 0
    const bValid = b.validIrs?.length || 0
    if (aValid !== bValid) return aValid - bValid
    return b.metrics.score - a.metrics.score
  })

  for (const entry of ordered) {
    const selected = selectRequiredIrsTrio(entry.validIrs, totalSurvivors, {
      terminalBuildingId: terminalHostId(entry.candidate),
    })
    if (selected.length !== REQUIRED_IRS_PER_TERMINAL) {
      return {
        viable: false,
        assignments,
        counts: entries.map((e) => assignments.get(e)?.length || 0),
      }
    }
    assignments.set(entry, selected)
  }

  const assignedSets = entries.map((entry) => assignments.get(entry) || [])
  const counts = assignedSets.map((set) => set.length)
  const quality =
    assignedSets.length && assignedSets.every((set) => set.length)
      ? mean(assignedSets.map((set) => mean(set.map((c) => c.quality_score))))
      : 0
  const coverage = trioCoverageScore(assignedSets.flat(), totalSurvivors)
  const completeness = counts.every((count) => count === REQUIRED_IRS_PER_TERMINAL) ? 1 : 0

  return {
    viable: counts.every((count) => count === REQUIRED_IRS_PER_TERMINAL),
    assignments,
    counts,
    quality,
    coverage,
    completeness,
  }
}

function chooseTerminalCombination(groupedRankings, totalSurvivors = 0) {
  let bestStrict = null
  let bestRelaxed = null

  const consider = (bucket, candidate) => {
    if (
      !bucket ||
      candidate.score > bucket.score + 1e-9 ||
      (Math.abs(candidate.score - bucket.score) < 1e-9 && candidate.minScore > bucket.minScore) ||
      (Math.abs(candidate.score - bucket.score) < 1e-9 && candidate.separation.min > bucket.separation.min)
    ) {
      return candidate
    }
    return bucket
  }

  const visit = (clusterIdx, current) => {
    if (clusterIdx === groupedRankings.length) {
      const roofHosts = current
        .map((entry) => terminalHostId(entry.candidate))
        .filter(Boolean)
      const duplicateRoofCount = roofHosts.length - new Set(roofHosts).size
      const assignment = assignUniqueIrsForEntries(current, totalSurvivors)
      if (!assignment.viable) return
      const separation = terminalSeparationScore(current)
      const absoluteSeparationOk = separation.min >= TERMINAL_ABSOLUTE_MIN_SEP_M
      const distinctRoofs = duplicateRoofCount === 0
      const avgScore = mean(current.map((entry) => entry.metrics.score))
      const minScore = Math.min(...current.map((entry) => entry.metrics.score))
      const avgValid = mean(current.map((entry) => entry.metrics.validCountScore))
      const avgCorridor = mean(current.map((entry) => entry.metrics.corridor))
      const avgSite = mean(current.map((entry) => entry.metrics.siteScore))
      const comboScore =
        avgSite * 0.35 +
        avgScore * 0.2 +
        minScore * 0.08 +
        avgValid * 0.03 +
        avgCorridor * 0.04 +
        separation.score * 0.1 +
        assignment.quality * 0.08 +
        assignment.coverage * 0.08 +
        assignment.completeness * 0.04 -
        (separation.ok ? 0 : 0.12) -
        duplicateRoofCount * 0.08 -
        (absoluteSeparationOk ? 0 : 0.08)

      const chosen = current.map((entry) => ({
        ...entry,
        globalChosen: assignment.assignments.get(entry) || [],
      }))
      const candidate = { score: comboScore, minScore, separation, assignment, chosen }
      if (
        distinctRoofs &&
        absoluteSeparationOk &&
        separation.min >= TERMINAL_HARD_MIN_SEP_M
      ) {
        bestStrict = consider(bestStrict, candidate)
      }
      bestRelaxed = consider(bestRelaxed, candidate)
      return
    }

    for (const entry of groupedRankings[clusterIdx]) {
      current.push(entry)
      visit(clusterIdx + 1, current)
      current.pop()
    }
  }

  visit(0, [])
  const best = bestStrict || bestRelaxed
  if (best?.chosen?.length) return best.chosen

  const fallback = []
  for (const entries of groupedRankings) {
    const picked = entries.find((entry) => {
      const selected = selectRequiredIrsTrio(entry.validIrs, totalSurvivors, {
        terminalBuildingId: terminalHostId(entry.candidate),
      })
      if (selected.length !== REQUIRED_IRS_PER_TERMINAL) return false
      entry.globalChosen = selected
      return true
    })
    if (picked) fallback.push(picked)
  }
  return fallback
}

function describeTerminalSelection(terminal, cluster, debris = []) {
  const site = terminal.selectionMetrics.site
  const placementText =
    terminal.mount_type === 'cati'
      ? `Enkazın yerel bina halkasındaki ${terminal.host_building_name || 'sağlam bina'} çatısı seçildi.`
      : 'Aynı enkaz bölgesinde uygun çatı bulunamadığı için yerel açık alan kullanıldı.'
  return (
    `${cluster.members.length} depremzede için bu nokta seçildi; üç farklı sağlam bina cephesinde tam 3 geçerli IRS bulundu. ` +
    placementText +
    ' ' +
    `Terminal puanı IRS set kalitesi %${Math.round(terminal.selectionMetrics.irsSetQuality * 100)}, ` +
    `bina-enkaz koridor uygunluğu %${Math.round(terminal.selectionMetrics.siteScore * 100)}, ` +
    `açık görüş %${Math.round(terminal.selectionMetrics.corridor * 100)}, ` +
    `doğrudan görüş %${Math.round(terminal.selectionMetrics.directVisibility * 100)} ve ` +
    `yerel kapsama %${Math.round(terminal.subScores.coverage * 100)} ile oluştu. ` +
    `İlişkili enkaz kenarı yaklaşık ${Math.round(site.debrisEdgeM)} m uzaktadır.`
  )
}

export function refineTerminals(clusters, survivors, debris, buildings = [], contextArg = null) {
  const weights = buildSurvivorWeights(clusters, survivors)
  const context = analysisContextOf(contextArg || buildings, debris)
  const groupedRankings = []

  clusters.forEach((cluster, idx) => {
    const anchors = clusterDebrisAnchors(cluster, debris)
    const base = {
      id: `T-${TERMINAL_LABELS[idx]}`,
      label: TERMINAL_LABELS[idx],
      name: `Terminal ${TERMINAL_LABELS[idx]}`,
      clusterIndex: idx,
    }

    const siteCandidates = buildTerminalCandidatePoints(cluster, debris, context, idx)
      .map((pt) => ({ pt, site: terminalSiteEvaluation(pt, anchors, context) }))
      .filter(({ site }) => site.valid)
      .map(({ pt, site }) => {
        const candidate = { ...base, ...pt, siteEvaluation: site }
        return {
          pt,
          site: {
            ...site,
            potentialIrsHostCount: potentialIrsHostCount(candidate, survivors, context),
          },
        }
      })
      .filter(({ site }) => site.potentialIrsHostCount >= REQUIRED_IRS_PER_TERMINAL)

    const evaluateSites = (entries, exhaustive = false) =>
      entries.map(({ pt, site }) => {
        const candidate = {
          ...base,
          ...pt,
          siteEvaluation: site,
        }
        const evaluation = evaluateTerminalCandidate(
          candidate,
          cluster,
          clusters,
          survivors,
          debris,
          context,
          weights,
          anchors,
          exhaustive
        )
        return { candidate, ...evaluation }
      })

    const evaluatePool = (pool) => {
      if (!pool.length) return { evaluations: [], viable: [] }
      const orderedSites = shortlistTerminalSites(pool, cluster, pool.length)
      let evaluations = []
      let viable = []
      const batchSize = 4
      for (let start = 0; start < orderedSites.length; start += batchSize) {
        const additional = evaluateSites(orderedSites.slice(start, start + batchSize))
        evaluations = [...evaluations, ...additional]
        viable = evaluations.filter(
          (entry) => entry.chosen.length === REQUIRED_IRS_PER_TERMINAL
        )
        if (viable.length >= 4) break
      }

      if (!viable.length) {
        const exhaustiveSites = orderedSites.slice(0, 30)
        const exhaustive = evaluateSites(exhaustiveSites, true)
        evaluations = [...evaluations, ...exhaustive]
        viable = exhaustive.filter(
          (entry) => entry.chosen.length === REQUIRED_IRS_PER_TERMINAL
        )
      }
      return { evaluations, viable }
    }

    const roofSites = siteCandidates.filter(({ pt }) => pt.mount_type === 'cati')
    const openSites = siteCandidates.filter(({ pt }) => pt.mount_type !== 'cati')
    let { evaluations, viable: viableEvaluations } = evaluatePool(roofSites)
    if (!viableEvaluations.length) {
      const openResult = evaluatePool(openSites)
      evaluations = [...evaluations, ...openResult.evaluations]
      viableEvaluations = openResult.viable
    }

    if (!siteCandidates.length) {
      throw new Error(
        `Terminal ${TERMINAL_LABELS[idx]} için enkaza yakın, sağlam bina ile enkaz arasında açık koridor bulunamadı.`
      )
    }

    if (!viableEvaluations.length) {
      throw new Error(
        `Terminal ${TERMINAL_LABELS[idx]} için aynı enkaz bölgesinde üç farklı bina cephesine yerleşen 3 geçerli IRS bulunamadı.`
      )
    }

    const ranked = viableEvaluations.sort((a, b) => {
      if (b.metrics.siteScore !== a.metrics.siteScore) return b.metrics.siteScore - a.metrics.siteScore
      if (b.metrics.score !== a.metrics.score) return b.metrics.score - a.metrics.score
      if (b.metrics.qualityAvg !== a.metrics.qualityAvg) return b.metrics.qualityAvg - a.metrics.qualityAvg
      if (b.metrics.coverage !== a.metrics.coverage) return b.metrics.coverage - a.metrics.coverage
      return comparePoints(a.candidate, b.candidate)
    })
    groupedRankings.push(shortlistTerminalEvaluations(ranked))
  })

  const selected = chooseTerminalCombination(groupedRankings, survivors.length)
  if (selected.length !== K) {
    throw new Error(
      'Yerel enkaz bina halkalarında A, B ve C terminallerinin her biri için tam 3 IRS üretilemedi.'
    )
  }
  return selected.map((best) => {
    const cluster = clusters[best.candidate.clusterIndex]
    const chosen = best.globalChosen?.length ? best.globalChosen : best.chosen
    const metrics = terminalCandidateMetrics(
      best.parts,
      cluster,
      best.candidate,
      chosen,
      survivors.length,
      context,
      clusterDebrisAnchors(cluster, debris)
    )
    const terminal = {
      ...best.candidate,
      score: metrics.score,
      scorePct: Math.round(metrics.score * 100),
      subScores: best.parts,
      candidates: best.allIrs,
      preferredCandidateIds: chosen.map((c) => c.id),
      validCandidateCount: best.validIrs.length,
      validIrsCount: chosen.length,
      selectionMetrics: metrics,
      siteEvaluation: metrics.site,
    }
    terminal.description = describeTerminalSelection(terminal, cluster, debris)
    return terminal
  })
}

// ============================================================
// STEP 3 - IRS candidate generation + absolute scoring
// ============================================================
export function optimizeIRS(
  terminal,
  clusters,
  survivors,
  debris,
  buildingsOrContext = [],
  options = {}
) {
  const context = analysisContextOf(buildingsOrContext, debris)
  const debrisIds = new Set(debris.map((d) => d.id).filter(Boolean))
  const ringIds = new Set(
    terminal.siteEvaluation?.ringBuildingIds ||
      localBuildingRing(
        context.debrisById.get(terminal.related_debris_id) || debris[0],
        context
      ).map((entry) => entry.building.id)
  )
  const terminalBuildingId = terminalHostId(terminal)
  const mountable = context.buildings.filter(
    (b) =>
      b.latlngs &&
      !debrisIds.has(b.id) &&
      b.id !== terminalBuildingId &&
      ringIds.has(b.id)
  )
  const candidates = []
  let idx = 0

  const generateCandidates = (targetClusters) => {
    for (let ci = 0; ci < targetClusters.length; ci++) {
      const cluster = targetClusters[ci]
      for (const building of mountable) {
        const mountInfo = mountInfoFor(building)
        for (const facade of buildingFacades(building.latlngs)) {
          const pos = destinationPoint(facade.mid, FACADE_OFFSET_M, facade.normalBearing)
          const alignment = facadeAlignment(
            pos,
            facade.normalBearing,
            terminal,
            cluster.centroid
          )
          if (alignment < 0.15) continue
          const hostId = building.id
          const inDir = bearing(terminal, pos)
          const outDir = bearing(pos, cluster.centroid)
          const turn = angularDiff(inDir, outDir)
          const thetaIn = turn / 2
          const thetaOut = turn / 2
          const reflEff = reflectionEfficiency(thetaIn, thetaOut)
          const cid = `${terminal.label}-C${++idx}`

          const termBlockerId = linkBlocker(
            context,
            terminal,
            pos,
            terminalMountHeightM(terminal),
            mountInfo.mount_height_m,
            [terminalBuildingId, hostId]
          )
          const termBlocked = termBlockerId != null
          const termLos = termBlocked ? 0 : 1

          const d1 = distanceM(terminal, pos)
          const d2 = distanceM(pos, cluster.centroid)

          const coveredSurvivors = []
          let clearCovered = 0
          let blockedCovered = 0
          let firstVictimBlockerId = null
          for (const s of survivors) {
            if (distanceM(pos, s) <= IRS_COVERAGE_RADIUS_M) {
              const blk = linkBlocker(
                context,
                pos,
                s,
                mountInfo.mount_height_m,
                1.5,
                [hostId]
              )
              if (!blk) {
                clearCovered += 1
              } else {
                blockedCovered += 1
                if (!firstVictimBlockerId) firstVictimBlockerId = blk
              }
              coveredSurvivors.push({
                id: s.id,
                lat: s.lat,
                lng: s.lng,
                nlos: blk ? 'FULL_NLoS' : 'CLEAR',
              })
            }
          }
          const vicBlocked = clearCovered <= 0
          const vicLos = coveredSurvivors.length ? clearCovered / coveredSurvivors.length : 0
          const vicStatus = vicBlocked ? 'FULL_NLoS' : blockedCovered > 0 ? 'PARTIAL_NLoS' : 'CLEAR'
          const vicBlockerId = vicBlocked ? firstVictimBlockerId : null
          const linkGainDb = estimateLinkGainDb({
            reflEff,
            termLoS: termLos,
            vicLoS: vicLos,
            d1,
            d2,
          })

          let siteClearance = Infinity
          for (const d of debris) {
            const edge = distanceM(pos, d) - (d.radius || DEBRIS_FOOTPRINT_M)
            if (edge < siteClearance) siteClearance = edge
          }

          const candidate = {
            id: cid,
            lat: pos.lat,
            lng: pos.lng,
            clusterIndex: ci,
            clusterCentroid: cluster.centroid,
            theta_in: thetaIn,
            theta_out: thetaOut,
            reflection_efficiency: reflEff,
            term_los: termLos,
            term_los_status: termBlocked ? 'FULL_NLoS' : 'CLEAR',
            term_blocked: termBlocked,
            term_blocker_id: termBlockerId,
            term_blocker_name: termBlockerId ? context.buildingNames.get(termBlockerId) || null : null,
            vic_los: vicLos,
            vic_los_status: vicStatus,
            vic_blocked: vicBlocked,
            vic_blocker_id: vicBlockerId,
            vic_blocker_name: vicBlockerId ? context.buildingNames.get(vicBlockerId) || null : null,
            blockage_count: (termBlocked ? 1 : 0) + blockedCovered,
            fresnel_violation: 0,
            fresnel_clear: termBlocked || vicBlocked ? 0 : 1,
            nlos_status: termBlocked || vicBlocked ? 'FULL_NLoS' : vicStatus,
            distance_to_terminal: d1,
            distance_irs_victim: d2,
            total_path_m: d1 + d2,
            link_gain_db: linkGainDb,
            survivors_covered: coveredSurvivors.length,
            survivors_covered_clear: clearCovered,
            scenario_survivor_count: survivors.length,
            coveredSurvivors,
            siteClearance,
            mount_type: 'cephe',
            host_building_id: hostId,
            host_building_name: building.name ?? null,
            facade: cardinalTR(facade.normalBearing),
            facade_bearing: round(facade.normalBearing, 0),
            facade_alignment: alignment,
            building_height_m: mountInfo.building_height_m,
            mount_height_m: mountInfo.mount_height_m,
            height_source: mountInfo.height_source,
            terminal_mount_height_m: terminalMountHeightM(terminal),
            terminal_host_building_id: terminalBuildingId,
            height_los_checked: true,
          }

          annotateCandidate(candidate, cluster.members.length)
          candidates.push(candidate)
        }
      }
    }
  }

  generateCandidates(clusters)
  const validCount = candidates.filter(isSelectableIrsCandidate).length
  if (options.exhaustive && candidates.filter(isSelectableIrsCandidate).length === 0) {
    const survivorTargets = survivors.map((survivor) => ({
      centroid: survivor,
      members: [survivor],
    }))
    generateCandidates(survivorTargets)
  }

  const deduped = []
  for (const c of [...candidates].sort((a, b) => b.quality_score - a.quality_score)) {
    if (deduped.some((x) => distanceM(x, c) < 8)) continue
    deduped.push(c)
  }

  if (DEBUG) {
    for (const c of deduped.filter((x) => x.term_blocked || x.vic_blocked)) {
      console.log('[IRS blocked]', {
        candidate: c.id,
        terminal_to_irs: c.term_blocked ? `BLOCKED by ${c.term_blocker_id}` : 'ok',
        irs_to_target: c.vic_blocked ? `BLOCKED by ${c.vic_blocker_id}` : 'ok',
        quality: c.quality_score,
      })
    }
  }

  return deduped.sort((a, b) => b.quality_score - a.quality_score)
}

// ============================================================
// STEP 4a - Orchestrate the synchronous math
// ============================================================
export function runAnalysis(survivors, debris, buildings = []) {
  if (survivors.length < 3) throw new Error('En az 3 depremzede gerekli.')

  const clusters = kMeans(survivors, K)
  const context = buildAnalysisContext(buildings, debris)
  const terminals = refineTerminals(clusters, survivors, debris, buildings, context)

  for (const t of terminals) {
    if (!t.candidates?.length) {
      t.candidates = optimizeIRS(t, clusters, survivors, debris, context)
    }
    if (!t.preferredCandidateIds?.length) {
      t.preferredCandidateIds = selectRequiredIrsTrio(
        t.candidates.filter(isSelectableIrsCandidate),
        survivors.length,
        { terminalBuildingId: terminalHostId(t) }
      ).map((c) => c.id)
    }
  }

  return { clusters, terminals, context }
}

function buildIrsDecision(irs, peers) {
  const others = peers.filter((p) => p !== irs)
  const shortest = others.length > 0 && others.every((p) => p.total_path_m >= irs.total_path_m)
  const cautionText =
    irs.validity_status === 'borderline'
      ? ` ${irs.constrained_reason || 'Bu önerinin kalitesi sınırda kaldığı için dikkatli kullanılmalıdır.'}`
      : ''

  return (
    `${irs.name} seçildi; açık hatla ${irs.survivors_covered_clear} depremzedeye ulaşıyor, ` +
    `kalite puanı %${Math.round(irs.quality_score * 100)} ve toplam yol ${irs.total_path_m} m` +
    `${shortest ? ' ile seçilen adaylar içinde en kısa' : ''}.` +
    cautionText
  )
}

function updateTerminalFinalSummary(terminal) {
  const irs = terminal.irs || []
  const finalCompleteness = irs.length === REQUIRED_IRS_PER_TERMINAL ? 1 : 0
  const finalQuality = irs.length ? mean(irs.map((u) => u.quality_score)) : 0
  const finalCoverage = trioCoverageScore(irs, terminal.candidates?.[0]?.scenario_survivor_count || 0)
  const baseScore = terminal.score ?? 0
  const finalScore = clamp(
    baseScore * 0.45 +
      finalQuality * 0.25 +
      finalCoverage * 0.2 +
      finalCompleteness * 0.1
  )
  const uniqueSurvivors = new Set()
  for (const u of irs) {
    for (const s of u.coveredSurvivors || []) uniqueSurvivors.add(s.id)
  }

  terminal.score = round(finalScore)
  terminal.scorePct = Math.round(finalScore * 100)
  const site = terminal.siteEvaluation
  terminal.description =
    `${uniqueSurvivors.size} depremzede için bu nokta seçildi; ` +
    'üç farklı sağlam bina cephesinde tam 3 geçerli IRS üretildi. ' +
    'Terminal ve IRS bağlantıları bina yükseklikleriyle doğrulandı. ' +
    (terminal.mount_type === 'cati'
      ? `Terminal ${terminal.host_building_name || 'sağlam bina'} çatısındadır.`
      : `Terminal aynı enkaz bölgesindeki açık alandadır; neden: ${terminal.open_area_fallback_reason}`)
}

// ============================================================
// STEP 4b - Finalize up to 3 VALID IRS per terminal
// ============================================================
export function finalizeTerminals(terminals, selections, buildings = [], debris = [], contextArg = null) {
  const context = analysisContextOf(contextArg || buildings, debris)
  const terminalOrder = [...terminals].sort((a, b) => {
    const aHosts = new Set(
      (a.candidates || []).filter(isSelectableIrsCandidate).map((candidate) => candidate.host_building_id)
    ).size
    const bHosts = new Set(
      (b.candidates || []).filter(isSelectableIrsCandidate).map((candidate) => candidate.host_building_id)
    ).size
    if (aHosts !== bHosts) return aHosts - bHosts
    return (b.score ?? 0) - (a.score ?? 0)
  })

  for (const t of terminalOrder) {
    const site = terminalSiteEvaluation(t, debris, context)
    t.siteEvaluation = site
    if (!site.valid) {
      t.irs = []
      t.validIrsCount = 0
      continue
    }

    const finalSelectable = (candidate) =>
      isSelectableIrsCandidate(candidate) &&
      !linkBlocker(
        context,
        t,
        candidate,
        terminalMountHeightM(t),
        candidate.mount_height_m,
        [terminalHostId(t), candidate.host_building_id]
      ) &&
      clearCoveredSurvivors(candidate, context).length > 0

    const chosen = selectRequiredIrsTrio(
      t.candidates.filter(finalSelectable),
      t.candidates[0]?.scenario_survivor_count || 0,
      {
        terminalBuildingId: terminalHostId(t),
      }
    ).sort((a, b) => b.quality_score - a.quality_score)
    t.irs = chosen.map((c, i) => {
      const clearSurvivors = clearCoveredSurvivors(c, context)
      return {
        id: `${t.label}-IRS-${i + 1}`,
        name: `${t.label}-IRS-${i + 1}`,
        label: `${t.label}-IRS-${i + 1}`,
        terminalId: t.id,
        terminalLabel: t.label,
        rank: i + 1,
        lat: c.lat,
        lng: c.lng,
        clusterCentroid: c.clusterCentroid,
        coveredSurvivors: clearSurvivors,
        quality_score: c.quality_score,
        composite_score: c.composite_score,
        reflection_efficiency: c.reflection_efficiency,
        fresnel_clear: c.fresnel_clear,
        theta_in: c.theta_in,
        theta_out: c.theta_out,
        distance_to_terminal: c.distance_to_terminal,
        distance_irs_victim: c.distance_irs_victim,
        total_path_m: c.total_path_m,
        survivors_covered: clearSurvivors.length,
        survivors_covered_clear: clearSurvivors.length,
        nlos_status: c.nlos_status,
        term_los: c.term_los,
        term_los_status: c.term_los_status,
        term_blocked: c.term_blocked,
        term_blocker_id: c.term_blocker_id,
        term_blocker_name: c.term_blocker_name,
        vic_los: c.vic_los,
        vic_los_status: c.vic_los_status,
        vic_blocked: c.vic_blocked,
        vic_blocker_id: c.vic_blocker_id,
        vic_blocker_name: c.vic_blocker_name,
        blockage_count: c.blockage_count,
        height_score: c.height_score,
        link_gain_db: c.link_gain_db,
        constrained: c.constrained ?? false,
        constrained_reason: c.constrained_reason || '',
        validity_status: c.validity_status || 'invalid',
        blocker_building_id: c.blocker_building_id,
        blocker_building_name: c.blocker_building_name,
        explanation_source: 'local',
        reranked_by_gemini: false,
        selection_reason: c.selection_reason,
        mount_type: c.mount_type,
        host_building_id: c.host_building_id,
        host_building_name: c.host_building_name,
        facade: c.facade,
        facade_bearing: c.facade_bearing,
        facade_alignment: c.facade_alignment,
        building_height_m: c.building_height_m,
        mount_height_m: c.mount_height_m,
        height_source: c.height_source,
        terminal_mount_height_m: c.terminal_mount_height_m,
        terminal_host_building_id: c.terminal_host_building_id,
        height_los_checked: c.height_los_checked,
      }
    })

    for (const u of t.irs) {
      u.decision = buildIrsDecision(u, t.irs)
      if (!u.selection_reason) u.selection_reason = u.decision
    }

    t.validIrsCount = t.irs.length
    t.borderlineIrsCount = t.irs.filter((u) => u.validity_status === 'borderline').length
    t.reranked_by_gemini = false
    t.mount = placeTerminalMount(t, t.irs)
    if (t.validIrsCount === REQUIRED_IRS_PER_TERMINAL) {
      updateTerminalFinalSummary(t)
    }
  }

  const viable = terminalOrder
    .filter(
      (t) =>
        t.siteEvaluation?.valid &&
        t.validIrsCount === REQUIRED_IRS_PER_TERMINAL &&
        new Set(t.irs.map((irs) => irs.host_building_id)).size === REQUIRED_IRS_PER_TERMINAL
    )
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  if (viable.length !== terminals.length || viable.length !== K) {
    throw new Error(
      'Aynı enkaz bölgesinde her terminal için üç farklı sağlam bina cephesine yerleşen tam 3 IRS üretilemedi.'
    )
  }
  return viable
}

// ============================================================
// STEP 4c - Build the explanation payload
// ============================================================
export function buildExplanationPayload(terminals, clusters, counts = {}) {
  const irs_list = []
  for (const t of terminals) {
    for (const u of t.irs) {
      irs_list.push({
        id: u.id,
        name: u.name,
        terminal_id: t.id,
        terminal_name: t.name,
        rank_in_terminal: u.rank,
        lat: round(u.lat, 6),
        lng: round(u.lng, 6),
        quality_score: u.quality_score,
        composite_score: u.composite_score,
        validity_status: u.validity_status,
        constrained_reason: u.constrained_reason,
        blocker_building_id: u.blocker_building_id,
        blocker_building_name: u.blocker_building_name,
        reflection_efficiency: u.reflection_efficiency,
        fresnel_clear: u.fresnel_clear,
        theta_in: u.theta_in,
        theta_out: u.theta_out,
        distance_to_terminal: u.distance_to_terminal,
        distance_irs_victim: u.distance_irs_victim,
        total_path_m: u.total_path_m,
        survivors_covered: u.survivors_covered,
        survivors_covered_clear: u.survivors_covered_clear,
        nlos_status: u.nlos_status,
        term_los: u.term_los,
        term_los_status: u.term_los_status,
        term_blocker_name: u.term_blocker_name,
        vic_los: u.vic_los,
        vic_los_status: u.vic_los_status,
        vic_blocker_name: u.vic_blocker_name,
        blockage_count: u.blockage_count,
        height_score: u.height_score,
        link_gain_db: u.link_gain_db,
        decision: u.decision,
        constrained: u.constrained,
        selection_reason: u.selection_reason,
        mount_type: u.mount_type,
        host_building_name: u.host_building_name,
        facade: u.facade,
        facade_bearing: u.facade_bearing,
        facade_alignment: u.facade_alignment,
        building_height_m: u.building_height_m,
        mount_height_m: u.mount_height_m,
        height_source: u.height_source,
        host_building_id: u.host_building_id,
        height_los_checked: u.height_los_checked,
        terminal_mount_height_m: u.terminal_mount_height_m,
      })
    }
  }

  return {
    scenario: {
      survivor_count: counts.survivors ?? 0,
      debris_count: counts.debris ?? 0,
      cluster_count: clusters.length,
    },
    terminals: terminals.map((t) => ({
      id: t.id,
      name: t.name,
      lat: round(t.lat, 6),
      lng: round(t.lng, 6),
      score: round(t.score),
      score_pct: t.scorePct,
      valid_irs_count: t.validIrsCount || 0,
      avg_quality:
        t.irs && t.irs.length ? round(mean(t.irs.map((u) => u.quality_score))) : 0,
      coverage_ratio:
        t.irs && t.irs.length ? round(trioCoverageScore(t.irs, counts.survivors ?? 0)) : 0,
      placement_class: t.siteEvaluation?.valid ? 'building_debris_open_corridor' : 'invalid',
      debris_edge_m: t.siteEvaluation?.debrisEdgeM ?? null,
      intact_building_edge_m: t.siteEvaluation?.buildingEdgeM ?? null,
      between_angle_deg: t.siteEvaluation?.betweenAngleDeg ?? null,
      corridor_clearance_m: t.siteEvaluation?.clearanceM ?? null,
      related_debris_id: t.related_debris_id || t.siteEvaluation?.debrisId || null,
      mount_type: t.mount?.type || t.mount_type || null,
      mount_lat: round(t.mount?.lat ?? t.lat, 6),
      mount_lng: round(t.mount?.lng ?? t.lng, 6),
      roof_building_id: t.mount?.host_building_id || null,
      roof_building_name: t.mount?.host_building_name || null,
      roof_slot: t.mount?.roof_slot || null,
      open_area_fallback_reason: t.mount?.fallback_reason || null,
    })),
    irs_list,
  }
}
