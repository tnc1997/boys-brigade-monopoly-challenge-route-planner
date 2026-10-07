import assert from 'node:assert/strict';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { describe, test } from 'node:test';

import { OPTIONAL_SETUP_LOCATION_FIELDS } from '../locations.js';
import { searchKey } from '../search.js';
import { SHARE_PREFIX, canCompress, preparedShareFragment, readShareFragment, shareFragment, sharedSetupOf } from '../share.js';
import { SCHEMA_VERSION, cleanState, defaultState } from '../storage.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Makes a fragment for any JSON value, as a link from another version or a damaged one might have. */
const fragmentOf = (value) => `${SHARE_PREFIX}${deflateRawSync(Buffer.from(JSON.stringify(value))).toString('base64url')}`;

/** Reads the JSON in a fragment without checking it. */
const jsonOf = (fragment) => JSON.parse(inflateRawSync(Buffer.from(fragment.slice(SHARE_PREFIX.length), 'base64url')).toString('utf8'));

/** Shares a state and opens the link, returning what opening it changes. */
const roundTrip = async (state) => {
  const result = await readShareFragment(await shareFragment(state));
  assert.equal(result.status, 'read');
  return result.shared;
};

/** A saved state with a found row, a pinned row, a coordinates row and a not-found row, ticks, a plan and changed settings. */
const sampleState = () => ({
  ...defaultState(),
  event: { startText: 'Castle Park', finishText: 'Queen Square', startTime: '10:30', deadline: '15:30', checkInFormUrl: 'https://example.com/form', pointsPerLocation: 20 },
  settings: { speedKmh: 3.5, detourFactor: 1.5, dwellSeconds: 300, safetyMarginSeconds: 600 },
  setupLocations: [
    { id: 'a', text: 'Old Kent Road', isVisited: true, isMustVisit: true, points: 30, at: '12:00' },
    { id: 'b', text: 'Whitechapel', pin: { lat: 51.45, lng: -2.6 } },
    { id: 'c', text: '51.4545,-2.5879' },
    { id: 'd', text: 'Nowhere Lane' },
  ],
  searchResults: {
    [searchKey('Castle Park')]: { isFound: true, lat: 51.4556, lng: -2.5894, name: 'Castle Park, Bristol' },
    [searchKey('Queen Square')]: { isFound: true, lat: 51.45, lng: -2.595, name: 'Queen Square, Bristol' },
    [searchKey('Old Kent Road')]: { isFound: true, lat: 51.46, lng: -2.58, name: 'Old Kent Road, Bristol' },
    [searchKey('Whitechapel')]: { isFound: false, error: 'Not found.', isTemporary: false },
    [searchKey('Nowhere Lane')]: { isFound: false, error: 'Not found.', isTemporary: false },
    [searchKey('Somewhere else')]: { isFound: true, lat: 51.4, lng: -2.5, name: 'Somewhere else' },
  },
  plan: { order: [0] },
  view: 'map',
});

/** The search results shared for {@link sampleState}, by their text. */
const sampleSharedSearchResults = () => ({
  'Castle Park': { isFound: true, lat: 51.4556, lng: -2.5894, name: 'Castle Park, Bristol' },
  'Queen Square': { isFound: true, lat: 51.45, lng: -2.595, name: 'Queen Square, Bristol' },
  'Old Kent Road': { isFound: true, lat: 51.46, lng: -2.58, name: 'Old Kent Road, Bristol' },
  'Nowhere Lane': { isFound: false, error: 'Not found.', isTemporary: false },
});

/** A shared setup as {@link sampleState} would make, as JSON for {@link fragmentOf} to change. */
const sampleSharedSetup = () => JSON.parse(JSON.stringify(sharedSetupOf(sampleState())));

