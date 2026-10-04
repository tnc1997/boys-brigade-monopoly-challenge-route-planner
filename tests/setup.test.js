import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { START_KEY } from '../locations.js';
import { searchKey } from '../search.js';
import { planFromSetup, replanStartingPoint, searchesNeeded, startTimeToday, timeToday } from '../setup.js';
import { defaultState } from '../storage.js';

const now = new Date(2026, 9, 3, 11, 0).getTime();

/** Rows of the location list with the given texts, with ids `a`, `b` and so on. */
const rows = (...texts) => texts.map((text, index) => ({ id: String.fromCharCode(97 + index), text }));

/** Rows of the location list pinned at Old Kent Road and Temple Meads. */
const pinnedRows = () => [
  { id: 'a', text: 'Old Kent Road', pin: { lat: 51.4545, lng: -2.5879 } },
  { id: 'b', text: 'Temple Meads', pin: { lat: 51.4492, lng: -2.5813 } },
];

const setupWith = ({ locations = pinnedRows(), ...event } = {}, settings = {}) => {
  const state = defaultState();
  return {
    event: { ...state.event, ...event },
    locations,
    settings: { ...state.settings, ...settings },
    now,
  };
};

describe('timeToday', () => {
  test('converts a time to the same local day', () => {
    assert.equal(timeToday('16:00', now), new Date(2026, 9, 3, 16, 0).getTime());
    assert.equal(timeToday(' 09:05 ', now), new Date(2026, 9, 3, 9, 5).getTime());
  });

  test('rejects invalid times', () => {
    for (const time of ['', '4pm', '24:00', '12:60', '1:00']) {
      assert.equal(timeToday(time, now), null, time);
    }
  });
});

