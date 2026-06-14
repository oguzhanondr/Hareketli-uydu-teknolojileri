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
  offsetMeters,
  localXY,
  angularDiff,
  clamp,
  reflectionEfficiency,
  firstBlockingBuilding,
  estimateLinkGainDb,
  buildingFacades,
  facadeAlignment,
  cardinalTR,
  DEBRIS_FOOTPRINT_M,
} from './geometry.js'
import { terminalSubScores, irsCompositeScore } from './scoring.js'
import { DEBUG } from '../config.js'

const K = 3
const GRID_STEPS = [-3, -2, -1, 0, 1, 2, 3]
const GRID_SPACING_M = 25
const TERMINAL_MIN_SEP_M = 100
const TERMINAL_RING_DISTANCES_M = [18, 36, 54, 72, 90]
const TERMINAL_RING_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315]
const TERMINAL_CORRIDOR_FRACTIONS = [0.2, 0.35, 0.5, 0.65]
const TERMINAL_CORRIDOR_SIDE_OFFSETS_M = [-18, 0, 18]
const TERMINAL_DEBRIS_MAX_M = 220
const TERMINAL_DEBRIS_BEST_MIN_M = 18
const TERMINAL_DEBRIS_BEST_MAX_M = 90
const TERMINAL_PROXIMITY_MAX_M = 220
const TERMINAL_SHORTLIST_PER_CLUSTER = 6
const TERMINAL_SCORE_WEIGHTS = {
  irsSet: 0.45,
  corridor: 0.25,
  coverage: 0.15,
  satAccess: 0.1,
  proximity: 0.05,
}

const IRS_FRACTIONS = [0.4, 0.5, 0.6, 0.7, 0.8]
const IRS_OFFSETS = [-45, -30, -15, 0, 15, 30, 45]
const IRS_EXTRA_FRACTIONS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
const IRS_EXTRA_OFFSETS = [-60, -45, -30, -15, 0, 15, 30, 45, 60]
const IRS_MIN_DIST_M = 30
const IRS_MAX_DIST_M = 180
const IRS_COVERAGE_RADIUS_M = 150
const SITE_CLEARANCE_MIN_M = 10
const LOW_REFLECTION_MIN = 0.4

const FACADE_SEARCH_M = 40
const FACADE_OFFSET_M = 1.5
const DEFAULT_BUILDING_HEIGHT_M = 12
const MOUNT_BELOW_ROOF_M = 2
const MOUNT_MIN_HEIGHT_M = 6
const MAST_HEIGHT_M = 8
const MAST_ALIGNMENT = 0.6
const HEIGHT_IDEAL_M = 15

const TRIO_MIN_SEPARATION_M = 45
const TRIO_SHORTLIST_PER_CLUSTER = 4
const TRIO_SHORTLIST_MAX = 12
const MIN_IRS_CANDIDATES = 3
const VALID_QUALITY_THRESHOLD = 0.55
const GOOD_QUALITY_THRESHOLD = 0.7
const STRONG_QUALITY_THRESHOLD = 0.85

const TOTAL_PATH_GOOD_M = 90
const TOTAL_PATH_BAD_M = 360
const LINK_GAIN_BAD_DB = -5
const LINK_GAIN_GOOD_DB = 10
const TERMINAL_LABELS = ['A', 'B', 'C']
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
function snapToFacade(ground, mountable, terminal, clusterCentroid) {
  let best = null
  for (const b of mountable) {
    if (!b.latlngs) continue
    if (distanceM(ground, b) > FACADE_SEARCH_M + (b.radius || 0)) continue
    for (const f of buildingFacades(b.latlngs)) {
      const mountPt = destinationPoint(f.mid, FACADE_OFFSET_M, f.normalBearing)
      const dGround = distanceM(ground, mountPt)
      if (dGround > FACADE_SEARCH_M) continue
      const alignment = facadeAlignment(mountPt, f.normalBearing, terminal, clusterCentroid)
      const score = alignment - dGround / (FACADE_SEARCH_M * 4)
      if (!best || score > best.score) {
        best = { score, alignment, mountPt, normalBearing: f.normalBearing, building: b }
      }
    }
  }
  return best
}

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
  const intactObstacles = getIntactBuildings(buildings, debris)
  const buildingNames = buildNameIndex(buildings)
  const blockerCache = new Map()
  const excludeCache = new Map()

  const obstacleList = (excludeId) => {
    if (!excludeId) return intactObstacles
    if (!excludeCache.has(excludeId)) {
      excludeCache.set(
        excludeId,
        intactObstacles.filter((o) => o.id !== excludeId)
      )
    }
    return excludeCache.get(excludeId)
  }

  const blockerFor = (a, b, excludeId = null) => {
    const ka = pointKey(a)
    const kb = pointKey(b)
    const key = ka < kb ? `${ka}|${kb}|${excludeId || '-'}` : `${kb}|${ka}|${excludeId || '-'}`
    if (!blockerCache.has(key)) {
      blockerCache.set(key, firstBlockingBuilding(a, b, obstacleList(excludeId)))
    }
    return blockerCache.get(key)
  }

  return { buildings, intactObstacles, buildingNames, blockerFor }
}

