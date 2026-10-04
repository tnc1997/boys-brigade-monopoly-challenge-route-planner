import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { migrateLocationsText } from '../legacy.js';

const searchResults = {
  'queen square, bristol': { isFound: true, lat: 51.4504, lng: -2.5947, name: 'Queen Square, City Centre, Bristol' },
  nowhere: { isFound: false, error: 'No match', isTemporary: false },
};

/** The rows' text and pins, without their random ids. */
const withoutIds = (records) => records.map(({ text, pin }) => ({ text, pin }));

describe('migrateLocationsText', () => {
  test('makes one row per non-blank line, each with its own id', () => {
    const { records } = migrateLocationsText('Queen Square, Bristol\n\n  \r\nNowhere\n', searchResults);
    assert.equal(records.length, 2);
    assert.notEqual(records[0].id, records[1].id);
  });

  test('pins lines with coordinates, named with their label', () => {
    const { records } = migrateLocationsText('Old Kent Road 51.4545,-2.5879\n51.4492, -2.5813', searchResults);
    assert.deepEqual(withoutIds(records), [
      { text: 'Old Kent Road', pin: { lat: 51.4545, lng: -2.5879 } },
      { text: '51.4492, -2.5813', pin: { lat: 51.4492, lng: -2.5813 } },
    ]);
  });

  test('pins lines with Google Maps links, named with their label or the place', () => {
    const text = [
      'Cabot Tower https://www.google.com/maps?q=51.4517,-2.6034',
      'https://www.google.com/maps/place/Cabot+Tower/@51.45,-2.60,17z/data=!3d51.4517!4d-2.6034',
    ].join('\n');
    assert.deepEqual(withoutIds(migrateLocationsText(text, searchResults).records), [
      { text: 'Cabot Tower', pin: { lat: 51.4517, lng: -2.6034 } },
      { text: 'Cabot Tower', pin: { lat: 51.4517, lng: -2.6034 } },
    ]);
  });

  test('keeps looked-up lines as text, which uses the saved search result', () => {
    assert.deepEqual(withoutIds(migrateLocationsText('Queen Square, Bristol', searchResults).records), [{ text: 'Queen Square, Bristol', pin: null }]);
  });

  test('pins labelled looked-up lines where they were found, named with the label', () => {
    assert.deepEqual(withoutIds(migrateLocationsText('Old Kent Road: Queen Square, Bristol', searchResults).records), [
      { text: 'Old Kent Road', pin: { lat: 51.4504, lng: -2.5947 } },
    ]);
  });

  test('keeps the text to look up for lines that were never looked up', () => {
    assert.deepEqual(withoutIds(migrateLocationsText('Old Kent Road: Temple Meads', searchResults).records), [{ text: 'Temple Meads', pin: null }]);
  });

  test('keeps any other line as it was typed, to be looked up or pinned again', () => {
    const text = 'Whitechapel ///filled.count.soap\nhttps://maps.app.goo.gl/abc\nNowhere';
    assert.deepEqual(withoutIds(migrateLocationsText(text, searchResults).records), [
      { text: 'Whitechapel ///filled.count.soap', pin: null },
      { text: 'https://maps.app.goo.gl/abc', pin: null },
      { text: 'Nowhere', pin: null },
    ]);
  });

  test("maps each old location key to the ids of the rows at that place", () => {
    const { records, idsByKey } = migrateLocationsText('Old Kent Road 51.4545,-2.5879\nQueen Square, Bristol\nAgain 51.454500,-2.587900', searchResults);
    assert.deepEqual(Object.fromEntries(idsByKey), {
      '51.454500,-2.587900': [records[0].id, records[2].id],
      '51.450400,-2.594700': [records[1].id],
    });
  });
});
