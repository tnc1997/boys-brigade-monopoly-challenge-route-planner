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

const setupWith = ({ setupLocations = pinnedRows(), ...event } = {}, settings = {}) => {
  const state = defaultState();
  return {
    event: { ...state.event, ...event },
    setupLocations,
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
    assert.deepEqual(plan.routeLocations.map(({ label, key }) => [label, key]), [
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

  test('leaves out rows that were not found or not looked up, without stopping the rest', () => {
    const searchResults = { [searchKey('Nowhere')]: { isFound: false, error: 'No match for "Nowhere" in Bristol.', isTemporary: false } };
    const { plan, leftOut } = planFromSetup({ ...setupWith({ setupLocations: rows('51.4545,-2.5879', 'Nowhere', '', 'Not looked up') }), searchResults });
    assert.equal(plan.routeLocations.length, 1);
    assert.deepEqual(leftOut.map(({ label }) => label), ['Nowhere', 'Not looked up']);
  });

  test('plans pinned rows where they were pinned, whatever their text', () => {
    const setupLocations = [
      { id: 'p', text: 'Queen Square', pin: { lat: 51.4504, lng: -2.5947 } },
      { id: 'q', text: '', pin: { lat: 51.4492, lng: -2.5813 } },
    ];
    const { plan } = planFromSetup(setupWith({ setupLocations }));
    assert.deepEqual(plan.routeLocations, [
      { lat: 51.4504, lng: -2.5947, label: 'Queen Square', key: 'p' },
      { lat: 51.4492, lng: -2.5813, label: 'Location 2', key: 'q' },
    ]);
  });

  test('uses the start time when one is entered', () => {
    const { plan } = planFromSetup(setupWith({ startTime: '11:30' }));
    assert.equal(plan.startTime, new Date(2026, 9, 3, 11, 30).getTime());
  });

  test('leaves done locations out of the route but keeps them in the route locations', () => {
    const { plan: firstPlan } = planFromSetup(setupWith());
    const setupLocations = pinnedRows().map((setupLocation) => (setupLocation.id === firstPlan.routeLocations[0].key ? { ...setupLocation, isVisited: true } : setupLocation));
    const { plan } = planFromSetup(setupWith({ setupLocations }));
    assert.deepEqual(plan.routeLocations.map(({ label }) => label), ['Old Kent Road', 'Temple Meads']);
    assert.deepEqual(plan.order, [1]);
    assert.deepEqual(plan.skipped, []);
    assert.equal(plan.arrivalTimes.length, 1);
  });

  test('always includes must-visit locations still to visit', () => {
    // With the start time at 15:40, nothing fits on its own merit.
    const setupLocations = pinnedRows().map((setupLocation) => (setupLocation.id === 'b' ? { ...setupLocation, isMustVisit: true } : setupLocation));
    const { plan } = planFromSetup(setupWith({ startTime: '15:40', setupLocations }));
    assert.deepEqual(plan.order, [1]);
    assert.equal(plan.isMustVisitLate, true);
  });

  test('visits the location worth the most points when only one fits', () => {
    // With the start time at 15:24, either location fits on its own, but not
    // both. Old Kent Road is the quicker.
    assert.deepEqual(planFromSetup(setupWith({ startTime: '15:24' })).plan.order, [0]);
    const setupLocations = pinnedRows().map((setupLocation) => (setupLocation.id === 'b' ? { ...setupLocation, points: 50 } : setupLocation));
    assert.deepEqual(planFromSetup(setupWith({ startTime: '15:24', setupLocations })).plan.order, [1]);
  });

  test("counts a location without its own points as worth the event's Points per location", () => {
    const setupLocations = pinnedRows().map((setupLocation) => (setupLocation.id === 'a' ? { ...setupLocation, points: 5 } : setupLocation));
    assert.deepEqual(planFromSetup(setupWith({ startTime: '15:24', pointsPerLocation: 10, setupLocations })).plan.order, [1]);
    assert.deepEqual(planFromSetup(setupWith({ startTime: '15:24', pointsPerLocation: 1, setupLocations })).plan.order, [0]);
  });

  describe('with sets', () => {
    // With the start time at 15:24, either location fits on its own, but not
    // both. Old Kent Road is the quicker, and Temple Meads is the last of the
    // brown set still to visit.
    const brownRows = () => [
      ...pinnedRows().map((setupLocation) => (setupLocation.id === 'b' ? { ...setupLocation, set: 'brown' } : setupLocation)),
      { id: 'c', text: 'Whitechapel Road', pin: { lat: 51.4504, lng: -2.5947 }, set: 'brown', isVisited: true },
    ];

    test('counts locations already visited towards completing a set', () => {
      const { plan, mismatchedSets } = planFromSetup(setupWith({ startTime: '15:24', setupLocations: brownRows() }));
      assert.deepEqual(plan.order, [1]);
      assert.deepEqual(mismatchedSets, []);
    });

    test('earns no set bonuses when Points per set is 0', () => {
      const { plan, mismatchedSets } = planFromSetup(setupWith({ startTime: '15:24', pointsPerSet: 0, setupLocations: brownRows() }));
      assert.deepEqual(plan.order, [0]);
      assert.deepEqual(mismatchedSets, []);
    });

    test('earns no bonus for a set with the wrong number of locations, and says so', () => {
      const setupLocations = [...brownRows(), { id: 'd', text: 'Mayfair', pin: { lat: 51.46, lng: -2.6 }, set: 'brown', isVisited: true }];
      const { plan, mismatchedSets } = planFromSetup(setupWith({ startTime: '15:24', setupLocations }));
      assert.deepEqual(plan.order, [0]);
      assert.deepEqual(mismatchedSets.map(({ set, count }) => [set.id, count]), [['brown', 3]]);
    });

    test("earns no bonus for a set with a location that can't be planned, and names it", () => {
      const setupLocations = brownRows().map((setupLocation) => (setupLocation.id === 'c' ? { id: 'c', text: 'Not looked up', set: 'brown' } : setupLocation));
      const { plan, mismatchedSets, unfoundSets } = planFromSetup(setupWith({ startTime: '15:24', setupLocations }));
      assert.deepEqual(plan.order, [0]);
      assert.deepEqual(mismatchedSets, []);
      assert.deepEqual(unfoundSets.map(({ set, labels }) => [set.id, labels]), [['brown', ['Not looked up']]]);
    });

    test('names every location of a set that was not found, but not one already visited', () => {
      const searchResults = { [searchKey('Bow Street')]: { isFound: false, error: 'No match', isTemporary: false } };
      const setupLocations = [
        { id: 'r1', text: 'Bow Street', set: 'red' },
        { id: 'r2', text: 'Strand', set: 'red' },
        { id: 'r3', text: 'Fleet Street', set: 'red', isVisited: true },
        ...pinnedRows(),
      ];
      const { unfoundSets } = planFromSetup({ ...setupWith({ setupLocations }), searchResults });
      assert.deepEqual(unfoundSets.map(({ set, labels }) => [set.id, labels]), [['red', ['Bow Street', 'Strand']]]);
    });

    test("only says a set is the wrong size, not also that its locations weren't found", () => {
      const setupLocations = [{ id: 'r1', text: 'Bow Street', set: 'red' }, ...pinnedRows()];
      const { mismatchedSets, unfoundSets } = planFromSetup(setupWith({ setupLocations }));
      assert.deepEqual(mismatchedSets.map(({ set, count }) => [set.id, count]), [['red', 1]]);
      assert.deepEqual(unfoundSets, []);
    });

    test('notes nothing about sets while Points per set is 0', () => {
      const setupLocations = [{ id: 'r1', text: 'Bow Street', set: 'red' }, { id: 'b1', text: 'Mayfair', set: 'darkBlue' }, { id: 'b2', text: 'Park Lane', set: 'darkBlue' }, ...pinnedRows()];
      const { mismatchedSets, unfoundSets } = planFromSetup(setupWith({ pointsPerSet: 0, setupLocations }));
      assert.deepEqual(mismatchedSets, []);
      assert.deepEqual(unfoundSets, []);
    });
  });

  test("ignores Must visit on a location that's been visited", () => {
    const setupLocations = pinnedRows().map((setupLocation) => (setupLocation.id === 'b' ? { ...setupLocation, isMustVisit: true, isVisited: true } : setupLocation));
    const { plan } = planFromSetup(setupWith({ startTime: '15:40', setupLocations }));
    assert.deepEqual(plan.order, []);
    assert.equal(plan.isMustVisitLate, false);
  });

  test('plans a location with an At time to arrive the safety margin before it, then waits', () => {
    const setupLocations = pinnedRows().map((setupLocation) => (setupLocation.id === 'b' ? { ...setupLocation, at: '13:00' } : setupLocation));
    const { plan } = planFromSetup(setupWith({ startTime: '11:00', setupLocations }));
    const position = plan.order.indexOf(1);
    assert.notEqual(position, -1);
    assert.ok(plan.arrivalTimes[position] <= new Date(2026, 9, 3, 12, 45).getTime());
    // The selfie is taken at 13:00, so the route can't end before 13:00 plus the selfie time.
    assert.ok(plan.endEta >= new Date(2026, 9, 3, 13, 0).getTime() + plan.settings.dwellSeconds * 1000);
    assert.deepEqual(plan.routeLocations.map(({ at }) => at), [undefined, '13:00']);
  });

  test('skips a location whose At time has passed', () => {
    const setupLocations = pinnedRows().map((setupLocation) => (setupLocation.id === 'b' ? { ...setupLocation, at: '10:30' } : setupLocation));
    const { plan } = planFromSetup(setupWith({ startTime: '11:00', setupLocations }));
    assert.deepEqual(plan.order, [0]);
    assert.deepEqual(plan.skipped, [1]);
  });

  test("skips a must-visit location that can't be reached in time for its At time", () => {
    const setupLocations = pinnedRows().map((setupLocation) => (setupLocation.id === 'b' ? { ...setupLocation, at: '11:05', isMustVisit: true } : setupLocation));
    const { plan } = planFromSetup(setupWith({ startTime: '11:00', setupLocations }));
    assert.deepEqual(plan.order, [0]);
    assert.deepEqual(plan.skippedMustVisit, [1]);
  });

  test('skips a must-visit location when re-planning after its At time has passed', () => {
    const setupLocations = pinnedRows().map((setupLocation) => (setupLocation.id === 'b' ? { ...setupLocation, at: '13:00', isMustVisit: true } : setupLocation));
    const from = { lat: 51.4492, lng: -2.5813 };
    const { plan } = planFromSetup({ ...setupWith({ startTime: '11:00', setupLocations }), now: new Date(2026, 9, 3, 13, 15).getTime(), from });
    assert.ok(!plan.order.includes(1));
    assert.deepEqual(plan.skippedMustVisit, [1]);
  });

  test('maps skipped locations back to their place in the list', () => {
    const { plan: firstPlan } = planFromSetup(setupWith());
    const setupLocations = pinnedRows().map((setupLocation) => (setupLocation.id === firstPlan.routeLocations[0].key ? { ...setupLocation, isVisited: true } : setupLocation));
    const { plan } = planFromSetup(setupWith({ startTime: '15:40', setupLocations }));
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
    ['there are no usable locations', { setupLocations: rows('Nowhere') }, {}, /at least one location/],
    ['there are no locations', { setupLocations: [] }, {}, /at least one location/],
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
      const setupResult = planFromSetup(setupWith(event, settings));
      assert.equal(setupResult.plan, null);
      assert.match(setupResult.error, error);
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
      ...setupWith({ setupLocations: rows('51.4545,-2.5879', 'Queen Square, Bristol'), finishText: 'Temple Meads' }),
      searchResults,
    });
    assert.deepEqual(leftOut, []);
    assert.equal(plan.routeLocations[1].matchedName, 'Queen Square, City Centre, Bristol');
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
    const setupLocations = [...rows('51.4545,-2.5879', 'Queen Square, Bristol', ''), { id: 'p', text: 'Pinned', pin: { lat: 51.45, lng: -2.59 } }];
    assert.deepEqual(searchesNeeded({ event, setupLocations }), ['Queen Square, Bristol', 'Temple Meads', 'Cabot Tower']);
  });

  test('leaves out searches that are already known', () => {
    const searchResults = { [searchKey('Queen Square, Bristol')]: { isFound: false, error: 'No match', isTemporary: false } };
    assert.deepEqual(searchesNeeded({ event: defaultState().event, setupLocations: rows('Queen Square, Bristol'), searchResults }), []);
  });

  test("leaves out the start when re-planning from the team's position", () => {
    const event = { ...defaultState().event, startText: 'Temple Meads' };
    assert.deepEqual(searchesNeeded({ event, setupLocations: [], isFromPosition: true }), []);
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