function analysisContextOf(buildingsOrContext = [], debris = []) {
  if (buildingsOrContext && typeof buildingsOrContext === 'object' && 'blockerFor' in buildingsOrContext) {
    return buildingsOrContext
  }
  return buildAnalysisContext(buildingsOrContext, debris)
}

const TERMINAL_MOUNT_SEARCH_M = 60

function placeTerminalMount(terminal, irsUnits = [], buildings = [], debris = [], contextArg = null) {
  const irsTotal = irsUnits.length
  const debrisIds = new Set(debris.map((d) => d.id).filter(Boolean))
  const context = analysisContextOf(contextArg || buildings, debris)
  const standing = buildings.filter(
    (b) =>
      b.latlngs &&
      !debrisIds.has(b.id) &&
      distanceM(terminal, b) <= TERMINAL_MOUNT_SEARCH_M + (b.radius || 0)
  )

  if (!standing.length) {
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
    }
  }

  const irsSeen = (pt, hostId) => {
    let visible = 0
    for (const u of irsUnits) {
      if (!context.blockerFor(pt, u, hostId)) visible += 1
    }
    return visible
  }

  let best = null
  const consider = (opt) => {
    if (!best || opt.score > best.score) best = opt
  }

  for (const b of standing) {
    const known = typeof b.heightM === 'number' && b.heightM > 0
    const height = round(known ? b.heightM : DEFAULT_BUILDING_HEIGHT_M, 0)
    const dT = distanceM(terminal, b)
    const heightSource = known ? 'osm' : 'estimate'

    const roofSeen = irsSeen({ lat: b.lat, lng: b.lng }, b.id)
    consider({
      score: roofSeen * 1000 + 100 - dT,
      type: 'cati',
      host_building_id: b.id,
      host_building_name: b.name || null,
      facade: null,
      facade_bearing: null,
      mount_height_m: height,
      height_source: heightSource,
      irs_visible: roofSeen,
      irs_total: irsTotal,
    })

    const facadeHeight = Math.max(MOUNT_MIN_HEIGHT_M, Math.min(round(height - MOUNT_BELOW_ROOF_M, 0), height))
    for (const f of buildingFacades(b.latlngs)) {
      const mountPt = destinationPoint(f.mid, FACADE_OFFSET_M, f.normalBearing)
      const seen = irsSeen(mountPt, b.id)
      consider({
        score: seen * 1000 - dT,
        type: 'cephe',
        host_building_id: b.id,
        host_building_name: b.name || null,
        facade: cardinalTR(f.normalBearing),
        facade_bearing: round(f.normalBearing, 0),
        mount_height_m: facadeHeight,
        height_source: heightSource,
        irs_visible: seen,
        irs_total: irsTotal,
      })
    }
  }

  return best
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
  if (candidate.term_blocked || candidate.vic_blocked || candidate.quality_score < VALID_QUALITY_THRESHOLD) {
    return 'invalid'
  }
  if (candidate.quality_score < GOOD_QUALITY_THRESHOLD) return 'borderline'
  return 'valid'
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

