# Mile — Tri-Valley Transit Access Lab

**Live website:** https://mile-transit-access.vercel.app — public Vercel production site, with no sign-in required.

A complete, responsive web app for exploring what public transit makes reachable around Dublin, Pleasanton, and Livermore, California. Built for a Congressional App Challenge project using real public datasets.

Choose a starting point, date, departure time, travel budget, walking tolerance, and transfer limit. Mile calculates reachable places on a connected walking network and real Wheels/BART timetables. Compare morning and evening access, inspect an itinerary, view Census vehicle-availability context, export CSV results, and share a reproducible analysis link.

## Run locally

Requires Node.js 22.12 or newer. The processed real-data snapshot is included: no API key, database, or Python setup is needed to run the app.

```sh
npm install
npm run dev
```

Open the local URL printed in the terminal.

```sh
npm test               # Timetable, transfer, walking, and overnight-service tests
npm run data:validate  # Snapshot integrity and graph-reference checks (Python 3.10+)
npm run build          # Type checking and production build
npm run preview        # Preview the production build
```

The website is configured for Vercel hosting. `vercel.json` builds the source as a Vite app and publishes `dist/`. The production build also includes a static deployment configuration, so the verified build can be uploaded directly without rebuilding it remotely. See [docs/VERCEL.md](docs/VERCEL.md).

The mobile layout has readable touch controls, a sticky navigation bar, safe-area spacing, horizontally scrollable destination categories, and an app manifest for adding the website to a home screen. The transit snapshot is compressed from 11.87 MB to 2.78 MB for production delivery; the underlying dataset is unchanged.

## What works

- A real interactive map with clustered place markers and reachable walking segments.
- Seven predefined local origins and a custom origin selected on the map.
- Date-aware Wheels and BART timetable routing, including holiday exceptions and service after midnight.
- Time budgets that include access walking, waiting, riding, transfers, and the final walk.
- Up to two transfers, with a two-minute transfer buffer.
- Per-leg walking limits of 5, 10, or 15 minutes, modeled at 4.5 km/h.
- Categories and search for groceries, libraries, parks, learning, and health destinations.
- Inspectable itineraries, with walking paths and schematic transit segments.
- Morning/evening comparisons and a daily reachable-place profile.
- An optional Census tract layer with household vehicle-availability estimates and margins of error.
- CSV exports containing the settings and source links behind each result.
- Shareable URL parameters that reproduce an analysis.
- Responsive controls for phone and desktop layouts.
- A background worker that keeps routing calculations off the interface thread.

## Real data and scope

The included transit snapshot contains 3,912 study-area trip records, 653 stop records, and 321 mapped places. These are records across service calendars, not the number of trips running on any one day. The selectable schedule period is September 21, 2026–January 10, 2027. See `public/data/manifest.json` for the exact source ranges, counts, and SHA-256 checksum.

Sources:

1. **Wheels/LAVTA**, through Caltrans' public Cal-ITP schedule-analysis tables. Original data provided by [511.org](https://511.org). This is a saved schedule analysis, not a replacement for the live operator trip planner.
2. **BART**: the official GTFS schedule download.
3. **OpenStreetMap contributors**: a bounded local walking-network and destination snapshot, under ODbL. A compressed source snapshot is included for reproduction without repeated downloads.
4. **U.S. Census ACS 2020–2024 5-year estimates**, table B08201, via Esri's public boundary service. The overlay contains 44 eastern Alameda County tracts.

Source URLs and details are in [docs/DATA.md](docs/DATA.md) and inside the app's **Data & sources** dialog.

Mile measures **scheduled reachability to mapped locations**. It does not model real-time delays, cancellations, opening hours, fares, wheelchair access, or individual household access. A nearby Census tract is context, not evidence that its residents can reach the highlighted streets. Walking locations use short estimated connectors to the mapped network. Check the current operator timetable for actual travel.

## Refresh the data

Requires Python 3.10+, `curl`, and network access:

```sh
npm run data:refresh
npm run data:validate
npm run build
```

This refreshes transit and Census data and reuses the bundled OSM snapshot. It obtains public Caltrans schedule records without a 511 API token. It fails if the two agencies' service calendars no longer overlap, rather than silently mixing incompatible periods.

For a deliberate walking-data update, use `python3 scripts/prepare_data.py --refresh-walk`. Public Overpass services can be busy. `scripts/fetch_osm.py` provides a cached, bounded OSM API fallback; run it sparingly and respect public service limits. The checked-in snapshot already covers the study area, so this is not needed for a normal setup.

## Project guide

```text
src/App.tsx                   Interface and application state
src/components/TransitMap.tsx Leaflet map and clustered place markers
src/components/Dialog.tsx     Accessible native modal
src/lib/routing.ts            Calendar, walking, and timetable engine
src/lib/analysis.worker.ts    Background analysis and comparison cache
src/lib/routing.test.ts       Meaningful routing regression tests
src/lib/types.ts              Typed data and itinerary contracts
src/lib/load-data.ts          Compressed production data loading
src/styles.css                Responsive visual system
scripts/prepare_data.py       Public-data ingestion and graph contraction
scripts/fetch_osm.py          Bounded, cached map-data fallback
scripts/validate_data.py      Data and checksum validation
scripts/prepare-web-data.mjs  Compress the verified snapshot for mobile delivery
scripts/finalize-web-build.mjs Package the static Vercel deployment
public/data/                  Shipped app datasets and manifest
data/source/                  Reproducible compressed OSM source snapshot
docs/                         Architecture, data notes, demo, and verification
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) to understand the algorithm and [docs/DEMO.md](docs/DEMO.md) for a three-minute presentation outline. Record and explain any AI assistance in your submission; do not present generated code or unperformed user research as solely your own work.

Application code is MIT-licensed. Source datasets retain their own licenses and attribution requirements; see [DATA_LICENSES.md](DATA_LICENSES.md).
