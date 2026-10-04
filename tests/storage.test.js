import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { searchKey } from '../search.js';
import { LEGACY_STORAGE_KEYS, SCHEMA_VERSION, STORAGE_KEY, clearState, defaultState, isOutOfDate, loadState, resetChallenge, saveState } from '../storage.js';

/** An in-memory stand-in for localStorage. */
const memoryStorage = (initial = {}) => {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
    items,
  };
};

/** A plan with every field the app needs to show it. */
const savedPlan = () => ({
  order: [0],
  skipped: [],
  arrivalTimes: [1],
  endEta: 2,
  spareSeconds: 3,
  points: [{ lat: 51.4545, lng: -2.5879, label: 'Old Kent Road', key: 'a' }],
  start: { lat: 51.4556, lng: -2.5894, label: 'Start', key: 'start' },
  finish: null,
  startTime: 0,
  deadline: 4,
  settings: { speedKmh: 4.5, detourFactor: 1.3, dwellSeconds: 180, safetyMarginSeconds: 900 },
  isFromPosition: false,
});

/** A storage that throws on every call, like a blocked or full localStorage. */
const throwingStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

describe('storage', () => {
  test('loads the defaults when nothing is saved', () => {
    assert.deepEqual(loadState(memoryStorage()), defaultState());
  });

  test('saves and loads the state', () => {
    const storage = memoryStorage();
    const state = defaultState();
    state.settings.speedKmh = 3.5;
    state.locations = [
      { id: 'a', text: 'Old Kent Road', pin: { lat: 51.4545, lng: -2.5879 } },
      { id: 'b', text: 'Queen Square, Bristol', isVisited: true },
    ];
    state.plan = savedPlan();
    assert.equal(saveState(state, storage), true);
    assert.deepEqual(loadState(storage), state);
  });

  test("drops a saved plan that doesn't have the shape needed to show it", () => {
    const broken = [
      'nope',
      { ...savedPlan(), settings: undefined },
      { ...savedPlan(), order: 'x' },
      { ...savedPlan(), deadline: null },
      { ...savedPlan(), start: null },
      { ...savedPlan(), finish: undefined },
      { ...savedPlan(), isFromPosition: undefined },
    ];
    for (const plan of broken) {
      const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ ...defaultState(), plan }) });
      assert.equal(loadState(storage).plan, null, JSON.stringify(plan));
    }
  });

  test('saves under a single versioned key', () => {
    const storage = memoryStorage();
    saveState(defaultState(), storage);
    assert.deepEqual([...storage.items.keys()], [STORAGE_KEY]);
    assert.equal(JSON.parse(storage.items.get(STORAGE_KEY)).version, SCHEMA_VERSION);
  });

  test('falls back to the defaults for an older or unknown version', () => {
    for (const version of [0, SCHEMA_VERSION + 1, 'one', undefined]) {
      const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ ...defaultState(), version, view: 'map' }) });
      assert.deepEqual(loadState(storage), defaultState());
    }
  });

  test("never saves over state saved by a newer version, and says it's out of date", () => {
    const newer = JSON.stringify({ version: SCHEMA_VERSION + 1, locations: [{ id: 'a', text: 'A', isMustVisit: true }] });
    const storage = memoryStorage({ [STORAGE_KEY]: newer });
    assert.deepEqual(loadState(storage), defaultState());
    assert.equal(isOutOfDate(storage), true);
    assert.equal(saveState(defaultState(), storage), false);
    assert.equal(storage.items.get(STORAGE_KEY), newer);
  });

  test("isn't out of date for state saved by this or an earlier version", () => {
    for (const version of [1, SCHEMA_VERSION]) {
      const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ ...defaultState(), version }) });
      loadState(storage);
      assert.equal(isOutOfDate(storage), false, String(version));
      assert.equal(saveState(defaultState(), storage), true);
    }
  });

  test('falls back to the defaults for unreadable data', () => {
    for (const text of ['not json', '[]', 'null', '42']) {
      assert.deepEqual(loadState(memoryStorage({ [STORAGE_KEY]: text })), defaultState());
    }
  });

  test('fills in missing or invalid fields with the defaults', () => {
    const storage = memoryStorage({
      [STORAGE_KEY]: JSON.stringify({ version: SCHEMA_VERSION, settings: { speedKmh: 5.5 }, locations: 'nope', searchResults: [], plan: 'nope' }),
    });
    const state = loadState(storage);
    const defaults = defaultState();
    assert.deepEqual(state.settings, { ...defaults.settings, speedKmh: 5.5 });
    assert.deepEqual(state.event, defaults.event);
    assert.deepEqual(state.locations, []);
    assert.deepEqual(state.searchResults, {});
    assert.equal(state.plan, null);
  });

  test('uses the default for a field saved with the wrong type, and drops unknown fields', () => {
    const storage = memoryStorage({
      [STORAGE_KEY]: JSON.stringify({ version: SCHEMA_VERSION, event: { startText: 42, deadline: '15:00' }, settings: { speedKmh: null, dwellSeconds: '300', colour: 'red' } }),
    });
    const { event, settings } = loadState(storage);
    const defaults = defaultState();
    assert.deepEqual(event, { ...defaults.event, deadline: '15:00' });
    assert.deepEqual(settings, defaults.settings);
  });

  test('makes each location worth 10 points by default, and only loads whole numbers of points', () => {
    assert.equal(defaultState().event.pointsPerLocation, 10);
    for (const [pointsPerLocation, expected] of [[20, 20], [0, 0], [2.5, 10], [-5, 10], ['20', 10]]) {
      const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ version: SCHEMA_VERSION, event: { pointsPerLocation } }) });
      assert.equal(loadState(storage).event.pointsPerLocation, expected, String(pointsPerLocation));
    }
  });

  test('has no check-in form by default', () => {
    assert.equal(defaultState().event.checkInFormUrl, '');
  });

  test('saves and loads the check-in form URL', () => {
    const storage = memoryStorage();
    const state = defaultState();
    state.event.checkInFormUrl = 'https://forms.example.com/check-in';
    saveState(state, storage);
    assert.equal(loadState(storage).event.checkInFormUrl, 'https://forms.example.com/check-in');
  });

  test('only loads an http or https check-in form URL', () => {
    for (const checkInFormUrl of ['javascript:alert(1)', 'ftp://example.com', 42, null]) {
      const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ version: SCHEMA_VERSION, event: { checkInFormUrl } }) });
      assert.equal(loadState(storage).event.checkInFormUrl, '', String(checkInFormUrl));
    }
  });

  test('only accepts list or map as the view', () => {
    for (const [view, expected] of [['map', 'map'], ['list', 'list'], ['table', 'list'], [undefined, 'list']]) {
      const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ version: SCHEMA_VERSION, view }) });
      assert.equal(loadState(storage).view, expected, String(view));
    }
  });

  test('keeps working when storage throws', () => {
    assert.deepEqual(loadState(throwingStorage), defaultState());
    assert.equal(saveState(defaultState(), throwingStorage), false);
    assert.equal(clearState(throwingStorage), false);
  });

  test('keeps working when storage is unavailable', () => {
    assert.deepEqual(loadState(null), defaultState());
    assert.equal(saveState(defaultState(), null), false);
    assert.equal(clearState(null), false);
  });

  test('clears the saved state', () => {
    const storage = memoryStorage();
    saveState(defaultState(), storage);
    assert.equal(clearState(storage), true);
    assert.equal(storage.items.size, 0);
  });

  test('returns a fresh default state each time', () => {
    const state = defaultState();
    state.locations.push({ id: 'x', text: 'X' });
    assert.deepEqual(defaultState().locations, []);
  });
});

