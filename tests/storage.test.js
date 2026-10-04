import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { LEGACY_STORAGE_KEYS, SCHEMA_VERSION, STORAGE_KEY, clearState, defaultState, loadState, resetChallenge, saveState } from '../storage.js';

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
      { id: 'b', text: 'Queen Square, Bristol', pin: null },
    ];
    state.doneKeys = ['a'];
    state.plan = { order: [0], arrivalTimes: [1], endEta: 2, spareSeconds: 3, skipped: [] };
    assert.equal(saveState(state, storage), true);
    assert.deepEqual(loadState(storage), state);
  });

  test('saves under a single versioned key', () => {
    const storage = memoryStorage();
    saveState(defaultState(), storage);
    assert.deepEqual([...storage.items.keys()], [STORAGE_KEY]);
    assert.equal(JSON.parse(storage.items.get(STORAGE_KEY)).version, SCHEMA_VERSION);
  });

  test('falls back to the defaults for an older or unknown version', () => {
    for (const version of [0, SCHEMA_VERSION + 1, 'one', undefined]) {
      const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ ...defaultState(), version, doneKeys: ['x'] }) });
      assert.deepEqual(loadState(storage), defaultState());
    }
  });

  test('falls back to the defaults for unreadable data', () => {
    for (const text of ['not json', '[]', 'null', '42']) {
      assert.deepEqual(loadState(memoryStorage({ [STORAGE_KEY]: text })), defaultState());
    }
  });

  test('fills in missing or invalid fields with the defaults', () => {
    const storage = memoryStorage({
      [STORAGE_KEY]: JSON.stringify({ version: SCHEMA_VERSION, settings: { speedKmh: 5.5 }, doneKeys: ['a', 1, null], searchResults: [], plan: 'nope' }),
    });
    const state = loadState(storage);
    const defaults = defaultState();
    assert.deepEqual(state.settings, { ...defaults.settings, speedKmh: 5.5 });
    assert.deepEqual(state.setup, defaults.setup);
    assert.deepEqual(state.locations, []);
    assert.deepEqual(state.doneKeys, ['a']);
    assert.deepEqual(state.searchResults, {});
    assert.equal(state.plan, null);
  });

  test('has no check-in form by default', () => {
    assert.equal(defaultState().settings.checkInFormUrl, '');
  });

  test('saves and loads the check-in form URL', () => {
    const storage = memoryStorage();
    const state = defaultState();
    state.settings.checkInFormUrl = 'https://forms.example.com/check-in';
    saveState(state, storage);
    assert.equal(loadState(storage).settings.checkInFormUrl, 'https://forms.example.com/check-in');
  });

  test('only loads an http or https check-in form URL', () => {
    for (const checkInFormUrl of ['javascript:alert(1)', 'ftp://example.com', 42, null]) {
      const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ version: SCHEMA_VERSION, settings: { checkInFormUrl } }) });
      assert.equal(loadState(storage).settings.checkInFormUrl, '', String(checkInFormUrl));
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
    state.doneKeys.push('x');
    assert.deepEqual(defaultState().doneKeys, []);
  });
});

