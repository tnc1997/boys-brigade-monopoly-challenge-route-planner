import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { describe, test } from 'node:test';

import { searchKey } from '../search.js';
import { SHARE_PREFIX, readShareFragment, shareFragment, sharedListOf, sharedState } from '../share.js';
import { SCHEMA_VERSION, defaultState } from '../storage.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Makes a fragment for any JSON value, as a link from another version or a damaged one might have. */
const fragmentOf = (value) => `${SHARE_PREFIX}${deflateRawSync(Buffer.from(JSON.stringify(value))).toString('base64url')}`;

/** Shares a state and opens the link, returning what opening it changes. */
const roundTrip = async (state) => {
  const result = await readShareFragment(await shareFragment(state));
  assert.equal(result.status, 'read');
  return sharedState(result.sharedList);
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
    [searchKey('Nowhere Lane')]: { isFound: false, error: 'Not found.', isTemporary: false },
    [searchKey('Somewhere else')]: { isFound: true, lat: 51.4, lng: -2.5, name: 'Somewhere else' },
  },
  plan: { order: [0] },
  view: 'map',
});

describe('sharedListOf', () => {
  test('shares the rows without their ids or ticks, the event, and only the search results for the shared texts', () => {
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
      searchResults: {
        'Castle Park': { isFound: true, lat: 51.4556, lng: -2.5894, name: 'Castle Park, Bristol' },
        'Queen Square': { isFound: true, lat: 51.45, lng: -2.595, name: 'Queen Square, Bristol' },
        'Old Kent Road': { isFound: true, lat: 51.46, lng: -2.58, name: 'Old Kent Road, Bristol' },
        'Nowhere Lane': { isFound: false, error: 'Not found.', isTemporary: false },
      },
    });
  });

  test("doesn't share the settings, the plan or the chosen tab", () => {
    const sharedList = sharedListOf(sampleState());
    assert.deepEqual(Object.keys(sharedList).sort(), ['event', 'searchResults', 'setupLocations', 'version']);
  });
});

describe('shareFragment and readShareFragment', () => {
  test('recreate the list, the event and the search results, with new ids and no ticks', async () => {
    const state = sampleState();
    const opened = await roundTrip(state);
    assert.deepEqual(opened.event, state.event);
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
    const { [searchKey('Somewhere else')]: unshared, ...shared } = state.searchResults;
    assert.deepEqual(opened.searchResults, shared);
  });

  test('carry row and event fields added later, such as a colour set and Points per set, without changing the encoding', async () => {
    const state = { ...defaultState(), event: { ...defaultState().event, pointsPerSet: 50 }, setupLocations: [{ id: 'a', text: 'Old Kent Road', set: 'red', isVisited: true }] };
    const result = await readShareFragment(await shareFragment(state));
    assert.equal(result.status, 'read');
    assert.equal(result.sharedList.event.pointsPerSet, 50);
    assert.deepEqual(result.sharedList.setupLocations, [{ text: 'Old Kent Road', set: 'red' }]);
  });

  test('make a fragment that only uses characters safe in a URL', async () => {
    const fragment = await shareFragment({ ...sampleState(), setupLocations: [{ id: 'a', text: 'Café “Ñ” 🎲 & ?#/+' }] });
    assert.match(fragment, /^#list=[A-Za-z0-9_-]+$/);
    const opened = await roundTrip({ ...sampleState(), setupLocations: [{ id: 'a', text: 'Café “Ñ” 🎲 & ?#/+' }] });
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

  test("say a list shared by a newer version can't be read, rather than reading part of it", async () => {
    const sharedList = { ...sharedListOf(sampleState()), version: SCHEMA_VERSION + 1 };
    assert.deepEqual(await readShareFragment(fragmentOf(sharedList)), { status: 'newer' });
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

  test("say a link that decompresses to something huge is damaged, without reading all of it", async () => {
    const fragment = `${SHARE_PREFIX}${deflateRawSync(Buffer.alloc(5_000_000, ' ')).toString('base64url')}`;
    assert.deepEqual(await readShareFragment(fragment), { status: 'damaged' });
  });
});

describe('sharedState', () => {
  test('checks the shared list as saved state is checked', () => {
    const opened = sharedState({
      version: SCHEMA_VERSION,
      event: { startText: 7, finishText: 'Queen Square', deadline: '15:00', checkInFormUrl: 'javascript:alert(1)', pointsPerLocation: -1, unknown: true },
      setupLocations: [
        'not a row',
        { text: 'Old Kent Road', points: 2.5, at: '25:00', isMustVisit: 'yes', pin: { lat: 100, lng: 0 } },
        { text: '   ' },
        { text: 'Whitechapel', id: 'chosen-id', isVisited: true },
      ],
      searchResults: {},
    });
    const defaults = defaultState().event;
    assert.deepEqual(opened.event, { ...defaults, finishText: 'Queen Square', deadline: '15:00' });
    assert.deepEqual(
      opened.setupLocations.map(({ id, ...row }) => row),
      [{ text: 'Old Kent Road' }, { text: 'Whitechapel' }],
    );
    assert.notEqual(opened.setupLocations[1].id, 'chosen-id');
    assert.match(opened.setupLocations[1].id, UUID);
  });

  test('only keeps search results for the shared texts, with the right shape', () => {
    const opened = sharedState({
      version: SCHEMA_VERSION,
      event: { ...defaultState().event, startText: 'Castle Park', finishText: '' },
      setupLocations: [{ text: 'Old Kent Road' }, { text: 'Whitechapel' }, { text: 'Bow Street' }, { text: 'Pall Mall' }, { text: '__proto__' }],
      searchResults: {
        'Castle Park': { isFound: true, lat: 51.4556, lng: -2.5894, name: 'Castle Park', extra: 1 },
        'Old Kent Road': { isFound: true, lat: 91, lng: 0, name: 'Too far north' },
        Whitechapel: { isFound: false, error: 'No signal', isTemporary: true },
        'Bow Street': { isFound: false, error: 'Not found.', isTemporary: false },
        'Pall Mall': 'found',
        'Not in the list': { isFound: true, lat: 51, lng: -2, name: 'Not in the list' },
      },
    });
    assert.deepEqual(opened.searchResults, {
      [searchKey('Castle Park')]: { isFound: true, lat: 51.4556, lng: -2.5894, name: 'Castle Park' },
      [searchKey('Bow Street')]: { isFound: false, error: 'Not found.', isTemporary: false },
    });
  });
});
