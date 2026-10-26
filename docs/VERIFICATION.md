# Verification record

Verified locally on October 25, 2026, using the included real-data snapshot.

## Calculation and data checks

- Seven routing regression tests pass: waiting/departed trips, transfer buffers and boarding limits, disconnected walking paths, per-leg walking limits, calendar exceptions, overnight service, and pickup/dropoff restrictions.
- Snapshot validation passes for 3,912 trip records, 653 stops, 321 mapped places, and 44 Census tracts. The data checksum, graph references, timetable ordering, snapped locations, and shared service-calendar span are checked.
- TypeScript and the Vite production build pass.

## Browser flow

The checked flow is: select journey settings → load the static source snapshot → compute in a Web Worker → render reachable streets, stops, and destinations → inspect a journey, comparison, Census context, or export.

| Check | Observed result |
| --- | --- |
| Default scheduled access, Oct 26 at 8 am, Dublin/Pleasanton BART, 45 minutes, 10-minute walking legs, one transfer | 116 mapped places reachable; 341 stops in reach |
| Same query at 8 pm | 105 mapped places reachable; category differences are calculated separately |
| Libraries filter | Dublin and Pleasanton libraries appear in the default morning view |
| Dublin Library itinerary | 19 minutes in the default morning view, including access walking, a wait, Wheels 30R, and the final walk |
| Origin and budget controls | Changing to Dublin Library and a 30-minute budget updates the results |
| Time entry | Native time input updates the departure slider; input-event handling was added for prompt updates |
| CSV export | Downloaded successfully; 321 records with result status, settings, and source URLs; the tested library-origin morning query contains 18 reachable records |
| Share link | Encodes origin, local date, departure minutes, budget, walk limit, boarding limit, and view |
| Census context | Clicking tract 4505.02 displays 2.2%, an estimated 43 no-vehicle households ± 28, and ACS 2020–2024 5-year metadata |
| Source dialog | Shows actual source links, study counts, snapshot status, and the verified Census release |
| Desktop | Inspected at 1440 × 1000 |
| Phone | Inspected at 390 × 844; journey controls expand/collapse; page width equals viewport width, with no horizontal overflow |
| Browser diagnostics | No warnings or errors were reported in the final inspected local flow |

Screenshots are saved as `preview-desktop.jpg` and `preview-mobile.jpg` beside this file.

## Limits of verification

This verifies the application's modeled schedule flow and included data. It does not establish real-world arrival accuracy, wheelchair accessibility, complete OSM coverage, opening hours, or measured community outcomes. Source datasets can contain errors. For actual travel, consult the current operator timetable and service alerts.
