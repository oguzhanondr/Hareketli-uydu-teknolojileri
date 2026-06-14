import { point, distance as turfDistance, bearing as turfBearing, destination } from '@turf/turf'

export const DEFAULT_FREQ_GHZ = 2.4
export const DEBRIS_FOOTPRINT_M = 14
export const SAT_AZIMUTH = 180
export const IRS_APERTURE_GAIN_DB = 12
export const DETOUR_LOSS_DB_PER_100M = 1.5

const DEG2RAD = Math.PI / 180
const EARTH_R = 6371000
const toPoint = (p) => point([p.lng, p.lat])

export const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v))

export function angularDiff(a, b) {
  let d = Math.abs(((a - b) % 360 + 360) % 360)
  return d > 180 ? 360 - d : d
}

export function distanceM(a, b) {
  return turfDistance(toPoint(a), toPoint(b), { units: 'meters' })
}

export function bearing(a, b) {
  return (turfBearing(toPoint(a), toPoint(b)) + 360) % 360
}

export function destinationPoint(origin, meters, bearingDeg) {
  const d = destination(toPoint(origin), meters, bearingDeg, { units: 'meters' })
  const [lng, lat] = d.geometry.coordinates
  return { lat, lng }
}

export function localXY(origin, p) {
  const lat0 = origin.lat * DEG2RAD
  return {
    x: (p.lng - origin.lng) * DEG2RAD * EARTH_R * Math.cos(lat0),
    y: (p.lat - origin.lat) * DEG2RAD * EARTH_R,
  }
}

export function offsetMeters(origin, dxEast, dyNorth) {
  const lat0 = origin.lat * DEG2RAD
  return {
    lat: origin.lat + dyNorth / EARTH_R / DEG2RAD,
    lng: origin.lng + dxEast / (EARTH_R * Math.cos(lat0)) / DEG2RAD,
  }
}

export function estimateLinkGainDb({ reflEff, termLoS, vicLoS, d1, d2 }) {
  const losFactor = clamp(Math.min(termLoS, vicLoS), 0.05, 1)
  return (
    IRS_APERTURE_GAIN_DB * clamp(reflEff) +
    10 * Math.log10(losFactor) -
    (DETOUR_LOSS_DB_PER_100M * (d1 + d2)) / 100
  )
}

function segmentsCross(p1, p2, p3, p4) {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x)
  if (Math.abs(d) < 1e-12) return false
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d
  return t >= 0 && t <= 1 && u >= 0 && u <= 1
}

function segmentBounds(a, b) {
  return {
    south: Math.min(a.lat, b.lat),
    north: Math.max(a.lat, b.lat),
    west: Math.min(a.lng, b.lng),
    east: Math.max(a.lng, b.lng),
  }
}

function boundsOverlap(a, b, margin = 0) {
  return !(
    a.east + margin < b.west ||
    a.west - margin > b.east ||
    a.north + margin < b.south ||
    a.south - margin > b.north
  )
}

function bboxFromRing(latlngs) {
  let south = Infinity
  let north = -Infinity
  let west = Infinity
  let east = -Infinity
  for (const [lat, lng] of latlngs) {
    if (lat < south) south = lat
    if (lat > north) north = lat
    if (lng < west) west = lng
    if (lng > east) east = lng
  }
  return { south, north, west, east }
}

