import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { appleMapsDirectionsUrl, countdownText, describeRoute, formatDuration, googleMapsDirectionsUrl, isAppleDevice, isPlanForToday, mapRoute, markDone, newLocationMarkers, plural, progress, timeWarning, toggleDone } from '../route.js';
import { planFromSetup } from '../setup.js';
import { defaultState } from '../storage.js';

const now = new Date(2026, 9, 3, 11, 0).getTime();

/** Rows of the location list with the given texts, with ids `a`, `b` and so on. */
const rows = (...texts) => texts.map((text, index) => ({ id: String.fromCharCode(97 + index), text }));

/** Rows of the location list pinned at Old Kent Road and Temple Meads. */
const pinnedRows = () => [
  { id: 'a', text: 'Old Kent Road', pin: { lat: 51.4545, lng: -2.5879 } },
  { id: 'b', text: 'Temple Meads', pin: { lat: 51.4492, lng: -2.5813 } },
];

const locations = pinnedRows();

const savedPlan = (setup = {}, settings = {}) => {
  const state = defaultState();
  return planFromSetup({
    setup: { ...state.setup, ...setup },
    locations,
    settings: { ...state.settings, ...settings },
    now,
  }).plan;
};

describe('googleMapsDirectionsUrl', () => {
  test('opens walking directions to the location', () => {
    const url = new URL(googleMapsDirectionsUrl({ lat: 51.4545, lng: -2.5879 }));
    assert.equal(url.origin + url.pathname, 'https://www.google.com/maps/dir/');
    assert.equal(url.searchParams.get('api'), '1');
    assert.equal(url.searchParams.get('destination'), '51.454500,-2.587900');
    assert.equal(url.searchParams.get('travelmode'), 'walking');
  });
});

describe('appleMapsDirectionsUrl', () => {
  test('opens walking directions from the current position to the location', () => {
    assert.equal(appleMapsDirectionsUrl({ lat: 51.4545, lng: -2.5879 }), 'https://maps.apple.com/?daddr=51.454500,-2.587900&dirflg=w');
  });
});

describe('directions URLs near zero', () => {
  test("never write coordinates in exponent notation, which maps apps can't read", () => {
    const location = { lat: 51.5, lng: -5e-7 };
    assert.equal(new URL(googleMapsDirectionsUrl(location)).searchParams.get('destination'), '51.500000,0.000000');
    assert.equal(appleMapsDirectionsUrl(location), 'https://maps.apple.com/?daddr=51.500000,0.000000&dirflg=w');
    assert.equal(new URL(googleMapsDirectionsUrl({ lat: 51.5, lng: 0.0000012 })).searchParams.get('destination'), '51.500000,0.000001');
  });
});

describe('formatDuration', () => {
  for (const [seconds, text] of [
    [0, 'under 1 min'],
    [29, 'under 1 min'],
    [30, '1 min'],
    [943, '16 min'],
    [3570, '1 h'],
    [3600, '1 h'],
    [3900, '1 h 5 min'],
  ]) {
    test(`formats ${seconds} s as ${text}`, () => {
      assert.equal(formatDuration(seconds), text);
    });
  }
});

describe('describeRoute', () => {
  test('describes each stop in order with its arrival time, walk time and directions URLs', () => {
    const plan = savedPlan();
    const { stops } = describeRoute(plan);
    assert.deepEqual(stops.map(({ number }) => number), [1, 2]);
    assert.deepEqual(stops.map(({ location }) => location.label), plan.order.map((index) => plan.points[index].label));
    assert.deepEqual(stops.map(({ arrivalTime }) => arrivalTime), plan.arrivalTimes);
    // Each stop's directions go to that stop's own coordinates.
    const coordinates = { 'Old Kent Road': '51.454500,-2.587900', 'Temple Meads': '51.449200,-2.581300' };
    for (const stop of stops) {
      assert.ok(stop.walkSeconds > 0);
      const expected = coordinates[stop.location.label];
      assert.equal(new URL(stop.googleMapsDirectionsUrl).searchParams.get('destination'), expected, stop.location.label);
      assert.equal(stop.appleMapsDirectionsUrl, `https://maps.apple.com/?daddr=${expected}&dirflg=w`, stop.location.label);
    }
  });

  test('walk times add up to the arrival times', () => {
    const plan = savedPlan();
    const { stops } = describeRoute(plan);
    let time = plan.startTime;
    for (const [position, stop] of stops.entries()) {
      time += (position > 0 ? plan.settings.dwellSeconds : 0) * 1000 + stop.walkSeconds * 1000;
      assert.ok(Math.abs(time - stop.arrivalTime) < 1, `stop ${stop.number}`);
    }
  });

  test('has no finish when the plan has none, and ends with the last selfie', () => {
    const plan = savedPlan();
    const route = describeRoute(plan);
    assert.equal(route.finish, null);
    assert.equal(route.endEta, plan.endEta);
  });

  test('describes the walk to the finish when there is one', () => {
    const plan = savedPlan({ finishText: '51.4556,-2.5894' });
    const { finish, endEta } = describeRoute(plan);
    assert.equal(finish.location.label, 'Finish');
    assert.equal(finish.arrivalTime, endEta);
    assert.ok(finish.walkSeconds > 0);
    assert.equal(new URL(finish.googleMapsDirectionsUrl).searchParams.get('destination'), '51.455600,-2.589400');
    assert.equal(finish.appleMapsDirectionsUrl, 'https://maps.apple.com/?daddr=51.455600,-2.589400&dirflg=w');
  });

  test('lists the skipped locations in list order', () => {
    const plan = savedPlan({ startTimeText: '15:40' });
    const { stops, skipped } = describeRoute(plan);
    assert.equal(stops.length, 0);
    assert.deepEqual(skipped.map(({ label }) => label), ['Old Kent Road', 'Temple Meads']);
  });
});

