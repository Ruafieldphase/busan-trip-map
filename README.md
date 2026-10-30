# Local Trip Map

A small browser-based trip map that keeps the viewer and your personal trip file separate.

**App:** https://ruafieldphase.github.io/busan-trip-map/

## 휴대폰에서 처음 사용하기

1. 별도로 받은 개인 일정 파일이나 전체 백업 파일을 휴대폰에 다운로드하세요. Drive에서 열어 보기만 했다면 먼저 기기에 저장하세요.
2. 앱을 열고 **일정·전체 백업 가져오기**에서 내려받은 **.json 파일**을 선택하세요.
3. 날짜를 선택하고 **빠진 도보 경로 연결**을 누르면 해당 날짜에서 빠진 도보 구간을 계산합니다. 이후 날짜 변경이나 후보 추가 때 필요한 구간만 조회하고 저장한 결과를 재사용합니다.
4. 대중교통 연결은 기본으로 꺼져 있습니다. 별도로 받은 비공개 호출자 연결 코드를 비밀번호 입력란에 입력하고 **현재 화면 연결 켜기**를 직접 눌러야 요청합니다. Kakao REST 키를 입력하지 마세요. 원본 도보·도보 후보·통제 구간은 자동 대중교통 조회에서 제외하며, 모든 번호의 선택 구간 카드에서 명시적으로 대중교통을 요청할 수 있습니다.

처음에는 개인 일정을 불러오기 전이라 날짜와 동선이 비어 있습니다. 파일을 가져오면 지도와 날짜가 나타납니다. 개인 파일의 주소와 내용은 이 공개 저장소에 포함하지 않습니다. 다른 기기로 옮기기 전에는 앱의 전체 내보내기로 최신 기록도 함께 보관하세요.

## Use

1. Open the app in a modern browser.
2. Choose your compatible trip JSON or full backup using the import control.
3. Select a day, inspect a place or leg, and optionally add a candidate stop.
4. Export a full backup before changing device, browser or site origin, then import it there.

This repository ships an empty viewer. It contains no personal itinerary, accommodation bookings, visit history, private route geometry or trip dataset. Imported files are handled in the browser and saved to that origin's local storage. The app has no full-file upload or analytics. Transit sends only four endpoint coordinate numbers through the dedicated Cloudflare gateway to Kakao, after a private caller code and explicit enable action. Current transit responses are displayed in memory and excluded from trip storage, caches and exports. Separately, walking connections send their two endpoint coordinates to FOSSGIS after walking is enabled or explicitly selected. The full file and booking notes are not sent. Map/CDN providers receive normal asset or viewed-area requests; external map links are opened only on explicit interaction.

## How it works

Every adjacent pair of numbered stops is now displayed immediately, including before pedestrian routing is enabled. Green lines follow acquired road/path geometry. Orange dashed arrows show itinerary order only where a real route is unavailable, and are explicitly labeled as unverified. Gray dashed links show gaps between a pin and the routing network. These display links are never saved as road geometry, counted as acquired routes, or presented as actual bus roads. Numbered direction badges such as `1→2` make the sequence visible and selectable on the map.

Use the `1→2`, `2→3` buttons at the top of the map to zoom to each pair and read its selected card. The walking connection control is available there too when routing has not yet been enabled.

- `io.js`: bounded JSON validation, atomic local imports, legacy visit-memory merging and full private backups.
- `core.js`: route/leg construction and preservation of independently stored geometry and evidence.
- `routing.js`: opt-in foot routing, directed coordinate-pair cache, response validation, one-request queue and stale-response isolation.
- `composite.js`: independently owned imported transport steps and evidence.
- `live-transit.js`: ephemeral current-response parsing and display models, excluded from saved data.
- `live-request.js`: private opt-in request ownership, current-edge cancellation and a non-replenishing60-request session ceiling.
- `app.js`: dynamic date/mode controls, map overlays, one selected card, optional details and the fixed reviewed gateway address.
- `styles.css`: responsive map/card layout and a scrollable date strip.
- `index.html`: empty entry point, attribution and restrictive connection/form policy.

