import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { appleMapsDirectionsUrl, countdownText, describeRoute, formatDuration, googleMapsDirectionsUrl, isAppleDevice, isPlanForToday, mapRoute, newLocationMarkers, plural, progress, timeWarning } from '../route.js';
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

const setupLocations = pinnedRows();

/** Formats a time as `HH:MM` local time, as the app does in a 24-hour locale. */
const formatTime = (time) => new Date(time).toTimeString().slice(0, 5);

const savedPlan = (event = {}, settings = {}, locations = setupLocations) => {
  const state = defaultState();
  return planFromSetup({
    event: { ...state.event, ...event },
    setupLocations: locations,
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
    assert.deepEqual(stops.map(({ location }) => location.label), plan.order.map((index) => plan.routeLocations[index].label));
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
    const plan = savedPlan({ startTime: '15:40' });
    const { stops, skipped } = describeRoute(plan);
    assert.equal(stops.length, 0);
    assert.deepEqual(skipped.map(({ label }) => label), ['Old Kent Road', 'Temple Meads']);
  });

  test("gives each stop its At, and whether it's reached the safety margin before it", () => {
    const locations = pinnedRows().map((setupLocation) => (setupLocation.id === 'b' ? { ...setupLocation, at: '13:00' } : setupLocation));
    const { stops } = describeRoute(savedPlan({ startTime: '11:00' }, {}, locations));
    const byLabel = new Map(stops.map((stop) => [stop.location.label, stop]));
    assert.equal(byLabel.get('Old Kent Road').fixedTime, null);
    assert.equal(byLabel.get('Old Kent Road').isLateForAt, false);
    assert.equal(byLabel.get('Temple Meads').fixedTime, new Date(2026, 9, 3, 13, 0).getTime());
    assert.equal(byLabel.get('Temple Meads').isLateForAt, false);
  });

  test('says how long the team waits at a stop for its At', () => {
    const locations = pinnedRows().map((setupLocation) => (setupLocation.id === 'b' ? { ...setupLocation, at: '13:00' } : setupLocation));
    const { stops } = describeRoute(savedPlan({ startTime: '11:00' }, {}, locations));
    const atStop = stops.find(({ location }) => location.label === 'Temple Meads');
    assert.ok(Math.abs(atStop.waitSeconds - (atStop.fixedTime - atStop.arrivalTime) / 1000) < 1e-6);
    assert.ok(atStop.waitSeconds > 0);
    assert.equal(stops.find(({ location }) => location.label === 'Old Kent Road').waitSeconds, 0);
  });

  test('says a must-visit stop is late when it would be reached less than the safety margin before its At', () => {
    // Temple Meads is a few minutes' walk away, so it's reached after 10:50,
    // the 15-minute safety margin before 11:05.
    const locations = pinnedRows().map((setupLocation) => (setupLocation.id === 'b' ? { ...setupLocation, at: '11:05', isMustVisit: true } : setupLocation));
    const { stops } = describeRoute(savedPlan({ startTime: '11:00' }, {}, locations));
    assert.equal(stops.find(({ location }) => location.label === 'Temple Meads').isLateForAt, true);
  });

  test('compares a stop with its At to the minute, as times are shown', () => {
    const plan = savedPlan({ startTime: '11:00' }, {}, pinnedRows().map((setupLocation) => ({ ...setupLocation, at: '13:00' })));
    const atStops = (arrivalTimes) => describeRoute({ ...plan, order: [0], arrivalTimes }).stops[0].isLateForAt;
    // The cut-off is 12:45, the 15-minute safety margin before 13:00.
    assert.equal(atStops([new Date(2026, 9, 3, 12, 45, 30).getTime()]), false);
    assert.equal(atStops([new Date(2026, 9, 3, 12, 46).getTime()]), true);
  });

  test('lists the skipped locations with an At time apart', () => {
    const locations = pinnedRows().map((setupLocation) => (setupLocation.id === 'b' ? { ...setupLocation, at: '10:30' } : setupLocation));
    const { stops, skipped, skippedForAt } = describeRoute(savedPlan({ startTime: '11:00' }, {}, locations));
    assert.deepEqual(stops.map(({ location }) => location.label), ['Old Kent Road']);
    assert.deepEqual(skipped, []);
    assert.deepEqual(skippedForAt.map(({ label }) => label), ['Temple Meads']);
  });
});

