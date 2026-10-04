import { cleanRecords } from './locations.js';
import { searchKey } from './search.js';
import { checkInFormUrl, defaultDwellSeconds } from './settings.js';

/**
 * The team's own settings for planning, which can be changed during the
 * challenge. Unlike the event's details, they aren't the same for every
 * team, so they aren't shared.
 *
 * @typedef {object} Settings
 * @property {number} speedKmh Walking speed of the whole group in km/h.
 * @property {number} detourFactor How much longer the walk along streets is than the straight line.
 * @property {number} dwellSeconds Time spent at each stop taking the selfie, in seconds.
 * @property {number} safetyMarginSeconds Spare time to keep before the deadline, in seconds.
 */

/**
 * The event's details, which are the same for every team, kept as typed so
 * they can be shown again. Event-wide rules, such as points, go here too.
 *
 * @typedef {object} EventDetails
 * @property {string} startText Where the route starts.
 * @property {string} finishText Where the route finishes, or an empty string if there's no physical finish.
 * @property {string} startTime When the route starts, as `HH:MM` local time, or an empty string to start when Plan route is pressed.
 * @property {string} deadline The time the team must have finished by, at the finish if there is one, as `HH:MM` local time.
 * @property {string} checkInFormUrl The organisers' online check-in form, as an http or https URL, or an empty string if there isn't one.
 */

/**
 * Everything the app saves between visits.
 *
 * @typedef {object} AppState
 * @property {number} version The schema version the state was saved with.
 * @property {EventDetails} event The event's details.
 * @property {Settings} settings The team's own settings for planning.
 * @property {import('./locations.js').LocationRecord[]} locations The location list, one row per location.
 * @property {'list' | 'map'} view Which tab of the Route section is showing.
 * @property {import('./search.js').SearchResults} searchResults Saved results of looking up addresses and place names, so each is only looked up once and re-planning works offline. Temporary failures aren't saved.
 * @property {import('./setup.js').SavedPlan | null} plan The current plan, or `null` if there isn't one yet.
 */

/**
 * A minimal subset of the Web Storage API, so tests can pass in a fake.
 *
 * @typedef {Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>} StateStorage
 */

/** The localStorage key the state is saved under. */
export const STORAGE_KEY = 'monopoly-challenge-route-planner';

/** Keys the state was saved under by earlier versions, which it's moved from when loading. */
export const LEGACY_STORAGE_KEYS = ['monopoly-challenge-planner'];

/**
 * The current schema version. Increase it when the shape of {@link AppState}
 * changes, and move state saved with the previous version in {@link loadState}.
 * Version 1 kept the location list as text, one location per line.
 */
export const SCHEMA_VERSION = 2;

/**
 * Creates the state for a new challenge.
 *
 * @returns {AppState} The default state, starting at Castle Park (as coordinates) with a 16:00 deadline.
 */
export function defaultState() {
  return {
    version: SCHEMA_VERSION,
    event: {
      // Castle Park, where the challenge started in 2026.
      startText: '51.4556,-2.5894',
      finishText: '',
      startTime: '',
      deadline: '16:00',
      checkInFormUrl: '',
    },
    settings: {
      speedKmh: 4.5,
      detourFactor: 1.3,
      dwellSeconds: defaultDwellSeconds(false),
      safetyMarginSeconds: 900,
    },
    locations: [],
    view: 'list',
    searchResults: {},
    plan: null,
  };
}

/**
 * Gets the browser's localStorage, which can be missing or throw (for example
 * in a private window or when site data is blocked).
 *
 * @returns {StateStorage | null} localStorage, or `null` if it isn't available.
 */
function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Loads the saved state. Anything missing, unreadable or saved with an
 * unknown schema version falls back to the defaults, so the app always gets
 * a complete state. State saved by an earlier version under one of the
 * {@link LEGACY_STORAGE_KEYS} is moved to {@link STORAGE_KEY}, and state
 * saved with schema version 1 keeps everything but the location list, the
 * ticks and the plan.
 *
 * @param {StateStorage | null} [storage] Where to load from. Defaults to the browser's localStorage.
 * @returns {AppState} The saved state, or the default state.
 * @example
 * const state = loadState();
 * state.settings.speedKmh; // 4.5 on first visit
 */
