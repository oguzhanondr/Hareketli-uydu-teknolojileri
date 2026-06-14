// Deterministic fallback footprints for the Elbistan mission block.
// Used only when live Overpass/OSM building data cannot be reached.
import { distanceM, offsetMeters } from '../lib/geometry.js'

const BASE = { lat: 38.20598, lng: 37.1961 }
const DEG2RAD = Math.PI / 180

function rotate(dx, dy, deg) {
  const r = deg * DEG2RAD
  const c = Math.cos(r)
  const s = Math.sin(r)
  return {
    x: dx * c - dy * s,
    y: dx * s + dy * c,
  }
}

function bboxOf(latlngs) {
  let south = Infinity
  let north = -Infinity
  let west = Infinity
  let east = -Infinity
  for (const [lat, lng] of latlngs) {
    south = Math.min(south, lat)
    north = Math.max(north, lat)
    west = Math.min(west, lng)
    east = Math.max(east, lng)
  }
  return { south, north, west, east }
}

function rectBuilding(id, dx, dy, width, depth, angle, heightM, name = null) {
  const center = offsetMeters(BASE, dx, dy)
  const corners = [
    [-width / 2, -depth / 2],
    [width / 2, -depth / 2],
    [width / 2, depth / 2],
    [-width / 2, depth / 2],
  ].map(([x, y]) => {
    const p = rotate(x, y, angle)
    const ll = offsetMeters(center, p.x, p.y)
    return [ll.lat, ll.lng]
  })
  corners.push(corners[0])

  return {
    id: `fallback-${id}`,
    latlngs: corners,
    lat: center.lat,
    lng: center.lng,
    radius: Math.max(...corners.map(([lat, lng]) => distanceM(center, { lat, lng })), 6),
    bbox: bboxOf(corners),
    name,
    heightM,
    levels: Math.max(1, Math.round(heightM / 3)),
    source: 'fallback',
  }
}

const SPECS = [
  ['c01', -22, -8, 34, 62, -8, 12, 'Yedek Merkez Blok A'],
  ['c02', 28, -4, 28, 74, -7, 15, 'Yedek Merkez Blok B'],
  ['c03', -70, 22, 24, 48, 2, 9, 'Yedek Kuzeybati Blok'],
  ['c04', 76, 18, 30, 54, 5, 12, 'Yedek Kuzeydogu Blok'],
  ['c05', -58, -54, 42, 26, -5, 9, 'Yedek Guneybati Blok'],
  ['c06', 62, -62, 46, 30, 4, 9, 'Yedek Guneydogu Blok'],
  ['n01', -122, 92, 28, 44, -10, 12],
  ['n02', -76, 112, 30, 52, -8, 9],
  ['n03', -18, 118, 42, 34, -4, 9],
  ['n04', 42, 114, 36, 42, 4, 12],
  ['n05', 102, 98, 40, 36, 6, 9],
  ['n06', 154, 76, 30, 48, 8, 9],
  ['e01', 148, 18, 34, 52, 6, 12],
  ['e02', 182, -38, 36, 46, 4, 9],
  ['e03', 122, -104, 44, 32, 2, 9],
  ['e04', 206, 74, 30, 44, 8, 12],
  ['s01', 92, -142, 38, 34, 0, 9],
  ['s02', 32, -152, 46, 30, -4, 9],
  ['s03', -32, -148, 36, 36, -6, 9],
  ['s04', -94, -132, 42, 34, -8, 9],
  ['w01', -138, -82, 34, 50, -7, 12],
  ['w02', -176, -22, 38, 42, -5, 9],
  ['w03', -152, 48, 34, 46, -3, 9],
  ['w04', -206, 96, 42, 32, -6, 9],
  ['m01', -116, -8, 24, 34, -5, 9],
  ['m02', -104, -52, 28, 38, -7, 9],
  ['m03', 116, -12, 26, 40, 6, 9],
  ['m04', 108, 42, 34, 34, 5, 9],
  ['m05', -12, 58, 28, 36, 0, 9],
  ['m06', 16, -82, 30, 40, -3, 9],
  ['r01', -214, -142, 38, 30, -8, 9],
  ['r02', -166, -178, 34, 34, -5, 9],
  ['r03', -82, -196, 42, 28, -2, 9],
  ['r04', 8, -210, 44, 28, 2, 9],
  ['r05', 88, -204, 36, 32, 4, 9],
  ['r06', 168, -170, 40, 30, 6, 9],
]

export const FALLBACK_BUILDINGS = SPECS.map((spec) => rectBuilding(...spec))
