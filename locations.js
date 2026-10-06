import { searchKey } from './search.js';

/**
 * A location the route can use, with coordinates: a setup location that's
 * been pinned, has coordinates or was found, or the route's start or finish.
 *
 * A saved plan keeps the route locations it was made from, so as well as
 * where each one is, a route location carries what the plan's times depend
 * on, such as its At. What doesn't change the times, such as points and
 * Must visit, is read from the location list instead.
 *
 * @typedef {object} RouteLocation
 * @property {number} lat Latitude, from -90 to 90.
 * @property {number} lng Longitude, from -180 to 180.
 * @property {string} label What to call the location: the row's text, or "Location N" for a pinned row without any.
 * @property {string} key A stable key for the location, a v4 UUID. For a setup location, it's its id, so moving the location doesn't change which location it is. For the start and finish, it's {@link START_KEY} or {@link FINISH_KEY}.
 * @property {string} [matchedName] For a location found by searching, the name of the place that was found, so the team can check it.
 * @property {string} [at] For a setup location with a fixed time, its At, as `HH:MM` local time on the day of the challenge.
 */

/**
 * A location the team entered in Setup: a row of the location list, as
 * saved. Its text is both what's searched for and the location's name.
 *
 * Optional fields are left out rather than saved with their default or
 * `null`, so a missing field means its default. Adding one doesn't change
 * the schema version: add it here, and check it in {@link cleanSetupLocations}.
 *
 * @typedef {object} SetupLocation
 * @property {string} id A stable id for the row, a v4 UUID, which ticked-off selfies and plans refer to.
 * @property {string} text The row's text, as typed.
 * @property {import('./planner.js').LatLng} [pin] Where the row was pinned on the map, if it was. A pinned row isn't searched for.
 * @property {true} [isVisited] Whether the location has been visited, with its selfie taken.
 * @property {true} [isMustVisit] Whether the route must include the location, while it's still to visit.
 * @property {number} [points] What the location is worth, a whole number from 0 to 9999, if it isn't worth the event's Points per location.
 * @property {string} [at] The time the team must be at the location, as `HH:MM` local time on the day of the challenge, if it has a fixed time. The selfie time comes after it.
 */

/**
 * The result of getting a route location for a setup location (or the Start
 * or Finish field): the route location, or why there isn't one yet, as far
 * as is known without searching.
 *
 * - `empty`: there's no text and no pin, so it's ignored.
 * - `pinned`: it was pinned on the map.
 * - `coordinates`: its text is only coordinates, which are used directly.
 * - `found`: its text was looked up and found.
 * - `notFound`: its text was looked up and not found, or its coordinates are out of range.
 * - `unknown`: its text hasn't been looked up yet.
 *
 * @typedef {{ status: 'empty' }
 *   | { status: 'pinned' | 'coordinates' | 'found', routeLocation: RouteLocation }
 *   | { status: 'notFound', label: string, error: string }
 *   | { status: 'unknown', label: string, query: string }} RouteLocationResult
 */