describe('resetChallenge', () => {
  test('clears the locations, ticks and plan, keeping everything else apart from searches that found nothing', () => {
    const state = defaultState();
    state.settings.speedKmh = 3.5;
    state.event = { ...state.event, startText: '51.4556,-2.5894', finishText: '51.4492,-2.5813', startTime: '11:00' };
    state.locations = [{ id: 'a', text: '51.4545,-2.5879', isVisited: true }];
    state.view = 'map';
    const found = { isFound: true, lat: 51.4504, lng: -2.5947, name: 'Queen Square, City Centre, Bristol' };
    state.searchResults = { [searchKey('Queen Square')]: found, [searchKey('Nowhere')]: { isFound: false, error: 'No match', isTemporary: false } };
    state.plan = { order: [0] };
    const reset = resetChallenge(state);
    assert.deepEqual(reset.locations, []);
    assert.equal(reset.plan, null);
    assert.deepEqual(reset.settings, state.settings);
    assert.deepEqual(reset.event, state.event);
    assert.equal(reset.view, 'map');
    assert.deepEqual(reset.searchResults, { [searchKey('Queen Square')]: found });
  });

  test("doesn't change the original state", () => {
    const state = defaultState();
    state.locations = [{ id: 'a', text: '51.4545,-2.5879' }];
    resetChallenge(state);
    assert.equal(state.locations.length, 1);
  });
});