export function firstBlockingBuilding(a, b, obstacles = []) {
  const segment = localXY(a, b)
  const length = Math.hypot(segment.x, segment.y)
  if (length < 1) return null

  const origin = { x: 0, y: 0 }
  const bounds = segmentBounds(a, b)
  for (const obstacle of obstacles) {
    if (obstacle.latlngs && obstacle.latlngs.length >= 3) {
      const obstacleBounds = obstacle.bbox ?? bboxFromRing(obstacle.latlngs)
      if (!boundsOverlap(bounds, obstacleBounds, 0.00008)) continue
      const ring = obstacle.latlngs
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i]
        const q = ring[(i + 1) % ring.length]
        const v1 = localXY(a, { lat: p[0], lng: p[1] })
        const v2 = localXY(a, { lat: q[0], lng: q[1] })
        if (segmentsCross(origin, segment, v1, v2)) return obstacle.id ?? 'bina'
      }
      continue
    }

    const marginDeg = ((typeof obstacle.radius === 'number' ? obstacle.radius : DEBRIS_FOOTPRINT_M) + 2) / 111320
    const obstacleBounds = {
      south: obstacle.lat - marginDeg,
      north: obstacle.lat + marginDeg,
      west: obstacle.lng - marginDeg,
      east: obstacle.lng + marginDeg,
    }
    if (!boundsOverlap(bounds, obstacleBounds)) continue
    const projected = localXY(a, obstacle)
    const t = (projected.x * segment.x + projected.y * segment.y) / length
    if (t <= 0 || t >= length) continue
    const perp = Math.hypot(
      projected.x - (segment.x / length) * t,
      projected.y - (segment.y / length) * t
    )
    const footprint = typeof obstacle.radius === 'number' ? obstacle.radius : DEBRIS_FOOTPRINT_M
    if (perp < footprint) return obstacle.id ?? 'bina'
  }

  return null
}

export function reflectionEfficiency(thetaInDeg, thetaOutDeg) {
  return clamp(Math.cos(thetaInDeg * DEG2RAD) * Math.cos(thetaOutDeg * DEG2RAD), 0, 1)
}

const CARDINALS_TR = [
  'Kuzey',
  'Kuzeydoğu',
  'Doğu',
  'Güneydoğu',
  'Güney',
  'Güneybatı',
  'Batı',
  'Kuzeybatı',
]

export function cardinalTR(bearingDeg) {
  const i = Math.round((((bearingDeg % 360) + 360) % 360) / 45) % 8
  return CARDINALS_TR[i]
}

function ringCentroid(latlngs) {
  const pts =
    latlngs.length > 1 &&
    latlngs[0][0] === latlngs[latlngs.length - 1][0] &&
    latlngs[0][1] === latlngs[latlngs.length - 1][1]
      ? latlngs.slice(0, -1)
      : latlngs
  let lat = 0
  let lng = 0
  for (const [la, ln] of pts) {
    lat += la
    lng += ln
  }
  return { lat: lat / pts.length, lng: lng / pts.length }
}

export function buildingFacades(latlngs) {
  if (!latlngs || latlngs.length < 3) return []
  const centroid = ringCentroid(latlngs)
  const facades = []

  for (let i = 0; i < latlngs.length - 1; i++) {
    const a = { lat: latlngs[i][0], lng: latlngs[i][1] }
    const b = { lat: latlngs[i + 1][0], lng: latlngs[i + 1][1] }
    const length = distanceM(a, b)
    if (length < 1) continue

    const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 }
    const edge = bearing(a, b)
    const n1 = (edge + 90) % 360
    const probe = destinationPoint(mid, 2, n1)
    const normalBearing = distanceM(probe, centroid) > distanceM(mid, centroid) ? n1 : (edge + 270) % 360
    facades.push({ a, b, mid, normalBearing, length })
  }

  return facades
}

function faceScore(normalBearing, targetBearing) {
  return clamp(Math.cos(angularDiff(normalBearing, targetBearing) * DEG2RAD))
}

export function facadeAlignment(mountPt, normalBearing, terminal, clusterCentroid) {
  const toTerminal = bearing(mountPt, terminal)
  const toCluster = bearing(mountPt, clusterCentroid)
  return clamp(
    0.4 * faceScore(normalBearing, toTerminal) +
      0.4 * faceScore(normalBearing, toCluster) +
      0.2 * faceScore(normalBearing, SAT_AZIMUTH)
  )
}

export function elevationAngleScore(terminal, debris = []) {
  if (!debris.length) return 1
  let penalty = 0
  for (const d of debris) {
    const az = bearing(terminal, d)
    const diff = angularDiff(az, SAT_AZIMUTH)
    const dist = distanceM(terminal, d)
    if (diff < 60 && dist < 120) {
      const azFactor = 1 - diff / 60
      const distFactor = 1 - dist / 120
      penalty += 0.5 * azFactor * distFactor
    }
  }
  return clamp(1 - penalty)
}
