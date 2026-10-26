# Data sources and reproducibility

## Wheels/LAVTA

- Publisher: Caltrans, Cal-ITP GTFS-Ingest Pipeline Dataset.
- Catalog: https://data.ca.gov/dataset/cal-itp-gtfs-ingest-pipeline-dataset
- Read interface: CKAN `datastore_search`, filtered to the Wheels-specific feed identifier.
- Original schedule source: 511 SF Bay; required attribution: **data provided by 511.org**, linked to https://511.org.
- Tables: stops, routes, trips, stop_times, calendar, calendar_dates.
- The included Wheels calendars run September 21, 2026–January 29, 2027.

Caltrans describes this copy as intended for analysis rather than trip-planner ingestion. Mile is a saved schedule-access analysis and labels its modeled output accordingly. Live journey planning and actual travel should use current operator information. The older standalone Wheels ZIP published in April 2026 was inspected but rejected for the combined analysis because its service period did not overlap the current BART schedule. It is not used in the app.

The importer paginates all filtered records rather than truncating the stop-time table. It namespaces stop, route, service, and trip IDs by agency before combining them.

## BART

- Documentation: https://www.bart.gov/schedules/developers/gtfs
- Download permalink: https://www.bart.gov/dev/schedules/google_transit.zip
- Source tables: GTFS stops, routes, trips, stop_times, calendar, calendar_dates.
- The included BART calendars run August 10, 2026–January 10, 2027.

The downloaded feed's `feed_info` metadata did not match its calendar dates. The importer uses the actual service-calendar and exception records, which are the records used to determine whether a trip runs. Both agencies must have an overlapping service span; the app restricts selectable dates to that shared span. A date inside the span may legitimately have fewer or no active trips.

BART's official logos and system map are not used. BART owns its data and marks; review the developer terms linked from its documentation.

## OpenStreetMap

- Data: © OpenStreetMap contributors, https://www.openstreetmap.org/copyright
- License: Open Database License (ODbL), https://opendatacommons.org/licenses/odbl/1-0/
- Study bounds: south 37.62, west -121.99, north 37.78, east -121.70.
- Snapshot retrieval: October 25, 2026 Pacific time.
- The compressed source extract is included in `data/source/` for inspection and reproduction.

Public Overpass mirrors were unavailable during the initial import, so a bounded extract was obtained from the documented OSM map API. Small requests were cached and oversized requests subdivided. `fetch_osm.py` supports this fallback. Do not use it to scrape large regions or repeatedly download an unchanged area.

Destination categories use OSM tags: `shop=supermarket`; `amenity=library`, `school`, `college`, `hospital`, or `clinic`; and `leisure=park`, with a name. Nearby point/area representations sharing the same name are deduplicated within 350 metres. Places too far from the walking graph are omitted. OSM tags can be incomplete or imperfect, and the app does not verify opening hours or public entrance access.

## Census

- Original source: U.S. Census Bureau, ACS 2020–2024 5-year estimates.
- Table: B08201, household size by vehicles available.
- Current Esri item: https://www.arcgis.com/home/item.html?id=458ceeeff7e847af8257ad5ce58e0161
- Current service: ACS_Vehicle_Availability_View_Boundaries.
- Scope: 44 eastern Alameda County tracts (`GEOID LIKE '0600145%'`).
- Fields: B08201_001E and 001M (total households estimate/MOE); B08201_002E and 002M (no-vehicle households estimate/MOE).

The older Esri item was identified as the 2019–2023 release and replaced by its publisher-linked current version. `census.geojson` stores the verified release label, retrieval time, table, and source/download links in its metadata.

Margins of error apply to household count estimates and are displayed at the source's 90% confidence level. The app does not calculate or display a margin of error for the percentage ratio. Do not interpret these contextual tract estimates as a household-level access measure or a causal relationship.

## Integrity

`manifest.json` contains the SHA-256 checksum of the exact shipped `transit.json`. `npm run data:validate` checks that hash, stop/trip uniqueness, timetable order, graph references, snapped locations, service-span overlap, and Census metadata.

The build date is the time the snapshot was assembled. It is not a claim that all source data were measured that day. GTFS describes future scheduled service; Census estimates cover a multi-year period; OSM is a saved map snapshot.