/** Text that's only coordinates, as `lat,lng` in decimal degrees, with or without a space after the comma. */
const COORDINATES = /^(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/;

/**
 * The key of the route's start, whether that's the Start field or the
 * team's position. Like every location's key, it's a v4 UUID, but a fixed
 * one, which can't clash with a row's random id.
 */
export const START_KEY = 'ae9af498-cc10-4b09-93c4-9a6d712f7fb7';

/** The key of the route's finish, a fixed v4 UUID like {@link START_KEY}. */
export const FINISH_KEY = '54fb4fd9-ae1a-45ec-907a-72c8ef4fc9d2';

/**
 * Makes a new id for a row of the location list: a random v4 UUID.
 *
 * @returns {string} The id, like `3b241101-e2bb-4255-8caf-4136c566a962`.
 */
export function newLocationId() {
  // randomUUID is only available in secure contexts, such as https and
  // localhost, so make one from random bytes elsewhere.
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  const bytes = globalThis.crypto?.getRandomValues?.(new Uint8Array(16)) ?? Uint8Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  // Mark it as version 4 (random), RFC 4122 variant.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Gets the route location for some text, using its search result if it
 * has one. Text that's only coordinates (like `51.4545,-2.5879`) uses them
 * directly. Any other text is searched for as it is, and is also the name.
 *
 * @param {string} text The text, as typed.
 * @param {string} key The location's key.
 * @param {import('./search.js').SearchResults} searchResults Search results by {@link searchKey}.
 * @param {object} [options] How to name a location that's only coordinates.
 * @param {string} [options.coordinatesLabel] The name for a location that's only coordinates, like "Start". Defaults to the text.
 * @returns {RouteLocationResult} The route location, or why there isn't one yet.
 * @example
 * routeLocationOfText('51.4556,-2.5894', START_KEY, {}, { coordinatesLabel: 'Start' });
 * // { status: 'coordinates', routeLocation: { lat: 51.4556, lng: -2.5894, label: 'Start', key: START_KEY } }
 */
export function routeLocationOfText(text, key, searchResults, { coordinatesLabel } = {}) {
  const label = text.trim();
  if (label === '') {
    return { status: 'empty' };
  }

  const coordinates = label.match(COORDINATES);
  if (coordinates) {
    const [, latText, lngText] = coordinates;
    const lat = Number(latText);
    const lng = Number(lngText);
    if (lat < -90 || lat > 90) {
      return { status: 'notFound', label, error: `The latitude ${latText} must be between -90 and 90. Check the coordinates are in lat,lng order.` };
    }
    if (lng < -180 || lng > 180) {
      return { status: 'notFound', label, error: `The longitude ${lngText} must be between -180 and 180.` };
    }
    return { status: 'coordinates', routeLocation: { lat, lng, label: coordinatesLabel ?? label, key } };
  }

  const searchResult = searchResults[searchKey(label)];
  if (!searchResult) {
    return { status: 'unknown', label, query: label };
  }
  if (!searchResult.isFound) {
    return { status: 'notFound', label, error: searchResult.error };
  }
  return { status: 'found', routeLocation: { lat: searchResult.lat, lng: searchResult.lng, label, key, matchedName: searchResult.name } };
}

/**
 * Gets the route location for a setup location. A pinned setup location is
 * where it was pinned, whatever its text, and is called "Location N" if it
 * has no text. Otherwise, its text is used as in {@link routeLocationOfText}.
 * Either way, the route location has the setup location's At, if it has one.
 *
 * @param {SetupLocation} setupLocation The setup location.
 * @param {number} number Its position in the location list, starting at 1.
 * @param {import('./search.js').SearchResults} searchResults Search results by {@link searchKey}.
 * @returns {RouteLocationResult} The route location, or why there isn't one yet.
 */
export function routeLocationOf(setupLocation, number, searchResults) {
  /** @type {RouteLocationResult} */
  let routeLocationResult;
  if (setupLocation.pin) {
    const label = setupLocation.text.trim() || `Location ${number}`;
    routeLocationResult = { status: 'pinned', routeLocation: { lat: setupLocation.pin.lat, lng: setupLocation.pin.lng, label, key: setupLocation.id } };
  } else {
    routeLocationResult = routeLocationOfText(setupLocation.text, setupLocation.id, searchResults);
  }
  if (setupLocation.at === undefined || !('routeLocation' in routeLocationResult)) {
    return routeLocationResult;
  }
  return { ...routeLocationResult, routeLocation: { ...routeLocationResult.routeLocation, at: setupLocation.at } };
}

/**
 * Gets the route location for each setup location.
 *
 * @param {SetupLocation[]} setupLocations The setup locations, in order.
 * @param {import('./search.js').SearchResults} searchResults Search results by {@link searchKey}.
 * @returns {RouteLocationResult[]} Each one's route location, or why there isn't one yet, in order.
 */
export function routeLocationsOf(setupLocations, searchResults) {
  return setupLocations.map((setupLocation, index) => routeLocationOf(setupLocation, index + 1, searchResults));
}

/**
 * Gets the route locations that can be planned: those of setup locations
 * that are pinned, have coordinates or were found.
 *
 * @param {SetupLocation[]} setupLocations The setup locations, in order.
 * @param {import('./search.js').SearchResults} searchResults Search results by {@link searchKey}.
 * @returns {RouteLocation[]} Their route locations, in order.
 */
export function usableRouteLocations(setupLocations, searchResults) {
  return routeLocationsOf(setupLocations, searchResults).flatMap((routeLocationResult) => ('routeLocation' in routeLocationResult ? [routeLocationResult.routeLocation] : []));
}

/** The most a location can be worth, so a slip can't make it worth something like 1e+23 points. */
export const MAX_POINTS = 9999;

/**
 * Whether a value can be a number of points: a whole number from 0 to
 * {@link MAX_POINTS}.
 *
 * @param {unknown} value The value.
 * @returns {value is number} Whether it can be.
 */
export function isPoints(value) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_POINTS;
}

/**
 * Reads a number of points typed into a field. Blank means the location is
 * worth the event's Points per location.
 *
 * @param {string} text The field's text.
 * @returns {{ isValid: true, points: number | null } | { isValid: false, error: string }} The points, or `null` for blank, or what's wrong.
 * @example
 * parsePoints(' 20 '); // { isValid: true, points: 20 }
 * parsePoints(''); // { isValid: true, points: null }
 * parsePoints('2.5'); // { isValid: false, error: 'Enter a whole number of points from 0 to 9999, or leave it blank.' }
 */
export function parsePoints(text) {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { isValid: true, points: null };
  }
  const points = /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
  return isPoints(points) ? { isValid: true, points } : { isValid: false, error: `Enter a whole number of points from 0 to ${MAX_POINTS}, or leave it blank.` };
}

