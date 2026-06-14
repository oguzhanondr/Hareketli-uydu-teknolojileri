// ============================================================
// buildings.js - OpenStreetMap building footprints (Overpass)
// ============================================================
import { distanceM } from './geometry.js'
import { FALLBACK_BUILDINGS } from '../data/fallbackBuildings.js'

export const ELBISTAN_CENTER = [38.20598, 37.1961]
export const DEFAULT_ZOOM = 17
export const MAX_ZOOM = 19

const HALF_LAT = 0.002246
const HALF_LNG = 0.002856
export const MISSION_BOUNDS = {
  south: ELBISTAN_CENTER[0] - HALF_LAT,
  north: ELBISTAN_CENTER[0] + HALF_LAT,
  west: ELBISTAN_CENTER[1] - HALF_LNG,
  east: ELBISTAN_CENTER[1] + HALF_LNG,
}

export function inMission(lat, lng) {
  return (
    lat >= MISSION_BOUNDS.south &&
    lat <= MISSION_BOUNDS.north &&
    lng >= MISSION_BOUNDS.west &&
    lng <= MISSION_BOUNDS.east
  )
}

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
]

const cache = new Map()

async function fetchOverpass(url, query) {
  const post = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(query),
  }).catch((err) => ({ ok: false, status: 'network', _error: err }))

  if (post.ok) return post

  const getUrl = `${url}?data=${encodeURIComponent(query)}`
  const get = await fetch(getUrl).catch((err) => ({ ok: false, status: 'network', _error: err }))
  if (get.ok) return get

  const status = get.status || post.status || 'network'
  const err = get._error || post._error
  throw err || new Error(`Overpass HTTP ${status}`)
}

function normalizeRing(latlngs) {
  const filtered = []
  for (const [lat, lng] of latlngs) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    const prev = filtered[filtered.length - 1]
    if (prev && Math.abs(prev[0] - lat) < 1e-8 && Math.abs(prev[1] - lng) < 1e-8) continue
    filtered.push([lat, lng])
  }
  if (filtered.length < 3) return null
  const first = filtered[0]
  const last = filtered[filtered.length - 1]
  if (Math.abs(first[0] - last[0]) > 1e-8 || Math.abs(first[1] - last[1]) > 1e-8) {
    filtered.push([first[0], first[1]])
  }
  return filtered.length >= 4 ? filtered : null
}

function segmentsCross(a1, a2, b1, b2) {
  const d = (a2.lng - a1.lng) * (b2.lat - b1.lat) - (a2.lat - a1.lat) * (b2.lng - b1.lng)
  if (Math.abs(d) < 1e-12) return false
  const t = ((b1.lng - a1.lng) * (b2.lat - b1.lat) - (b1.lat - a1.lat) * (b2.lng - b1.lng)) / d
  const u = ((b1.lng - a1.lng) * (a2.lat - a1.lat) - (b1.lat - a1.lat) * (a2.lng - a1.lng)) / d
  return t >= 0 && t <= 1 && u >= 0 && u <= 1
}

function selfIntersects(latlngs) {
  for (let i = 0; i < latlngs.length - 1; i++) {
    const a1 = { lat: latlngs[i][0], lng: latlngs[i][1] }
    const a2 = { lat: latlngs[i + 1][0], lng: latlngs[i + 1][1] }
    for (let j = i + 1; j < latlngs.length - 1; j++) {
      if (Math.abs(i - j) <= 1) continue
      if (i === 0 && j === latlngs.length - 2) continue
      const b1 = { lat: latlngs[j][0], lng: latlngs[j][1] }
      const b2 = { lat: latlngs[j + 1][0], lng: latlngs[j + 1][1] }
      if (segmentsCross(a1, a2, b1, b2)) return true
    }
  }
  return false
}

function hasSuspiciousEdgeJump(latlngs) {
  const edges = []
  for (let i = 0; i < latlngs.length - 1; i++) {
    edges.push(
      distanceM(
        { lat: latlngs[i][0], lng: latlngs[i][1] },
        { lat: latlngs[i + 1][0], lng: latlngs[i + 1][1] }
      )
    )
  }
  if (edges.length < 4) return false
  const sorted = [...edges].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] || 0
  const max = sorted[sorted.length - 1] || 0
  return max > 120 || (median > 0 && max > median * 4.5)
}

