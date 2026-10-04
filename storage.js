import { checkInFormUrl } from './settings.js';

/**
 * Settings for planning, which can be changed during the challenge.
 *
 * @typedef {object} Settings
 * @property {number} speedKmh Walking speed of the whole group in km/h.
 * @property {number} detourFactor How much longer the walk along streets is than the straight line.
 * @property {number} dwellSeconds Time spent at each stop taking the selfie, in seconds.
 * @property {number} safetyMarginSeconds Spare time to keep before the deadline, in seconds.
 * @property {string} deadline The time the team must have finished by, as `HH:MM` local time.
 * @property {string} checkInFormUrl The organisers' online check-in form, as an http or https URL, or an empty string if there isn't one.
 */

/**
 * What was entered in the setup form, kept as typed so it can be shown again.
 *
 * @typedef {object} Setup
 * @property {string} locationsText The location list, one location per line.
 * @property {string} startText Where the route starts.
 * @property {string} finishText Where the route finishes, or an empty string if there's no physical finish.
 * @property {string} startTimeText When the route starts, as `HH:MM` local time, or an empty string to start when Plan route is pressed.
 */

/**
 * Everything the app saves between visits.
 *
 * @typedef {object} AppState
 * @property {number} version The schema version the state was saved with.
 * @property {Settings} settings Settings for planning.
 * @property {Setup} setup What was entered in the setup form.
 * @property {string[]} doneKeys Keys of the locations whose selfie has been taken.
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

/** The current schema version. Increase it when the shape of {@link AppState} changes. */
export const SCHEMA_VERSION = 1;

/**
 * Creates the state for a new challenge.
 *
 * @returns {AppState} The default state, starting at Castle Park with a 16:00 deadline.
 */
export function defaultState() {
  return {
    version: SCHEMA_VERSION,
    settings: {
      speedKmh: 4.5,
      detourFactor: 1.3,
      dwellSeconds: 180,
      safetyMarginSeconds: 900,
      deadline: '16:00',
      checkInFormUrl: '',
    },
    setup: {
      locationsText: '',
      startText: 'Castle Park 51.4556,-2.5894',
      finishText: '',
      startTimeText: '',
    },
    doneKeys: [],
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
 * Loads the saved state. Anything missing, unreadable or saved with a
 * different schema version falls back to the defaults, so the app always
 * gets a complete state. State saved by an earlier version under one of the
 * {@link LEGACY_STORAGE_KEYS} is moved to {@link STORAGE_KEY}.
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
  if (!isObject(saved) || saved.version !== SCHEMA_VERSION) {
    return defaults;
  }
  const settings = { ...defaults.settings, ...(isObject(saved.settings) ? saved.settings : {}) };
  // The form is opened in a new tab, so only ever load an http or https URL.
  settings.checkInFormUrl = (typeof settings.checkInFormUrl === 'string' && checkInFormUrl(settings.checkInFormUrl)) || '';
  return {
    version: SCHEMA_VERSION,
    settings,
    setup: { ...defaults.setup, ...(isObject(saved.setup) ? saved.setup : {}) },
    doneKeys: Array.isArray(saved.doneKeys) ? saved.doneKeys.filter((key) => typeof key === 'string') : [],
    view: saved.view === 'map' ? 'map' : 'list',
    searchResults: isObject(saved.searchResults) ? saved.searchResults : {},
    plan: isObject(saved.plan) ? saved.plan : null,
  };
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
    setup: { ...state.setup, locationsText: '' },
    doneKeys: [],
    plan: null,
  };
}