describe('toggleDone', () => {
  test('marks a location as done', () => {
    assert.deepEqual(toggleDone(['a'], 'b'), ['a', 'b']);
  });

  test('un-marks a location that was done', () => {
    assert.deepEqual(toggleDone(['a', 'b'], 'a'), ['b']);
  });

  test("doesn't change the original list", () => {
    const doneKeys = ['a'];
    toggleDone(doneKeys, 'b');
    assert.deepEqual(doneKeys, ['a']);
  });
});

describe('markDone', () => {
  test('marks a location as done', () => {
    assert.deepEqual(markDone(['a'], 'b'), ['a', 'b']);
  });

  test('leaves a location that was done as done', () => {
    assert.deepEqual(markDone(['a', 'b'], 'a'), ['a', 'b']);
  });

  test("doesn't change the original list", () => {
    const doneKeys = ['a'];
    markDone(doneKeys, 'b');
    assert.deepEqual(doneKeys, ['a']);
  });
});

describe('progress', () => {
  test('counts the done locations out of every location in the list', () => {
    const plan = savedPlan();
    assert.deepEqual(progress(plan, []), { done: 0, total: 2 });
    assert.deepEqual(progress(plan, [plan.points[0].key]), { done: 1, total: 2 });
    assert.deepEqual(progress(plan, plan.points.map(({ key }) => key)), { done: 2, total: 2 });
  });

  test('ignores keys of locations that are not in the plan', () => {
    assert.deepEqual(progress(savedPlan(), ['0.000000,0.000000']), { done: 0, total: 2 });
  });
});

describe('mapRoute', () => {
  const formatTime = (time) => new Date(time).toISOString().slice(11, 16);

  test('marks the start and numbers the stops in visiting order, like the list', () => {
    const plan = savedPlan();
    const { markers, path } = mapRoute(plan, [], formatTime);
    const { stops } = describeRoute(plan);
    assert.equal(markers[0].kind, 'start');
    assert.deepEqual(
      markers.filter(({ kind }) => kind === 'stop').map(({ label, location }) => [label, location.label]),
      stops.map(({ number, location }) => [String(number), location.label]),
    );
    assert.deepEqual(path, [plan.start, ...stops.map(({ location }) => location)]);
  });

  test('describes each marker for its tooltip', () => {
    const { markers } = mapRoute(savedPlan(), [], formatTime);
    assert.equal(markers[0].title, 'Start');
    assert.match(markers[1].title, /^1\. .+, ETA \d\d:\d\d$/);
  });

  test('marks done stops differently, including done locations that are not on the route', () => {
    const plan = savedPlan();
    const [first] = describeRoute(plan).stops;
    const { markers } = mapRoute(plan, [first.location.key], formatTime);
    const done = markers.filter(({ kind }) => kind === 'done');
    assert.equal(done.length, 1);
    assert.match(done[0].title, /selfie done$/);

    const replanned = planFromSetup({
      setup: defaultState().setup,
      locations,
      settings: defaultState().settings,
      now,
      doneKeys: [first.location.key],
    }).plan;
    const offRoute = mapRoute(replanned, [first.location.key], formatTime).markers.filter(({ kind }) => kind === 'done');
    assert.deepEqual(offRoute.map(({ label }) => label), ['✓']);
  });

  test('only marks the finish when there is one, and ends the line there', () => {
    assert.equal(mapRoute(savedPlan(), [], formatTime).markers.some(({ kind }) => kind === 'finish'), false);
    const plan = savedPlan({ finishText: '51.4556,-2.5894' });
    const { markers, path } = mapRoute(plan, [], formatTime);
    assert.equal(markers.filter(({ kind }) => kind === 'finish').length, 1);
    assert.equal(path.at(-1), plan.finish);
  });

  test('includes skipped locations, but not in the line', () => {
    const plan = savedPlan({ startTimeText: '15:40' });
    const { markers, path } = mapRoute(plan, [], formatTime);
    assert.deepEqual(markers.filter(({ kind }) => kind === 'skipped').map(({ location }) => location.label), ['Old Kent Road', 'Temple Meads']);
    assert.deepEqual(path, [plan.start]);
  });
});