The trip format is `local-trip-v1`; full backups use `local-trip-backup-v1`. Trip data supplies places, day routes/labels/areas, reservations, original saved presets, query labels and explicit unknown-leg rules. A visit-memory export is not a full trip file. Import validation is defined in `io.js`.

Unchanged route legs keep their stored geometry when a stop is added. Missing short walking legs can be calculated through the dedicated FOSSGIS `routed-foot` engine. A selected transfer with unknown mode can be explicitly queried as walking; bus and rail legs keep their original mode. Routing failures remain visible and require an explicit retry. Calculated geometry is cached locally and included in full backups. No car route is substituted for a bus route. Engine estimates and approximate endpoints are labeled separately from current transit information.

Tile-image loading and actual cartographic content are different checks. A finished image batch does not prove all tiles succeeded or that decoded pixels show real roads. Basemap transport state is kept separate from trip data and route overlays. There is no tile-prefetch, offline tile archive, automatic geolocation or background synchronization.

## Dependencies and status

The viewer loads [Leaflet1.9.4](https://leafletjs.com/) from unpkg after a trip is activated, and uses the standard OpenStreetMap image tiles with visible attribution. Follow the [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/); this app does not provide offline map downloads.

Walking connections use the [FOSSGIS foot-routing service](https://routing.openstreetmap.de/about.html), with serialized requests at least 1.1 seconds apart, local caching and no automatic retries. Its dedicated pedestrian endpoint is essential: changing a profile label on a car-only engine does not make a walking route. Data: © OpenStreetMap contributors. [Fix the map](https://www.openstreetmap.org/). Public demo routing has no availability guarantee; saved geometry remains available if a new request fails. Pin locations and actual access restrictions still require checking.

Network snapping is bounded to 100m for normal endpoints and 150m for explicitly approximate pins. The original pins are preserved; only the returned pedestrian path is drawn. Cards disclose each pin-to-path distance and prominently flag gaps over 100m. The undrawn gap is not proof of access to a beach, building or entrance.

The final v0.8.5 offline viewer/gateway suite passed293/293 synthetic tests (exit0), including existing baseline/CSP checks and failure classification, no-retry, cleanup, privacy and used-count checks. The previous v0.8.3 final suite passed152/152. Tests use fake responses and DOM/Leaflet doubles; they do not establish real routes, road alignment, rail identity, entrances or physical Android acceptance. These checks remain incomplete. See LIVE_TRANSIT.md for verification scope.

For development discussions, use synthetic data rather than private trip files. This public repository is the generic viewer; personal data, local research evidence and private test fixtures are excluded.


## Imported composite transport evidence (candidate extension)

Optional versioned `transportLegs` records keep walking, bus, subway/rail and transfer steps separate, with endpoint identities and independent source/time/verification evidence. The same selected step model drives map geometry and card guidance. Missing connectors/entrances/transfer evidence remain partial; imported verification assertions are not current provider verification. Composite components never enter the foot-routing queue. Existing trip/backup versions and unknown fields are preserved. See [COMPOSITE_LEGS.md](COMPOSITE_LEGS.md) for the exact contract and offline verification limits. No real transit data is bundled.

The private app instance uses exactly `https://busan-trip-transit.kuirvana.workers.dev/v1/transit`. Its CSP adds only that exact HTTPS host beside the existing FOSSGIS foot host; all local asset references use version0.8.5. EMPTY startup, trip activation, storage restore and cached-page return stay disabled with zero transit requests. Connection controls appear after a trip is loaded, and the caller code accepts printable ASCII U+0021–U+007E,32–512 characters, without whitespace or normalization. Input is cleared only after successful activation or on disconnect/import/pagehide; invalid entries and setup failures preserve it. Codes are never stored or exported. Setup errors disconnect partial ownership without an automatic retry. Original pins, reservations, itinerary, foot caches and import/backup contracts retain their existing ownership.

The gateway has dedicated provider/caller Secrets and rejects unauthenticated requests with401, exact CORS Origin and no-store. That authentication check does not prove a positive provider route or correct road, boarding or entrance alignment. The60-attempt ceiling is per page session and does not enforce an account-global quota. Real route, visual and Android checks remain incomplete. See [LIVE_TRANSIT.md](LIVE_TRANSIT.md).


## v0.8.4 offline failure diagnostics

The v0.8.3 notes above are historical. Those historical local asset references used 0.8.4. The current candidate uses0.8.6. Fixed Korean notices distinguish accessible HTTP 401/403/503/502 and other HTTP failures, ambiguous inaccessible/network responses, timeout, invalid body and unsupported provider structure. Failure never enables a same-edge retry. No raw error/body/header/URL/coordinate/provider detail enters diagnostics. No new logging or persistence is added. Pending and disabled connection text retains the used session request count. Status 0 and the separate Python Cloudflare 1010 observation do not establish the cause of the prior browser failure. Synthetic tests do not establish live routing or Android acceptance. Publication and actual route checks are separate.


## v0.8.5 legacy transit eligibility

Explicit source bus, subway, rail and transit legs are automatically queried at every index, even when a legacy stored line exists. These physical types are checked before the walking/stored-line exclusion. Source walking/foot candidates and closures remain excluded. A visit composition name does not choose a physical transport mode. This corrects legacy bus-stop pairs that previously remained order lines while other transit legs were queried. No personal trip or provider response is bundled. The final combined synthetic suite passed293/293; actual road/boarding/entrance and Android verification are separate.

## v0.8.6 manual current-edge approach walks

The accepted current transit card offers **접근·이탈·환승 도보 연결 (N회)**. N is the exact additional query count available for this action, bounded by current unqueried original-pin/provider-endpoint gaps and the remaining shared budget. More than20 gaps on one accepted edge blocks the action. It requires the existing connection enabled, an accepted current directed edge and no request in flight. Rendering, endpoint configuration and generic enable never start a walking batch. Primary transit automatic eligibility retains its existing behavior.

Both operations use the same in-memory caller and single-flight owner. Transit posts four coordinates to /v1/transit. A manual connector posts only four numeric original-pin/current-Kakao endpoint coordinates to /v1/walk on the SAME fixed gateway origin. The gateway chooses ONLY https://dapi.kakao.com/v2/routing/walk, GET with WGS84 input/output. No labels, dates, names, generic URLs, other providers or new secrets. Browser redirects fail; gateway redirects use manual and every3xx is rejected. Each attempt consumes the same monotonically used maximum60 page-session budget at dispatch, including failure/timeout. It is not an account-global quota. Failed connectors are held for the current edge, never retried by repeat actions or rendering.

Walk responses must have the bounded Kakao status:OK route/legs/steps shape, per-step guidance/metrics, valid WGS84 coordinates and consistent direction. Transit/car shapes are rejected as walking. No zero walk or total is invented. Successful steps receive unique connector IDs before/between/after the original bus/rail steps, preserving original ride IDs and coordinate arrays. Map and guide share the new immutable model. Remaining gaps are recomputed from all geometry, including walking endpoint snaps and internal gaps. Failure retains the bus path and affected missing gap. Detailed bus geometry can coexist with a missing approach walk. Two-coordinate paths have an explicit detail warning; greater vertex count alone proves no road alignment.

Date/composition/import/disconnect and directed-edge removal discard connectors with existing ownership and ignore late replies. Unchanged current edges keep results. Date/composition changes keep the explicitly enabled same-page connection; import/disconnect/pagehide releases the caller. **Tab visibility alone does not disconnect.** Full reload cannot restore the caller or live responses. No live walking data enters state, localStorage, history, foot-cache callbacks or exports; all model branches have JSON guards. Original pins, trip, reservations and existing independently owned FOSSGIS foot caches stay separate. Reference release is not physical memory erasure.

The v0.8.6 viewer and reviewed gateway passed361/361 offline synthetic checks. Walking connectors require the explicit selected-card action and the existing private connection. Actual road alignment, building entrances, boarding side/direction, current operations and Android use remain separate verification gates; offline checks are not evidence of those results.
