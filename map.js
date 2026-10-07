/**
 * OpenStreetMap's standard tiles, which are free within the tile usage
 * policy: https://operations.osmfoundation.org/policies/tiles/
 *
 * Keep to the policy when changing this module. Keep the attribution
 * visible on the map, don't prefetch or download tiles for offline use, and
 * let the browser cache tiles normally. If asked to stop using the service,
 * change this URL and redeploy.
 */
export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** The attribution the tile usage policy requires, shown in a corner of the map. */
export const TILE_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Central Bristol, as `[[south, west], [north, east]]`, shown before there's a route. */
export const BRISTOL_BOUNDS = [
  [51.44, -2.63],
  [51.47, -2.56],
];

/**
 * A map of the route.
 *
 * @typedef {object} RouteMap
 * @property {import('leaflet').Map} map The Leaflet map.
 * @property {import('leaflet').LayerGroup} routeLayer The layer the route is drawn on.
 * @property {import('leaflet').LayerGroup} positionLayer The layer the team's position is drawn on.
 * @property {() => void} refresh Updates the map's size after its container has been shown or resized.
 */

/**
 * A place to mark on the map.
 *
 * @typedef {object} MapMarker
 * @property {'start' | 'stop' | 'done' | 'finish' | 'skipped' | 'new'} kind What the place is, which sets how it looks. `new` is a location that isn't in the route yet.
 * @property {import('./locations.js').RouteLocation} location Where it is, and which location it is.
 * @property {string} label What the marker shows: the stop's number, or a short symbol.
 * @property {string} title A description for its tooltip and screen readers, like "1. Old Kent Road, ETA 11:02".
 * @property {() => void} [onMove] Called when Move is pressed in its popup, to move the location to where the map is tapped next. Without it, the popup has no Move button.
 */

/**
 * How long after the map is pressed a context menu still counts as a long
 * press or right-click, in milliseconds. Long presses fire it after about
 * half a second.
 */
const PRESS_MAX_AGE_MS = 2000;

/** How each kind of marker looks, as Tailwind classes. */
const MARKER_CLASSES = {
  start: 'bg-ink text-surface',
  stop: 'bg-accent text-white',
  done: 'bg-accent-line text-accent-ink',
  finish: 'bg-ink text-surface',
  skipped: 'bg-field text-surface',
  new: 'border-2 border-dashed border-accent bg-surface text-accent-ink',
};

/**
 * Creates a Leaflet map with OpenStreetMap tiles, showing central Bristol.
 * Leaflet is loaded from a CDN as the global `L`.
 *
 * @param {HTMLElement} container The element to show the map in. It must be visible and have a height.
 * @param {object} [options] Callbacks.
 * @param {() => void} [options.onTilesFailed] Called when map tiles fail to load, for example without signal.
 * @param {() => void} [options.onTilesLoaded] Called when map tiles load again.
 * @param {(latLng: import('./planner.js').LatLng) => void} [options.onLongPress] Called with the place the map was long-pressed or right-clicked, to drop a pin there.
 * @param {(latLng: import('./planner.js').LatLng) => void} [options.onTap] Called with the place the map was tapped or clicked, but not dragged, such as to pin a location there.
 * @returns {RouteMap | null} The map, or `null` if Leaflet couldn't be loaded (for example, without signal).
 */
export function createMap(container, { onTilesFailed = () => {}, onTilesLoaded = () => {}, onLongPress = () => {}, onTap = () => {} } = {}) {
  const { L } = globalThis;
  if (!L) {
    return null;
  }
  const map = L.map(container);
  L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION })
    .on('tileerror', onTilesFailed)
    .on('tileload', onTilesLoaded)
    .addTo(map);
  map.fitBounds(BRISTOL_BOUNDS);
  // Leaflet fires contextmenu for a right-click, a long press on Android and,
  // with its tapHold option (on by default in mobile Safari), a long press on
  // iOS. It isn't fired for presses on markers, popups or the zoom buttons.
  // The keyboard's context menu key (or Shift+F10) also fires contextmenu,
  // at a point the team didn't choose. Not every browser says where it came
  // from, so only count it if the map was pressed just before, as it is for
  // a right-click or a long press.
  let lastPressTime = -Infinity;
  container.addEventListener('pointerdown', () => {
    lastPressTime = Date.now();
  }, { capture: true });
  map.on('contextmenu', ({ latlng }) => {
    if (Date.now() - lastPressTime > PRESS_MAX_AGE_MS) {
      return;
    }
    const { lat, lng } = latlng.wrap();
    onLongPress({ lat, lng });
  });
  // Leaflet doesn't fire click after the map is dragged, or for taps on
  // markers, popups or the zoom buttons.
  map.on('click', ({ latlng }) => {
    const { lat, lng } = latlng.wrap();
    onTap({ lat, lng });
  });
  const routeLayer = L.layerGroup().addTo(map);
  // The team's position goes in its own pane above the markers (600), so a
  // stop's marker never hides it.
  map.createPane('position').style.zIndex = '650';
  const positionLayer = L.layerGroup().addTo(map);
  return { map, routeLayer, positionLayer, refresh: () => map.invalidateSize() };
}