export function selectBestIrsSet(candidates, totalSurvivors = 0, maxCount = 3) {
  if (!candidates?.length) return []
  const ranked = [...candidates].sort((a, b) => b.quality_score - a.quality_score)
  const targetSize = Math.min(maxCount, ranked.length)
  if (targetSize <= 1) {
    const chosen = ranked.slice(0, 1)
    chosen.forEach(setSelectionReason)
    return chosen
  }
  if (ranked.length <= targetSize) {
    const chosen = ranked.slice(0, targetSize)
    chosen.forEach(setSelectionReason)
    return chosen
  }

  const shortlist = buildShortlist(ranked)
  let best = null

  const visit = (current, start) => {
    if (current.length === targetSize) {
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

      if (
        !best ||
        score > best.score + 1e-9 ||
        (Math.abs(score - best.score) < 1e-9 && qualityFloor > best.qualityFloor) ||
        (Math.abs(score - best.score) < 1e-9 && coverage > best.coverage)
      ) {
        best = { chosen: [...current], score, qualityFloor, coverage }
      }
      return
    }

    for (let i = start; i < shortlist.length; i++) {
      current.push(shortlist[i])
      visit(current, i + 1)
      current.pop()
    }
  }

  visit([], 0)
  const chosen = (best?.chosen || ranked.slice(0, targetSize))
    .slice()
    .sort((a, b) => b.quality_score - a.quality_score)
  chosen.forEach(setSelectionReason)
  return chosen
}

export function selectBestIrsTrio(candidates, totalSurvivors = 0) {
  return selectBestIrsSet(candidates, totalSurvivors, 3)
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
  return (filtered.length ? filtered : nearby.slice(0, 2)).slice(0, 3).map((d) => d.point)
}

function buildTerminalCandidatePoints(cluster, debris) {
  const points = []
  const seen = new Set()
  pushUniquePoint(points, seen, cluster.centroid)

  for (const sy of GRID_STEPS) {
    for (const sx of GRID_STEPS) {
      pushUniquePoint(
        points,
        seen,
        offsetMeters(cluster.centroid, sx * GRID_SPACING_M, sy * GRID_SPACING_M)
      )
    }
  }

  for (const anchor of clusterDebrisAnchors(cluster, debris)) {
    pushUniquePoint(points, seen, anchor)
    const br = bearing(anchor, cluster.centroid)
    const corridorDist = distanceM(anchor, cluster.centroid)
    for (const frac of TERMINAL_CORRIDOR_FRACTIONS) {
      const step = Math.max(
        TERMINAL_DEBRIS_BEST_MIN_M,
        Math.min(TERMINAL_DEBRIS_MAX_M * 0.6, corridorDist * frac)
      )
      const centerline = destinationPoint(anchor, step, br)
      pushUniquePoint(points, seen, centerline)
      for (const side of TERMINAL_CORRIDOR_SIDE_OFFSETS_M) {
        if (side === 0) continue
        pushUniquePoint(
          points,
          seen,
          destinationPoint(centerline, Math.abs(side), side > 0 ? br + 90 : br + 270)
        )
      }
    }
    for (const dist of TERMINAL_RING_DISTANCES_M) {
      for (const ang of TERMINAL_RING_ANGLES) {
        pushUniquePoint(points, seen, destinationPoint(anchor, dist, ang))
      }
    }
  }

  return stableSortPoints(points)
}

function debrisDistanceScore(terminal, anchors) {
  if (!anchors.length) return 0.5
  const nearest = Math.min(...anchors.map((anchor) => distanceM(terminal, anchor)))
  if (nearest < TERMINAL_DEBRIS_BEST_MIN_M) {
    return clamp(nearest / TERMINAL_DEBRIS_BEST_MIN_M)
  }
  if (nearest <= TERMINAL_DEBRIS_BEST_MAX_M) return 1
  return clamp(
    1 - (nearest - TERMINAL_DEBRIS_BEST_MAX_M) / (TERMINAL_DEBRIS_MAX_M - TERMINAL_DEBRIS_BEST_MAX_M)
  )
}

function clusterVisibilityScore(terminal, cluster, context) {
  if (!cluster.members.length) return 0
  let clear = 0
  for (const member of cluster.members) {
    if (!context.blockerFor(terminal, member)) clear += 1
  }
  return clamp(clear / cluster.members.length)
}

