import { useCallback, useMemo, useState } from 'react'

let _id = 0
const nextId = () => `s${++_id}`

/**
 * Scene state:
 *  - survivors: hand-placed survivor markers ({id,lat,lng})
 *  - buildings: OSM footprints loaded for the mission area
 *  - enkazIds: ids of buildings marked as collapsed
 *  - mode: 'survivor' | 'enkaz' | 'remove' | null
 */
export function useMarkers() {
  const [survivors, setSurvivors] = useState([])
  const [buildings, setBuildings] = useState([])
  const [enkazIds, setEnkazIds] = useState(() => new Set())
  const [mode, setMode] = useState(null)

  const toggleMode = useCallback((m) => setMode((cur) => (cur === m ? null : m)), [])

  const addSurvivorAt = useCallback((latlng) => {
    setSurvivors((s) => [...s, { id: nextId(), lat: latlng.lat, lng: latlng.lng }])
  }, [])

  const removeSurvivor = useCallback((survivorId) => {
    setSurvivors((s) => s.filter((item) => item.id !== survivorId))
  }, [])

  const toggleEnkaz = useCallback((buildingId) => {
    setEnkazIds((prev) => {
      const next = new Set(prev)
      if (next.has(buildingId)) next.delete(buildingId)
      else next.add(buildingId)
      return next
    })
  }, [])

  const removeEnkaz = useCallback((buildingId) => {
    setEnkazIds((prev) => {
      if (!prev.has(buildingId)) return prev
      const next = new Set(prev)
      next.delete(buildingId)
      return next
    })
  }, [])

  const mergeBuildings = useCallback((incoming) => {
    if (!incoming || incoming.length === 0) return
    setBuildings((prev) => {
      const hasLiveOsm = incoming.some((b) => b.source === 'osm')
      const base = hasLiveOsm ? prev.filter((b) => b.source !== 'local-osm') : prev
      const byId = new Map(base.map((b) => [b.id, b]))
      for (const b of incoming) if (!byId.has(b.id)) byId.set(b.id, b)
      return byId.size === prev.length && base.length === prev.length ? prev : Array.from(byId.values())
    })
  }, [])

  const clearAll = useCallback(() => {
    setSurvivors([])
    setEnkazIds(new Set())
    setMode(null)
  }, [])

  const setScene = useCallback((nextSurvivors, nextEnkazIds) => {
    setSurvivors(nextSurvivors)
    setEnkazIds(new Set(nextEnkazIds))
    setMode(null)
  }, [])

  const debris = useMemo(
    () =>
      buildings
        .filter((b) => enkazIds.has(b.id))
        .map((b) => ({ id: b.id, lat: b.lat, lng: b.lng, radius: b.radius, name: b.name })),
    [buildings, enkazIds]
  )

  const canAnalyze = survivors.length >= 3 && debris.length >= 1

  return useMemo(
    () => ({
      survivors,
      buildings,
      enkazIds,
      debris,
      mode,
      toggleMode,
      addSurvivorAt,
      removeSurvivor,
      toggleEnkaz,
      removeEnkaz,
      mergeBuildings,
      clearAll,
      setScene,
      counts: { survivors: survivors.length, enkaz: debris.length },
      canAnalyze,
    }),
    [
      survivors,
      buildings,
      enkazIds,
      debris,
      mode,
      toggleMode,
      addSurvivorAt,
      removeSurvivor,
      toggleEnkaz,
      removeEnkaz,
      mergeBuildings,
      clearAll,
      setScene,
      canAnalyze,
    ]
  )
}