describe('newLocationMarkers', () => {
  const cabotTower = { lat: 51.45174, lng: -2.6034, label: 'Cabot Tower', key: 'c' };

  test('marks every location when there is no plan', () => {
    assert.deepEqual(newLocationMarkers([cabotTower], null), [
      { kind: 'new', location: cabotTower, label: '+', title: 'Cabot Tower, not in the route yet' },
    ]);
  });

  test('marks only the locations that are not in the plan', () => {
    const plan = savedPlan();
    assert.deepEqual(newLocationMarkers([...plan.points, cabotTower], plan).map(({ title }) => title), ['Cabot Tower, not in the route yet']);
  });

  test('marks a location that has moved since the plan was made, such as when it was pinned', () => {
    const plan = savedPlan();
    const moved = { ...plan.points[0], lat: 51.46 };
    assert.deepEqual(newLocationMarkers([moved, plan.points[1]], plan).map(({ location }) => location), [moved]);
  });
});

describe('timeWarning', () => {
  const minutes = (count) => count * 60000;

  test('stays quiet when there is plenty of time and the team is on schedule', () => {
    const plan = savedPlan();
    assert.equal(timeWarning(plan, [], plan.startTime), null);
    assert.equal(timeWarning(plan, [], plan.arrivalTimes[0] - minutes(1)), null);
  });

  test('tells the team to head to the finish when the time left is down to the safety margin', () => {
    const plan = savedPlan({ finishText: '51.4556,-2.5894' });
    const warning = timeWarning(plan, [], plan.deadline - minutes(10));
    assert.deepEqual(warning, { kind: 'short', message: 'Head to the finish now: 10 minutes until the deadline.', minutesLeft: 10, minutesBehind: warning.minutesBehind });
  });

  test("says time's nearly up when there's no finish", () => {
    const plan = savedPlan();
    assert.equal(timeWarning(plan, [], plan.deadline - minutes(1)).message, "Last few selfies, time's nearly up: 1 minute until the deadline.");
  });

  test('warns when the team is running late enough to push the route into the safety margin', () => {
    // A short deadline leaves the route with little spare time, so running
    // late for the first stop pushes the end into the margin.
    const plan = savedPlan({ startTimeText: '15:10' });
    assert.ok(plan.order.length > 0);
    const spareMinutes = plan.spareSeconds / 60;
    const late = timeWarning(plan, [], plan.arrivalTimes[0] + minutes(spareMinutes + 2));
    assert.match(late.message, /^Running \d+ minutes behind plan/);
    assert.ok(late.minutesBehind >= spareMinutes);
    // Being late by less than the spare time is fine.
    assert.equal(timeWarning(plan, [], plan.arrivalTimes[0] + minutes(spareMinutes / 2)), null);
  });

  test('measures lateness against the next stop that is not done', () => {
    const plan = savedPlan({ startTimeText: '15:10' });
    const allDone = plan.order.map((index) => plan.points[index].key);
    // Everything is done, so there's no stop to be late for, and the time
    // left is more than the margin.
    assert.equal(timeWarning(plan, allDone, plan.arrivalTimes.at(-1) + minutes(1)), null);
  });

  test("doesn't warn when every stop is done and there's no finish to reach", () => {
    const plan = savedPlan();
    const allDone = plan.order.map((index) => plan.points[index].key);
    assert.equal(timeWarning(plan, allDone, plan.deadline - minutes(5)), null);
    const withFinish = savedPlan({ finishText: '51.4556,-2.5894' });
    const allDoneWithFinish = withFinish.order.map((index) => withFinish.points[index].key);
    assert.match(timeWarning(withFinish, allDoneWithFinish, withFinish.deadline - minutes(5)).message, /^Head to the finish now/);
  });

  test('warns when nothing fits before the deadline, as when it is only a few minutes away', () => {
    // Re-planning with the deadline 5 minutes away leaves less than the
    // 15-minute safety margin, so every location is skipped.
    for (const finishText of ['', '51.4556,-2.5894']) {
      const plan = savedPlan({ finishText }, { deadline: '11:05' });
      assert.deepEqual(plan.order, []);
      const warning = timeWarning(plan, [], plan.startTime);
      assert.ok(warning, `no warning ${finishText ? 'with' : 'without'} a finish`);
      assert.equal(warning.minutesLeft, 5);
    }
  });

  test("doesn't say the team is behind until they're at least a minute late", () => {
    // A plan that ends right at the safety margin, so any lateness pushes it in.
    const plan = savedPlan({ startTimeText: '15:10' });
    const tightPlan = { ...plan, endEta: plan.deadline - plan.settings.safetyMarginSeconds * 1000, spareSeconds: 0 };
    assert.equal(timeWarning(tightPlan, [], tightPlan.arrivalTimes[0] + 30000), null);
    assert.equal(timeWarning(tightPlan, [], tightPlan.arrivalTimes[0] + minutes(1)).kind, 'late');
  });

  test('warns straight away when the plan already ends inside the safety margin', () => {
    // The finish is too far to reach before the deadline minus the margin.
    const plan = savedPlan({ startTimeText: '15:30', finishText: '51.5300,-2.7000' });
    assert.ok(plan.spareSeconds < 0);
    const warning = timeWarning(plan, [], plan.startTime);
    assert.equal(warning.kind, 'short');
    assert.match(warning.message, /^Head to the finish now/);
  });

  test("doesn't warn about a finish that doesn't fit before the route starts", () => {
    const plan = savedPlan({ startTimeText: '15:30', finishText: '51.5300,-2.7000' });
    assert.ok(plan.spareSeconds < 0);
    assert.equal(timeWarning(plan, [], plan.startTime - minutes(60)), null);
  });

  test('gives each kind of warning', () => {
    const plan = savedPlan({ startTimeText: '15:10' });
    assert.equal(timeWarning(plan, [], plan.deadline - minutes(5)).kind, 'short');
    assert.equal(timeWarning(plan, [], plan.deadline + minutes(5)).kind, 'passed');
    assert.equal(timeWarning(plan, [], plan.arrivalTimes[0] + minutes(plan.spareSeconds / 60 + 2)).kind, 'late');
  });

  test("doesn't warn about a plan from an earlier day", () => {
    const plan = savedPlan({ finishText: '51.4556,-2.5894' });
    const nextMorning = plan.deadline + minutes(17 * 60);
    assert.equal(isPlanForToday(plan, nextMorning), false);
    assert.equal(timeWarning(plan, [], nextMorning), null);
    assert.equal(isPlanForToday(plan, plan.startTime), true);
  });

  test('says when the deadline has passed', () => {
    assert.equal(timeWarning(savedPlan(), [], savedPlan().deadline + minutes(5)).message, "The deadline has passed. Time's up.");
    const withFinish = savedPlan({ finishText: '51.4556,-2.5894' });
    assert.equal(timeWarning(withFinish, [], withFinish.deadline).message, 'The deadline has passed. Head to the finish now.');
  });
});

