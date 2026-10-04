import { searchKey } from './search.js';

/**
 * A location the planner can visit.
 *
 * @typedef {object} Location
 * @property {number} lat Latitude, from -90 to 90.
 * @property {number} lng Longitude, from -180 to 180.
 * @property {string} label What to call the location: the row's text, or "Location N" for a pinned row without any.
 * @property {string} key A stable key for the location, a v4 UUID. For a row of the location list, it's the row's id, so moving the location doesn't change which location it is. For the start and finish, it's {@link START_KEY} or {@link FINISH_KEY}.
 * @property {string} [matchedName] For a location found by searching, the name of the place that was found, so the team can check it.
 */

/**
 * A row of the location list, as saved. Its text is both what's searched
 * for and the location's name.
 *
 * Optional fields are left out rather than saved with their default or
 * `null`, so a missing field means its default. Adding one doesn't change
 * the schema version: add it here, and check it in {@link cleanRecords}.
 *
 * @typedef {object} LocationRecord
 * @property {string} id A stable id for the row, a v4 UUID, which ticked-off selfies and plans refer to.
 * @property {string} text The row's text, as typed.
 * @property {import('./planner.js').LatLng} [pin] Where the row was pinned on the map, if it was. A pinned row isn't searched for.
 * @property {true} [isVisited] Whether the location has been visited, with its selfie taken.
 * @property {true} [isMustVisit] Whether the route must include the location, while it's still to visit.
 * @property {number} [points] What the location is worth, a whole number of 0 or more, if it isn't worth the event's Points per location.
 */

/**
 * Where a row (or the Start or Finish field) is, as far as is known without
 * searching.
 *
 * - `empty`: there's no text and no pin, so it's ignored.
 * - `pinned`: it was pinned on the map.
 * - `coordinates`: its text is only coordinates, which are used directly.
 * - `found`: its text was looked up and found.
 * - `notFound`: its text was looked up and not found, or its coordinates are out of range.
 * - `unknown`: its text hasn't been looked up yet.
 *
 * @typedef {{ status: 'empty' }
 *   | { status: 'pinned' | 'coordinates' | 'found', location: Location }
 *   | { status: 'notFound', label: string, error: string }
 *   | { status: 'unknown', label: string, query: string }} Resolved
 */

/**
 * A row of the location list and where it is.
 *
 * @typedef {object} ResolvedRecord
 * @property {LocationRecord} record The row.
 * @property {number} number The row's position in the list, starting at 1.
 * @property {Resolved} resolved Where it is.
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
 * Works out where a row of text is, using its search result if it has one.
 * Text that's only coordinates (like `51.4545,-2.5879`) uses them directly.
 * Any other text is searched for as it is, and is also the name.
 *
 * @param {string} text The text, as typed.
 * @param {string} key The location's key.
 * @param {import('./search.js').SearchResults} searchResults Search results by {@link searchKey}.
 * @param {object} [options] How to name a location that's only coordinates.
 * @param {string} [options.coordinatesLabel] The name for a location that's only coordinates, like "Start". Defaults to the text.
 * @returns {Resolved} Where it is.
 * @example
 * resolveText('51.4556,-2.5894', START_KEY, {}, { coordinatesLabel: 'Start' });
 * // { status: 'coordinates', location: { lat: 51.4556, lng: -2.5894, label: 'Start', key: START_KEY } }
 */
export function resolveText(text, key, searchResults, { coordinatesLabel } = {}) {
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
    return { status: 'coordinates', location: { lat, lng, label: coordinatesLabel ?? label, key } };
  }

  const result = searchResults[searchKey(label)];
  if (!result) {
    return { status: 'unknown', label, query: label };
  }
  if (!result.isFound) {
    return { status: 'notFound', label, error: result.error };
  }
  return { status: 'found', location: { lat: result.lat, lng: result.lng, label, key, matchedName: result.name } };
}

/**
 * Works out where a row of the location list is. A pinned row is where it
 * was pinned, whatever its text, and is called "Location N" if it has no
 * text. Otherwise, the row's text is used as in {@link resolveText}.
 *
 * @param {LocationRecord} record The row.
 * @param {number} number The row's position in the list, starting at 1.
 * @param {import('./search.js').SearchResults} searchResults Search results by {@link searchKey}.
 * @returns {Resolved} Where it is.
 */
