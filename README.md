# Local Trip Map

A small browser-based trip map that keeps the viewer and your personal trip file separate.

**App:** https://ruafieldphase.github.io/busan-trip-map/

## 휴대폰에서 처음 사용하기

1. 별도로 받은 개인 일정 파일이나 전체 백업 파일을 휴대폰에 다운로드하세요. Drive에서 열어 보기만 했다면 먼저 기기에 저장하세요.
2. 앱을 열고 **일정·전체 백업 가져오기**에서 내려받은 **.json 파일**을 선택하세요.
3. 날짜를 선택하고 **빠진 도보 경로 연결**을 누르면 해당 날짜에서 빠진 도보 구간을 계산합니다. 이후 날짜 변경이나 후보 추가 때 필요한 구간만 조회하고 저장한 결과를 재사용합니다.

처음에는 개인 일정을 불러오기 전이라 날짜와 동선이 비어 있습니다. 파일을 가져오면 지도와 날짜가 나타납니다. 개인 파일의 주소와 내용은 이 공개 저장소에 포함하지 않습니다. 다른 기기로 옮기기 전에는 앱의 전체 내보내기로 최신 기록도 함께 보관하세요.

## Use

1. Open the app in a modern browser.
2. Choose your compatible trip JSON or full backup using the import control.
3. Select a day, inspect a place or leg, and optionally add a candidate stop.
4. Export a full backup before changing device, browser or site origin, then import it there.

This repository ships an empty viewer. It contains no personal itinerary, accommodation bookings, visit history, private route geometry or trip dataset. Imported files are handled in the browser and saved to that origin's local storage. The app has no upload backend or analytics. After you enable walking connections or explicitly request a leg, its two endpoint coordinates are sent to FOSSGIS for pedestrian routing; the full file and booking notes are not sent. Map/CDN providers receive normal asset or viewed-area requests; external map links are opened only on explicit interaction.

## How it works

- `io.js`: bounded JSON validation, atomic local imports, legacy visit-memory merging and full private backups.
- `core.js`: route/leg construction and preservation of independently stored geometry and evidence.
- `routing.js`: opt-in foot routing, directed coordinate-pair cache, response validation, one-request queue and stale-response isolation.
- `app.js`: dynamic date/mode controls, map overlays, one selected card and optional details.
- `styles.css`: responsive map/card layout and a scrollable date strip.
- `index.html`: empty entry point, attribution and restrictive connection/form policy.

The trip format is `local-trip-v1`; full backups use `local-trip-backup-v1`. Trip data supplies places, day routes/labels/areas, reservations, original saved presets, query labels and explicit unknown-leg rules. A visit-memory export is not a full trip file. Import validation is defined in `io.js`.

Unchanged route legs keep their stored geometry when a stop is added. Missing short walking legs can be calculated through the dedicated FOSSGIS `routed-foot` engine. A selected transfer with unknown mode can be explicitly queried as walking; bus and rail legs keep their original mode. Routing failures remain visible and require an explicit retry. Calculated geometry is cached locally and included in full backups. No car route is substituted for a bus route. Engine estimates and approximate endpoints are labeled separately from current transit information.

Tile-image loading and actual cartographic content are different checks. A finished image batch does not prove all tiles succeeded or that decoded pixels show real roads. Basemap transport state is kept separate from trip data and route overlays. There is no tile-prefetch, offline tile archive, automatic geolocation or background synchronization.

## Dependencies and status

The viewer loads [Leaflet1.9.4](https://leafletjs.com/) from unpkg after a trip is activated, and uses the standard OpenStreetMap image tiles with visible attribution. Follow the [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/); this app does not provide offline map downloads.

Walking connections use the [FOSSGIS foot-routing service](https://routing.openstreetmap.de/about.html), with serialized requests at least 1.1 seconds apart, local caching and no automatic retries. Its dedicated pedestrian endpoint is essential: changing a profile label on a car-only engine does not make a walking route. Data: © OpenStreetMap contributors. [Fix the map](https://www.openstreetmap.org/). Public demo routing has no availability guarantee; saved geometry remains available if a new request fails. Pin locations and actual access restrictions still require checking.

Validation includes offline core/import checks, local preview boundary checks and desktop-browser import/export/route-state checks. Physical Android acceptance and current real-world place/transit information remain separate verification tasks.

For development discussions, use synthetic data rather than private trip files. This public repository is the generic viewer; personal data, local research evidence and private test fixtures are excluded.