describe('sharedSetupOf', () => {
  test('shares the rows without their ids or ticks, the event, and the search results for the shared texts except pinned rows', () => {
    const sharedSetup = sharedSetupOf(sampleState());
    assert.deepEqual(sharedSetup, {
      version: SCHEMA_VERSION,
      event: sampleState().event,
      setupLocations: [
        { text: 'Old Kent Road', isMustVisit: true, points: 30, at: '12:00' },
        { text: 'Whitechapel', pin: { lat: 51.45, lng: -2.6 } },
        { text: '51.4545,-2.5879' },
        { text: 'Nowhere Lane' },
      ],
      searchResults: sampleSharedSearchResults(),
    });
  });

  test("doesn't share the settings, the plan or the chosen tab", () => {
    const sharedSetup = sharedSetupOf(sampleState());
    assert.deepEqual(Object.keys(sharedSetup).sort(), ['event', 'searchResults', 'setupLocations', 'version']);
  });
});

describe('shareFragment and readShareFragment', () => {
  test('can compress in this environment', () => {
    assert.equal(canCompress(), true);
  });

  test('recreate the locations, the event and the search results, with new ids and no ticks', async () => {
    const state = sampleState();
    const opened = await roundTrip(state);
    // Event fields added since sampleState was written get their defaults.
    assert.deepEqual(opened.event, { ...defaultState().event, ...state.event });
    assert.deepEqual(
      opened.setupLocations.map(({ id, ...row }) => row),
      [
        { text: 'Old Kent Road', isMustVisit: true, points: 30, at: '12:00' },
        { text: 'Whitechapel', pin: { lat: 51.45, lng: -2.6 } },
        { text: '51.4545,-2.5879' },
        { text: 'Nowhere Lane' },
      ],
    );
    for (const { id } of opened.setupLocations) {
      assert.match(id, UUID);
    }
    assert.equal(new Set(opened.setupLocations.map(({ id }) => id)).size, 4);
    const { [searchKey('Somewhere else')]: unshared, [searchKey('Whitechapel')]: pinned, ...shared } = state.searchResults;
    assert.deepEqual(opened.searchResults, shared);
  });

  test('carry row and event fields added later, such as a colour set and Points per set, without changing the encoding', async () => {
    const state = { ...defaultState(), event: { ...defaultState().event, pointsPerSet: 50 }, setupLocations: [{ id: 'a', text: 'Old Kent Road', set: 'red', isVisited: true }] };
    const sharedSetup = jsonOf(await shareFragment(state));
    assert.equal(sharedSetup.event.pointsPerSet, 50);
    assert.deepEqual(sharedSetup.setupLocations, [{ text: 'Old Kent Road', set: 'red' }]);
  });

  test('make a fragment that only uses characters safe in a URL', async () => {
    const state = { ...sampleState(), setupLocations: [{ id: 'a', text: 'Café “Ñ” 🎲 & ?#/+' }] };
    assert.match(await shareFragment(state), /^#setup=[A-Za-z0-9_-]+$/);
    const opened = await roundTrip(state);
    assert.equal(opened.setupLocations[0].text, 'Café “Ñ” 🎲 & ?#/+');
  });

  test('keep a link for 40 rows short enough to send in a message', async () => {
    const setupLocations = [];
    const searchResults = {};
    for (let index = 0; index < 40; index++) {
      const text = `Location number ${index + 1}, Street ${String.fromCharCode(65 + (index % 26))}`;
      setupLocations.push({ id: crypto.randomUUID(), text, ...(index % 5 === 0 ? { points: 20 } : {}) });
      searchResults[searchKey(text)] = { isFound: true, lat: 51.4 + index / 1000, lng: -2.6 + index / 997, name: `${text}, Redcliffe, Bristol, City of Bristol, England, BS1 ${index}AA, United Kingdom` };
    }
    const fragment = await shareFragment({ ...defaultState(), setupLocations, searchResults });
    assert.ok(fragment.length < 8000, `${fragment.length} characters`);
  });

  test('ignore a fragment without a shared setup', async () => {
    assert.deepEqual(await readShareFragment(''), { status: 'none' });
    assert.deepEqual(await readShareFragment('#map'), { status: 'none' });
  });

  test("say a setup shared with a newer schema version can't be read, rather than reading part of it", async () => {
    assert.deepEqual(await readShareFragment(fragmentOf({ ...sampleSharedSetup(), version: SCHEMA_VERSION + 1 })), { status: 'newer' });
  });

  for (const [name, change] of [
    ['a row field', (sharedSetup) => (sharedSetup.setupLocations[0].colourOfTheDay = 'red')],
    ['an event field', (sharedSetup) => (sharedSetup.event.bonusPerHour = 5)],
  ]) {
    test(`say a setup with ${name} this version doesn't know is from a newer version, rather than dropping it`, async () => {
      const sharedSetup = sampleSharedSetup();
      change(sharedSetup);
      assert.deepEqual(await readShareFragment(fragmentOf(sharedSetup)), { status: 'newer' });
    });
  }

  test('know every row field that loading checks, and every event field with a default', async () => {
    const sharedSetup = sampleSharedSetup();
    sharedSetup.setupLocations[0] = { text: 'Old Kent Road', ...Object.fromEntries(Object.keys(OPTIONAL_SETUP_LOCATION_FIELDS).map((field) => [field, null])) };
    sharedSetup.event = Object.fromEntries(Object.keys(defaultState().event).map((field) => [field, null]));
    assert.equal((await readShareFragment(fragmentOf(sharedSetup))).status, 'read');
  });

  test('know a row field that loading keeps, even if it was checked outside the table of optional fields', async () => {
    const clean = (saved) => {
      const state = cleanState(saved);
      state.setupLocations = state.setupLocations.map((row, index) => (saved.setupLocations[index].set === 'red' ? { ...row, set: 'red' } : row));
      return state;
    };
    const sharedSetup = sampleSharedSetup();
    sharedSetup.setupLocations[0].set = 'red';
    const result = await readShareFragment(fragmentOf(sharedSetup), { clean });
    assert.equal(result.status, 'read');
    assert.equal(result.shared.setupLocations[0].set, 'red');
  });

  for (const [name, change, check] of [
    ['points', (sharedSetup) => (sharedSetup.setupLocations[0].points = 99999), ({ setupLocations }) => setupLocations[0].points === undefined],
    ['an At', (sharedSetup) => (sharedSetup.setupLocations[0].at = '12:00:30'), ({ setupLocations }) => setupLocations[0].at === undefined],
    ['Must visit', (sharedSetup) => (sharedSetup.setupLocations[0].isMustVisit = 'yes'), ({ setupLocations }) => setupLocations[0].isMustVisit === undefined],
    ['a pin', (sharedSetup) => (sharedSetup.setupLocations[1].pin = { lat: 100, lng: 0 }), ({ setupLocations }) => setupLocations[1].pin === undefined],
    ["a pin's field", (sharedSetup) => (sharedSetup.setupLocations[1].pin.accuracy = 5), ({ setupLocations }) => setupLocations[1].pin.accuracy === undefined],
    ['Points per location', (sharedSetup) => (sharedSetup.event.pointsPerLocation = 2.5), ({ event }) => event.pointsPerLocation === defaultState().event.pointsPerLocation],
    ['the deadline', (sharedSetup) => (sharedSetup.event.deadline = 1600), ({ event }) => event.deadline === defaultState().event.deadline],
    ['the check-in form', (sharedSetup) => (sharedSetup.event.checkInFormUrl = 'javascript:alert(1)'), ({ event }) => event.checkInFormUrl === ''],
  ]) {
    test(`drop a value for ${name} that this version doesn't allow, as loading does, and open the rest`, async () => {
      const sharedSetup = sampleSharedSetup();
      change(sharedSetup);
      const result = await readShareFragment(fragmentOf(sharedSetup));
      assert.equal(result.status, 'read');
      assert.ok(check(result.shared));
      assert.deepEqual(
        result.shared.setupLocations.map(({ text }) => text),
        ['Old Kent Road', 'Whitechapel', '51.4545,-2.5879', 'Nowhere Lane'],
      );
      assert.equal(result.shared.event.startText, 'Castle Park');
    });
  }

  for (const [name, row] of [
    ['a row that isn\'t an object', 'Old Kent Road'],
    ['a row without text', { pin: { lat: 51, lng: -2 } }],
    ['a row with no text or pin', { text: '  ' }],
  ]) {
    test(`say a setup with ${name} is damaged, since a phone never shares one`, async () => {
      const sharedSetup = sampleSharedSetup();
      sharedSetup.setupLocations.push(row);
      assert.deepEqual(await readShareFragment(fragmentOf(sharedSetup)), { status: 'damaged' });
    });
  }

  test('leave out rows whose text has been cleared, so the setup still opens', async () => {
    const state = { ...sampleState(), setupLocations: [...sampleState().setupLocations, { id: 'e', text: '' }, { id: 'f', text: '   ' }, { id: 'g', text: '', pin: { lat: 51.44, lng: -2.6 } }] };
    assert.deepEqual(
      sharedSetupOf(state).setupLocations.map(({ text }) => text),
      ['Old Kent Road', 'Whitechapel', '51.4545,-2.5879', 'Nowhere Lane', ''],
    );
    const opened = await roundTrip(state);
    assert.equal(opened.setupLocations.length, 5);
    assert.deepEqual(opened.setupLocations[4].pin, { lat: 51.44, lng: -2.6 });
  });

  test("move a setup shared with an earlier schema version as saved state is, without checking for unknown fields", async () => {
    // Pretend the schema is a version ahead, and that moving from the
    // shared version renames `minutes` on rows to `at`, as a migration might.
    const clean = (saved) => {
      assert.equal(saved.version, SCHEMA_VERSION);
      const setupLocations = saved.setupLocations.map(({ minutes, ...row }) => ({ ...row, ...(minutes === undefined ? {} : { at: `12:${minutes}` }) }));
      return cleanState({ ...saved, version: SCHEMA_VERSION, setupLocations });
    };
    const sharedSetup = sampleSharedSetup();
    sharedSetup.setupLocations[2] = { text: '51.4545,-2.5879', minutes: '30' };
    sharedSetup.event.oldField = true;
    const result = await readShareFragment(fragmentOf(sharedSetup), { schemaVersion: SCHEMA_VERSION + 1, clean });
    assert.equal(result.status, 'read');
    assert.equal(result.shared.setupLocations[2].at, '12:30');
    assert.equal(result.shared.event.oldField, undefined);
  });

  test("don't count rows that moving from an earlier schema version drops as damage", async () => {
    const clean = (saved) => cleanState({ ...saved, version: SCHEMA_VERSION, setupLocations: saved.setupLocations.slice(1) });
    const result = await readShareFragment(fragmentOf(sampleSharedSetup()), { schemaVersion: SCHEMA_VERSION + 1, clean });
    assert.equal(result.status, 'read');
    assert.equal(result.shared.setupLocations.length, 3);
  });


  test('fill in event fields missing from a setup shared by an earlier version with their defaults', async () => {
    const sharedSetup = sampleSharedSetup();
    delete sharedSetup.event.pointsPerLocation;
    const result = await readShareFragment(fragmentOf(sharedSetup));
    assert.equal(result.status, 'read');
    assert.equal(result.shared.event.pointsPerLocation, defaultState().event.pointsPerLocation);
  });

  test("give rows new ids and no ticks, even if the link has them", async () => {
    const sharedSetup = sampleSharedSetup();
    sharedSetup.setupLocations[0].id = 'chosen-id';
    sharedSetup.setupLocations[0].isVisited = true;
    const result = await readShareFragment(fragmentOf(sharedSetup));
    assert.equal(result.status, 'read');
    assert.match(result.shared.setupLocations[0].id, UUID);
    assert.equal(result.shared.setupLocations[0].isVisited, undefined);
  });

  test('only keep search results for the shared texts, with the right shape', async () => {
    const sharedSetup = {
      version: SCHEMA_VERSION,
      event: { ...defaultState().event, startText: 'Castle Park', finishText: '' },
      setupLocations: [{ text: 'Old Kent Road' }, { text: 'Whitechapel' }, { text: 'Bow Street' }, { text: 'Pall Mall' }, { text: '__proto__' }, { text: 'Pinned', pin: { lat: 51, lng: -2 } }],
      searchResults: {
        'Castle Park': { isFound: true, lat: 51.4556, lng: -2.5894, name: 'Castle Park', extra: 1 },
        'Old Kent Road': { isFound: true, lat: 91, lng: 0, name: 'Too far north' },
        Whitechapel: { isFound: false, error: 'No signal', isTemporary: true },
        'Bow Street': { isFound: false, error: 'Not found.', isTemporary: false },
        'Pall Mall': 'found',
        Pinned: { isFound: false, error: 'Not found.', isTemporary: false },
        'Not in the list': { isFound: true, lat: 51, lng: -2, name: 'Not in the list' },
      },
    };
    const result = await readShareFragment(fragmentOf(sharedSetup));
    assert.equal(result.status, 'read');
    assert.deepEqual(result.shared.searchResults, {
      [searchKey('Castle Park')]: { isFound: true, lat: 51.4556, lng: -2.5894, name: 'Castle Park' },
      [searchKey('Bow Street')]: { isFound: false, error: 'Not found.', isTemporary: false },
    });
  });

  for (const [name, fragment] of [
    ['not base64url', `${SHARE_PREFIX}not base64!`],
    ['not compressed', `${SHARE_PREFIX}${Buffer.from('{"version":2}').toString('base64url')}`],
    ['empty', SHARE_PREFIX],
  ]) {
    test(`say a link that's ${name} is damaged`, async () => {
      assert.deepEqual(await readShareFragment(fragment), { status: 'damaged' });
    });
  }

  test("say a link that's been cut short is damaged", async () => {
    const fragment = await shareFragment(sampleState());
    assert.deepEqual(await readShareFragment(fragment.slice(0, fragment.length - 10)), { status: 'damaged' });
  });

  for (const [name, value] of [
    ['not JSON', null],
    ['not an object', [1, 2]],
    ['without a version', { event: {}, setupLocations: [], searchResults: {} }],
    ['from before lists could be shared', { version: 1, event: {}, setupLocations: [], searchResults: {} }],
    ['without rows', { version: SCHEMA_VERSION, event: {}, searchResults: {} }],
    ['without the event', { version: SCHEMA_VERSION, setupLocations: [], searchResults: {} }],
    ['without search results', { version: SCHEMA_VERSION, event: {}, setupLocations: [] }],
  ]) {
    test(`say a setup that's ${name} is damaged`, async () => {
      const fragment = value === null ? `${SHARE_PREFIX}${deflateRawSync(Buffer.from('{"version":')).toString('base64url')}` : fragmentOf(value);
      assert.deepEqual(await readShareFragment(fragment), { status: 'damaged' });
    });
  }

  test('say a link that decompresses to something huge is damaged, without reading all of it', async () => {
    const fragment = `${SHARE_PREFIX}${deflateRawSync(Buffer.alloc(5_000_000, ' ')).toString('base64url')}`;
    assert.deepEqual(await readShareFragment(fragment), { status: 'damaged' });
  });

  test("say a browser that can't decompress needs updating, rather than that the link is damaged", async (context) => {
    const { DecompressionStream } = globalThis;
    context.after(() => (globalThis.DecompressionStream = DecompressionStream));
    delete globalThis.DecompressionStream;
    assert.equal(canCompress(), false);
    assert.deepEqual(await readShareFragment(await shareFragment(sampleState())), { status: 'unsupported' });
  });
});

describe('preparedShareFragment', () => {
  test('gives the fragment straight away once it has been made, until the setup changes', async () => {
    const state = sampleState();
    const fragment = await shareFragment(state);
    assert.equal(preparedShareFragment(state), fragment);
    // Ticks and settings aren't shared, so they don't change it.
    assert.equal(preparedShareFragment({ ...state, settings: { ...state.settings, speedKmh: 5 }, setupLocations: state.setupLocations.map((row) => ({ ...row, isVisited: true })) }), fragment);
    assert.equal(preparedShareFragment({ ...state, setupLocations: [...state.setupLocations, { id: 'e', text: 'Mayfair' }] }), null);
  });
});