describe('legacy storage keys', () => {
  const [legacyKey] = LEGACY_STORAGE_KEYS;

  test('uses the new name for the storage key', () => {
    assert.equal(STORAGE_KEY, 'monopoly-challenge-route-planner');
    assert.deepEqual(LEGACY_STORAGE_KEYS, ['monopoly-challenge-planner']);
  });

  test('moves state saved under the old key to the new key', () => {
    const saved = { ...defaultState(), view: 'map' };
    const storage = memoryStorage({ [legacyKey]: JSON.stringify(saved) });
    assert.equal(loadState(storage).view, 'map');
    assert.equal(storage.items.has(legacyKey), false);
    assert.equal(JSON.parse(storage.items.get(STORAGE_KEY)).view, 'map');
  });

  test('uses the old state and keeps the old key when saving under the new key fails', () => {
    const storage = memoryStorage({ [legacyKey]: JSON.stringify({ ...defaultState(), view: 'map' }) });
    storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    assert.equal(loadState(storage).view, 'map');
    assert.equal(storage.items.has(legacyKey), true);
  });

  test('prefers state saved under the new key', () => {
    const storage = memoryStorage({
      [STORAGE_KEY]: JSON.stringify({ ...defaultState(), view: 'map' }),
      [legacyKey]: JSON.stringify({ ...defaultState(), view: 'list' }),
    });
    assert.equal(loadState(storage).view, 'map');
  });

  test('clears state saved under both keys', () => {
    const storage = memoryStorage({ [STORAGE_KEY]: '{}', [legacyKey]: '{}' });
    assert.equal(clearState(storage), true);
    assert.equal(storage.items.size, 0);
  });
});

describe('loading state saved with schema version 1', () => {
  const version1 = {
    version: 1,
    settings: { speedKmh: 3.5, detourFactor: 1.3, dwellSeconds: 300, safetyMarginSeconds: 900, deadline: '15:30', checkInFormUrl: 'https://forms.example.com/check-in' },
    setup: { locationsText: 'Old Kent Road 51.4545,-2.5879', startText: 'Temple Meads', finishText: 'Cabot Tower', startTimeText: '11:00' },
    doneKeys: ['51.454500,-2.587900'],
    view: 'map',
    searchResults: {
      'temple meads': { isFound: true, lat: 51.4492, lng: -2.5813, name: 'Bristol Temple Meads' },
      'old kent road': { isFound: false, error: 'No match', isTemporary: false },
    },
    plan: { order: [0], arrivalTimes: [1], endEta: 2, spareSeconds: 3, skipped: [] },
  };

  test("keeps the settings and setup form as the event and settings, the tab, and the start's and finish's search results", () => {
    const state = loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(version1) }));
    assert.equal(state.version, SCHEMA_VERSION);
    assert.deepEqual(state.event, {
      startText: 'Temple Meads',
      finishText: 'Cabot Tower',
      startTime: '11:00',
      deadline: '15:30',
      checkInFormUrl: 'https://forms.example.com/check-in',
      pointsPerLocation: 10,
    });
    assert.deepEqual(state.settings, { speedKmh: 3.5, detourFactor: 1.3, dwellSeconds: 300, safetyMarginSeconds: 900 });
    assert.equal(state.view, 'map');
    assert.deepEqual(state.searchResults, { [searchKey('Temple Meads')]: version1.searchResults['temple meads'] });
  });

  test("changes the old default start to Castle Park's coordinates", () => {
    const saved = { ...version1, setup: { ...version1.setup, startText: 'Castle Park 51.4556,-2.5894' } };
    assert.equal(loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved) })).event.startText, defaultState().event.startText);
  });

  test('keeps only the coordinates from a start or finish with a name or Google Maps link', () => {
    const saved = { ...version1, setup: { ...version1.setup, startText: 'Queen Square 51.4512, -2.5973', finishText: 'https://www.google.com/maps?q=51.4517,-2.6034' } };
    const { event } = loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved) }));
    assert.equal(event.startText, '51.4512,-2.5973');
    assert.equal(event.finishText, '51.4517,-2.6034');
  });

  test("gives what version 1 didn't save its default", () => {
    const saved = { ...version1, settings: { speedKmh: 3.5 }, setup: { startText: 'Temple Meads' } };
    const state = loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved) }));
    assert.deepEqual(state.event, { ...defaultState().event, startText: 'Temple Meads' });
    assert.deepEqual(state.settings, { ...defaultState().settings, speedKmh: 3.5 });
  });

  test('drops the location list, the ticks and the plan', () => {
    const state = loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(version1) }));
    assert.deepEqual(state.locations, []);
    assert.equal(state.doneKeys, undefined);
    assert.equal(state.plan, null);
  });
});
