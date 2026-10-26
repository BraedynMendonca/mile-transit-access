# Architecture and routing

## Runtime

Mile is a static React/TypeScript app built with Vite. Leaflet renders the map. A Web Worker loads a compact dataset and performs timetable analysis entirely in the browser. There is no account system, analytics service, or application server.

The browser fetches the compressed `transit.json.gz` snapshot and `census.geojson` in production. Native decompression or fflate decodes the identical source JSON. Development loads the original JSON directly. After the transit worker reports ready, changes to the query trigger a debounced calculation. Request IDs prevent an older result from replacing a newer one. The daily profile is cached by origin, date, budget, walking limit, and boarding limit.

External browser requests are for map tiles and fonts. Transit analysis and custom starting points are not sent to a routing service. A user can deliberately copy a share URL containing the chosen coordinates and settings.

## Walking graph

The ingestion script extracts connected OSM highways and paths, excluding motorway/trunk roads, construction/proposed ways, foot-prohibited ways, and roads explicitly marked private or inaccessible. Foot travel is modeled as bidirectional. Conditional access, elevation, stairs, and accessibility are not modeled.

Stops and places snap to the nearest source walking node within 220 metres. The connector distance is added to walking time. These connectors approximate the link between a published point and a mapped path; they are not guaranteed entrances or barrier-checked directions.

Degree-two geometry nodes are contracted while protecting every stop and destination snap. An edge retains the sum of its original segment lengths and its original polyline geometry. Intersections are not merged by proximity. Thus a road crossing a freeway is connected only when the source topology actually connects it. Contraction changes storage and runtime size, not the modeled travel distance.

Bounded Dijkstra searches return walking distances. Their results are cached by source node. The map draws segments whose endpoints are reached within the time and walking limits. Long edges are shown conservatively; the display does not interpolate a partial segment when the budget ends mid-edge.

## Timetable routing

1. Select service calendars for the chosen date, applying additions/removals from `calendar_dates`. Include the previous service day's trips after midnight and the next service day's early trips if they fall in the query window.
2. Walk from the origin to reachable served stops, respecting the per-leg walking limit.
3. Scan active trips in rounds. Each round allows one additional boarding. Board only when the traveler can be at the stop by departure; honor GTFS pickup and dropoff restrictions.
4. A later boarding requires a two-minute buffer after arrival, plus any walking between stops. A direct continuation on the same trip is one ride, not a transfer.
5. Relax walking connections from alighting stops for the next round. Final destination walks start at an actual alighting stop or at the origin, preventing repeated walking-only stop hops from bypassing the leg limit.
6. Keep the earliest reachable arrival and its predecessor chain, then reconstruct the itinerary.

All waiting time counts against the total budget. Boarding limits are 1–3, corresponding to 0–2 transfers. The maximum foot distance is the selected per-leg walking time multiplied by 1.25 metres/second (4.5 km/h).

## Map and comparison

The result includes reachable walking nodes, stop arrival states, and destination itineraries. Place markers are grouped in screen-space clusters at lower zoom levels; clicking a cluster zooms in. A selected itinerary draws OSM walking geometry and schematic lines between actual transit stops.

The morning/evening comparison uses the same origin, service date, budget, walking tolerance, and boarding limit at 08:00 and 20:00 Pacific time. Categories may improve or decline independently. Counts represent the included OSM destination set, not every destination in the community.

## Census context

The optional tract layer displays B08201 household vehicle-availability estimates. Darker tracts have a higher estimated share of households with no vehicle available. The inspection panel shows an estimated count and its 90% margin of error. These tract-wide figures are not intersected with reachable streets to claim a count of people served.

## Boundaries

The model is restricted to a fixed Tri-Valley study area. Trips with fewer than two included stops are omitted. This means a journey that leaves the study area and returns via an excluded agency is not modeled. Only Wheels and BART are included; County Connection, ACE, paratransit, rideshare, bicycles, and driving are outside the model.

Time comes from the selected local service date and timetable seconds. The browser's device timezone does not change the timetable interpretation: the app explicitly labels all query times Pacific.
