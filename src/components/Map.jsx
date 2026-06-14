import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  Polygon,
  Rectangle,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import L from 'leaflet'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ELBISTAN_CENTER,
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MISSION_BOUNDS,
  fetchBuildings,
} from '../lib/buildings.js'
import { destinationPoint, distanceM, firstBlockingBuilding } from '../lib/geometry.js'
import { getIntactBuildings } from '../lib/algorithm.js'
import { rankColor, nlosColor } from '../lib/ui.js'

const MIN_BUILDING_ZOOM = 15

const survivorIcon = L.divIcon({
  className: '',
  html: '<div class="ares-marker marker-survivor"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
})

const PIN_PATH =
  'M12 0C5.37 0 0 5.37 0 12c0 8.5 12 20 12 20s12-11.5 12-20C24 5.37 18.63 0 12 0z'

const terminalIcon = () =>
  L.divIcon({
    className: '',
    html: `
      <svg width="34" height="44" viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg">
        <path d="${PIN_PATH}" fill="#2f6fff" stroke="#ffffff" stroke-width="1.6"/>
        <g fill="#ffffff">
          <rect x="6.4" y="13" width="2.7" height="5" rx="0.6"/>
          <rect x="10.65" y="10" width="2.7" height="8" rx="0.6"/>
          <rect x="14.9" y="7" width="2.7" height="11" rx="0.6"/>
        </g>
      </svg>`,
    iconSize: [34, 44],
    iconAnchor: [17, 44],
  })

const irsIcon = (rank, color) =>
  L.divIcon({
    className: '',
    html: `
      <svg width="26" height="34" viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg">
        <path d="${PIN_PATH}" fill="${color}" stroke="#ffffff" stroke-width="1.6"/>
        <circle cx="12" cy="11.5" r="5" fill="#ffffff"/>
        <text x="12" y="14.7" text-anchor="middle" font-family="Rajdhani, sans-serif"
              font-size="9" font-weight="700" fill="${color}">${rank}</text>
      </svg>`,
    iconSize: [26, 34],
    iconAnchor: [13, 34],
  })

function ClickHandler({ mode, onMapClick }) {
  useMapEvents({
    click(e) {
      if (mode === 'survivor') onMapClick(e.latlng)
    },
  })
  return null
}

function BuildingLoader({ onLoaded, onStatus }) {
  const map = useMap()
  const timer = useRef(null)

  const run = useCallback(async () => {
    if (map.getZoom() < MIN_BUILDING_ZOOM) {
      onStatus({ loading: false, tooFar: true, error: null })
      return
    }
    const b = map.getBounds()
    onStatus({ loading: true, tooFar: false, error: null })
    try {
      const list = await fetchBuildings({
        south: b.getSouth(),
        west: b.getWest(),
        north: b.getNorth(),
        east: b.getEast(),
      })
      onLoaded(list)
      onStatus({ loading: false, tooFar: false, error: null })
    } catch (e) {
      onStatus({ loading: false, tooFar: false, error: String(e?.message || e) })
    }
  }, [map, onLoaded, onStatus])

  useMapEvents({
    moveend() {
      clearTimeout(timer.current)
      timer.current = setTimeout(run, 600)
    },
  })

  useEffect(() => {
    run()
    return () => clearTimeout(timer.current)
  }, [run])

  return null
}

function FlyTo({ target }) {
  const map = useMap()
  useEffect(() => {
    if (target?.center) map.setView(target.center, target.zoom ?? map.getZoom(), { animate: true })
  }, [target, map])
  return null
}

function ResultFitter({ result }) {
  const map = useMap()
  useEffect(() => {
    if (!result) return
    const pts = []
    for (const t of result.terminals) {
      pts.push([t.lat, t.lng])
      for (const u of t.irs) pts.push([u.lat, u.lng])
    }
    for (const cl of result.clusters) for (const m of cl.members) pts.push([m.lat, m.lng])
    if (pts.length) map.fitBounds(pts, { padding: [50, 50], maxZoom: 18 })
  }, [result, map])
  return null
}

