import { isLatLng, newLocationId } from './locations.js';
import { searchKey } from './search.js';
import { SCHEMA_VERSION, cleanState, isObject } from './storage.js';

/**
 * A shared list, as it's put in a link: the location list and the event's
 * details, as saved, with the search results for their texts. It never
 * carries the ticks, the plan or the team's own settings.
 *
 * It's in the same shape as the saved state, so it has the same schema
 * version and is checked in the same way when it's opened (see
 * {@link readShareFragment}). Fields added to a row or to the event later
 * are shared without changing this module.
 *
 * @typedef {object} SharedList
 * @property {number} version The schema version it was shared with.
 * @property {Record<string, unknown>} event The event's details, as saved.
 * @property {Record<string, unknown>[]} setupLocations The rows, as saved, without their ids and ticks.
 * @property {Record<string, import('./search.js').SearchResult>} searchResults Saved search results by the text they're for, trimmed, rather than by {@link searchKey}, since the text compresses well next to the rows.
 */

/**
 * What opening a shared list changes in the saved state: the event's
 * details, the rows, each with a new id and no tick, and the search results
 * to add to the phone's own, by {@link searchKey}.
 *
 * @typedef {Pick<import('./storage.js').AppState, 'event' | 'setupLocations' | 'searchResults'>} SharedState
 */

/**
 * The result of reading a link's shared list.
 *
 * - `none`: the link has no shared list.
 * - `read`: the shared list, checked as saved state is.
 * - `newer`: the list has something this version of the app can't read,
 *   such as a field added by a newer version, so none of it is read.
 * - `damaged`: the link is damaged or cut short.
 * - `unsupported`: the browser can't decompress the list, so it needs updating.
 *
 * @typedef {{ status: 'none' | 'newer' | 'damaged' | 'unsupported' } | { status: 'read', shared: SharedState }} SharedListResult
 */

/** What a link's fragment starts with when it has a shared list, before the list itself. */
export const SHARE_PREFIX = '#list=';

/**
 * The first schema version lists were shared with. A list shared with an
 * earlier version than the current one is moved to the current version as
 * saved state is, by {@link cleanState}.
 */
const FIRST_SHARED_VERSION = 2;

/** The longest shared list read from a link once decompressed, so a link made to decompress to something huge can't use up the phone's memory. */
const MAX_SHARED_LIST_BYTES = 1_000_000;

/**
 * Whether the browser can compress and decompress shared lists, which needs
 * `CompressionStream` with deflate-raw (Safari 16.4, Firefox 113, Chrome 103).
 *
 * @returns {boolean} Whether it can.
 */
export function canCompress() {
  try {
    new CompressionStream('deflate-raw');
    new DecompressionStream('deflate-raw');
    return true;
  } catch {
    return false;
  }
}

/**
 * Compresses or decompresses bytes with deflate, without a header.
 *
 * @param {Uint8Array} bytes The bytes.
 * @param {CompressionStream | DecompressionStream} stream The stream to pass them through.
 * @param {number} [maxBytes] The most bytes to read out, or `Infinity`.
 * @returns {Promise<Uint8Array>} The bytes that came out.
 */
