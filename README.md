# ARES-Reflect - Terminal Placement System

ARES-Reflect is a TEKNOFEST mobile satellite terminal placement tool for post-earthquake communication planning. The app lets an operator mark survivors and collapsed buildings on a map, then computes terminal and IRS relay placements with deterministic local geometry rules.

The core placement decision is local and repeatable. Gemini is optional and is used only for explanation, reranking of already-valid local results, and visual validation.

## What The System Does

- Clusters survivor points into 3 deterministic terminal regions.
- Searches terminal positions around survivor clusters and debris corridors.
- Generates IRS candidates from geometric relay corridors and nearby building facades.
- Rejects IRS candidates when `Terminal -> IRS` or `IRS -> Survivor` is blocked by an intact building.
- Treats collapsed buildings as debris, not as line-of-sight blockers.
- Optimizes terminals and IRS units together instead of choosing terminals first and forcing IRS positions later.
- Shows only physically valid IRS suggestions, usually 1-3 per terminal.
- Draws clear and blocked signal paths on the map with the same rules used by the optimizer.
- Produces a PDF report for presentation or field review.

## Quick Start

```bash
npm install
npm run dev
```

The Vite development server starts on:

```text
http://localhost:5173
```

Production build:

```bash
npm run build
npm run preview
```

You can also use `baslat.bat` on Windows to install dependencies if needed and start the local development server.

## Optional Gemini Setup

Gemini is optional. The placement engine works without it.

Create a local `.env` file:

```bash
VITE_GEMINI_API_KEY=your_api_key_here
```

Important notes:

- `.env` is ignored by Git and must not be committed.
- `.env.example` is committed as a template.
- Because this is a Vite client app, every `VITE_` variable is bundled into the browser. For public deployment, a backend proxy is safer than exposing a browser API key.

## User Workflow

1. Click `Depremzede Ekle` and place at least 3 survivor markers.
2. Click `Enkaz Sec` and mark at least 1 collapsed building.
3. Use `Kaldir` to remove a survivor marker or remove the collapsed-building mark from a building.
4. Click `Analiz Et`.
5. Review terminal cards, IRS tables, map lines, and optional Gemini validation.
6. Export the result with `PDF Disa Aktar` if needed.

## Placement Pipeline

The main pipeline lives in `src/lib/algorithm.js`.

### 1. Deterministic Clustering

`kMeans()` groups survivors into 3 terminal regions. It does not use `Math.random()`. Center initialization is deterministic, so the same input should produce the same clusters and placements.

### 2. Terminal Candidate Generation

For each survivor cluster, the engine creates terminal candidates from:

- the cluster centroid,
- a grid around the cluster,
- nearby debris anchors,
- rings around debris,
- corridor points between debris and survivor clusters.

Each terminal candidate is evaluated with the IRS set it can actually support.

### 3. IRS Candidate Generation

For each terminal candidate, the engine creates IRS candidates along relay directions and snaps suitable candidates to building facades when useful.

IRS scoring checks:

- `Terminal -> IRS` line of sight,
- `IRS -> Survivor/cluster` line of sight,
- survivor coverage,
- total path distance,
- estimated link gain,
- reflection angle efficiency,
- mounting height,
- facade alignment,
- distance from debris.

### 4. Hard Validity Rules

The optimizer has hard constraints:

- If `Terminal -> IRS` is blocked by an intact building, the IRS candidate is invalid.
- If `IRS -> target` is blocked by an intact building, the IRS candidate is invalid.
- Collapsed buildings selected as debris are excluded from the blocker list.
- Invalid candidates cannot be restored by Gemini.

This rule is shared by the optimizer, map lines, cards, modals, and report data.

### 5. Joint Terminal Selection

Terminals are not selected independently. The engine builds a shortlist for each cluster and then chooses the best terminal combination.

Terminal scoring includes:

- IRS set quality,
- open corridor quality,
- direct visibility to cluster members,
- survivor coverage potential,
- satellite/access suitability,
- proximity to the cluster,
- separation from other selected terminals.

### 6. IRS Set Optimization

IRS units are selected as a set, not as isolated top scores. The set optimizer balances:

- average IRS quality,
- minimum IRS quality,
- survivor coverage,
- spatial separation,
- cluster spread.

The UI no longer forces 3 IRS units when fewer valid units exist.

## Gemini Role

Gemini integration lives in `src/lib/gemini.js`.

Gemini can:

- generate clearer explanation text,
- rerank already-valid terminal results for presentation order,
- visually validate the rendered map screenshot.

Gemini cannot:

- create new coordinates,
- bypass line-of-sight rules,
- make blocked candidates valid,
- restore candidates rejected by the local engine.

Current model:

```text
gemini-3.5-flash
```

## Important Source Files

```text
src/App.jsx                    Main application orchestration
src/components/Map.jsx          Leaflet map, markers, building polygons, signal lines
src/components/Navbar.jsx       Scenario menu, status indicators, PDF export access
src/components/TerminalCard.jsx Terminal summary cards
src/components/IRSCard.jsx      IRS summary cards
src/components/IRSModal.jsx     Detailed IRS engineering view
src/components/IRSScoreTable.jsx IRS comparison table
src/components/ExportPDF.jsx    PDF report generator
src/hooks/useMarkers.js         Survivor, debris, building, and mode state
src/hooks/useAnalysis.js        Local-first analysis and Gemini background flow
src/lib/algorithm.js            Deterministic placement and scoring pipeline
src/lib/geometry.js             Distance, bearings, facade, blockage, link helpers
src/lib/buildings.js            OSM/Overpass building loading and cleanup
src/lib/gemini.js               Explanation, rerank, and validation calls
src/lib/scoring.js              Terminal and IRS score helpers
src/data/scenarios.js           Deterministic demo scenarios
```

## Data And Blocking Rules

Building data is fetched from OpenStreetMap through Overpass endpoints in `src/lib/buildings.js`.

The building parser:

- ignores invalid footprints,
- normalizes closed polygons,
- computes centroid, radius, and bounding box,
- estimates height from `height` or `building:levels` when available.

The blocker rule uses only intact buildings:

```text
all OSM buildings - user-selected collapsed buildings = blockers
```

That means an IRS path can cross a collapsed building footprint without being treated as blocked, while intact buildings still block the signal line.

## UI Status Indicators

The top bar shows where each part of the result came from:

- `Yerlesim: Yerel` means placement is from the deterministic local engine.
- `Aciklama: Yerel`, `Calisiyor`, or `Gemini` shows explanation source.
- `Rerank: Yerel`, `Calisiyor`, or `Gemini` shows terminal ordering source.
- `Dogrulama: Hazir`, `Calisiyor`, `Gemini`, or `Kapali` shows visual validation state.

## Quality Bands

IRS quality scores are absolute 0-100 style scores in the UI:

- `85-100`: Guclu
- `70-84`: Uygun
- `55-69`: Sinirda
- `0-54`: Gecersiz or hidden from recommendation output

## Repository Hygiene

Ignored files include:

- `node_modules/`
- `dist/`
- `.env`
- `.env.*`
- local editor folders
- logs
- `.claude/`

Before pushing to GitHub, verify:

```bash
git status --short
npm run build
```

## Known Notes

- The app depends on live OpenStreetMap tile and Overpass data for real map/building loading.
- Demo scenarios are deterministic once building data is available.
- Vite may warn that the final bundle is larger than 500 kB because map, PDF, and canvas dependencies are bundled. This is a warning, not a build failure.