function Validator({ token, onValidate }) {
  const map = useMap()
  const done = useRef(null)
  useEffect(() => {
    if (!token || done.current === token) return
    const id = setTimeout(() => {
      done.current = token
      onValidate(map.getContainer())
    }, 1300)
    return () => clearTimeout(id)
  }, [token, onValidate, map])
  return null
}

function ValidationBadge({ validation, onOpen }) {
  const { status, result } = validation
  let color = '#8aa0c6'
  let icon = '*'
  let label = ''
  if (status === 'running') {
    color = '#00d4ff'
    icon = 'o'
    label = 'Doğrulanıyor...'
  } else if (status === 'done' && result?.valid === true) {
    color = '#22c55e'
    icon = 'OK'
    label = 'Yerleşim Doğrulandı'
  } else {
    return null
  }

  const clickable = status === 'done'
  return (
    <button
      onClick={() => clickable && onOpen()}
      disabled={!clickable}
      title={clickable ? 'Doğrulama raporunu aç' : ''}
      className={`absolute right-3 top-3 z-[600] flex items-center gap-2 rounded-md border px-3 py-1.5 font-head text-xs font-semibold shadow-lg backdrop-blur ${
        clickable ? 'cursor-pointer hover:brightness-125' : ''
      }`}
      style={{
        borderColor: `${color}66`,
        color,
        backgroundColor: 'rgba(10,15,30,0.82)',
      }}
    >
      <span style={{ color }} className={status === 'running' ? 'animate-spin' : ''}>
        {icon}
      </span>
      {label}
      {status === 'done' && result?.confidence ? (
        <span className="opacity-70"> -  %{result.confidence}</span>
      ) : null}
    </button>
  )
}

function nearestDebrisGroupKey(point, debris = []) {
  if (!debris.length) return 'saha'
  let best = null
  for (const d of debris) {
    const dist = distanceM(point, d)
    if (!best || dist < best.dist) best = { debris: d, dist }
  }
  if (!best) return 'saha'
  const groupRadius = Math.max(45, (best.debris.radius || 14) + 34)
  return best.dist <= groupRadius ? best.debris.id || 'enkaz' : 'saha'
}

function buildIrsGroupLines(irsUnits = [], debris = []) {
  const debrisById = new Map(debris.map((d) => [d.id, d]))
  const lines = []

  for (const u of irsUnits) {
    const groups = new Map()
    for (const survivor of u.coveredSurvivors || []) {
      const key = nearestDebrisGroupKey(survivor, debris)
      const group = groups.get(key) || { key, survivors: [] }
      group.survivors.push(survivor)
      groups.set(key, group)
    }

    for (const group of groups.values()) {
      const survivors = group.survivors
      if (!survivors.length) continue
      const lat = survivors.reduce((sum, s) => sum + s.lat, 0) / survivors.length
      const lng = survivors.reduce((sum, s) => sum + s.lng, 0) / survivors.length
      const clearCount = survivors.filter((s) => s.nlos === 'CLEAR').length
      const status =
        clearCount === survivors.length ? 'CLEAR' : clearCount > 0 ? 'PARTIAL_NLoS' : 'FULL_NLoS'
      const debrisName = debrisById.get(group.key)?.name || (group.key === 'saha' ? 'Saha geneli' : 'Enkaz kümesi')

      lines.push({
        id: `${u.id}-${group.key}`,
        irs: u,
        target: { lat, lng },
        count: survivors.length,
        clearCount,
        status,
        debrisName,
      })
    }
  }

  return lines
}