async function transform(bytes, stream, maxBytes = Infinity) {
  const writer = stream.writable.getWriter();
  // Errors from writing are seen by the reader too, so they're ignored here.
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});
  const chunks = [];
  let length = 0;
  for await (const chunk of stream.readable) {
    length += chunk.length;
    if (length > maxBytes) {
      throw new RangeError('Too long');
    }
    chunks.push(chunk);
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

/**
 * Encodes bytes as base64url without padding, which can go in a URL as it is.
 *
 * @param {Uint8Array} bytes The bytes.
 * @returns {string} The base64url text.
 */
function toBase64Url(bytes) {
  let binary = '';
  // In chunks, since spreading a long array into one call can overflow the stack.
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/**
 * Decodes base64url, with or without padding.
 *
 * @param {string} text The base64url text.
 * @returns {Uint8Array} The bytes.
 * @throws {Error} If the text isn't base64url.
 */
function fromBase64Url(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) {
    throw new SyntaxError('Not base64url');
  }
  const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/**
 * Makes the shared list for the saved state: the event's details and the
 * rows, as saved, without each row's id (the receiving phone gives each
 * row a new one) or tick, and the saved search results for the Start's,
 * the Finish's and the rows' texts, so the receiving phone needn't look
 * them up. A pinned row's search result isn't shared, since its pin is
 * used instead. The team's own settings, the plan and the chosen tab
 * aren't shared.
 *
 * @param {Pick<import('./storage.js').AppState, 'event' | 'setupLocations' | 'searchResults'>} state The saved state.
 * @returns {SharedList} The shared list.
 */
export function sharedListOf({ event, setupLocations, searchResults }) {
  const rows = setupLocations.map(({ id, isVisited, ...row }) => row);
  /** @type {SharedList['searchResults']} */
  const sharedSearchResults = {};
  for (const text of [event.startText, event.finishText, ...rows.filter((row) => !row.pin).map((row) => row.text)]) {
    const query = text.trim();
    const searchResult = searchResults[searchKey(query)];
    if (query !== '' && searchResult) {
      sharedSearchResults[query] = searchResult;
    }
  }
  return { version: SCHEMA_VERSION, event: { ...event }, setupLocations: rows, searchResults: sharedSearchResults };
}

/** The last shared list made into a fragment, as JSON, and its fragment. */
let lastShared = { json: '', fragment: '' };

/**
 * Makes a link's fragment for the saved state's list: {@link SHARE_PREFIX}
 * then the shared list (see {@link sharedListOf}) as JSON, compressed with
 * deflate and encoded as base64url. Being in the fragment, it's never sent
 * to the server.
 *
 * @param {Pick<import('./storage.js').AppState, 'event' | 'setupLocations' | 'searchResults'>} state The saved state.
 * @returns {Promise<string>} The fragment, starting with `#`.
 * @throws {Error} If the browser can't compress it (see {@link canCompress}).
 * @example
 * `${location.origin}${location.pathname}${await shareFragment(state)}`; // 'https://…/#list=q1ZKy0…'
 */
export async function shareFragment(state) {
  const json = JSON.stringify(sharedListOf(state));
  if (json !== lastShared.json) {
    const fragment = `${SHARE_PREFIX}${toBase64Url(await transform(new TextEncoder().encode(json), new CompressionStream('deflate-raw')))}`;
    lastShared = { json, fragment };
  }
  return lastShared.fragment;
}

/**
 * Gets the fragment for the saved state's list straight away, if it's
 * already been made by {@link shareFragment} and the list hasn't changed
 * since. Sharing and copying need to start straight from a tap, which
 * waiting for compression can be too late for, so it's made ahead.
 *
 * @param {Pick<import('./storage.js').AppState, 'event' | 'setupLocations' | 'searchResults'>} state The saved state.
 * @returns {string | null} The fragment, or `null` if it hasn't been made yet.
 */
export function preparedShareFragment(state) {
  return lastShared.json !== '' && JSON.stringify(sharedListOf(state)) === lastShared.json ? lastShared.fragment : null;
}

/**
 * Whether two values from JSON are the same, comparing objects and arrays
 * by their contents.
 *
 * @param {unknown} a One value.
 * @param {unknown} b The other.
 * @returns {boolean} Whether they're the same.
 */
function isSame(a, b) {
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return a === b;
  }
  if (Array.isArray(a) !== Array.isArray(b) || Object.keys(a).length !== Object.keys(b).length) {
    return false;
  }
  return Object.keys(a).every((key) => Object.hasOwn(b, key) && isSame(a[key], b[key]));
}

/**
 * Checks a saved search result from a shared list, so one with the wrong
 * shape or out-of-range coordinates isn't added to the phone's own.
 *
 * @param {unknown} searchResult The search result.
 * @returns {import('./search.js').SearchResult | null} The search result, or `null` if it can't be used.
 */
function cleanSearchResult(searchResult) {
  if (!isObject(searchResult)) {
    return null;
  }
  const { isFound, lat, lng, name, error } = searchResult;
  if (isFound === true && isLatLng(searchResult) && typeof name === 'string') {
    return { isFound: true, lat, lng, name };
  }
  // Temporary failures aren't saved, so they're never shared.
  if (isFound === false && typeof error === 'string' && searchResult.isTemporary === false) {
    return { isFound: false, error, isTemporary: false };
  }
  return null;
}

/**
 * Checks a shared list as saved state is checked (see {@link cleanState}),
 * giving each row a new id and no tick. If checking would change or drop
 * anything in a row or the event, such as a field this version doesn't
 * know or a value it doesn't allow, the list is from a newer version (or
 * damaged), so none of it is used rather than part of it. Search results
 * are only kept for the shared texts, and any with the wrong shape are left
 * out, so their text is looked up again.
 *
 * @param {SharedList} sharedList The shared list.
 * @returns {SharedState | null} What opening it changes, or `null` if it can't all be read.
 */
function sharedStateOf(sharedList) {
  const rows = sharedList.setupLocations.map((row) => {
    if (!isObject(row)) {
      return { row, id: null };
    }
    const { id, isVisited, ...shared } = row;
    return { row: shared, id: newLocationId() };
  });
  const { event, setupLocations } = cleanState({
    version: sharedList.version,
    event: sharedList.event,
    setupLocations: rows.map(({ row, id }) => (id === null ? row : { ...row, id })),
  });
  const cleanedRows = new Map(setupLocations.map((setupLocation) => [setupLocation.id, setupLocation]));
  const isReadInFull =
    setupLocations.length === rows.length &&
    Object.entries(sharedList.event).every(([key, value]) => Object.hasOwn(event, key) && isSame(event[key], value)) &&
    rows.every(({ row, id }) => cleanedRows.has(id) && isSame({ ...row, id }, cleanedRows.get(id)));
  if (!isReadInFull) {
    return null;
  }
  /** @type {import('./search.js').SearchResults} */
  const searchResults = {};
  for (const text of [event.startText, event.finishText, ...setupLocations.filter((row) => !row.pin).map((row) => row.text)]) {
    const query = text.trim();
    const searchResult = Object.hasOwn(sharedList.searchResults, query) ? cleanSearchResult(sharedList.searchResults[query]) : null;
    if (query !== '' && searchResult) {
      searchResults[searchKey(query)] = searchResult;
    }
  }
  return { event, setupLocations, searchResults };
}

/**
 * Reads the shared list from a link's fragment, checked as saved state is.
 * A list with anything this version of the app can't read, such as one
 * shared by a newer version, isn't read at all, rather than read in part.
 *
 * @param {string} fragment The link's fragment, such as `location.hash`, starting with `#` unless it's empty.
 * @returns {Promise<SharedListResult>} What opening the shared list changes, or why it can't be opened.
 */
export async function readShareFragment(fragment) {
  if (!fragment.startsWith(SHARE_PREFIX)) {
    return { status: 'none' };
  }
  if (!canCompress()) {
    return { status: 'unsupported' };
  }
  let sharedList;
  try {
    const bytes = await transform(fromBase64Url(fragment.slice(SHARE_PREFIX.length)), new DecompressionStream('deflate-raw'), MAX_SHARED_LIST_BYTES);
    sharedList = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return { status: 'damaged' };
  }
  if (!isObject(sharedList) || !Number.isInteger(sharedList.version) || sharedList.version < FIRST_SHARED_VERSION) {
    return { status: 'damaged' };
  }
  if (sharedList.version > SCHEMA_VERSION) {
    return { status: 'newer' };
  }
  if (!isObject(sharedList.event) || !Array.isArray(sharedList.setupLocations) || !isObject(sharedList.searchResults)) {
    return { status: 'damaged' };
  }
  const shared = sharedStateOf(sharedList);
  return shared ? { status: 'read', shared } : { status: 'newer' };
}