describe('planFromSetup', () => {
  test('plans every location from the default setup', () => {
    const { plan, error, leftOut } = planFromSetup(setupWith());
    assert.equal(error, null);
    assert.deepEqual(leftOut, []);
    assert.deepEqual([...plan.order].sort(), [0, 1]);
    assert.deepEqual(plan.points.map(({ label, key }) => [label, key]), [
      ['Old Kent Road', 'a'],
      ['Temple Meads', 'b'],
    ]);
    assert.equal(plan.start.label, 'Start');
    assert.equal(plan.startTime, now);
    assert.equal(plan.deadline, new Date(2026, 9, 3, 16, 0).getTime());
  });

  test('plans an open route when the finish is blank', () => {
    assert.equal(planFromSetup(setupWith({ finishText: '  ' })).plan.finish, null);
  });

  test('plans to the finish when there is one', () => {
    const { plan } = planFromSetup(setupWith({ finishText: '51.4556,-2.5894' }));
    assert.equal(plan.finish.label, 'Finish');
  });

  test('returns every row and where it is', () => {
    const { rows: resolved } = planFromSetup(setupWith({ locations: rows('51.4545,-2.5879', '', 'Nowhere') }));
    assert.deepEqual(resolved.map(({ number, resolved: { status } }) => [number, status]), [
      [1, 'coordinates'],
      [2, 'empty'],
      [3, 'unknown'],
    ]);
  });

  test('leaves out rows that were not found or not looked up, without stopping the rest', () => {
    const searchResults = { [searchKey('Nowhere')]: { isFound: false, error: 'No match for "Nowhere" in Bristol.', isTemporary: false } };
    const { plan, leftOut } = planFromSetup({ ...setupWith({ locations: rows('51.4545,-2.5879', 'Nowhere', '', 'Not looked up') }), searchResults });
    assert.equal(plan.points.length, 1);
    assert.deepEqual(leftOut.map(({ number }) => number), [2, 4]);
  });

  test('plans pinned rows where they were pinned, whatever their text', () => {
    const locations = [
      { id: 'p', text: 'Queen Square', pin: { lat: 51.4504, lng: -2.5947 } },
      { id: 'q', text: '', pin: { lat: 51.4492, lng: -2.5813 } },
    ];
    const { plan } = planFromSetup(setupWith({ locations }));
    assert.deepEqual(plan.points, [
      { lat: 51.4504, lng: -2.5947, label: 'Queen Square', key: 'p' },
      { lat: 51.4492, lng: -2.5813, label: 'Location 2', key: 'q' },
    ]);
  });

  test('uses the start time when one is entered', () => {
    const { plan } = planFromSetup(setupWith({ startTime: '11:30' }));
    assert.equal(plan.startTime, new Date(2026, 9, 3, 11, 30).getTime());
  });

  test('leaves done locations out of the route but keeps them in the points', () => {
    const { plan: firstPlan } = planFromSetup(setupWith());
    const locations = pinnedRows().map((record) => (record.id === firstPlan.points[0].key ? { ...record, isVisited: true } : record));
    const { plan } = planFromSetup(setupWith({ locations }));
    assert.deepEqual(plan.points.map(({ label }) => label), ['Old Kent Road', 'Temple Meads']);
    assert.deepEqual(plan.order, [1]);
    assert.deepEqual(plan.skipped, []);
    assert.equal(plan.arrivalTimes.length, 1);
  });

  test('always includes must-visit locations still to visit', () => {
    // With the start time at 15:40, nothing fits on its own merit.
    const locations = pinnedRows().map((record) => (record.id === 'b' ? { ...record, isMustVisit: true } : record));
    const { plan } = planFromSetup(setupWith({ startTime: '15:40', locations }));
    assert.deepEqual(plan.order, [1]);
    assert.equal(plan.isMustVisitLate, true);
  });

  test("ignores Must visit on a location that's been visited", () => {
    const locations = pinnedRows().map((record) => (record.id === 'b' ? { ...record, isMustVisit: true, isVisited: true } : record));
    const { plan } = planFromSetup(setupWith({ startTime: '15:40', locations }));
    assert.deepEqual(plan.order, []);
    assert.equal(plan.isMustVisitLate, false);
  });

  test('maps skipped locations back to their place in the list', () => {
    const { plan: firstPlan } = planFromSetup(setupWith());
    const locations = pinnedRows().map((record) => (record.id === firstPlan.points[0].key ? { ...record, isVisited: true } : record));
    const { plan } = planFromSetup(setupWith({ startTime: '15:40', locations }));
    assert.deepEqual(plan.order, []);
    assert.deepEqual(plan.skipped, [1]);
  });

  test('re-plans from the current position and time, ignoring the Start field and start time', () => {
    const from = { lat: 51.4492, lng: -2.5813 };
    const later = new Date(2026, 9, 3, 13, 15).getTime();
    const { plan, error } = planFromSetup({ ...setupWith({ startText: 'not a location', startTime: '11:00' }), now: later, from });
    assert.equal(error, null);
    assert.deepEqual(plan.start, { lat: 51.4492, lng: -2.5813, label: 'Your position', key: START_KEY });
    assert.equal(plan.startTime, later);
  });

  test('uses the current form values when re-planning', () => {
    const from = { lat: 51.4492, lng: -2.5813 };
    const { plan } = planFromSetup({ ...setupWith({ finishText: '51.4556,-2.5894' }, { speedKmh: 3.5 }), from });
    assert.equal(plan.finish.label, 'Finish');
    assert.equal(plan.settings.speedKmh, 3.5);
  });

  const failures = [
    ['there are no usable locations', { locations: rows('Nowhere') }, {}, /at least one location/],
    ['there are no locations', { locations: [] }, {}, /at least one location/],
    ['the start has not been looked up', { startText: 'Castle Park' }, {}, /^Start: "Castle Park" couldn't be looked up/],
    ['the start is blank', { startText: ' ' }, {}, /^Start: Enter where/],
    ['the finish is invalid', { finishText: 'Somewhere' }, {}, /^Finish: /],
    ['the start time is invalid', { startTime: 'soon' }, {}, /^Start time: /],
    ['the deadline is invalid', { deadline: '' }, {}, /^Deadline: Enter a time/],
    ['the deadline is before the start time', { startTime: '16:30' }, {}, /^Deadline: The deadline must be after/],
    ['the walking speed is 0', {}, { speedKmh: 0 }, /^Walking speed: /],
    ['the walking speed is below the slider range', {}, { speedKmh: 1.5 }, /^Walking speed: Enter a speed between 2 and 7 km\/h/],
    ['the walking speed is above the slider range', {}, { speedKmh: 9 }, /^Walking speed: Enter a speed between 2 and 7 km\/h/],
    ['the selfie time is negative', {}, { dwellSeconds: -60 }, /^Selfie time: /],
  ];
  for (const [name, event, settings, error] of failures) {
    test(`stops planning when ${name}`, () => {
      const result = planFromSetup(setupWith(event, settings));
      assert.equal(result.plan, null);
      assert.match(result.error, error);
    });
  }
});

describe('planFromSetup with addresses and place names', () => {
  const searchResults = {
    [searchKey('Queen Square, Bristol')]: { isFound: true, lat: 51.4504, lng: -2.5947, name: 'Queen Square, City Centre, Bristol' },
    [searchKey('Temple Meads')]: { isFound: true, lat: 51.4492, lng: -2.5813, name: 'Bristol Temple Meads' },
    [searchKey('Nowhere')]: { isFound: false, error: 'No match for "Nowhere" in Bristol.', isTemporary: false },
  };

  test('plans rows that were found, with what each matched', () => {
    const { plan, leftOut } = planFromSetup({
      ...setupWith({ locations: rows('51.4545,-2.5879', 'Queen Square, Bristol'), finishText: 'Temple Meads' }),
      searchResults,
    });
    assert.deepEqual(leftOut, []);
    assert.equal(plan.points[1].matchedName, 'Queen Square, City Centre, Bristol');
    assert.equal(plan.finish.lat, 51.4492);
  });

  test('looks up the start too', () => {
    const { plan } = planFromSetup({ ...setupWith({ startText: 'Queen Square, Bristol' }), searchResults });
    assert.equal(plan.start.lat, 51.4504);
  });

  test('says why the start or finish was not found', () => {
    const { error } = planFromSetup({ ...setupWith({ finishText: 'Nowhere' }), searchResults });
    assert.equal(error, 'Finish: No match for "Nowhere" in Bristol.');
  });
});

describe('searchesNeeded', () => {
  test('lists the rows, start and finish that need looking up, but not coordinates or pins', () => {
    const event = { ...defaultState().event, startText: 'Temple Meads', finishText: 'Cabot Tower' };
    const locations = [...rows('51.4545,-2.5879', 'Queen Square, Bristol', ''), { id: 'p', text: 'Pinned', pin: { lat: 51.45, lng: -2.59 } }];
    assert.deepEqual(searchesNeeded({ event, locations }), ['Queen Square, Bristol', 'Temple Meads', 'Cabot Tower']);
  });

  test('leaves out searches that are already known', () => {
    const searchResults = { [searchKey('Queen Square, Bristol')]: { isFound: false, error: 'No match', isTemporary: false } };
    assert.deepEqual(searchesNeeded({ event: defaultState().event, locations: rows('Queen Square, Bristol'), searchResults }), []);
  });

  test("leaves out the start when re-planning from the team's position", () => {
    const event = { ...defaultState().event, startText: 'Temple Meads' };
    assert.deepEqual(searchesNeeded({ event, locations: [], isFromPosition: true }), []);
  });
});
describe('startTimeToday', () => {
  test('uses now for a blank start time, and today otherwise', () => {
    assert.equal(startTimeToday('', now), now);
    assert.equal(startTimeToday(' 11:30 ', now), new Date(2026, 9, 3, 11, 30).getTime());
    assert.equal(startTimeToday('soon', now), null);
  });
});

describe('replanStartingPoint', () => {
  const at = (day, hours, minutes) => new Date(2026, 9, day, hours, minutes).getTime();
  const options = (overrides) => ({ startTime: '11:00', deadline: '16:00', hasVisited: false, isReplannedFromPositionToday: false, ...overrides });

  test('re-plans from the Start field before the start time, when nothing is ticked off', () => {
    assert.equal(replanStartingPoint(options({ now: at(3, 10, 30) })), 'start');
  });

  test("re-plans from the team's position between the start time and the deadline", () => {
    assert.equal(replanStartingPoint(options({ now: at(3, 11, 0) })), 'position');
    assert.equal(replanStartingPoint(options({ now: at(3, 14, 0) })), 'position');
  });

  test("re-plans from the Start field the evening before, after that day's deadline", () => {
    assert.equal(replanStartingPoint(options({ now: at(2, 20, 0) })), 'start');
  });

  test('re-plans from the Start field the morning of the challenge', () => {
    assert.equal(replanStartingPoint(options({ now: at(3, 9, 0) })), 'start');
  });

  test("re-plans from the team's position once a selfie is ticked off, even before the start time", () => {
    assert.equal(replanStartingPoint(options({ hasVisited: true, now: at(3, 10, 50) })), 'position');
  });

  test("re-plans from the team's position after re-planning from there today, even before the start time", () => {
    assert.equal(replanStartingPoint(options({ isReplannedFromPositionToday: true, now: at(3, 10, 45) })), 'position');
  });

  test('uses a start time that has just been put back', () => {
    assert.equal(replanStartingPoint(options({ startTime: '12:00', now: at(3, 11, 30) })), 'start');
  });

  test("re-plans from the team's position with no start time before the deadline", () => {
    assert.equal(replanStartingPoint(options({ startTime: '', now: at(3, 10, 0) })), 'position');
  });

  test('re-plans from the Start field with an invalid start time', () => {
    assert.equal(replanStartingPoint(options({ startTime: 'soon', now: at(3, 10, 0) })), 'start');
  });
});