function Toolbar({ mode, toggleMode, onClear, onAnalyze, canAnalyze, counts, loading, buildingStatus }) {
  const btn = (active) =>
    `px-3 py-1.5 rounded-md font-head font-semibold text-sm tracking-wide border transition-all duration-200 ${
      active
        ? 'bg-accent text-[#06121f] border-accent shadow-glow'
        : 'bg-card text-text border-border hover:border-accent hover:text-accent'
    }`

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-panel border-b border-border">
      <button className={btn(mode === 'survivor')} onClick={() => toggleMode('survivor')}>
        <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-survivor align-middle" />
        Depremzede Ekle
      </button>
      <button className={btn(mode === 'enkaz')} onClick={() => toggleMode('enkaz')}>
        <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-[2px] bg-debris align-middle" />
        Enkaz Seç
      </button>
      <button className={btn(mode === 'remove')} onClick={() => toggleMode('remove')}>
        <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full border border-current align-middle" />
        Kaldır
      </button>
      <button
        className="px-3 py-1.5 rounded-md font-head font-semibold text-sm tracking-wide border border-border bg-card text-muted hover:text-debris hover:border-debris transition-all duration-200"
        onClick={onClear}
      >
        Temizle
      </button>

      <span className="font-head text-[11px] uppercase tracking-wide">
        {buildingStatus.loading ? (
          <span className="text-accent">* Binalar yükleniyor...</span>
        ) : buildingStatus.error ? (
          <span className="text-debris">* Bina verisi alınamadı</span>
        ) : buildingStatus.tooFar ? (
          <span className="text-muted">* Binalar için yakınlaştırın</span>
        ) : null}
      </span>

      <div className="ml-auto flex items-center gap-3">
        <div className="flex items-center gap-3 text-sm font-head">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-survivor" />
            <span className="text-muted">DEPREMZEDE</span>
            <span className="text-text font-bold tabular-nums">{counts.survivors}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[2px] bg-debris" />
            <span className="text-muted">ENKAZ</span>
            <span className="text-text font-bold tabular-nums">{counts.enkaz}</span>
          </span>
        </div>
        <button
          disabled={!canAnalyze || loading}
          onClick={onAnalyze}
          className={`px-5 py-1.5 rounded-md font-head font-bold text-sm tracking-widest uppercase transition-all duration-200 ${
            canAnalyze && !loading
              ? 'bg-accent text-[#06121f] shadow-glow animate-pulseGlow hover:shadow-glow-lg'
              : 'bg-card text-muted border border-border cursor-not-allowed'
          }`}
          title={canAnalyze ? 'Yerleşim analizini çalıştır' : 'En az 3 depremzede ve 1 enkaz gerekli'}
        >
          {loading ? 'Analiz yapılıyor...' : 'Analiz Et'}
        </button>
      </div>
    </div>
  )
}

