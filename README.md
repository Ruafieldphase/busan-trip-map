# Local Trip Map

A small browser-based trip map that keeps the viewer and your personal trip file separate.

**App:** https://ruafieldphase.github.io/busan-trip-map/

## Use

1. Open the app in a modern browser.
2. Choose your compatible trip JSON or full backup using the import control.
3. Select a day, inspect a place or leg, and optionally add a candidate stop.
4. Export a full backup before changing device, browser or site origin, then import it there.

This repository ships an empty viewer. It contains no personal itinerary, accommodation bookings, visit history, private route geometry or trip dataset. Imported files are handled in the browser and saved to that origin's local storage. The app has no upload backend or analytics. Map/CDN providers still receive normal asset or viewed-area requests; external map links are opened only on explicit interaction.

## How it works

- `io.js`: bounded JSON validation, atomic local imports, legacy visit-memory merging and full private backups.
- `core.js`: route/leg construction and preservation of independently stored geometry and evidence.
- `app.js`: dynamic date/mode controls, map overlays, one selected card and optional details.
- `styles.css`: responsive map/card layout and a scrollable date strip.
- `index.html`: empty entry point, attribution and restrictive connection/form policy.

The trip format is `local-trip-v1`; full backups use `local-trip-backup-v1`. Trip data supplies places, day routes/labels/areas, reservations, original saved presets, query labels and explicit unknown-leg rules. A visit-memory export is not a full trip file. Import validation is defined in `io.js`.

Unchanged route legs keep their stored geometry when a stop is added. Newly adjacent or unverified legs remain unverified; no car route is substituted for a bus route. Saved engine estimates are labeled separately from current transit information.

Tile-image loading and actual cartographic content are different checks. A finished image batch does not prove all tiles succeeded or that decoded pixels show real roads. Basemap transport state is kept separate from trip data and route overlays. There is no tile-prefetch, offline tile archive, automatic geolocation or background synchronization.

## Dependencies and status

The viewer loads [Leaflet1.9.4](https://leafletjs.com/) from unpkg after a trip is activated, and uses the standard OpenStreetMap image tiles with visible attribution. Follow the [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/); this app does not provide offline map downloads.

Validation includes offline core/import checks, local preview boundary checks and desktop-browser import/export/route-state checks. Physical Android acceptance and current real-world place/transit information remain separate verification tasks.

For development discussions, use synthetic data rather than private trip files. This public repository is the generic viewer; personal data, local research evidence and private test fixtures are excluded.
