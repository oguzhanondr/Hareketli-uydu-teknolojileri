import {
  bearing as turfBearing,
  booleanPointInPolygon,
  lineIntersect,
  lineString,
  point,
  pointToLineDistance,
  polygon,
} from '@turf/turf'
import { SCENARIOS, resolveScenario } from '../src/data/scenarios.js'
import { getStaticBuildings, MISSION_BOUNDS } from '../src/lib/buildings.js'
import {
  finalizeTerminals,
  getIntactBuildings,
  runAnalysis,
} from '../src/lib/algorithm.js'
import { destinationPoint, distanceM } from '../src/lib/geometry.js'

const DEBRIS_EDGE_MIN_M = 8
const DEBRIS_EDGE_MAX_M = 75
const BUILDING_EDGE_MIN_M = 4
const BUILDING_EDGE_MAX_M = 70
const BETWEEN_MIN_ANGLE_DEG = 125
const TERMINAL_MIN_SEPARATION_M = 2
const REQUIRED_IRS_COUNT = 3

function turfPoint(value) {
  return point([value.lng, value.lat])
}

function turfPolygon(building) {
  const coordinates = building.latlngs.map(([lat, lng]) => [lng, lat])
  const first = coordinates[0]
  const last = coordinates[coordinates.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) coordinates.push([...first])
  return polygon([coordinates])
}

function footprintDistanceM(value, building) {
  const target = turfPoint(value)
  const footprint = turfPolygon(building)
  if (booleanPointInPolygon(target, footprint)) return 0
  let nearest = Infinity
  const ring = building.latlngs
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const edge = lineString([
      [a[1], a[0]],
      [b[1], b[0]],
    ])
    nearest = Math.min(
      nearest,
      pointToLineDistance(target, edge, { units: 'meters' })
    )
  }
  return nearest
}

function buildingHeightM(building) {
  if (Number.isFinite(building?.heightM) && building.heightM > 0) return building.heightM
  if (Number.isFinite(building?.levels) && building.levels > 0) return building.levels * 3
  return 12
}

function heightAwareBlocker(a, b, startHeightM, endHeightM, buildings, excludedIds = []) {
  const excluded = new Set(excludedIds.filter(Boolean))
  const path = lineString([
    [a.lng, a.lat],
    [b.lng, b.lat],
  ])
  const totalDistance = Math.max(distanceM(a, b), 0.1)
  for (const building of buildings) {
    if (excluded.has(building.id)) continue
    const footprint = turfPolygon(building)
    const intersections = lineIntersect(path, footprint).features
    if (!intersections.length) continue
    const heights = intersections.map((feature) => {
      const [lng, lat] = feature.geometry.coordinates
      const ratio = Math.min(1, distanceM(a, { lat, lng }) / totalDistance)
      return startHeightM + (endHeightM - startHeightM) * ratio
    })
    if (buildingHeightM(building) + 1 >= Math.min(...heights)) return building.id
  }
  return null
}

function angleDifference(a, b) {
  let diff = Math.abs(((a - b) % 360 + 360) % 360)
  if (diff > 180) diff = 360 - diff
  return diff
}