export function resolveRecord(record, number, searchResults) {
  if (record.pin) {
    const label = record.text.trim() || `Location ${number}`;
    return { status: 'pinned', location: { lat: record.pin.lat, lng: record.pin.lng, label, key: record.id } };
  }
  return resolveText(record.text, record.id, searchResults);
}

/**
 * Works out where each row of the location list is.
 *
 * @param {LocationRecord[]} records The rows, in order.
 * @param {import('./search.js').SearchResults} searchResults Search results by {@link searchKey}.
 * @returns {ResolvedRecord[]} Each row with its position in the list and where it is, in order.
 */
export function resolveRecords(records, searchResults) {
  return records.map((record, index) => ({ record, number: index + 1, resolved: resolveRecord(record, index + 1, searchResults) }));
}

/**
 * Gets the locations that can be planned: rows that are pinned, have
 * coordinates or were found.
 *
 * @param {ResolvedRecord[]} rows The rows, from {@link resolveRecords}.
 * @returns {Location[]} Their locations, in order.
 */
export function usableLocations(rows) {
  return rows.flatMap(({ resolved }) => ('location' in resolved ? [resolved.location] : []));
}

/**
 * Whether a value can be a number of points: a whole number of 0 or more.
 *
 * @param {unknown} value The value.
 * @returns {value is number} Whether it can be.
 */
export function isPoints(value) {
  return Number.isInteger(value) && value >= 0;
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
 * parsePoints('2.5'); // { isValid: false, error: 'Enter a whole number of points, 0 or more, or leave it blank.' }
 */
export function parsePoints(text) {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { isValid: true, points: null };
  }
  const points = /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
  return isPoints(points) ? { isValid: true, points } : { isValid: false, error: 'Enter a whole number of points, 0 or more, or leave it blank.' };
}

/**
 * Works out what a row of the location list is worth.
 *
 * @param {LocationRecord | undefined} record The row, or `undefined` if it's been removed.
 * @param {number} pointsPerLocation What a location is worth unless its row says otherwise.
 * @returns {number} Its points.
 */
export function locationPoints(record, pointsPerLocation) {
  return record?.points ?? pointsPerLocation;
}

/**
 * Whether scores vary, so points are worth showing: when any row has its
 * own points. Until then, every location is worth the same, so the route
 * looks as it does without points.
 *
 * @param {LocationRecord[]} records The rows.
 * @returns {boolean} Whether any row has its own points.
 */
export function isScored(records) {
  return records.some(({ points }) => points !== undefined);
}

/**
 * Gets the keys of the rows that have been visited, whose selfie has been taken.
 *
 * @param {LocationRecord[]} records The rows.
 * @returns {string[]} Their ids, which are their locations' keys.
 */
export function visitedKeys(records) {
  return records.filter(({ isVisited }) => isVisited).map(({ id }) => id);
}

/**
 * Cleans up saved rows of the location list, dropping anything that isn't a
 * row and rows with no text and no pin, so the app can rely on their shape.
 * Optional fields are only kept when they're valid, so an invalid one
 * falls back to its default, and unknown fields are dropped.
 *
 * @param {unknown} records The rows as saved.
 * @returns {LocationRecord[]} The rows.
 */
export function cleanRecords(records) {
  if (!Array.isArray(records)) {
    return [];
  }
  const isCoordinate = (value, limit) => typeof value === 'number' && Math.abs(value) <= limit;
  const ids = new Set();
  return records.flatMap((record) => {
    if (typeof record?.id !== 'string' || typeof record.text !== 'string' || ids.has(record.id)) {
      return [];
    }
    ids.add(record.id);
    /** @type {LocationRecord} */
    const cleaned = { id: record.id, text: record.text };
    if (isCoordinate(record.pin?.lat, 90) && isCoordinate(record.pin?.lng, 180)) {
      cleaned.pin = { lat: record.pin.lat, lng: record.pin.lng };
    }
    if (record.isVisited === true) {
      cleaned.isVisited = true;
    }
    if (record.isMustVisit === true) {
      cleaned.isMustVisit = true;
    }
    if (isPoints(record.points)) {
      cleaned.points = record.points;
    }
    return cleaned.text.trim() === '' && !cleaned.pin ? [] : [cleaned];
  });
}