/**
 * Works out what a setup location is worth.
 *
 * @param {SetupLocation | undefined} setupLocation The setup location, or `undefined` if it's been removed.
 * @param {number} pointsPerLocation What a location is worth unless its row says otherwise.
 * @returns {number} Its points.
 */
export function pointsOf(setupLocation, pointsPerLocation) {
  return setupLocation?.points ?? pointsPerLocation;
}

/**
 * Works out what every setup location is worth.
 *
 * @param {SetupLocation[]} setupLocations The setup locations.
 * @param {number} pointsPerLocation What a location is worth unless its row says otherwise.
 * @returns {Map<string, number>} Each one's points by its id.
 * @example
 * pointsById([{ id: 'a', text: 'A', points: 20 }, { id: 'b', text: 'B' }], 10); // Map { 'a' => 20, 'b' => 10 }
 */
export function pointsById(setupLocations, pointsPerLocation) {
  return new Map(setupLocations.map((setupLocation) => [setupLocation.id, pointsOf(setupLocation, pointsPerLocation)]));
}

/**
 * Whether any setup location has its own points, so points are worth
 * showing. Until then, every location is worth the same, so the route looks
 * as it does without points.
 *
 * @param {SetupLocation[]} setupLocations The setup locations.
 * @returns {boolean} Whether any of them has its own points.
 */
export function hasOwnPoints(setupLocations) {
  return setupLocations.some(({ points }) => points !== undefined);
}

/**
 * Whether a value is a time of day as `HH:MM`, as a time field gives it.
 *
 * @param {unknown} value The value.
 * @returns {value is string} Whether it is.
 */
export function isTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/**
 * Says what's wrong with a location's fixed time: the route must reach it
 * at least the safety margin before then, so it must be at least the
 * safety margin after the start time, and the selfie there must be done by
 * the safety margin before the deadline. Without a start time, the route
 * starts when it's planned, so only the deadline is checked. A start time
 * or deadline that isn't a time, ignoring spaces around it as planning
 * does, isn't checked either, nor are both when the deadline isn't after
 * the start time, since planning says what's wrong with them and no At
 * could fix it. Times are `HH:MM` on the same day.
 *
 * @param {string} at The location's fixed time, as `HH:MM`.
 * @param {Pick<import('./storage.js').EventDetails, 'startTime' | 'deadline'>} event The event's start time and deadline.
 * @param {Pick<import('./storage.js').Settings, 'safetyMarginSeconds' | 'dwellSeconds'>} settings The safety margin and selfie time.
 * @returns {string | null} What's wrong, or `null` if nothing is.
 * @example
 * const settings = { safetyMarginSeconds: 900, dwellSeconds: 180 };
 * atError('11:05', { startTime: '11:00', deadline: '16:00' }, settings); // 'At must be between 11:15 and 15:42, to allow for the safety margin and selfie time.'
 * atError('13:30', { startTime: '', deadline: '16:00' }, settings); // null
 */