export function loadState(storage = browserStorage()) {
  const defaults = defaultState();
  let saved;
  try {
    const text = storage?.getItem(STORAGE_KEY) ?? moveLegacyState(storage);
    saved = text ? JSON.parse(text) : null;
  } catch {
    return defaults;
  }
  if (!isObject(saved) || (saved.version !== SCHEMA_VERSION && saved.version !== 1)) {
    return defaults;
  }
  if (saved.version === 1) {
    saved = fromVersion1(saved);
  }
  const event = { ...defaults.event, ...(isObject(saved.event) ? saved.event : {}) };
  // The form is opened in a new tab, so only ever load an http or https URL.
  event.checkInFormUrl = (typeof event.checkInFormUrl === 'string' && checkInFormUrl(event.checkInFormUrl)) || '';
  return {
    version: SCHEMA_VERSION,
    event,
    settings: { ...defaults.settings, ...(isObject(saved.settings) ? saved.settings : {}) },
    locations: cleanRecords(saved.locations),
    view: saved.view === 'map' ? 'map' : 'list',
    searchResults: isObject(saved.searchResults) ? saved.searchResults : {},
    plan: isObject(saved.plan) ? saved.plan : null,
  };
}

/**
 * Moves state saved with schema version 1, which kept the location list as
 * text, to the current version. The list was from the 2026 challenge, so it
 * isn't moved to rows, and nor are the ticks and the plan, which refer to
 * it. The settings and the rest of the setup form are kept, as the event's
 * details and the team's settings, with only the coordinates from a Start
 * or Finish that had them. Of the search results,
 * only the Start's and Finish's are kept, under their current key, since
 * the rest were for the list.
 *
 * @param {Record<string, any>} saved The state as saved with version 1.
 * @returns {Record<string, any>} The state without the location list, still to be checked like any other saved state.
 */
function fromVersion1(saved) {
  const { locationsText, startTimeText, ...setup } = isObject(saved.setup) ? saved.setup : {};
  const { deadline, checkInFormUrl: formUrl, ...settings } = isObject(saved.settings) ? saved.settings : {};
  // Leave out what version 1 didn't save, so it gets its default.
  const event = Object.fromEntries(Object.entries({ ...setup, startTime: startTimeText, deadline, checkInFormUrl: formUrl }).filter(([, value]) => value !== undefined));
  // Version 1 allowed a name or a Google Maps link around coordinates,
  // which would now be looked up as text, so keep only the coordinates.
  for (const field of ['startText', 'finishText']) {
    const coordinates = typeof event[field] === 'string' ? event[field].match(/(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/) : null;
    if (coordinates) {
      event[field] = `${coordinates[1]},${coordinates[2]}`;
    }
  }
  // Version 1 saved results by the query in lower case with single spaces,
  // so they're found under the Start's and Finish's text that way.
  const oldSearchResults = isObject(saved.searchResults) ? saved.searchResults : {};
  const searchResults = {};
  for (const text of [event.startText, event.finishText]) {
    const oldKey = typeof text === 'string' ? text.trim().replace(/\s+/g, ' ').toLowerCase() : '';
    if (oldKey && Object.hasOwn(oldSearchResults, oldKey)) {
      searchResults[searchKey(text)] = oldSearchResults[oldKey];
    }
  }
  return { ...saved, event, settings, locations: [], searchResults, plan: null };
}

/**
 * Saves the state. Failing to save (for example when storage is full or
 * blocked) doesn't throw, so the app keeps working for this visit.
 *
 * @param {AppState} state The state to save.
 * @param {StateStorage | null} [storage] Where to save to. Defaults to the browser's localStorage.
 * @returns {boolean} Whether the state was saved.
 */
export function saveState(state, storage = browserStorage()) {
  try {
    if (!storage) {
      return false;
    }
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...state, version: SCHEMA_VERSION }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Moves state saved under a legacy key to the current key, so it isn't lost
 * when the key changes. The legacy key is only removed once the state is
 * saved under the current key, and the state is used even if moving it
 * fails (for example when storage is full), so it's never lost.
 *
 * @param {StateStorage | null | undefined} storage Where the state is saved.
 * @returns {string | null} The legacy state's text, or `null` if there isn't any.
 */
function moveLegacyState(storage) {
  for (const key of LEGACY_STORAGE_KEYS) {
    const text = storage?.getItem(key);
    if (text) {
      try {
        storage.setItem(STORAGE_KEY, text);
        storage.removeItem(key);
      } catch {
        // Keep the legacy key, so the move is tried again next time.
      }
      return text;
    }
  }
  return null;
}

/**
 * Removes the saved state, for starting a new challenge.
 *
 * @param {StateStorage | null} [storage] Where to remove it from. Defaults to the browser's localStorage.
 * @returns {boolean} Whether the state was removed.
 */
export function clearState(storage = browserStorage()) {
  try {
    if (!storage) {
      return false;
    }
    for (const key of [STORAGE_KEY, ...LEGACY_STORAGE_KEYS]) {
      storage.removeItem(key);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Starts a new challenge: clears the location list, the ticks and the plan,
 * but keeps the settings, the start, finish and start time, the chosen tab
 * and saved search results (which can be reused).
 *
 * @param {AppState} state The current state. This isn't changed.
 * @returns {AppState} The state for a new challenge.
 */
export function resetChallenge(state) {
  return {
    ...state,
    locations: [],
    plan: null,
  };
}
