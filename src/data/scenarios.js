// ============================================================
// scenarios.js - deterministic demo scenarios for the mission block
// ============================================================
import { distanceM, offsetMeters } from '../lib/geometry.js'
import { ELBISTAN_CENTER } from '../lib/buildings.js'

export const SCENARIOS = [
  {
    id: 'kavsak',
    name: 'Basit Kavsak',
    difficulty: 'Basit',
    description: 'Hafif hasar - 2 enkaz, 4 depremzede.',
    enkaz: 2,
    perEnkaz: 2,
  },
  {
    id: 'carsi',
    name: 'Çarşı Bölgesi',
    difficulty: 'Basit',
    description: 'Dağınık çökmeler - 3 enkaz, 6 depremzede.',
    enkaz: 3,
    perEnkaz: 2,
  },
  {
    id: 'okul',
    name: 'Okul Bölgesi',
    difficulty: 'Orta',
    description: 'Orta hasar - 3 enkaz, 9 depremzede.',
    enkaz: 3,
    perEnkaz: 3,
  },
  {
    id: 'merkez',
    name: 'Şehir Merkezi Çöküşü',
    difficulty: 'Zor',
    description: 'Ağır yapısal çöküş - 4 enkaz, 12 depremzede.',
    enkaz: 4,
    perEnkaz: 3,
  },
  {
    id: 'hastane',
    name: 'Hastane Bölgesi Krizi',
    difficulty: 'Zor',
    description: 'Yollar enkazla kapalı - 5 enkaz, 15 depremzede.',
    enkaz: 5,
    perEnkaz: 3,
  },
  {
    id: 'kentsel',
    name: 'Tam Kentsel Felaket',
    difficulty: 'Aşırı',
    description: 'Maksimum hasar - 6 enkaz, 24 depremzede.',
    enkaz: 6,
    perEnkaz: 4,
  },
]

const DETERMINISTIC_OFFSETS = [
  [-0.55, -0.2],
  [0.52, -0.25],
  [-0.2, 0.5],
  [0.28, 0.42],
  [-0.45, 0.1],
  [0.12, -0.52],
]

/**
 * Resolve a scenario against the loaded mission-block buildings: take the
 * `enkaz` buildings nearest the center as collapsed, and place `perEnkaz`
 * survivors around each using a fixed offset pattern.
 */
export function resolveScenario(scenario, buildings) {
  const center = { lat: ELBISTAN_CENTER[0], lng: ELBISTAN_CENTER[1] }
  const pick = buildings
    .map((b) => ({ b, d: distanceM(center, b) }))
    .sort((a, z) => a.d - z.d)
    .slice(0, scenario.enkaz)
    .map((x) => x.b)

  const enkazIds = []
  const survivors = []
  let sid = 0
  for (let bi = 0; bi < pick.length; bi++) {
    const b = pick[bi]
    enkazIds.push(b.id)
    const spread = Math.min(b.radius, 16)
    for (let k = 0; k < scenario.perEnkaz; k++) {
      const pattern = DETERMINISTIC_OFFSETS[(bi * scenario.perEnkaz + k) % DETERMINISTIC_OFFSETS.length]
      const p = offsetMeters(b, pattern[0] * spread, pattern[1] * spread)
      survivors.push({ id: `demo-${sid++}`, lat: p.lat, lng: p.lng })
    }
  }
  return { enkazIds, survivors }
}