describe('resetChallenge', () => {
  test('clears the locations, ticks and plan, keeping everything else', () => {
    const state = defaultState();
    state.settings.speedKmh = 3.5;
    state.setup = { startText: 'Castle Park 51.4556,-2.5894', finishText: 'Finish 51.4556,-2.5894', startTimeText: '11:00' };
    state.locations = [{ id: 'a', text: 'Old Kent Road 51.4545,-2.5879', pin: null }];
    state.doneKeys = ['a'];
    state.view = 'map';
    state.searchResults = { 'queen square': { isFound: false, error: 'No match', isTemporary: false } };
    state.plan = { order: [0] };
    const reset = resetChallenge(state);
    assert.deepEqual(reset.locations, []);
    assert.deepEqual(reset.doneKeys, []);
    assert.equal(reset.plan, null);
    assert.deepEqual(reset.settings, state.settings);
    assert.deepEqual(reset.setup, state.setup);
    assert.equal(reset.view, 'map');
    assert.deepEqual(reset.searchResults, state.searchResults);
  });

  test("doesn't change the original state", () => {
    const state = defaultState();
    state.locations = [{ id: 'a', text: 'Old Kent Road 51.4545,-2.5879', pin: null }];
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
    const saved = { ...defaultState(), doneKeys: ['51.449200,-2.581300'] };
    const storage = memoryStorage({ [legacyKey]: JSON.stringify(saved) });
    assert.deepEqual(loadState(storage).doneKeys, ['51.449200,-2.581300']);
    assert.equal(storage.items.has(legacyKey), false);
    assert.deepEqual(JSON.parse(storage.items.get(STORAGE_KEY)).doneKeys, ['51.449200,-2.581300']);
  });

  test('uses the old state and keeps the old key when saving under the new key fails', () => {
    const storage = memoryStorage({ [legacyKey]: JSON.stringify({ ...defaultState(), doneKeys: ['old'] }) });
    storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    assert.deepEqual(loadState(storage).doneKeys, ['old']);
    assert.equal(storage.items.has(legacyKey), true);
  });

  test('prefers state saved under the new key', () => {
    const storage = memoryStorage({
      [STORAGE_KEY]: JSON.stringify({ ...defaultState(), doneKeys: ['new'] }),
      [legacyKey]: JSON.stringify({ ...defaultState(), doneKeys: ['old'] }),
    });
    assert.deepEqual(loadState(storage).doneKeys, ['new']);
  });

  test('clears state saved under both keys', () => {
    const storage = memoryStorage({ [STORAGE_KEY]: '{}', [legacyKey]: '{}' });
    assert.equal(clearState(storage), true);
    assert.equal(storage.items.size, 0);
  });
});

describe('moving state saved with schema version 1', () => {
  const version1 = {
    version: 1,
    settings: { ...defaultState().settings, speedKmh: 3.5 },
    setup: {
      locationsText: 'Old Kent Road 51.4545,-2.5879\nQueen Square, Bristol\n\nWhitechapel ///filled.count.soap',
      startText: 'Castle Park 51.4556,-2.5894',
      finishText: '',
      startTimeText: '11:00',
    },
    doneKeys: ['51.454500,-2.587900', '51.000000,-2.000000'],
    view: 'map',
    searchResults: { 'queen square, bristol': { isFound: true, lat: 51.4504, lng: -2.5947, name: 'Queen Square, City Centre, Bristol' } },
    plan: {
      order: [1],
      skipped: [],
      arrivalTimes: [1],
      endEta: 2,
      spareSeconds: 3,
      points: [
        { lat: 51.4545, lng: -2.5879, label: 'Old Kent Road', key: '51.454500,-2.587900' },
        { lat: 51.4504, lng: -2.5947, label: 'Queen Square, Bristol', key: '51.450400,-2.594700', matchedName: 'Queen Square, City Centre, Bristol' },
      ],
    },
  };

  test('moves the location list to rows, keeping everything else', () => {
    const state = loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(version1) }));
    assert.equal(state.version, SCHEMA_VERSION);
    assert.deepEqual(
      state.locations.map(({ text, pin }) => ({ text, pin })),
      [
        { text: 'Old Kent Road', pin: { lat: 51.4545, lng: -2.5879 } },
        { text: 'Queen Square, Bristol', pin: null },
        { text: 'Whitechapel ///filled.count.soap', pin: null },
      ],
    );
    assert.deepEqual(state.setup, { startText: 'Castle Park 51.4556,-2.5894', finishText: '', startTimeText: '11:00' });
    assert.equal(state.settings.speedKmh, 3.5);
    assert.equal(state.view, 'map');
    assert.deepEqual(state.searchResults, version1.searchResults);
  });

  test("moves ticked-off selfies and the plan's locations to the rows' ids", () => {
    const state = loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(version1) }));
    const [oldKentRoad, queenSquare] = state.locations;
    assert.deepEqual(state.doneKeys, [oldKentRoad.id]);
    assert.deepEqual(state.plan.points.map(({ key }) => key), [oldKentRoad.id, queenSquare.id]);
    assert.deepEqual(state.plan.order, [1]);
  });

  test('saves the moved state, so the rows keep their ids', () => {
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(version1) });
    const state = loadState(storage);
    assert.deepEqual(JSON.parse(storage.items.get(STORAGE_KEY)), state);
    assert.deepEqual(loadState(storage), state);
  });

  test('moves state saved under the old key too', () => {
    const storage = memoryStorage({ [LEGACY_STORAGE_KEYS[0]]: JSON.stringify(version1) });
    assert.equal(loadState(storage).locations.length, 3);
  });
});