function terminalCandidateMetrics(parts, cluster, terminal, chosen, totalSurvivors, context, anchors) {
  const validCount = chosen.length
  const qualityAvg = validCount ? mean(chosen.map((c) => c.quality_score)) : 0
  const qualityFloor = validCount ? Math.min(...chosen.map((c) => c.quality_score)) : 0
  const coverage = validCount ? trioCoverageScore(chosen, totalSurvivors) : 0
  const irsCorridor = validCount > 0 ? mean(chosen.map((c) => Math.min(c.term_los, c.vic_los))) : 0
  const directVisibility = clusterVisibilityScore(terminal, cluster, context)
  const debrisFitness = debrisDistanceScore(terminal, anchors)
  const corridor = irsCorridor * 0.45 + directVisibility * 0.4 + debrisFitness * 0.15
  const validCountScore = clamp(validCount / 3)
  const irsSetQuality = qualityAvg * 0.5 + coverage * 0.3 + validCountScore * 0.2
  const satAccess = parts.elevation * 0.6 + parts.access * 0.4
  const proximity = clamp(1 - distanceM(terminal, cluster.centroid) / TERMINAL_PROXIMITY_MAX_M)
  const score =
    TERMINAL_SCORE_WEIGHTS.irsSet * irsSetQuality +
    TERMINAL_SCORE_WEIGHTS.corridor * corridor +
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
    validCountScore: round(validCountScore),
    satAccess: round(satAccess),
    proximity: round(proximity),
    irsSetQuality: round(irsSetQuality),
  }
}

function evaluateTerminalCandidate(candidate, cluster, clusters, survivors, debris, context, weights, anchors) {
  const parts = terminalSubScores(candidate, survivors, debris, weights)
  const allIrs = optimizeIRS(candidate, clusters, survivors, debris, context)
  const validIrs = allIrs.filter(
    (c) => !c.term_blocked && !c.vic_blocked && c.quality_score >= VALID_QUALITY_THRESHOLD
  )
  const chosen = selectBestIrsSet(validIrs, survivors.length)
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
  return evaluations.slice(0, TERMINAL_SHORTLIST_PER_CLUSTER)
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

function chooseTerminalCombination(groupedRankings) {
  let best = null

  const visit = (clusterIdx, current) => {
    if (clusterIdx === groupedRankings.length) {
      const separation = terminalSeparationScore(current)
      const avgScore = mean(current.map((entry) => entry.metrics.score))
      const minScore = Math.min(...current.map((entry) => entry.metrics.score))
      const avgValid = mean(current.map((entry) => entry.metrics.validCountScore))
      const avgCorridor = mean(current.map((entry) => entry.metrics.corridor))
      const comboScore =
        avgScore * 0.62 +
        minScore * 0.16 +
        avgValid * 0.12 +
        avgCorridor * 0.05 +
        separation.score * 0.05 -
        (separation.ok ? 0 : 0.12)

      if (
        !best ||
        comboScore > best.score + 1e-9 ||
        (Math.abs(comboScore - best.score) < 1e-9 && minScore > best.minScore) ||
        (Math.abs(comboScore - best.score) < 1e-9 && separation.min > best.separation.min)
      ) {
        best = { score: comboScore, minScore, separation, chosen: [...current] }
      }
      return
    }

    for (const entry of groupedRankings[clusterIdx]) {
      current.push(entry)
      visit(clusterIdx + 1, current)
      current.pop()
    }
  }

  visit(0, [])
  return best?.chosen || groupedRankings.map((entries) => entries[0]).filter(Boolean)
}

function describeTerminalSelection(terminal, cluster, debris = []) {
  const countText =
    terminal.validIrsCount >= 3
      ? '3 geçerli IRS çıkardı'
      : terminal.validIrsCount > 0
        ? `${terminal.validIrsCount} geçerli IRS çıkardı`
        : 'geçerli IRS çıkaramadı'
  const nearestDebris = debris.length
    ? Math.round(Math.min(...debris.map((d) => distanceM(terminal, d))))
    : null
  return (
    `${cluster.members.length} depremzede için bu nokta seçildi; ${countText}. ` +
    `Terminal puanı IRS set kalitesi %${Math.round(terminal.selectionMetrics.irsSetQuality * 100)}, ` +
    `açık görüş koridoru %${Math.round(terminal.selectionMetrics.corridor * 100)}, ` +
    `doğrudan görüş %${Math.round(terminal.selectionMetrics.directVisibility * 100)} ve ` +
    `yerel kapsama %${Math.round(terminal.subScores.coverage * 100)} ile olustu.` +
    (nearestDebris !== null
      ? ` En yakin enkaz ${nearestDebris} m uzakta ve enkaz koridor uygunlugu %${Math.round(
          terminal.selectionMetrics.debrisFitness * 100
        )} olduğu için kurulum nokta seçimi açık alana göre değil görüş koridoruna göre yapıldı.`
      : ' Açık kurulum alanı mevcut.')
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

    const evaluations = buildTerminalCandidatePoints(cluster, debris).map((pt) => {
      const candidate = { ...base, lat: pt.lat, lng: pt.lng }
      const evaluation = evaluateTerminalCandidate(
        candidate,
        cluster,
        clusters,
        survivors,
        debris,
        context,
        weights,
        anchors
      )
      return { candidate, ...evaluation }
    })

    const ranked = evaluations.sort((a, b) => {
      if (b.metrics.score !== a.metrics.score) return b.metrics.score - a.metrics.score
      if (b.metrics.validCount !== a.metrics.validCount) return b.metrics.validCount - a.metrics.validCount
      if (b.metrics.qualityAvg !== a.metrics.qualityAvg) return b.metrics.qualityAvg - a.metrics.qualityAvg
      if (b.metrics.coverage !== a.metrics.coverage) return b.metrics.coverage - a.metrics.coverage
      return comparePoints(a.candidate, b.candidate)
    })
    groupedRankings.push(shortlistTerminalEvaluations(ranked))
  })

  const selected = chooseTerminalCombination(groupedRankings)
  return selected.map((best) => {
    const cluster = clusters[best.candidate.clusterIndex]
    const terminal = {
      ...best.candidate,
      score: best.metrics.score,
      scorePct: Math.round(best.metrics.score * 100),
      subScores: best.parts,
      candidates: best.allIrs,
      preferredCandidateIds: best.chosen.map((c) => c.id),
      validCandidateCount: best.validIrs.length,
      validIrsCount: best.chosen.length,
      selectionMetrics: best.metrics,
    }
    terminal.description = describeTerminalSelection(terminal, cluster, debris)
    return terminal
  })
}