describe('countdownText', () => {
  const deadline = new Date(2026, 9, 3, 16, 0).getTime();
  const at = (hours, minutes, seconds = 0) => new Date(2026, 9, 3, hours, minutes, seconds).getTime();

  test('shows hours and minutes left', () => {
    assert.equal(countdownText(deadline, at(12, 48)), '3 h 12 min left');
    assert.equal(countdownText(deadline, at(11, 0)), '5 h left');
  });

  test('rounds up to the next minute', () => {
    assert.equal(countdownText(deadline, at(15, 45, 30)), '15 min left');
    assert.equal(countdownText(deadline, at(15, 59, 30)), '1 min left');
  });

  test('says when the deadline has passed', () => {
    assert.equal(countdownText(deadline, deadline), 'Deadline passed');
    assert.equal(countdownText(deadline, at(16, 5)), 'Deadline passed');
  });

  test('says when there is no deadline', () => {
    assert.equal(countdownText(null, at(12, 0)), 'No deadline set');
    assert.equal(countdownText(NaN, at(12, 0)), 'No deadline set');
  });
});

describe('plural', () => {
  test('uses the singular for one and adds s otherwise', () => {
    assert.equal(plural(1, 'minute'), '1 minute');
    assert.equal(plural(0, 'minute'), '0 minutes');
    assert.equal(plural(3, 'minute'), '3 minutes');
  });

  test('uses a given plural', () => {
    assert.equal(plural(2, 'line has a problem', 'lines have problems'), '2 lines have problems');
  });
});

describe('isAppleDevice', () => {
  test('recognises iPhones, iPads and Macs', () => {
    for (const userAgent of [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      // iPads on iPadOS 13 and later report themselves as Macs.
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    ]) {
      assert.equal(isAppleDevice(userAgent), true, userAgent);
    }
  });

  test('leaves out Android and Windows', () => {
    for (const userAgent of [
      'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    ]) {
      assert.equal(isAppleDevice(userAgent), false, userAgent);
    }
  });
});
