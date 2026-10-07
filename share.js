import { newLocationId } from './locations.js';
import { searchKey } from './search.js';
import { SCHEMA_VERSION, loadState } from './storage.js';

/**
 * A shared list, as it's put in a link: the location list and the event's
 * details, as saved, with the search results for their texts. It never
 * carries the ticks, the plan or the team's own settings.
 *
 * It's in the same shape as the saved state, so it has the same schema
 * version and is checked in the same way when it's opened (see
 * {@link sharedState}). Fields added to a row or to the event later are
 * shared without changing this module.
 *
 * @typedef {object} SharedList
 * @property {number} version The schema version it was shared with.
 * @property {Record<string, unknown>} event The event's details, as saved.
 * @property {Record<string, unknown>[]} setupLocations The rows, as saved, without their ids and ticks.
 * @property {Record<string, import('./search.js').SearchResult>} searchResults Saved search results by the text they're for, trimmed, rather than by {@link searchKey}, since the text compresses well next to the rows.
 */

/**
 * The result of reading a link's shared list.
 *
 * - `none`: the link has no shared list.
 * - `read`: the shared list, still to be checked by {@link sharedState}.
 * - `newer`: the list was shared by a newer version of the app, so it can't be read.
 * - `damaged`: the link is damaged or cut short.
 *
 * @typedef {{ status: 'none' | 'newer' | 'damaged' } | { status: 'read', sharedList: SharedList }} SharedListResult
 */

/** What a link's fragment starts with when it has a shared list, before the list itself. */
export const SHARE_PREFIX = '#list=';

/**
 * The first schema version lists were shared with. A list shared with an
 * earlier version than the current one is moved to the current version as
 * saved state is, by {@link loadState}.
 */
const FIRST_SHARED_VERSION = 2;

/** The longest shared list read from a link once decompressed, so a link made to decompress to something huge can't use up the phone's memory. */
const MAX_SHARED_LIST_BYTES = 1_000_000;

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

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
 * row a new one) or tick, and the saved search results for the rows', the
 * Start's and the Finish's texts, so the receiving phone needn't look them
 * up. The team's own settings, the plan and the chosen tab aren't shared.
 *
 * @param {Pick<import('./storage.js').AppState, 'event' | 'setupLocations' | 'searchResults'>} state The saved state.
 * @returns {SharedList} The shared list.
 */
export function sharedListOf({ event, setupLocations, searchResults }) {
  const rows = setupLocations.map(({ id, isVisited, ...row }) => row);
  /** @type {SharedList['searchResults']} */
  const sharedSearchResults = {};
  for (const text of [event.startText, event.finishText, ...rows.map((row) => row.text)]) {
    const query = text.trim();
    const searchResult = searchResults[searchKey(query)];
    if (query !== '' && searchResult) {
      sharedSearchResults[query] = searchResult;
    }
  }
  return { version: SCHEMA_VERSION, event: { ...event }, setupLocations: rows, searchResults: sharedSearchResults };
}

/**
 * Makes a link's fragment for the saved state's list: {@link SHARE_PREFIX}
 * then the shared list (see {@link sharedListOf}) as JSON, compressed with
 * deflate and encoded as base64url. Being in the fragment, it's never sent
 * to the server.
 *
 * @param {Pick<import('./storage.js').AppState, 'event' | 'setupLocations' | 'searchResults'>} state The saved state.
 * @returns {Promise<string>} The fragment, starting with `#`.
 * @example
 * `${location.origin}${location.pathname}${await shareFragment(state)}`; // 'https://…/#list=q1ZKy0…'
 */
export async function shareFragment(state) {
  const json = new TextEncoder().encode(JSON.stringify(sharedListOf(state)));
  return `${SHARE_PREFIX}${toBase64Url(await transform(json, new CompressionStream('deflate-raw')))}`;
}

/**
 * Reads the shared list from a link's fragment. A list shared by a newer
 * version of the app isn't read at all, rather than read in part.
 *
 * @param {string} fragment The link's fragment, such as `location.hash`, starting with `#` unless it's empty.
 * @returns {Promise<SharedListResult>} The shared list, or why there isn't one.
 */
export async function readShareFragment(fragment) {
  if (!fragment.startsWith(SHARE_PREFIX)) {
    return { status: 'none' };
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
  return { status: 'read', sharedList };
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
  const isCoordinate = (value, limit) => typeof value === 'number' && Math.abs(value) <= limit;
  if (isFound === true && isCoordinate(lat, 90) && isCoordinate(lng, 180) && typeof name === 'string') {
    return { isFound: true, lat, lng, name };
  }
  // Temporary failures aren't saved, so they're never shared.
  if (isFound === false && typeof error === 'string' && searchResult.isTemporary === false) {
    return { isFound: false, error, isTemporary: false };
  }
  return null;
}

/**
 * Gets what opening a shared list changes in the saved state. It's checked
 * as saved state is when it's loaded, so it can be relied on in the same way:
 * fields with the wrong type fall back to their defaults, invalid optional
 * row fields and unknown fields are dropped, and so are rows with no text
 * and no pin. Each row gets a new id and no tick. Only search results for
 * the shared texts are kept.
 *
 * @param {SharedList} sharedList The shared list, from {@link readShareFragment}.
 * @returns {Pick<import('./storage.js').AppState, 'event' | 'setupLocations' | 'searchResults'>} The event's details, the rows and the search results to add to the phone's own, by {@link searchKey}.
 */
export function sharedState(sharedList) {
  const setupLocations = sharedList.setupLocations.map((row) => {
    if (!isObject(row)) {
      return row;
    }
    const { id, isVisited, ...shared } = row;
    return { ...shared, id: newLocationId() };
  });
  // Load it as saved state, so it's checked, and moved from an earlier
  // version, in exactly the same way.
  const saved = JSON.stringify({ version: sharedList.version, event: sharedList.event, setupLocations });
  const { event, setupLocations: cleaned } = loadState({ getItem: () => saved, setItem: () => {}, removeItem: () => {} });
  /** @type {import('./search.js').SearchResults} */
  const searchResults = {};
  for (const text of [event.startText, event.finishText, ...cleaned.map((row) => row.text)]) {
    const query = text.trim();
    const searchResult = Object.hasOwn(sharedList.searchResults, query) ? cleanSearchResult(sharedList.searchResults[query]) : null;
    if (query !== '' && searchResult) {
      searchResults[searchKey(query)] = searchResult;
    }
  }
  return { event, setupLocations: cleaned, searchResults };
}