describe('progress', () => {
  test('counts the done locations out of every location in the list', () => {
    const plan = savedPlan();
    assert.deepEqual(progress(plan, []), { done: 0, total: 2 });
    assert.deepEqual(progress(plan, [plan.routeLocations[0].key]), { done: 1, total: 2 });
    assert.deepEqual(progress(plan, plan.routeLocations.map(({ key }) => key)), { done: 2, total: 2 });
  });

  test('ignores keys of locations that are not in the plan', () => {
    assert.deepEqual(progress(savedPlan(), ['0.000000,0.000000']), { done: 0, total: 2 });
  });
});

describe('mapRoute', () => {

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
      event: defaultState().event,
      setupLocations: setupLocations.map((setupLocation) => (setupLocation.id === first.location.key ? { ...setupLocation, isVisited: true } : setupLocation)),
      settings: defaultState().settings,
      now,
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
    const plan = savedPlan({ startTime: '15:40' });
    const { markers, path } = mapRoute(plan, [], formatTime);
    assert.deepEqual(markers.filter(({ kind }) => kind === 'skipped').map(({ location }) => location.label), ['Old Kent Road', 'Temple Meads']);
    assert.deepEqual(path, [plan.start]);
  });

  test('gives a stop with an At its selfie time', () => {
    const locations = pinnedRows().map((setupLocation) => (setupLocation.id === 'b' ? { ...setupLocation, at: '13:00' } : setupLocation));
    const { markers } = mapRoute(savedPlan({ startTime: '11:00' }, {}, locations), [], formatTime);
    const title = markers.find(({ location }) => location.label === 'Temple Meads').title;
    assert.ok(title.endsWith(`, selfie at ${formatTime(new Date(2026, 9, 3, 13, 0).getTime())}`), title);
  });

  test('says why a location with an At time is skipped', () => {
    const locations = pinnedRows().map((setupLocation) => (setupLocation.id === 'b' ? { ...setupLocation, at: '10:30' } : setupLocation));
    const { markers } = mapRoute(savedPlan({ startTime: '11:00' }, {}, locations), [], formatTime);
    assert.deepEqual(markers.filter(({ kind }) => kind === 'skipped').map(({ title }) => title), ["Temple Meads, skipped: its At time can't be met"]);
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
    assert.deepEqual(newLocationMarkers([...plan.routeLocations, cabotTower], plan).map(({ title }) => title), ['Cabot Tower, not in the route yet']);
  });

  test("marks a must-visit location that the plan doesn't visit", () => {
    const plan = { ...savedPlan(), order: [0], skipped: [1] };
    const markers = newLocationMarkers(plan.routeLocations, plan, new Set([plan.routeLocations[0].key, plan.routeLocations[1].key]));
    assert.deepEqual(markers.map(({ title }) => title), ['Temple Meads, must visit, not in the route yet']);
  });

  test('marks a location that has moved since the plan was made, such as when it was pinned', () => {
    const plan = savedPlan();
    const moved = { ...plan.routeLocations[0], lat: 51.46 };
    assert.deepEqual(newLocationMarkers([moved, plan.routeLocations[1]], plan).map(({ location }) => location), [moved]);
  });
});