export function atError(at, { startTime, deadline }, { safetyMarginSeconds, dwellSeconds }) {
  const minutesOf = (time) => (isTime(time.trim()) ? Number(time.trim().slice(0, 2)) * 60 + Number(time.trim().slice(3)) : null);
  const timeOf = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const start = minutesOf(startTime);
  const end = minutesOf(deadline);
  if (start !== null && end !== null && end <= start) {
    return null;
  }
  // At is in whole minutes, so round the earliest up and the latest down.
  const earliest = start === null ? null : start + Math.ceil(safetyMarginSeconds / 60);
  const latest = end === null ? null : end - Math.ceil((safetyMarginSeconds + dwellSeconds) / 60);
  if ((earliest ?? 0) > (latest ?? 24 * 60 - 1)) {
    return 'No At fits between the start time and the deadline, with the safety margin and selfie time.';
  }
  const minutes = minutesOf(at);
  if ((earliest === null || minutes >= earliest) && (latest === null || minutes <= latest)) {
    return null;
  }
  if (earliest === null) {
    return `At must be by ${timeOf(latest)}, to allow for the safety margin and selfie time.`;
  }
  if (latest === null) {
    return `At must be no earlier than ${timeOf(earliest)}, to allow for the safety margin.`;
  }
  return `At must be between ${timeOf(earliest)} and ${timeOf(latest)}, to allow for the safety margin and selfie time.`;
}

/**
 * Gets the keys of the setup locations that have been visited, whose selfie has been taken.
 *
 * @param {SetupLocation[]} setupLocations The setup locations.
 * @returns {string[]} Their ids, which are their route locations' keys.
 */
export function visitedKeys(setupLocations) {
  return setupLocations.filter(({ isVisited }) => isVisited).map(({ id }) => id);
}

/**
 * Cleans up saved setup locations, dropping anything that isn't one and
 * those with no text and no pin, so the app can rely on their shape.
 * Optional fields are only kept when they're valid, so an invalid one
 * falls back to its default, and unknown fields are dropped.
 *
 * @param {unknown} setupLocations The setup locations as saved.
 * @returns {SetupLocation[]} The setup locations.
 */
export function cleanSetupLocations(setupLocations) {
  if (!Array.isArray(setupLocations)) {
    return [];
  }
  const isCoordinate = (value, limit) => typeof value === 'number' && Math.abs(value) <= limit;
  const ids = new Set();
  return setupLocations.flatMap((setupLocation) => {
    if (typeof setupLocation?.id !== 'string' || typeof setupLocation.text !== 'string' || ids.has(setupLocation.id)) {
      return [];
    }
    ids.add(setupLocation.id);
    /** @type {SetupLocation} */
    const cleaned = { id: setupLocation.id, text: setupLocation.text };
    if (isCoordinate(setupLocation.pin?.lat, 90) && isCoordinate(setupLocation.pin?.lng, 180)) {
      cleaned.pin = { lat: setupLocation.pin.lat, lng: setupLocation.pin.lng };
    }
    if (setupLocation.isVisited === true) {
      cleaned.isVisited = true;
    }
    if (setupLocation.isMustVisit === true) {
      cleaned.isMustVisit = true;
    }
    if (isPoints(setupLocation.points)) {
      cleaned.points = setupLocation.points;
    }
    if (isTime(setupLocation.at)) {
      cleaned.at = setupLocation.at;
    }
    return cleaned.text.trim() === '' && !cleaned.pin ? [] : [cleaned];
  });
}
