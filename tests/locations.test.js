import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { FINISH_KEY, START_KEY, atError, cleanSetupLocations, hasOwnPoints, isPoints, isTime, newLocationId, parsePoints, pointsById, pointsOf, routeLocationOf, routeLocationOfText, routeLocationsOf, usableRouteLocations, visitedKeys } from '../locations.js';
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

describe('routeLocationOfText', () => {
  test('ignores blank text', () => {
    assert.deepEqual(routeLocationOfText('  ', 'a', {}), { status: 'empty' });
  });

  test('uses coordinates directly, without a search', () => {
    assert.deepEqual(routeLocationOfText('51.4545,-2.5879', 'a', {}), {
      status: 'coordinates',
      routeLocation: { lat: 51.4545, lng: -2.5879, label: '51.4545,-2.5879', key: 'a' },
    });
    assert.equal(routeLocationOfText('51.4545, -2.5879', 'a', {}).status, 'coordinates');
  });

  test('names a location that is only coordinates by them, or the name given', () => {
    assert.equal(routeLocationOfText(' 51.4545, -2.5879 ', 'a', {}).routeLocation.label, '51.4545, -2.5879');
    assert.equal(routeLocationOfText('51.4545,-2.5879', 'start', {}, { coordinatesLabel: 'Start' }).routeLocation.label, 'Start');
  });

  test('searches for text with coordinates and other text, as it is', () => {
    assert.equal(routeLocationOfText('Old Kent Road 51.4545,-2.5879', 'a', {}).status, 'unknown');
  });

  test('says when coordinates are out of range', () => {
    assert.match(routeLocationOfText('91.0,-2.5', 'a', {}).error, /latitude 91.0 must be between -90 and 90/);
    assert.match(routeLocationOfText('51.4,-181.0', 'a', {}).error, /longitude -181.0 must be between -180 and 180/);
  });

  test('needs looking up when its search result is not known yet', () => {
    assert.deepEqual(routeLocationOfText(' Queen Square, Bristol ', 'a', {}), { status: 'unknown', label: 'Queen Square, Bristol', query: 'Queen Square, Bristol' });
  });

  test('searches for text with more than one set of coordinates, as it is', () => {
    assert.equal(routeLocationOfText('51.45,-2.59 51.46,-2.58', 'a', {}).status, 'unknown');
  });

  test('uses the search result once it is known, for the text without its ends\' spaces', () => {
    assert.deepEqual(routeLocationOfText(' Queen Square, Bristol ', 'a', { [searchKey('Queen Square, Bristol')]: queenSquare }), {
      status: 'found',
      routeLocation: { lat: 51.4504, lng: -2.5947, label: 'Queen Square, Bristol', key: 'a', matchedName: 'Queen Square, City Centre, Bristol' },
    });
  });

  test('needs looking up again when only the case is different', () => {
    assert.equal(routeLocationOfText('queen square, bristol', 'a', { [searchKey('Queen Square, Bristol')]: queenSquare }).status, 'unknown');
  });

  test('works for text that is a name built into objects', () => {
    assert.equal(routeLocationOfText('constructor', 'a', {}).status, 'unknown');
  });

  test('says why a search found nothing', () => {
    const searchResults = { [searchKey('Nowhere')]: { isFound: false, error: 'No match for "Nowhere" in Bristol.', isTemporary: false } };
    assert.deepEqual(routeLocationOfText('Nowhere', 'a', searchResults), { status: 'notFound', label: 'Nowhere', error: 'No match for "Nowhere" in Bristol.' });
  });

  test('searches for Google Maps links and what3words addresses as text', () => {
    assert.equal(routeLocationOfText('///filled.count.soap', 'a', {}).status, 'unknown');
    assert.equal(routeLocationOfText('https://maps.app.goo.gl/abc', 'a', {}).status, 'unknown');
  });
});

