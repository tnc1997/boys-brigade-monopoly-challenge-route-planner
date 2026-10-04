import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { cleanRecords, locationKey, newLocationId, resolveRecord, resolveRecords, resolveText, usableLocations } from '../locations.js';

const queenSquare = { isFound: true, lat: 51.4504, lng: -2.5947, name: 'Queen Square, City Centre, Bristol' };

describe('locationKey', () => {
  test('gives the same key to the same coordinates written differently', () => {
    assert.equal(locationKey(51.4545, -2.5879), locationKey(51.454500001, -2.58790000));
    assert.equal(locationKey(51.4545, -2.5879), '51.454500,-2.587900');
  });

  test('never gives -0', () => {
    assert.equal(locationKey(51.4779, -0.0000001), '51.477900,0.000000');
  });
});

describe('newLocationId', () => {
  test('makes a different id each time', () => {
    const ids = new Set(Array.from({ length: 100 }, newLocationId));
    assert.equal(ids.size, 100);
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
    assert.equal(resolveText(' 51.4545,  -2.5879 ', 'a', {}).location.label, '51.4545, -2.5879');
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
    assert.deepEqual(resolveText(' Queen  Square, Bristol ', 'a', {}), { status: 'unknown', label: 'Queen Square, Bristol', query: 'Queen Square, Bristol' });
  });

  test('searches for text with more than one set of coordinates, as it is', () => {
    assert.equal(resolveText('51.45,-2.59 51.46,-2.58', 'a', {}).status, 'unknown');
  });

  test('uses the search result once it is known, whatever the spacing and case', () => {
    assert.deepEqual(resolveText('QUEEN square, bristol', 'a', { 'queen square, bristol': queenSquare }), {
      status: 'found',
      location: { lat: 51.4504, lng: -2.5947, label: 'QUEEN square, bristol', key: 'a', matchedName: 'Queen Square, City Centre, Bristol' },
    });
  });

  test('says why a search found nothing', () => {
    const searchResults = { nowhere: { isFound: false, error: 'No match for "Nowhere" in Bristol.', isTemporary: false } };
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
    assert.deepEqual(resolveRecord(record, 3, { 'queen square, bristol': queenSquare }), {
      status: 'pinned',
      location: { lat: 51.45, lng: -2.59, label: 'Queen Square, Bristol', key: 'a' },
    });
  });

  test('names a pinned row with no text by its position in the list', () => {
    assert.equal(resolveRecord({ id: 'a', text: ' ', pin: { lat: 51.45, lng: -2.59 } }, 3, {}).location.label, 'Location 3');
  });

  test("uses the row's id as the location's key", () => {
    assert.equal(resolveRecord({ id: 'xyz', text: '51.45,-2.59', pin: null }, 1, {}).location.key, 'xyz');
  });
});

describe('resolveRecords and usableLocations', () => {
  test('numbers the rows and gets the locations that can be planned', () => {
    const records = [
      { id: 'a', text: '51.4545,-2.5879', pin: null },
      { id: 'b', text: 'Nowhere', pin: null },
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
      { id: 'a', text: 'Queen Square', pin: null },
      { id: 'b', text: '', pin: { lat: 51.45, lng: -2.59 } },
    ];
    assert.deepEqual(cleanRecords(records), records);
  });

  test('drops blank rows, rows without an id and repeated ids', () => {
    const records = [{ id: 'a', text: ' ', pin: null }, { text: 'No id' }, { id: 'b', text: 'B' }, { id: 'b', text: 'Again' }, null, 'text'];
    assert.deepEqual(cleanRecords(records), [{ id: 'b', text: 'B', pin: null }]);
  });

  test('drops pins that are out of range or not numbers', () => {
    assert.deepEqual(cleanRecords([{ id: 'a', text: 'A', pin: { lat: '51', lng: -2.59 } }, { id: 'b', text: 'B', pin: { lat: 91, lng: 0 } }]), [
      { id: 'a', text: 'A', pin: null },
      { id: 'b', text: 'B', pin: null },
    ]);
  });

  test('returns no rows for anything but a list', () => {
    assert.deepEqual(cleanRecords(undefined), []);
    assert.deepEqual(cleanRecords({ id: 'a' }), []);
  });
});