export default function MapPanel({
  survivors,
  buildings,
  enkazIds,
  debris,
  mode,
  onMapClick,
  onRemoveSurvivor,
  onToggleEnkaz,
  onRemoveEnkaz,
  onBuildingsLoaded,
  toggleMode,
  onClear,
  onAnalyze,
  canAnalyze,
  counts,
  loading,
  result,
  selectedTerminalId,
  flyTo,
  onValidate,
  validation,
  onOpenValidation,
}) {
  const [buildingStatus, setBuildingStatus] = useState({ loading: false, tooFar: false, error: null })
  const terminals = result?.terminals ?? []
  const clusters = result?.clusters ?? []
  const enkazMode = mode === 'enkaz'
  const removeMode = mode === 'remove'
  const selectedT = terminals.find((t) => t.id === selectedTerminalId) || null

  const intactObstacles = useMemo(() => getIntactBuildings(buildings, debris), [buildings, debris])

  const directLines = useMemo(() => {
    if (!result) return []
    const t = terminals.find((x) => x.id === selectedTerminalId)
    if (!t) return []
    const members = clusters[t.clusterIndex]?.members ?? []
    const lines = []
    for (const s of members) {
      if (!firstBlockingBuilding(t, s, intactObstacles)) {
        lines.push([[t.lat, t.lng], [s.lat, s.lng]])
      }
    }
    return lines
  }, [result, selectedTerminalId, terminals, clusters, intactObstacles])

  const blockedBuildingIds = useMemo(() => {
    if (!selectedT) return new Set()
    const ids = selectedT.irs.flatMap((u) => [u.term_blocker_id, u.vic_blocker_id]).filter(Boolean)
    return new Set(ids)
  }, [selectedT])

  const irsGroupLines = useMemo(
    () => buildIrsGroupLines(selectedT?.irs || [], debris),
    [selectedT, debris]
  )

  const missionRect = [
    [MISSION_BOUNDS.south, MISSION_BOUNDS.west],
    [MISSION_BOUNDS.north, MISSION_BOUNDS.east],
  ]

  return (
    <div className={`flex h-full flex-col ${mode === 'survivor' ? 'placing' : ''}`}>
      <Toolbar
        mode={mode}
        toggleMode={toggleMode}
        onClear={onClear}
        onAnalyze={onAnalyze}
        canAnalyze={canAnalyze}
        counts={counts}
        loading={loading}
        buildingStatus={buildingStatus}
      />
      <div className="relative flex-1">
        <MapContainer
          center={ELBISTAN_CENTER}
          zoom={DEFAULT_ZOOM}
          minZoom={13}
          maxZoom={MAX_ZOOM}
          preferCanvas={true}
          className="absolute inset-0 h-full w-full"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={MAX_ZOOM}
            maxNativeZoom={19}
            crossOrigin="anonymous"
          />
          <ClickHandler mode={mode} onMapClick={onMapClick} />
          <BuildingLoader onLoaded={onBuildingsLoaded} onStatus={setBuildingStatus} />
          <FlyTo target={flyTo} />
          <ResultFitter result={result} />
          {result && <Validator token={result.id} onValidate={onValidate} />}

          <Rectangle
            bounds={missionRect}
            pathOptions={{
              color: '#00d4ff',
              weight: 1,
              dashArray: '6 8',
              opacity: 0.45,
              fill: false,
              interactive: false,
            }}
          />

          {buildings.map((b) => {
            const selected = enkazIds.has(b.id)
            const highlightedBlocker = blockedBuildingIds.has(b.id) && !selected
            const interactive = enkazMode || removeMode
            return (
              <Polygon
                key={`${b.id}:${interactive ? 1 : 0}`}
                positions={b.latlngs}
                pathOptions={{
                  color: selected
                    ? '#ff3b3b'
                    : highlightedBlocker
                      ? '#f59e0b'
                      : interactive
                        ? '#7c8aa8'
                        : '#566480',
                  weight: selected ? 2 : highlightedBlocker ? 2 : 1,
                  fillColor: selected ? '#ff3b3b' : highlightedBlocker ? '#f59e0b' : '#64748b',
                  fillOpacity: selected ? 0.5 : highlightedBlocker ? 0.2 : 0.12,
                  interactive,
                }}
                eventHandlers={
                  interactive
                    ? {
                        click: (e) => {
                          L.DomEvent.stopPropagation(e)
                          if (enkazMode) onToggleEnkaz(b.id)
                          if (removeMode && selected) onRemoveEnkaz(b.id)
                        },
                      }
                    : undefined
                }
              >
                {interactive && (
                  <Tooltip direction="top" opacity={1} sticky>
                    {enkazMode
                      ? selected
                        ? 'Enkaz işaretini kaldır'
                        : 'Enkaz olarak işaretle'
                      : selected
                        ? 'Enkaz işaretini kaldır'
                        : highlightedBlocker
                          ? 'Bu bina sinyal hattini kesiyor'
                          : 'Kaldırılacak enkaz değil'}
                    {b.name ? `  -  ${b.name}` : ''}
                  </Tooltip>
                )}
              </Polygon>
            )
          })}

          {survivors.map((s) => (
            <Marker
              key={s.id}
              position={[s.lat, s.lng]}
              icon={survivorIcon}
              eventHandlers={
                removeMode
                  ? {
                      click: (e) => {
                        L.DomEvent.stopPropagation(e)
                        onRemoveSurvivor(s.id)
                      },
                    }
                  : undefined
              }
            >
              {removeMode && (
                <Tooltip direction="top" opacity={1}>
                  Depremzedeyi kaldır
                </Tooltip>
              )}
            </Marker>
          ))}

          {selectedT && (
            <>
              {selectedT.irs.map((u) => {
                const status = u.term_los_status || 'CLEAR'
                const clear = status === 'CLEAR'
                return (
                  <Polyline
                    key={`t2irs-${u.id}`}
                    positions={[[selectedT.lat, selectedT.lng], [u.lat, u.lng]]}
                    pathOptions={{
                      color: nlosColor(status),
                      weight: 3,
                      opacity: 0.95,
                      dashArray: clear ? null : '8 8',
                      className: clear ? 'path-draw' : 'path-draw path-nlos',
                    }}
                  >
                    <Tooltip direction="center" opacity={0.95} sticky>
                      Terminal -&gt; {u.name}: %{Math.round((u.term_los ?? 0) * 100)} açıklık
                      {u.term_blocker_name ? `  -  Engelleyen: ${u.term_blocker_name}` : ''}
                    </Tooltip>
                  </Polyline>
                )
              })}

              {irsGroupLines.map((line) => {
                const clear = line.status === 'CLEAR'
                const partial = line.status === 'PARTIAL_NLoS'
                return (
                  <Polyline
                    key={`irs2group-${line.id}`}
                    positions={[[line.irs.lat, line.irs.lng], [line.target.lat, line.target.lng]]}
                    pathOptions={{
                      color: clear ? '#22c55e' : partial ? '#eab308' : '#ef4444',
                      weight: Math.min(4, 1.8 + line.clearCount * 0.35),
                      opacity: 0.82,
                      dashArray: clear ? null : '8 8',
                      className: clear ? 'path-draw' : 'path-draw path-nlos',
                    }}
                  >
                    <Tooltip direction="center" opacity={0.95} sticky>
                      {line.irs.name} -&gt; {line.debrisName}: {line.clearCount}/{line.count} açık depremzede
                    </Tooltip>
                  </Polyline>
                )
              })}

              {directLines.map((line, i) => (
                <Polyline
                  key={`direct-${i}`}
                  positions={line}
                  pathOptions={{ color: '#2f6fff', weight: 1.5, opacity: 0.55, dashArray: '2 6' }}
                />
              ))}

              <Marker
                position={[selectedT.lat, selectedT.lng]}
                icon={terminalIcon()}
                zIndexOffset={1000}
              >
                <Tooltip direction="top" offset={[0, -26]} opacity={1}>
                  <b>{selectedT.name}</b>  -  {selectedT.scorePct}%
                </Tooltip>
              </Marker>

              {selectedT.irs.map((u) => {
                if (u.mount_type !== 'cephe' || u.facade_bearing == null) return null
                const tip = destinationPoint({ lat: u.lat, lng: u.lng }, 14, u.facade_bearing)
                return (
                  <Polyline
                    key={`facade-${u.id}`}
                    positions={[[u.lat, u.lng], [tip.lat, tip.lng]]}
                    pathOptions={{ color: '#00d4ff', weight: 2.5, opacity: 0.9 }}
                  />
                )
              })}

              {selectedT.irs.map((u) => (
                <Marker
                  key={u.id}
                  position={[u.lat, u.lng]}
                  icon={irsIcon(u.rank, rankColor(u.rank))}
                  zIndexOffset={900}
                >
                  <Tooltip direction="top" offset={[0, -14]} opacity={1}>
                    <b>{u.name}</b>  -  Kalite %{Math.round((u.quality_score ?? u.composite_score) * 100)}
                    <br />
                    T-&gt;IRS %{Math.round((u.term_los ?? 0) * 100)}  -  IRS-&gt;Hedef %
                    {Math.round((u.vic_los ?? 0) * 100)}  -  {u.link_gain_db >= 0 ? '+' : ''}
                    {u.link_gain_db} dB
                    <br />
                    {u.mount_type === 'cephe'
                      ? `${u.facade} cephe  -  ~${u.mount_height_m} m`
                      : `Serbest direk  -  ~${u.mount_height_m} m`}
                    {u.validity_status === 'borderline' ? <><br />Sınırda ama geçerli</> : null}
                  </Tooltip>
                </Marker>
              ))}
            </>
          )}
        </MapContainer>

        {result && <ValidationBadge validation={validation} onOpen={onOpenValidation} />}
      </div>
    </div>
  )
}