// ============================================================
// STEP 3 - IRS candidate generation + absolute scoring
// ============================================================
export function optimizeIRS(terminal, clusters, survivors, debris, buildingsOrContext = []) {
  const context = analysisContextOf(buildingsOrContext, debris)
  const debrisIds = new Set(debris.map((d) => d.id).filter(Boolean))
  const mountable = context.buildings.filter((b) => b.latlngs && !debrisIds.has(b.id))
  const candidates = []
  let idx = 0

  const generateCandidates = (fractions, offsets) => {
    for (let ci = 0; ci < clusters.length; ci++) {
      const cluster = clusters[ci]
      const brToCluster = bearing(terminal, cluster.centroid)
      const dCluster = distanceM(terminal, cluster.centroid)
      const hi = Math.min(IRS_MAX_DIST_M, Math.max(IRS_MIN_DIST_M + 5, dCluster - 8))

      for (const f of fractions) {
        const dist = Math.max(IRS_MIN_DIST_M, Math.min(f * dCluster, hi))
        for (const off of offsets) {
          const ground = destinationPoint(terminal, dist, brToCluster + off)
          const snap = snapToFacade(ground, mountable, terminal, cluster.centroid)
          const pos = snap ? snap.mountPt : ground
          const mountInfo = mountInfoFor(snap?.building)
          const hostId = snap?.building?.id ?? null
          const inDir = bearing(terminal, pos)
          const outDir = bearing(pos, cluster.centroid)
          const turn = angularDiff(inDir, outDir)
          const thetaIn = turn / 2
          const thetaOut = turn / 2
          const reflEff = reflectionEfficiency(thetaIn, thetaOut)
          const cid = `${terminal.label}-C${++idx}`

          const termBlockerId = context.blockerFor(terminal, pos, hostId)
          const vicBlockerId = context.blockerFor(pos, cluster.centroid, hostId)
          const termBlocked = termBlockerId != null
          const vicBlocked = vicBlockerId != null
          const termLos = termBlocked ? 0 : 1
          const vicLos = vicBlocked ? 0 : 1

          const d1 = distanceM(terminal, pos)
          const d2 = distanceM(pos, cluster.centroid)
          const linkGainDb = estimateLinkGainDb({
            reflEff,
            termLoS: termLos,
            vicLoS: vicLos,
            d1,
            d2,
          })

          const coveredSurvivors = []
          let clearCovered = 0
          for (const s of survivors) {
            if (distanceM(pos, s) <= IRS_COVERAGE_RADIUS_M) {
              const blk = context.blockerFor(pos, s, hostId)
              if (!blk) clearCovered += 1
              coveredSurvivors.push({
                id: s.id,
                lat: s.lat,
                lng: s.lng,
                nlos: blk ? 'FULL_NLoS' : 'CLEAR',
              })
            }
          }

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
            vic_los_status: vicBlocked ? 'FULL_NLoS' : 'CLEAR',
            vic_blocked: vicBlocked,
            vic_blocker_id: vicBlockerId,
            vic_blocker_name: vicBlockerId ? context.buildingNames.get(vicBlockerId) || null : null,
            blockage_count: 0,
            fresnel_violation: 0,
            fresnel_clear: termBlocked || vicBlocked ? 0 : 1,
            nlos_status: vicBlocked ? 'FULL_NLoS' : 'CLEAR',
            distance_to_terminal: d1,
            distance_irs_victim: d2,
            total_path_m: d1 + d2,
            link_gain_db: linkGainDb,
            survivors_covered: coveredSurvivors.length,
            survivors_covered_clear: clearCovered,
            scenario_survivor_count: survivors.length,
            coveredSurvivors,
            siteClearance,
            mount_type: snap ? 'cephe' : 'serbest direk',
            host_building_id: hostId,
            host_building_name: snap?.building?.name ?? null,
            facade: snap ? cardinalTR(snap.normalBearing) : null,
            facade_bearing: snap ? round(snap.normalBearing, 0) : null,
            facade_alignment: snap ? snap.alignment : MAST_ALIGNMENT,
            building_height_m: mountInfo.building_height_m,
            mount_height_m: mountInfo.mount_height_m,
            height_source: mountInfo.height_source,
          }

          annotateCandidate(candidate, cluster.members.length)
          candidates.push(candidate)
        }
      }
    }
  }

  generateCandidates(IRS_FRACTIONS, IRS_OFFSETS)
  const validCount = candidates.filter(
    (c) => !c.term_blocked && !c.vic_blocked && c.quality_score >= VALID_QUALITY_THRESHOLD
  ).length
  if (validCount < MIN_IRS_CANDIDATES) {
    generateCandidates(IRS_EXTRA_FRACTIONS, IRS_EXTRA_OFFSETS)
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
      t.preferredCandidateIds = selectBestIrsSet(
        t.candidates.filter(
          (c) => !c.term_blocked && !c.vic_blocked && c.quality_score >= VALID_QUALITY_THRESHOLD
        ),
        survivors.length
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

// ============================================================
// STEP 4b - Finalize up to 3 VALID IRS per terminal
// ============================================================
export function finalizeTerminals(terminals, selections, buildings = [], debris = [], contextArg = null) {
  const context = analysisContextOf(contextArg || buildings, debris)

  for (const t of terminals) {
    let chosen = []
    const ids = (selections && selections[t.id]) || t.preferredCandidateIds || []
    if (ids.length) {
      chosen = ids.map((id) => t.candidates.find((c) => c.id === id)).filter(Boolean)
    }
    if (!chosen.length) {
      chosen = selectBestIrsSet(
        t.candidates.filter(
          (c) => !c.term_blocked && !c.vic_blocked && c.quality_score >= VALID_QUALITY_THRESHOLD
        ),
        t.candidates[0]?.scenario_survivor_count || 0
      )
    }

    chosen = chosen.slice(0, 3).sort((a, b) => b.quality_score - a.quality_score)
    t.irs = chosen.map((c, i) => ({
      id: `${t.label}-IRS-${i + 1}`,
      name: `${t.label}-IRS-${i + 1}`,
      label: `${t.label}-IRS-${i + 1}`,
      terminalId: t.id,
      terminalLabel: t.label,
      rank: i + 1,
      lat: c.lat,
      lng: c.lng,
      clusterCentroid: c.clusterCentroid,
      coveredSurvivors: c.coveredSurvivors,
      quality_score: c.quality_score,
      composite_score: c.composite_score,
      reflection_efficiency: c.reflection_efficiency,
      fresnel_clear: c.fresnel_clear,
      theta_in: c.theta_in,
      theta_out: c.theta_out,
      distance_to_terminal: c.distance_to_terminal,
      distance_irs_victim: c.distance_irs_victim,
      total_path_m: c.total_path_m,
      survivors_covered: c.survivors_covered,
      survivors_covered_clear: c.survivors_covered_clear,
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
    }))

    for (const u of t.irs) {
      u.decision = buildIrsDecision(u, t.irs)
      if (!u.selection_reason) u.selection_reason = u.decision
    }

    t.validIrsCount = t.irs.length
    t.borderlineIrsCount = t.irs.filter((u) => u.validity_status === 'borderline').length
    t.reranked_by_gemini = false
    t.mount = placeTerminalMount(t, t.irs, buildings, debris, context)
  }

  return terminals
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
    })),
    irs_list,
  }
}
