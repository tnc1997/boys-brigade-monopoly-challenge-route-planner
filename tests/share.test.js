import assert from 'node:assert/strict';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { describe, test } from 'node:test';

import { searchKey } from '../search.js';
import { SHARE_PREFIX, canCompress, preparedShareFragment, readShareFragment, shareFragment, sharedListOf } from '../share.js';
import { SCHEMA_VERSION, defaultState } from '../storage.js';

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

/** A shared list as {@link sampleState} would make, as JSON for {@link fragmentOf} to change. */
const sampleSharedList = () => JSON.parse(JSON.stringify(sharedListOf(sampleState())));

describe('sharedListOf', () => {
  test('shares the rows without their ids or ticks, the event, and the search results for the shared texts except pinned rows', () => {
    const sharedList = sharedListOf(sampleState());
    assert.deepEqual(sharedList, {
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
    const sharedList = sharedListOf(sampleState());
    assert.deepEqual(Object.keys(sharedList).sort(), ['event', 'searchResults', 'setupLocations', 'version']);
  });
});

describe('shareFragment and readShareFragment', () => {
  test('can compress in this environment', () => {
    assert.equal(canCompress(), true);
  });

  test('recreate the list, the event and the search results, with new ids and no ticks', async () => {
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
    const sharedList = jsonOf(await shareFragment(state));
    assert.equal(sharedList.event.pointsPerSet, 50);
    assert.deepEqual(sharedList.setupLocations, [{ text: 'Old Kent Road', set: 'red' }]);
  });

  test('make a fragment that only uses characters safe in a URL', async () => {
    const state = { ...sampleState(), setupLocations: [{ id: 'a', text: 'Café “Ñ” 🎲 & ?#/+' }] };
    assert.match(await shareFragment(state), /^#list=[A-Za-z0-9_-]+$/);
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

  test('ignore a fragment without a shared list', async () => {
    assert.deepEqual(await readShareFragment(''), { status: 'none' });
    assert.deepEqual(await readShareFragment('#map'), { status: 'none' });
  });

  test("say a list shared with a newer schema version can't be read, rather than reading part of it", async () => {
    assert.deepEqual(await readShareFragment(fragmentOf({ ...sampleSharedList(), version: SCHEMA_VERSION + 1 })), { status: 'newer' });
  });

  for (const [name, change] of [
    ['a row field', (sharedList) => (sharedList.setupLocations[0].colourOfTheDay = 'red')],
    ['an event field', (sharedList) => (sharedList.event.bonusPerHour = 5)],
    ['a pin field', (sharedList) => (sharedList.setupLocations[1].pin.accuracy = 5)],
  ]) {
    test(`say a list with ${name} this version doesn't know can't be read, rather than dropping it`, async () => {
      const sharedList = sampleSharedList();
      change(sharedList);
      assert.deepEqual(await readShareFragment(fragmentOf(sharedList)), { status: 'newer' });
    });
  }

  for (const [name, change] of [
    ['points', (sharedList) => (sharedList.setupLocations[0].points = 99999)],
    ['an At', (sharedList) => (sharedList.setupLocations[0].at = '12:00:30')],
    ['Must visit', (sharedList) => (sharedList.setupLocations[0].isMustVisit = 'yes')],
    ['a pin', (sharedList) => (sharedList.setupLocations[1].pin = { lat: 100, lng: 0 })],
    ['Points per location', (sharedList) => (sharedList.event.pointsPerLocation = 2.5)],
    ['a deadline', (sharedList) => (sharedList.event.deadline = 1600)],
    ['a check-in form', (sharedList) => (sharedList.event.checkInFormUrl = 'javascript:alert(1)')],
    ['a row', (sharedList) => sharedList.setupLocations.push('Old Kent Road')],
    ['a row with no text or pin', (sharedList) => sharedList.setupLocations.push({ text: '  ' })],
  ]) {
    test(`say a list with a value for ${name} that this version doesn't allow can't be read, rather than dropping it`, async () => {
      const sharedList = sampleSharedList();
      change(sharedList);
      assert.deepEqual(await readShareFragment(fragmentOf(sharedList)), { status: 'newer' });
    });
  }

  test('fill in event fields missing from a list shared by an earlier version with their defaults', async () => {
    const sharedList = sampleSharedList();
    delete sharedList.event.pointsPerLocation;
    const result = await readShareFragment(fragmentOf(sharedList));
    assert.equal(result.status, 'read');
    assert.equal(result.shared.event.pointsPerLocation, defaultState().event.pointsPerLocation);
  });

  test("give rows new ids and no ticks, even if the link has them", async () => {
    const sharedList = sampleSharedList();
    sharedList.setupLocations[0].id = 'chosen-id';
    sharedList.setupLocations[0].isVisited = true;
    const result = await readShareFragment(fragmentOf(sharedList));
    assert.equal(result.status, 'read');
    assert.match(result.shared.setupLocations[0].id, UUID);
    assert.equal(result.shared.setupLocations[0].isVisited, undefined);
  });

  test('only keep search results for the shared texts, with the right shape', async () => {
    const sharedList = {
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
    const result = await readShareFragment(fragmentOf(sharedList));
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
    test(`say a list that's ${name} is damaged`, async () => {
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
  test('gives the fragment straight away once it has been made, until the list changes', async () => {
    const state = sampleState();
    const fragment = await shareFragment(state);
    assert.equal(preparedShareFragment(state), fragment);
    // Ticks and settings aren't shared, so they don't change it.
    assert.equal(preparedShareFragment({ ...state, settings: { ...state.settings, speedKmh: 5 }, setupLocations: state.setupLocations.map((row) => ({ ...row, isVisited: true })) }), fragment);
    assert.equal(preparedShareFragment({ ...state, setupLocations: [...state.setupLocations, { id: 'e', text: 'Mayfair' }] }), null);
  });
});
