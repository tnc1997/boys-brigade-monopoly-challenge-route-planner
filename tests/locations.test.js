import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { FINISH_KEY, START_KEY, cleanRecords, isPoints, isScored, locationPoints, newLocationId, parsePoints, pointsById, resolveRecord, resolveRecords, resolveText, usableLocations, visitedKeys } from '../locations.js';
import { searchKey } from '../search.js';

const queenSquare = { isFound: true, lat: 51.4504, lng: -2.5947, name: 'Queen Square, City Centre, Bristol' };

/** A v4 UUID, RFC 4122 variant. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newLocationId', () => {
  test('makes a different v4 UUID each time', () => {
    const ids = new Set(Array.from({ length: 100 }, newLocationId));
    assert.equal(ids.size, 100);
    assert.ok([...ids].every((id) => UUID_V4.test(id)));
  });

  test('makes v4 UUIDs without randomUUID, which needs a secure context', () => {
    const { randomUUID } = crypto;
    crypto.randomUUID = undefined;
    try {
      const ids = new Set(Array.from({ length: 100 }, newLocationId));
      assert.equal(ids.size, 100);
      assert.ok([...ids].every((id) => UUID_V4.test(id)), [...ids][0]);
    } finally {
      delete crypto.randomUUID;
    }
    assert.equal(crypto.randomUUID, randomUUID);
  });
});

describe('START_KEY and FINISH_KEY', () => {
  test('are different fixed v4 UUIDs', () => {
    assert.match(START_KEY, UUID_V4);
    assert.match(FINISH_KEY, UUID_V4);
    assert.notEqual(START_KEY, FINISH_KEY);
  });
});

describe('resolveText', () => {
  test('ignores blank text', () => {
    assert.deepEqual(resolveText('  ', 'a', {}), { status: 'empty' });
  });

  test('uses coordinates directly, without a search', () => {
    assert.deepEqual(resolveText('51.4545,-2.5879', 'a', {}), {
      status: 'coordinates',
      location: { lat: 51.4545, lng: -2.5879, label: '51.4545,-2.5879', key: 'a' },
    });
    assert.equal(resolveText('51.4545, -2.5879', 'a', {}).status, 'coordinates');
  });

  test('names a location that is only coordinates by them, or the name given', () => {
    assert.equal(resolveText(' 51.4545, -2.5879 ', 'a', {}).location.label, '51.4545, -2.5879');
    assert.equal(resolveText('51.4545,-2.5879', 'start', {}, { coordinatesLabel: 'Start' }).location.label, 'Start');
  });

  test('searches for text with coordinates and other text, as it is', () => {
    assert.equal(resolveText('Old Kent Road 51.4545,-2.5879', 'a', {}).status, 'unknown');
  });

  test('says when coordinates are out of range', () => {
    assert.match(resolveText('91.0,-2.5', 'a', {}).error, /latitude 91.0 must be between -90 and 90/);
    assert.match(resolveText('51.4,-181.0', 'a', {}).error, /longitude -181.0 must be between -180 and 180/);
  });

  test('needs looking up when its search result is not known yet', () => {
    assert.deepEqual(resolveText(' Queen Square, Bristol ', 'a', {}), { status: 'unknown', label: 'Queen Square, Bristol', query: 'Queen Square, Bristol' });
  });

  test('searches for text with more than one set of coordinates, as it is', () => {
    assert.equal(resolveText('51.45,-2.59 51.46,-2.58', 'a', {}).status, 'unknown');
  });

  test('uses the search result once it is known, for the text without its ends\' spaces', () => {
    assert.deepEqual(resolveText(' Queen Square, Bristol ', 'a', { [searchKey('Queen Square, Bristol')]: queenSquare }), {
      status: 'found',
      location: { lat: 51.4504, lng: -2.5947, label: 'Queen Square, Bristol', key: 'a', matchedName: 'Queen Square, City Centre, Bristol' },
    });
  });

  test('needs looking up again when only the case is different', () => {
    assert.equal(resolveText('queen square, bristol', 'a', { [searchKey('Queen Square, Bristol')]: queenSquare }).status, 'unknown');
  });

  test('works for text that is a name built into objects', () => {
    assert.equal(resolveText('constructor', 'a', {}).status, 'unknown');
  });

  test('says why a search found nothing', () => {
    const searchResults = { [searchKey('Nowhere')]: { isFound: false, error: 'No match for "Nowhere" in Bristol.', isTemporary: false } };
    assert.deepEqual(resolveText('Nowhere', 'a', searchResults), { status: 'notFound', label: 'Nowhere', error: 'No match for "Nowhere" in Bristol.' });
  });

  test('searches for Google Maps links and what3words addresses as text', () => {
    assert.equal(resolveText('///filled.count.soap', 'a', {}).status, 'unknown');
    assert.equal(resolveText('https://maps.app.goo.gl/abc', 'a', {}).status, 'unknown');
  });
});

describe('resolveRecord', () => {
  test('uses the pin, whatever the text, and keeps the text as the name', () => {
    const record = { id: 'a', text: 'Queen Square, Bristol', pin: { lat: 51.45, lng: -2.59 } };
    assert.deepEqual(resolveRecord(record, 3, { [searchKey('Queen Square, Bristol')]: queenSquare }), {
      status: 'pinned',
      location: { lat: 51.45, lng: -2.59, label: 'Queen Square, Bristol', key: 'a' },
    });
  });

  test('names a pinned row with no text by its position in the list', () => {
    assert.equal(resolveRecord({ id: 'a', text: ' ', pin: { lat: 51.45, lng: -2.59 } }, 3, {}).location.label, 'Location 3');
  });

  test("uses the row's id as the location's key", () => {
    assert.equal(resolveRecord({ id: 'xyz', text: '51.45,-2.59' }, 1, {}).location.key, 'xyz');
  });
});

describe('isPoints', () => {
  test('accepts whole numbers from 0 to 9999', () => {
    assert.deepEqual([0, 5, 20, 9999, 10000, 1e23, 1.5, -1, NaN, Infinity, '5', null].map(isPoints), [true, true, true, true, false, false, false, false, false, false, false, false]);
  });
});

describe('parsePoints', () => {
  test('reads whole numbers, with blank meaning Points per location', () => {
    assert.deepEqual(parsePoints(' 20 '), { isValid: true, points: 20 });
    assert.deepEqual(parsePoints('0'), { isValid: true, points: 0 });
    assert.deepEqual(parsePoints('  '), { isValid: true, points: null });
  });

  test('says what is wrong with anything else', () => {
    for (const text of ['2.5', '-1', 'ten', '1e3', '+5', '10000', '100000000000000000000000']) {
      assert.deepEqual(parsePoints(text), { isValid: false, error: 'Enter a whole number of points from 0 to 9999, or leave it blank.' }, text);
    }
  });
});

describe('locationPoints, pointsById and isScored', () => {
  test("uses a row's own points, or Points per location", () => {
    assert.equal(locationPoints({ id: 'a', text: 'A', points: 20 }, 10), 20);
    assert.equal(locationPoints({ id: 'a', text: 'A', points: 0 }, 10), 0);
    assert.equal(locationPoints({ id: 'a', text: 'A' }, 10), 10);
    assert.equal(locationPoints(undefined, 10), 10);
  });

  test("works out every row's points by its id", () => {
    assert.deepEqual(pointsById([{ id: 'a', text: 'A', points: 20 }, { id: 'b', text: 'B' }], 10), new Map([['a', 20], ['b', 10]]));
  });

  test('says scores vary once any row has its own points, even if it equals the default', () => {
    assert.equal(isScored([{ id: 'a', text: 'A' }]), false);
    assert.equal(isScored([{ id: 'a', text: 'A' }, { id: 'b', text: 'B', points: 10 }]), true);
  });
});

describe('visitedKeys', () => {
  test("gets the ids of the visited rows", () => {
    assert.deepEqual(visitedKeys([{ id: 'a', text: 'A', isVisited: true }, { id: 'b', text: 'B' }]), ['a']);
  });
});

describe('resolveRecords and usableLocations', () => {
  test('numbers the rows and gets the locations that can be planned', () => {
    const records = [
      { id: 'a', text: '51.4545,-2.5879' },
      { id: 'b', text: 'Nowhere' },
      { id: 'c', text: '', pin: { lat: 51.45, lng: -2.59 } },
    ];
    const rows = resolveRecords(records, {});
    assert.deepEqual(rows.map(({ number, resolved }) => [number, resolved.status]), [
      [1, 'coordinates'],
      [2, 'unknown'],
      [3, 'pinned'],
    ]);
    assert.deepEqual(usableLocations(rows).map(({ label }) => label), ['51.4545,-2.5879', 'Location 3']);
  });
});

describe('cleanRecords', () => {
  test('keeps rows with text or a pin', () => {
    const records = [
      { id: 'a', text: 'Queen Square' },
      { id: 'b', text: '', pin: { lat: 51.45, lng: -2.59 } },
    ];
    assert.deepEqual(cleanRecords(records), records);
  });

  test('drops blank rows, rows without an id and repeated ids', () => {
    const records = [{ id: 'a', text: ' ' }, { text: 'No id' }, { id: 'b', text: 'B' }, { id: 'b', text: 'Again' }, null, 'text'];
    assert.deepEqual(cleanRecords(records), [{ id: 'b', text: 'B' }]);
  });

  test('keeps points only when they are a whole number from 0 to 9999', () => {
    const records = [
      { id: 'a', text: 'A', points: 20 },
      { id: 'b', text: 'B', points: 0 },
      { id: 'c', text: 'C', points: 2.5 },
      { id: 'd', text: 'D', points: -1 },
      { id: 'e', text: 'E', points: '20' },
    ];
    assert.deepEqual(cleanRecords(records), [{ id: 'a', text: 'A', points: 20 }, { id: 'b', text: 'B', points: 0 }, { id: 'c', text: 'C' }, { id: 'd', text: 'D' }, { id: 'e', text: 'E' }]);
  });

  test('keeps isMustVisit only when it is true', () => {
    assert.deepEqual(cleanRecords([{ id: 'a', text: 'A', isMustVisit: true }, { id: 'b', text: 'B', isMustVisit: 1 }]), [
      { id: 'a', text: 'A', isMustVisit: true },
      { id: 'b', text: 'B' },
    ]);
  });

  test('keeps isVisited only when it is true', () => {
    assert.deepEqual(cleanRecords([{ id: 'a', text: 'A', isVisited: true }, { id: 'b', text: 'B', isVisited: false }, { id: 'c', text: 'C', isVisited: 'yes' }]), [
      { id: 'a', text: 'A', isVisited: true },
      { id: 'b', text: 'B' },
      { id: 'c', text: 'C' },
    ]);
  });

  test('leaves out a pin that is null, and fields it does not know', () => {
    assert.deepEqual(cleanRecords([{ id: 'a', text: 'A', pin: null, colour: 'red' }]), [{ id: 'a', text: 'A' }]);
  });

  test('drops pins that are out of range or not numbers', () => {
    assert.deepEqual(cleanRecords([{ id: 'a', text: 'A', pin: { lat: '51', lng: -2.59 } }, { id: 'b', text: 'B', pin: { lat: 91, lng: 0 } }]), [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ]);
  });

  test('returns no rows for anything but a list', () => {
    assert.deepEqual(cleanRecords(undefined), []);
    assert.deepEqual(cleanRecords({ id: 'a' }), []);
  });
});