/**
 * Draws the route: a line through the start, the stops in order and the
 * finish, and a marker for each place, with skipped locations greyed out.
 * Anything drawn before is replaced.
 *
 * @param {RouteMap} routeMap The map.
 * @param {object} route What to draw.
 * @param {import('./planner.js').LatLng[]} route.path The start, the stops in order and the finish (if there is one), for the line.
 * @param {MapMarker[]} route.markers The places to mark.
 * @param {boolean} shouldFit Whether to zoom the map to fit the route (not counting skipped locations), as after planning.
 */
export function showRoute({ map, routeLayer }, { path, markers }, shouldFit) {
  const { L } = globalThis;
  routeLayer.clearLayers();
  if (path.length > 1) {
    // Leaflet sets the line's colour as an SVG attribute, which can't use the
    // theme's CSS variables, so the colour comes from a class instead.
    L.polyline(
      path.map(({ lat, lng }) => [lat, lng]),
      { className: 'stroke-accent', weight: 4, opacity: 0.8, interactive: false },
    ).addTo(routeLayer);
  }
  // Skipped locations go underneath, so they don't hide the route.
  const ordered = [...markers.filter(({ kind }) => kind === 'skipped'), ...markers.filter(({ kind }) => kind !== 'skipped')];
  for (const { kind, location, label, title, onMove } of ordered) {
    // Each marker can be tapped anywhere in a 44 px square, larger than the
    // circle that's drawn, so it's easy to hit without crowding the map.
    const target = document.createElement('span');
    target.className = 'flex size-full items-center justify-center';
    const icon = document.createElement('span');
    icon.className = `flex ${kind === 'skipped' ? 'size-5' : 'size-8'} items-center justify-center rounded-full text-xs font-bold shadow ring-2 ring-surface ${MARKER_CLASSES[kind]}`;
    icon.textContent = label;
    target.append(icon);
    const marker = L.marker([location.lat, location.lng], {
      icon: L.divIcon({ html: target, className: '', iconSize: [44, 44] }),
      title,
      alt: title,
      keyboard: true,
      // New locations go on top, so a pin just dropped near a stop can
      // still be seen and tapped.
      zIndexOffset: { skipped: -1000, new: 1000 }[kind] ?? 0,
    });
    const popup = document.createElement('div');
    popup.className = 'flex flex-col items-start gap-2 text-sm';
    const description = document.createElement('p');
    description.className = '!m-0';
    description.textContent = title;
    popup.append(description);
    if (onMove) {
      // Moving takes a button and then a tap, rather than dragging the
      // marker, so panning or zooming on a phone can't move it by accident.
      const move = document.createElement('button');
      move.type = 'button';
      move.className = 'min-h-11 rounded-md bg-accent px-4 py-2 font-semibold text-white hover:bg-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-line';
      move.textContent = 'Move';
      move.setAttribute('aria-label', `Move ${location.label}`);
      move.addEventListener('click', () => {
        map.closePopup();
        onMove();
      });
      popup.append(move);
    }
    marker.bindPopup(popup).addTo(routeLayer);
  }
  // Fit the route itself, so far-off skipped locations (or new ones) don't
  // zoom the map out so far that the stops overlap. With too little route
  // to fit, use the plan's other places, and only fit new locations when
  // there's nothing else, such as before the first plan.
  const onRoute = markers.filter(({ kind }) => kind !== 'skipped' && kind !== 'new');
  const planned = markers.filter(({ kind }) => kind !== 'new');
  const fitted = onRoute.length > 1 ? onRoute : planned.length > 0 ? planned : markers;
  if (shouldFit && fitted.length > 0) {
    map.fitBounds(
      fitted.map(({ location }) => [location.lat, location.lng]),
      { padding: [24, 24], maxZoom: 16 },
    );
  }
}

/**
 * The team's position from the browser.
 *
 * @typedef {object} Position
 * @property {number} lat Latitude.
 * @property {number} lng Longitude.
 * @property {number} accuracy How far off the position might be, in metres.
 * @property {number} time When the position was found, in milliseconds since the Unix epoch.
 */

/**
 * Shows the team's position as a dot, with a circle showing how accurate it
 * is. Anything drawn before is replaced.
 *
 * @param {RouteMap} routeMap The map.
 * @param {Position | null} position The position, or `null` to remove it.
 */
export function showPosition({ positionLayer }, position) {
  const { L } = globalThis;
  positionLayer.clearLayers();
  if (!position) {
    return;
  }
  const centre = [position.lat, position.lng];
  const options = { pane: 'position', interactive: false };
  L.circle(centre, { ...options, radius: position.accuracy, className: 'fill-position stroke-position', weight: 1, fillOpacity: 0.15 }).addTo(positionLayer);
  L.circleMarker(centre, { ...options, radius: 7, className: 'fill-position stroke-surface', weight: 3, fillOpacity: 1 }).addTo(positionLayer);
}