describe('routeLocationOf', () => {
  test('uses the pin, whatever the text, and keeps the text as the name', () => {
    const setupLocation = { id: 'a', text: 'Queen Square, Bristol', pin: { lat: 51.45, lng: -2.59 } };
    assert.deepEqual(routeLocationOf(setupLocation, 3, { [searchKey('Queen Square, Bristol')]: queenSquare }), {
      status: 'pinned',
      routeLocation: { lat: 51.45, lng: -2.59, label: 'Queen Square, Bristol', key: 'a' },
    });
  });

  test('names a pinned row with no text by its position in the list', () => {
    assert.equal(routeLocationOf({ id: 'a', text: ' ', pin: { lat: 51.45, lng: -2.59 } }, 3, {}).routeLocation.label, 'Location 3');
  });

  test("uses the row's id as the location's key", () => {
    assert.equal(routeLocationOf({ id: 'xyz', text: '51.45,-2.59' }, 1, {}).routeLocation.key, 'xyz');
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

describe('pointsOf, pointsById and hasOwnPoints', () => {
  test("uses a row's own points, or Points per location", () => {
    assert.equal(pointsOf({ id: 'a', text: 'A', points: 20 }, 10), 20);
    assert.equal(pointsOf({ id: 'a', text: 'A', points: 0 }, 10), 0);
    assert.equal(pointsOf({ id: 'a', text: 'A' }, 10), 10);
    assert.equal(pointsOf(undefined, 10), 10);
  });

  test("works out every row's points by its id", () => {
    assert.deepEqual(pointsById([{ id: 'a', text: 'A', points: 20 }, { id: 'b', text: 'B' }], 10), new Map([['a', 20], ['b', 10]]));
  });

  test('says a location has its own points once any row has them, even if they equal the default', () => {
    assert.equal(hasOwnPoints([{ id: 'a', text: 'A' }]), false);
    assert.equal(hasOwnPoints([{ id: 'a', text: 'A' }, { id: 'b', text: 'B', points: 10 }]), true);
  });
});

describe('isTime', () => {
  test('accepts times of day as HH:MM', () => {
    assert.deepEqual(['00:00', '09:05', '13:30', '23:59', '24:00', '9:05', '13:60', '13:30:00', ' 13:30', '', 1330, null].map(isTime), [true, true, true, true, false, false, false, false, false, false, false, false]);
  });
});

describe('atError', () => {
  const event = { startTime: '11:00', deadline: '16:00' };

  test('accepts a time between the start time and the deadline, including both', () => {
    for (const at of ['11:00', '13:30', '16:00']) {
      assert.equal(atError(at, event), null, at);
    }
  });

  test('says what is wrong with a time before the start time or after the deadline', () => {
    for (const at of ['10:59', '16:01']) {
      assert.equal(atError(at, event), 'At must be between 11:00 and 16:00.', at);
    }
  });

  test('only checks the deadline without a start time, since the route starts when it is planned', () => {
    assert.equal(atError('08:00', { startTime: '', deadline: '16:00' }), null);
    assert.equal(atError('16:30', { startTime: '', deadline: '16:00' }), 'At must be by the deadline, 16:00.');
  });

  test('only checks the start time without a deadline, which planning says is missing', () => {
    assert.equal(atError('18:00', { startTime: '11:00', deadline: '' }), null);
    assert.equal(atError('10:00', { startTime: '11:00', deadline: '' }), 'At must be after the start time, 11:00.');
  });
});

describe('visitedKeys', () => {
  test("gets the ids of the visited rows", () => {
    assert.deepEqual(visitedKeys([{ id: 'a', text: 'A', isVisited: true }, { id: 'b', text: 'B' }]), ['a']);
  });
});

describe('routeLocationsOf and usableRouteLocations', () => {
  test('gets each setup location\'s result and the route locations that can be planned, naming a pinned one without text by its position', () => {
    const setupLocations = [
      { id: 'a', text: '51.4545,-2.5879' },
      { id: 'b', text: 'Nowhere' },
      { id: 'c', text: '', pin: { lat: 51.45, lng: -2.59 } },
    ];
    const routeLocationResults = routeLocationsOf(setupLocations, {});
    assert.deepEqual(routeLocationResults.map(({ status }) => status), ['coordinates', 'unknown', 'pinned']);
    assert.deepEqual(usableRouteLocations(setupLocations, {}).map(({ label }) => label), ['51.4545,-2.5879', 'Location 3']);
  });
});

describe('cleanSetupLocations', () => {
  test('keeps rows with text or a pin', () => {
    const setupLocations = [
      { id: 'a', text: 'Queen Square' },
      { id: 'b', text: '', pin: { lat: 51.45, lng: -2.59 } },
    ];
    assert.deepEqual(cleanSetupLocations(setupLocations), setupLocations);
  });

  test('drops blank rows, rows without an id and repeated ids', () => {
    const setupLocations = [{ id: 'a', text: ' ' }, { text: 'No id' }, { id: 'b', text: 'B' }, { id: 'b', text: 'Again' }, null, 'text'];
    assert.deepEqual(cleanSetupLocations(setupLocations), [{ id: 'b', text: 'B' }]);
  });

  test('keeps points only when they are a whole number from 0 to 9999', () => {
    const setupLocations = [
      { id: 'a', text: 'A', points: 20 },
      { id: 'b', text: 'B', points: 0 },
      { id: 'c', text: 'C', points: 2.5 },
      { id: 'd', text: 'D', points: -1 },
      { id: 'e', text: 'E', points: '20' },
    ];
    assert.deepEqual(cleanSetupLocations(setupLocations), [{ id: 'a', text: 'A', points: 20 }, { id: 'b', text: 'B', points: 0 }, { id: 'c', text: 'C' }, { id: 'd', text: 'D' }, { id: 'e', text: 'E' }]);
  });

  test('keeps at only when it is a time as HH:MM', () => {
    assert.deepEqual(cleanSetupLocations([{ id: 'a', text: 'A', at: '13:30' }, { id: 'b', text: 'B', at: '25:00' }, { id: 'c', text: 'C', at: '' }, { id: 'd', text: 'D', at: 1330 }]), [
      { id: 'a', text: 'A', at: '13:30' },
      { id: 'b', text: 'B' },
      { id: 'c', text: 'C' },
      { id: 'd', text: 'D' },
    ]);
  });

  test('keeps isMustVisit only when it is true', () => {
    assert.deepEqual(cleanSetupLocations([{ id: 'a', text: 'A', isMustVisit: true }, { id: 'b', text: 'B', isMustVisit: 1 }]), [
      { id: 'a', text: 'A', isMustVisit: true },
      { id: 'b', text: 'B' },
    ]);
  });

  test('keeps isVisited only when it is true', () => {
    assert.deepEqual(cleanSetupLocations([{ id: 'a', text: 'A', isVisited: true }, { id: 'b', text: 'B', isVisited: false }, { id: 'c', text: 'C', isVisited: 'yes' }]), [
      { id: 'a', text: 'A', isVisited: true },
      { id: 'b', text: 'B' },
      { id: 'c', text: 'C' },
    ]);
  });

  test('leaves out a pin that is null, and fields it does not know', () => {
    assert.deepEqual(cleanSetupLocations([{ id: 'a', text: 'A', pin: null, colour: 'red' }]), [{ id: 'a', text: 'A' }]);
  });

  test('drops pins that are out of range or not numbers', () => {
    assert.deepEqual(cleanSetupLocations([{ id: 'a', text: 'A', pin: { lat: '51', lng: -2.59 } }, { id: 'b', text: 'B', pin: { lat: 91, lng: 0 } }]), [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ]);
  });

  test('returns no rows for anything but a list', () => {
    assert.deepEqual(cleanSetupLocations(undefined), []);
    assert.deepEqual(cleanSetupLocations({ id: 'a' }), []);
  });
});
