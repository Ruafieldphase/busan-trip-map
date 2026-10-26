# Composite itinerary legs (optional v1 extension)

This candidate adds optional `trip.transportLegs` to `local-trip-v1`. The outer trip and backup versions remain `local-trip-v1` and `local-trip-backup-v1`; files without the extension retain their previous behavior. No real transit dataset is bundled. `tests/fixtures.js` contains fictional, explicitly SYNTHETIC examples and is never loaded by the app.

A composite record uses `schema: "composite-itinerary-leg-v1"`. It belongs to a directed pair of itinerary **place IDs** `a` and `b`. Real stops, station entrances and platforms live inside its own `endpoints`, independently of the day's itinerary composition. A composition key called `bus`, `rest` or `walk` is never interpreted as a transport mode.

| Record | Required fields |
| --- | --- |
| Leg | `schema`, unique `id`, `a`, `b`, `from`, `to`, `evidence`, `endpoints`, ordered `steps` |
| Endpoint | unique local `id`, `kind` (`place`, `stop`, `entrance`, `platform`), `name`, `coords` (`[lat,lon]` or `null`), `evidence`; `placeId` for `place` |
| Step | unique local `id`, `mode` (`walk`, `bus`, `subway`, `rail`, `transfer`), endpoint IDs `from` and `to`, `evidence`, `geometry`, `distance` (meters or `null`), `duration` (seconds or `null`) |
| Transit service | `service` required for bus/subway/rail: `name` and `direction` (strings or `null`), matching `from` and `to`, `evidence` |
| Geometry | `null`, or `{coords: [[lat,lon], ...], evidence: {...}}`; source order follows step travel direction |
| Evidence | `{source: string|null, reference: string|null, observedAt: date-time string|null, verification: "unknown"|"unverified"|"source-verified"}` |

All evidence objects are independent. `source-verified` is the imported owner's assertion and requires nonempty source, reference and parseable time. The viewer does not authenticate that assertion or contact the referenced provider. Geometry coordinates alone prove no provider, stop, road type, accessibility, operating schedule or entrance. Unknown values must be explicit `null`; missing structural fields are invalid. Unknown extra JSON fields remain in full backups.

`from`/`to` identify the itinerary endpoints through `placeId`, matching `a`/`b`. A destination can itself be a `stop` or `platform`; its physical kind stays intact and no zero-length access walk is invented. Any endpoint carrying `placeId` must preserve that original itinerary pin when coordinates are supplied. This does not assert that the pin is an accessible entrance. First/last steps must follow these endpoints. Transit boarding/alighting endpoints must be `stop` or `platform`. Service `from`/`to` must match the step. Known reversed geometry and disconnected reversed step sequences are rejected. These checks cannot validate a textual destination/headsign against an actual transit operator.

Optional `day` and `composition` restrict applicability to existing trip keys. Omission means all dates/compositions. Overlapping records for the same directed pair are rejected rather than chosen by array order. To provide alternatives, use non-overlapping explicit scopes. Records can be stored while their pair is not adjacent, including after adding a candidate; they are selected only when that directed pair becomes adjacent again. A matching composite takes precedence over `legRules` and saved walking presets, while the matching original rule's warning/source text remains in the card. Other pairs keep existing behavior.

The selected composite produces one `transportModel`. The selected card, Leaflet and schematic rendering consume that model's ordered steps and exact coordinate arrays. Individual disconnected steps are never concatenated into a continuous route. No transport component is offered to foot routing, even if the component itself is walking or a foot cache already exists for the outer pair. Existing opt-in foot behavior applies only to non-composite legacy edges.

`documented` means every required component has an imported evidence assertion, known distance/time, and no detected missing connection. It is displayed as **original evidence present; current provider not reverified**, never as provider acceptance or trip completion. Missing source/time, endpoint evidence, service direction, geometry, connector walk, entrance connection or explicit transfer remains `partial`. Continuous coordinates do not prove a transfer: consecutive transit rides require an explicit transfer/walking step. Stationary transfers may use the same endpoint with evidence and no geometry. Waiting time and operating schedules are not calculated; no total travel time is synthesized.

Map meanings:

- Green walking, blue bus, purple subway/rail, gold transfer: imported per-step geometry; dashed when that geometry lacks a source verification assertion.
- Orange dashed: itinerary order only when actual linework is absent, never saved as geometry.
- Gray dashed: endpoint/entrance/transfer gaps, including missing step geometry. These are display-only uncertainty indicators, not walkable connectors.

Individual geometry attribution, service evidence, endpoint evidence and timestamps are shown as text in the selected card. Imported references are not fetched. Full private backups retain trip/reservation/visit/legacy/unknown values and foot caches. Invalid imports validate before the single storage write. Existing 2MB, structure and cache bounds continue to apply, with a maximum 50,000 composite vertices inside that file limit.

Offline checks from task root:

```powershell
node --test candidate/tests/*.test.js
```

The baseline regression tests require the sibling `baseline` snapshot supplied with this worker result; candidate-only tests can be run with the other explicit test paths. The Node DOM/Leaflet doubles exercise rendering code without a browser. They do not establish real layout, map tile appearance, mobile touch/scroll behavior or Android acceptance. Actual source-owned transit acquisition, route/stop/direction/connector validation and device testing remain separate work.
