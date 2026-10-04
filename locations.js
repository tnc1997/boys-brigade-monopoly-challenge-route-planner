import { searchKey } from './search.js';

/**
 * A location the planner can visit.
 *
 * @typedef {object} Location
 * @property {number} lat Latitude, from -90 to 90.
 * @property {number} lng Longitude, from -180 to 180.
 * @property {string} label What to call the location: the row's text, or "Location N" for a pinned row without any.
 * @property {string} key A stable key for the location, for remembering which selfies are done. For a row of the location list, it's the row's id, so moving the location doesn't change which location it is.
 * @property {string} [matchedName] For a location found by searching, the name of the place that was found, so the team can check it.
 */

/**
 * A row of the location list, as saved. Its text is both what's searched
 * for and the location's name.
 *
 * @typedef {object} LocationRecord
 * @property {string} id A stable id for the row, which ticked-off selfies and plans refer to.
 * @property {string} text The row's text, as typed.
 * @property {import('./planner.js').LatLng | null} pin Where the row was pinned on the map, or `null` if it isn't pinned. A pinned row isn't searched for.
 */

/**
 * Where a row (or the Start or Finish field) is, as far as is known without
 * searching.
 *
 * - `empty`: there's no text and no pin, so it's ignored.
 * - `pinned`: it was pinned on the map.
 * - `coordinates`: its text has coordinates, which are used directly.
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

/** Coordinates as `lat,lng` in decimal degrees, with or without a space after the comma. */
const COORDINATES = /(?<![\d.])(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)(?![\d.])/g;

/** Punctuation that separates the name from coordinates, removed from the ends of the name. */
const SEPARATORS = /^[\s,;|–—-]+|[\s,;|–—-]+$/g;

/**
 * Makes the key a position is remembered by, from its coordinates to 6
 * decimal places, so the same place written differently gets the same key.
 *
 * @param {number} lat Latitude.
 * @param {number} lng Longitude.
 * @returns {string} The key, like `51.451740,-2.603400`.
 * @example
 * locationKey(51.45174, -2.6034); // '51.451740,-2.603400'
 */
export function locationKey(lat, lng) {
  // Round first, so a value like -0.0000001 gives 0.000000 rather than
  // -0.000000.
  const format = (value) => Number(value.toFixed(6)).toFixed(6);
  return `${format(lat)},${format(lng)}`;
}

/**
 * Makes a new id for a row of the location list.
 *
 * @returns {string} The id.
 */
export function newLocationId() {
  // randomUUID is only available in secure contexts, such as https and localhost.
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Works out where a row of text is, using its search result if it has one.
 * Text with one set of coordinates (like `51.4545,-2.5879`) uses them
 * directly, with any other text as the name. Any other text is searched for
 * as it is, and is also the name.
 *
 * @param {string} text The text, as typed.
 * @param {string} key The location's key.
 * @param {import('./search.js').SearchResults} searchResults Search results by {@link searchKey}.
 * @returns {Resolved} Where it is.
 * @example
 * resolveText('Old Kent Road 51.4545,-2.5879', 'a', {});
 * // { status: 'coordinates', location: { lat: 51.4545, lng: -2.5879, label: 'Old Kent Road', key: 'a' } }
 */
export function resolveText(text, key, searchResults) {
  const label = text.trim().replace(/\s+/g, ' ');
  if (label === '') {
    return { status: 'empty' };
  }

  const coordinates = [...label.matchAll(COORDINATES)];
  if (coordinates.length === 1) {
    const [match, latText, lngText] = coordinates[0];
    const lat = Number(latText);
    const lng = Number(lngText);
    if (lat < -90 || lat > 90) {
      return { status: 'notFound', label, error: `The latitude ${latText} must be between -90 and 90. Check the coordinates are in lat,lng order.` };
    }
    if (lng < -180 || lng > 180) {
      return { status: 'notFound', label, error: `The longitude ${lngText} must be between -180 and 180.` };
    }
    const name = label.replace(match, ' ').replace(/\s+/g, ' ').replace(SEPARATORS, '');
    return { status: 'coordinates', location: { lat, lng, label: name || `${latText}, ${lngText}`, key } };
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
    const label = record.text.trim().replace(/\s+/g, ' ') || `Location ${number}`;
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
 * Cleans up saved rows of the location list, dropping anything that isn't a
 * row and rows with no text and no pin, so the app can rely on their shape.
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
    const pin = isCoordinate(record.pin?.lat, 90) && isCoordinate(record.pin?.lng, 180) ? { lat: record.pin.lat, lng: record.pin.lng } : null;
    return record.text.trim() === '' && !pin ? [] : [{ id: record.id, text: record.text, pin }];
  });
}