function isUsableBuildingRing(latlngs) {
  return !selfIntersects(latlngs) && !hasSuspiciousEdgeJump(latlngs)
}

function centroidOf(latlngs) {
  const open = latlngs.slice(0, -1)
  let lat = 0
  let lng = 0
  for (const [la, ln] of open) {
    lat += la
    lng += ln
  }
  return { lat: lat / open.length, lng: lng / open.length }
}

function radiusOf(c, latlngs) {
  let r = 0
  for (const [la, ln] of latlngs) {
    const d = distanceM(c, { lat: la, lng: ln })
    if (d > r) r = d
  }
  return Math.max(r, 6)
}

function bboxOf(latlngs) {
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

function parseHeight(tags = {}) {
  let heightM = null
  let levels = null
  const h = parseFloat(String(tags.height ?? '').replace(',', '.'))
  if (Number.isFinite(h) && h > 0) heightM = h
  const lv = parseFloat(String(tags['building:levels'] ?? '').replace(',', '.'))
  if (Number.isFinite(lv) && lv > 0) {
    levels = lv
    if (heightM == null) heightM = lv * 3
  }
  return { heightM, levels }
}

export function parseBuildings(elements) {
  const out = []
  const seen = new Set()
  for (const el of elements) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 3) continue
    if (seen.has(el.id)) continue
    seen.add(el.id)
    const latlngs = normalizeRing(el.geometry.map((g) => [g.lat, g.lon]))
    if (!latlngs) continue
    if (!isUsableBuildingRing(latlngs)) continue
    const c = centroidOf(latlngs)
    if (!inMission(c.lat, c.lng)) continue
    const { heightM, levels } = parseHeight(el.tags)
    out.push({
      id: String(el.id),
      latlngs,
      lat: c.lat,
      lng: c.lng,
      radius: radiusOf(c, latlngs),
      bbox: bboxOf(latlngs),
      name: el.tags?.name || null,
      heightM,
      levels,
    })
  }
  return out
}

function clampToMission(b) {
  const south = Math.max(b.south, MISSION_BOUNDS.south)
  const north = Math.min(b.north, MISSION_BOUNDS.north)
  const west = Math.max(b.west, MISSION_BOUNDS.west)
  const east = Math.min(b.east, MISSION_BOUNDS.east)
  if (south >= north || west >= east) return null
  return { south, north, west, east }
}

function boundsOverlap(a, b) {
  return !(
    a.east < b.west ||
    a.west > b.east ||
    a.north < b.south ||
    a.south > b.north
  )
}

function fallbackBuildingsFor(bounds) {
  return FALLBACK_BUILDINGS.filter((building) => {
    const centerInside =
      building.lat >= bounds.south &&
      building.lat <= bounds.north &&
      building.lng >= bounds.west &&
      building.lng <= bounds.east
    return centerInside || boundsOverlap(bounds, building.bbox)
  })
}

export async function fetchBuildings(viewport) {
  const b = clampToMission(viewport)
  if (!b) return []

  const key = [b.south, b.west, b.north, b.east].map((v) => v.toFixed(3)).join(',')
  if (cache.has(key)) return cache.get(key)

  const query = `[out:json][timeout:25];(way["building"](${b.south},${b.west},${b.north},${b.east}););out geom;`
  let lastErr
  for (const url of ENDPOINTS) {
    try {
      const res = await fetchOverpass(url, query)
      if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`)
      const json = await res.json()
      const buildings = parseBuildings(json.elements || [])
      if (buildings.length > 0) {
        cache.set(key, buildings)
        return buildings
      }
    } catch (e) {
      lastErr = e
    }
  }

  const fallback = fallbackBuildingsFor(b)
  if (fallback.length > 0) {
    cache.set(key, fallback)
    return fallback
  }

  throw lastErr || new Error('Bina verisi alınamadı')
}
