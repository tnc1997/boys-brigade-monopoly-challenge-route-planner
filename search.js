/**
 * The result of looking up an address or place name.
 *
 * @typedef {{ isFound: true, lat: number, lng: number, name: string }
 *   | { isFound: false, error: string, isTemporary: boolean }} SearchResult
 * `isTemporary` is `true` when the lookup failed for a reason that may pass
 * (such as being offline), so the result shouldn't be saved.
 */

/**
 * Search results by {@link searchKey}.
 *
 * @typedef {Record<string, SearchResult>} SearchResults
 */

/**
 * OpenStreetMap's Nominatim search, which is free within its usage policy:
 * https://operations.osmfoundation.org/policies/nominatim/
 *
 * Keep to the policy when changing this module. It forbids searching as the
 * team types (auto-complete), so search only when they finish a location or
 * press a button. It allows at most 1 request per second for all users
 * together, and requires results to be cached, so save each result under
 * the query it was for and don't send that query again. Keep the
 * OpenStreetMap credit next to the location list, and send no personal data.
 * If asked to stop using the service, change this URL and redeploy.
 */
export const SEARCH_URL = 'https://nominatim.openstreetmap.org/search';

/**
 * The area searched, as Nominatim's `left,top,right,bottom`: Bristol and its
 * outskirts. Saved search results are only right for this area, so if it
 * changes, saved results should be cleared when they're loaded.
 */
export const BRISTOL_VIEWBOX = '-2.73,51.54,-2.45,51.39';

/** The shortest time between requests: Nominatim's limit is 1 request per second, so this leaves a generous buffer. */
export const REQUEST_INTERVAL_MS = 1500;

/**
 * Makes the key a search's result is saved under: the query exactly as
 * it's sent, without its ends' spaces, as base64. It isn't normalised any
 * further (such as ignoring case), so there's no rule to keep tuning, and
 * base64 means any text is a safe key, even "constructor" or "__proto__".
 *
 * @param {string} query The address or place name.
 * @returns {string} The key to save the result under.
 * @example
 * searchKey(' Queen Square '); // 'UXVlZW4gU3F1YXJl'
 */
export function searchKey(query) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(query.trim())));
}

/**
 * Looks up an address or place name in the Bristol area with OpenStreetMap.
 *
 * @param {string} query The address or place name.
 * @param {object} [options] Options for testing.
 * @param {typeof fetch} [options.fetch] The fetch function to use. Defaults to the global `fetch`.
 * @returns {Promise<SearchResult>} The best match, or why there isn't one.
 * @example
 * await searchPlace('Queen Square, Bristol');
 * // { isFound: true, lat: 51.45…, lng: -2.59…, name: 'Queen Square, …, Bristol, …' }
 */
export async function searchPlace(query, { fetch = globalThis.fetch } = {}) {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '1',
    countrycodes: 'gb',
    viewbox: BRISTOL_VIEWBOX,
    bounded: '1',
  });
  let response;
  try {
    response = await fetch(`${SEARCH_URL}?${params}`, { headers: { Accept: 'application/json' } });
  } catch {
    return {
      isFound: false,
      error: `Couldn't look up "${query}", which usually means there's no signal. Try again, or add the coordinates.`,
      isTemporary: true,
    };
  }
  if (!response.ok) {
    return {
      isFound: false,
      error: `Couldn't look up "${query}" because OpenStreetMap search is busy (error ${response.status}). Try again in a minute, or add the coordinates.`,
      isTemporary: true,
    };
  }

  let results;
  try {
    results = await response.json();
  } catch {
    return { isFound: false, error: `Couldn't read the search result for "${query}". Try again, or add the coordinates.`, isTemporary: true };
  }
  const [best] = Array.isArray(results) ? results : [];
  const lat = Number(best?.lat);
  const lng = Number(best?.lon);
  if (!best || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return {
      isFound: false,
      error: `No match for "${query}" in Bristol. Check the spelling, try a nearby street or landmark, or add the coordinates.`,
      isTemporary: false,
    };
  }
  return { isFound: true, lat, lng, name: String(best.display_name ?? query) };
}

/**
 * A queue of searches, sent one at a time.
 *
 * @typedef {object} SearchQueue
 * @property {(query: string) => Promise<SearchResult>} search Looks up an address or place name, after any searches already queued.
 */

/**
 * Creates a queue that looks up addresses and place names one at a time,
 * with at least {@link REQUEST_INTERVAL_MS} between requests, following
 * Nominatim's usage policy. It sends every search it's given, so don't give
 * it one that's already queued.
 *
 * @param {object} [options] Options for testing.
 * @param {typeof fetch} [options.fetch] The fetch function to use. Defaults to the global `fetch`.
 * @param {() => number} [options.now] Gets the current time in milliseconds. Defaults to `Date.now`.
 * @param {(ms: number) => Promise<void>} [options.sleep] Waits between requests. Defaults to a timer.
 * @returns {SearchQueue} The queue.
 * @example
 * const queue = createSearchQueue();
 * const result = await queue.search('Queen Square, Bristol');
 */
export function createSearchQueue({
  fetch = globalThis.fetch,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  let lastRequestTime = -Infinity;
  let tail = Promise.resolve();

  return {
    search(query) {
      const result = tail.then(async () => {
        const waitMs = lastRequestTime + REQUEST_INTERVAL_MS - now();
        if (waitMs > 0) {
          await sleep(waitMs);
        }
        lastRequestTime = now();
        return searchPlace(query, { fetch });
      });
      tail = result.catch(() => {});
      return result;
    },
  };
}