function validateResult(terminals, clusters, buildings, debris) {
  const failures = []
  const debrisIds = new Set(debris.map((item) => item.id))
  const debrisBuildings = buildings.filter((building) => debrisIds.has(building.id))
  const intact = getIntactBuildings(buildings, debris)
  const byId = new Map(buildings.map((building) => [building.id, building]))

  if (terminals.length !== 3) failures.push(`terminal-count:${terminals.length}`)

  for (const terminal of terminals) {
    const site = terminal.siteEvaluation
    if (!site?.valid) {
      failures.push(`${terminal.label}:invalid-site`)
      continue
    }

    const terminalHostId = terminal.mount?.host_building_id || terminal.host_building_id
    const cluster = clusters[terminal.clusterIndex]
    const localDebrisIds = [...debris]
      .sort((a, b) => distanceM(cluster.centroid, a) - distanceM(cluster.centroid, b))
      .slice(0, 3)
      .map((item) => item.id)
    const relatedDebrisId = terminal.related_debris_id || site.debrisId
    if (!localDebrisIds.includes(relatedDebrisId)) {
      failures.push(`${terminal.label}:non-local-debris:${relatedDebrisId}`)
    }
    if (terminal.mount?.type === 'cati' && !terminalHostId) {
      failures.push(`${terminal.label}:roof-without-building`)
    }
    if (terminal.mount?.type === 'acik alan' && !terminal.mount?.fallback_reason) {
      failures.push(`${terminal.label}:open-area-without-fallback-reason`)
    }
    for (const building of buildings) {
      if (building.id === terminalHostId) continue
      if (booleanPointInPolygon(turfPoint(terminal), turfPolygon(building))) {
        failures.push(`${terminal.label}:inside-building:${building.id}`)
      }
    }

    const debrisBuilding = byId.get(site.debrisId)
    const intactBuilding = byId.get(site.intactBuildingId || site.terminalBuildingId)
    if (!debrisBuilding || !debrisIds.has(debrisBuilding.id)) {
      failures.push(`${terminal.label}:unknown-debris:${site.debrisId}`)
      continue
    }
    if (!intactBuilding || debrisIds.has(intactBuilding.id)) {
      failures.push(
        `${terminal.label}:unknown-intact:${site.intactBuildingId || site.terminalBuildingId}`
      )
      continue
    }

    const debrisEdge = footprintDistanceM(terminal, debrisBuilding)
    const buildingEdge = footprintDistanceM(terminal, intactBuilding)
    if (debrisEdge < DEBRIS_EDGE_MIN_M || debrisEdge > DEBRIS_EDGE_MAX_M) {
      failures.push(`${terminal.label}:debris-edge:${debrisEdge.toFixed(1)}`)
    }
    if (terminal.mount?.type === 'cati') {
      if (terminalHostId !== intactBuilding.id || buildingEdge > 0.5) {
        failures.push(`${terminal.label}:roof-coordinate-mismatch`)
      }
    } else if (
      buildingEdge < BUILDING_EDGE_MIN_M ||
      buildingEdge > BUILDING_EDGE_MAX_M
    ) {
      failures.push(`${terminal.label}:building-edge:${buildingEdge.toFixed(1)}`)
    }

    const betweenAngle = angleDifference(
      turfBearing(turfPoint(terminal), turfPoint(debrisBuilding)),
      turfBearing(turfPoint(terminal), turfPoint(intactBuilding))
    )
    if (terminal.mount?.type !== 'cati' && betweenAngle < BETWEEN_MIN_ANGLE_DEG) {
      failures.push(`${terminal.label}:between-angle:${betweenAngle.toFixed(1)}`)
    }

    if (terminal.mount?.type !== 'cati') {
      const corridorBlocker = heightAwareBlocker(
        terminal,
        debrisBuilding,
        terminal.mount?.mount_height_m || 8,
        1.5,
        intact,
        [terminalHostId]
      )
      if (corridorBlocker) {
        failures.push(`${terminal.label}:blocked-debris-corridor:${corridorBlocker}`)
      }
    }

    if (terminal.irs.length !== REQUIRED_IRS_COUNT) {
      failures.push(`${terminal.label}:irs-count:${terminal.irs.length}`)
    }
    const irsHosts = terminal.irs.map((irs) => irs.host_building_id)
    if (new Set(irsHosts).size !== REQUIRED_IRS_COUNT) {
      failures.push(`${terminal.label}:irs-buildings-not-distinct`)
    }
    if (terminalHostId && irsHosts.includes(terminalHostId)) {
      failures.push(`${terminal.label}:terminal-building-reused-by-irs`)
    }
    for (const irs of terminal.irs) {
      if (irs.mount_type !== 'cephe' || !irs.host_building_id) {
        failures.push(`${terminal.label}/${irs.id}:not-facade-mounted`)
      }
      const terminalIrsBlocker = heightAwareBlocker(
        terminal,
        irs,
        terminal.mount?.mount_height_m || 8,
        irs.mount_height_m || 6,
        intact,
        [terminalHostId, irs.host_building_id]
      )
      if (terminalIrsBlocker) {
        failures.push(`${terminal.label}/${irs.id}:terminal-irs:${terminalIrsBlocker}`)
      }
      if (!irs.coveredSurvivors.length) failures.push(`${terminal.label}/${irs.id}:zero-target`)
      for (const survivor of irs.coveredSurvivors) {
        const targetBlocker = heightAwareBlocker(
          irs,
          survivor,
          irs.mount_height_m || 6,
          1.5,
          intact,
          [irs.host_building_id]
        )
        if (targetBlocker) {
          failures.push(`${terminal.label}/${irs.id}/${survivor.id}:irs-target:${targetBlocker}`)
        }
      }
    }
  }

  for (let i = 0; i < terminals.length; i++) {
    for (let j = i + 1; j < terminals.length; j++) {
      const terminalDistance = distanceM(terminals[i], terminals[j])
      if (terminalDistance < TERMINAL_MIN_SEPARATION_M) {
        failures.push(
          `terminal-overlap:${terminals[i].label}/${terminals[j].label}:${terminalDistance.toFixed(1)}`
        )
      }
    }
  }

  return failures
}

function seededRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 4294967296
  }
}

function randomScenario(buildings, seed) {
  const random = seededRandom(seed)
  const shuffled = [...buildings]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  const collapsed = shuffled.slice(0, 4)
  const survivors = []
  let survivorId = 0
  for (const building of collapsed) {
    for (let i = 0; i < 3; i++) {
      const value = destinationPoint(
        building,
        (building.radius || 10) + 6 + random() * 12,
        random() * 360
      )
      survivors.push({ id: `random-${seed}-${survivorId++}`, ...value })
    }
  }
  return {
    id: `random-${seed}`,
    survivors,
    enkazIds: collapsed.map((building) => building.id),
  }
}

function debrisFor(buildings, enkazIds) {
  const ids = new Set(enkazIds)
  return buildings
    .filter((building) => ids.has(building.id))
    .map((building) => ({
      id: building.id,
      lat: building.lat,
      lng: building.lng,
      radius: building.radius,
      name: building.name,
    }))
}

const buildings = getStaticBuildings(MISSION_BOUNDS)
const randomArg = process.argv.find((arg) => arg.startsWith('--random='))
const randomCount = randomArg ? Number(randomArg.split('=')[1]) || 0 : 0
const cases = SCENARIOS.map((scenario) => {
  const scene = resolveScenario(scenario, buildings)
  return { id: scenario.id, survivors: scene.survivors, enkazIds: scene.enkazIds }
})
for (let i = 0; i < randomCount; i++) cases.push(randomScenario(buildings, 9100 + i))

let failureCount = 0
for (const testCase of cases) {
  const started = Date.now()
  const debris = debrisFor(buildings, testCase.enkazIds)
  try {
    const base = runAnalysis(testCase.survivors, debris, buildings)
    const terminals = finalizeTerminals(
      base.terminals,
      null,
      buildings,
      debris,
      base.context
    )
    const failures = validateResult(terminals, base.clusters, buildings, debris)
    failureCount += failures.length
    console.log(
      JSON.stringify({
        case: testCase.id,
        ms: Date.now() - started,
        terminals: terminals.map((terminal) => ({
          label: terminal.label,
          irs: terminal.irs.length,
          debrisEdgeM: terminal.siteEvaluation.debrisEdgeM,
          buildingEdgeM: terminal.siteEvaluation.buildingEdgeM,
          betweenAngleDeg: terminal.siteEvaluation.betweenAngleDeg,
        })),
        failures,
      })
    )
  } catch (error) {
    failureCount += 1
    console.log(
      JSON.stringify({
        case: testCase.id,
        ms: Date.now() - started,
        failures: [String(error?.message || error)],
      })
    )
  }
}

console.log(JSON.stringify({ cases: cases.length, failureCount }))
if (failureCount > 0) process.exitCode = 1