describe('timeWarning', () => {
  const minutes = (count) => count * 60000;

  test('stays quiet when there is plenty of time and the team is on schedule', () => {
    const plan = savedPlan();
    assert.equal(timeWarning(plan, [], plan.startTime, formatTime), null);
    assert.equal(timeWarning(plan, [], plan.arrivalTimes[0] - minutes(1), formatTime), null);
  });

  test('tells the team to head to the finish when the time left is down to the safety margin', () => {
    const plan = savedPlan({ finishText: '51.4556,-2.5894' });
    const warning = timeWarning(plan, [], plan.deadline - minutes(10), formatTime);
    assert.deepEqual(warning, { kind: 'short', message: 'Head to the finish now: 10 minutes until the deadline.', minutesLeft: 10, minutesBehind: warning.minutesBehind });
  });

  test("says time's nearly up when there's no finish", () => {
    const plan = savedPlan();
    assert.equal(timeWarning(plan, [], plan.deadline - minutes(1), formatTime).message, "Last few selfies, time's nearly up: 1 minute until the deadline.");
  });

  test('warns when the team is running late enough to push the route into the safety margin', () => {
    // A short deadline leaves the route with little spare time, so running
    // late for the first stop pushes the end into the margin.
    const plan = savedPlan({ startTime: '15:10' });
    assert.ok(plan.order.length > 0);
    const spareMinutes = plan.spareSeconds / 60;
    const late = timeWarning(plan, [], plan.arrivalTimes[0] + minutes(spareMinutes + 2), formatTime);
    assert.match(late.message, /^Running \d+ minutes behind plan/);
    assert.ok(late.minutesBehind >= spareMinutes);
    // Being late by less than the spare time is fine.
    assert.equal(timeWarning(plan, [], plan.arrivalTimes[0] + minutes(spareMinutes / 2), formatTime), null);
  });

  /**
   * A plan reaching Old Kent Road at 12:00, then Temple Meads at 12:10 for
   * its 12:40 At, ending a minute before the 15:45 cut-off.
   */
  const planWithAt = () => {
    const plan = savedPlan({ startTime: '11:00' });
    return {
      ...plan,
      order: [0, 1],
      skipped: [],
      arrivalTimes: [new Date(2026, 9, 3, 12, 0).getTime(), new Date(2026, 9, 3, 12, 10).getTime()],
      routeLocations: plan.routeLocations.map((routeLocation, index) => (index === 1 ? { ...routeLocation, at: '12:40' } : routeLocation)),
      endEta: new Date(2026, 9, 3, 15, 44).getTime(),
      spareSeconds: 60,
    };
  };
  const at = (hours, minutes) => new Date(2026, 9, 3, hours, minutes).getTime();

  test("doesn't warn when a wait for an At ahead takes up being late", () => {
    // Without the wait, 10 minutes behind would push the end into the margin.
    assert.equal(timeWarning(planWithAt(), [], at(12, 10), formatTime), null);
  });

  test('warns when being late means reaching a stop less than the safety margin before its At', () => {
    const warning = timeWarning(planWithAt(), [], at(12, 20), formatTime);
    // Temple Meads would be reached at 12:30, after the 12:25 cut-off.
    assert.equal(warning.message, "Running 20 minutes behind plan, so you'd reach Temple Meads less than 15 minutes before its 12:40 At. Re-plan from here to see what still fits.");
    assert.match(timeWarning(planWithAt(), [], at(12, 35), formatTime).message, /^Running 35 minutes behind plan, so you'd reach Temple Meads after its 12:40 At\./);
  });

  test("doesn't warn a team waiting at a stop for its At", () => {
    // Old Kent Road is done, and the team may have reached Temple Meads at
    // 12:10, so they aren't behind until its 12:40 At has passed.
    assert.equal(timeWarning(planWithAt(), ['a'], at(12, 39), formatTime), null);
    assert.match(timeWarning(planWithAt(), ['a'], at(12, 42), formatTime).message, /^Running 2 minutes behind plan, so you're late for the 12:40 At at Temple Meads\./);
  });

  test("carries on what a wait for an At doesn't take up to the end of the route", () => {
    // Planned to reach Temple Meads at 12:30, already inside the safety
    // margin before its 12:40 At, so that's been warned about when planning.
    const plan = planWithAt();
    plan.arrivalTimes = [at(12, 20), at(12, 30)];
    // 8 minutes behind is taken up by the 10-minute wait.
    assert.equal(timeWarning(plan, [], at(12, 28), formatTime), null);
    // 15 minutes behind starts the selfie 5 minutes late, which pushes the end
    // into the margin.
    assert.match(timeWarning(plan, [], at(12, 35), formatTime).message, /^Running 15 minutes behind plan, so the route may not fit/);
  });

  test('measures lateness against the next stop that is not done', () => {
    const plan = savedPlan({ startTime: '15:10' });
    const allDone = plan.order.map((index) => plan.routeLocations[index].key);
    // Everything is done, so there's no stop to be late for, and the time
    // left is more than the margin.
    assert.equal(timeWarning(plan, allDone, plan.arrivalTimes.at(-1) + minutes(1), formatTime), null);
  });

  test("doesn't warn when every stop is done and there's no finish to reach", () => {
    const plan = savedPlan();
    const allDone = plan.order.map((index) => plan.routeLocations[index].key);
    assert.equal(timeWarning(plan, allDone, plan.deadline - minutes(5), formatTime), null);
    const withFinish = savedPlan({ finishText: '51.4556,-2.5894' });
    const allDoneWithFinish = withFinish.order.map((index) => withFinish.routeLocations[index].key);
    assert.match(timeWarning(withFinish, allDoneWithFinish, withFinish.deadline - minutes(5), formatTime).message, /^Head to the finish now/);
  });

  test('warns when nothing fits before the deadline, as when it is only a few minutes away', () => {
    // Re-planning with the deadline 5 minutes away leaves less than the
    // 15-minute safety margin, so every location is skipped.
    for (const finishText of ['', '51.4556,-2.5894']) {
      const plan = savedPlan({ finishText, deadline: '11:05' });
      assert.deepEqual(plan.order, []);
      const warning = timeWarning(plan, [], plan.startTime, formatTime);
      assert.ok(warning, `no warning ${finishText ? 'with' : 'without'} a finish`);
      assert.equal(warning.minutesLeft, 5);
    }
  });

  test("doesn't say the team is behind until they're at least a minute late", () => {
    // A plan that ends right at the safety margin, so any lateness pushes it in.
    const plan = savedPlan({ startTime: '15:10' });
    const tightPlan = { ...plan, endEta: plan.deadline - plan.settings.safetyMarginSeconds * 1000, spareSeconds: 0 };
    assert.equal(timeWarning(tightPlan, [], tightPlan.arrivalTimes[0] + 30000, formatTime), null);
    assert.equal(timeWarning(tightPlan, [], tightPlan.arrivalTimes[0] + minutes(1), formatTime).kind, 'late');
  });

  test("doesn't warn straight away when the must-visit locations make the plan late", () => {
    const setupLocations = pinnedRows().map((setupLocation) => ({ ...setupLocation, isMustVisit: true }));
    const plan = planFromSetup({ event: { ...defaultState().event, startTime: '15:30' }, setupLocations, settings: defaultState().settings, now }).plan;
    assert.equal(plan.isMustVisitLate, true);
    assert.ok(plan.spareSeconds < 0);
    assert.equal(timeWarning(plan, [], plan.startTime, formatTime), null);
    assert.equal(timeWarning(plan, [], plan.deadline - 10 * 60000, formatTime).kind, 'short');
  });

  test('warns straight away when the plan already ends inside the safety margin', () => {
    // The finish is too far to reach before the deadline minus the margin.
    const plan = savedPlan({ startTime: '15:30', finishText: '51.5300,-2.7000' });
    assert.ok(plan.spareSeconds < 0);
    const warning = timeWarning(plan, [], plan.startTime, formatTime);
    assert.equal(warning.kind, 'short');
    assert.match(warning.message, /^Head to the finish now/);
  });

  test("doesn't warn about a finish that doesn't fit before the route starts", () => {
    const plan = savedPlan({ startTime: '15:30', finishText: '51.5300,-2.7000' });
    assert.ok(plan.spareSeconds < 0);
    assert.equal(timeWarning(plan, [], plan.startTime - minutes(60), formatTime), null);
  });

  test('gives each kind of warning', () => {
    const plan = savedPlan({ startTime: '15:10' });
    assert.equal(timeWarning(plan, [], plan.deadline - minutes(5), formatTime).kind, 'short');
    assert.equal(timeWarning(plan, [], plan.deadline + minutes(5), formatTime).kind, 'passed');
    assert.equal(timeWarning(plan, [], plan.arrivalTimes[0] + minutes(plan.spareSeconds / 60 + 2), formatTime).kind, 'late');
  });

  test("doesn't warn about a plan from an earlier day", () => {
    const plan = savedPlan({ finishText: '51.4556,-2.5894' });
    const nextMorning = plan.deadline + minutes(17 * 60);
    assert.equal(isPlanForToday(plan, nextMorning), false);
    assert.equal(timeWarning(plan, [], nextMorning, formatTime), null);
    assert.equal(isPlanForToday(plan, plan.startTime), true);
  });

  test('says when the deadline has passed', () => {
    assert.equal(timeWarning(savedPlan(), [], savedPlan().deadline + minutes(5), formatTime).message, "The deadline has passed. Time's up.");
    const withFinish = savedPlan({ finishText: '51.4556,-2.5894' });
    assert.equal(timeWarning(withFinish, [], withFinish.deadline, formatTime).message, 'The deadline has passed. Head to the finish now.');
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
