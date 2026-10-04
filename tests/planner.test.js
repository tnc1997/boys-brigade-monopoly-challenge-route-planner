import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { evaluateRoute, greedyInsertion, haversineMetres, improveWithTwoOpt, plan, walkSeconds } from '../planner.js';

const castlePark = { lat: 51.4556, lng: -2.5894 };
const cliftonSuspensionBridge = { lat: 51.4549, lng: -2.6278 };
const templeMeads = { lat: 51.4492, lng: -2.5813 };

const assertWithinPercent = (actual, expected, percent) => {
  const tolerance = (expected * percent) / 100;
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${percent}% of ${expected}`,
  );
};

describe('haversineMetres', () => {
  test('returns 0 for identical points', () => {
    assert.equal(haversineMetres(castlePark, castlePark), 0);
  });

  test('one degree of latitude is about 111.2 km', () => {
    assertWithinPercent(haversineMetres({ lat: 51, lng: -2.6 }, { lat: 52, lng: -2.6 }), 111195, 0.1);
  });

  // Expected distances are from the equirectangular approximation, which is
  // accurate to well under 1% over a few kilometres.
  test('Castle Park to Clifton Suspension Bridge is about 2.66 km', () => {
    assertWithinPercent(haversineMetres(castlePark, cliftonSuspensionBridge), 2660, 1);
  });

  test('Castle Park to Temple Meads is about 906 m', () => {
    assertWithinPercent(haversineMetres(castlePark, templeMeads), 906, 1);
  });

  test('is symmetric', () => {
    assert.equal(
      haversineMetres(castlePark, cliftonSuspensionBridge),
      haversineMetres(cliftonSuspensionBridge, castlePark),
    );
  });
});

describe('walkSeconds', () => {
  // 1 km straight line, so the expected times are easy to check by hand.
  const oneKmNorth = { lat: castlePark.lat + 1000 / 111195, lng: castlePark.lng };

  test('defaults to 4.5 km/h with a detour factor of 1.3', () => {
    // 1 km × 1.3 = 1.3 km at 4.5 km/h = 1040 s.
    assertWithinPercent(walkSeconds(castlePark, oneKmNorth), 1040, 0.1);
  });

  test('uses a custom walking speed', () => {
    // 1 km × 1.3 = 1.3 km at 3.5 km/h ≈ 1337 s.
    assertWithinPercent(walkSeconds(castlePark, oneKmNorth, { speedKmh: 3.5 }), 1337, 0.1);
  });

  test('uses a custom detour factor', () => {
    // 1 km × 1 = 1 km at 4.5 km/h = 800 s.
    assertWithinPercent(walkSeconds(castlePark, oneKmNorth, { detourFactor: 1 }), 800, 0.1);
  });

  test('returns 0 for identical points', () => {
    assert.equal(walkSeconds(castlePark, castlePark), 0);
  });

  test('rejects a speed that is not greater than 0', () => {
    for (const speedKmh of [0, -1, NaN]) {
      assert.throws(() => walkSeconds(castlePark, oneKmNorth, { speedKmh }), RangeError);
    }
  });

  test('rejects a detour factor less than 1', () => {
    for (const detourFactor of [0.9, 0, NaN]) {
      assert.throws(() => walkSeconds(castlePark, oneKmNorth, { detourFactor }), RangeError);
    }
  });
});

describe('evaluateRoute', () => {
  // Points 1 km apart walked at 3.6 km/h (1 m/s) with no detour, so each
  // kilometre takes exactly 1000 s.
  const kmNorth = (km) => ({ lat: castlePark.lat + (km * 1000) / 111195, lng: castlePark.lng });
  const startTime = Date.parse('2026-10-03T11:00:00+01:00');
  const deadline = Date.parse('2026-10-03T16:00:00+01:00');
  const base = {
    start: castlePark,
    startTime,
    deadline,
    speedKmh: 3.6,
    detourFactor: 1,
    dwellSeconds: 100,
    safetyMarginSeconds: 600,
  };
  const assertTimesClose = (actual, expected) => {
    assert.equal(actual.length, expected.length);
    actual.forEach((time, index) => assert.ok(Math.abs(time - expected[index]) < 2000, `stop ${index}: ${time} vs ${expected[index]}`));
  };
  const assertTimeClose = (actual, expected) => assertTimesClose([actual], [expected]);

  test('times each stop as the walk to it plus the selfie time at the previous stop', () => {
    const { arrivalTimes } = evaluateRoute({ ...base, stops: [kmNorth(1), kmNorth(2)] });
    assertTimesClose(arrivalTimes, [startTime + 1000_000, startTime + 2100_000]);
  });

  test('without a finish, ends when the last selfie is taken', () => {
    const { endEta } = evaluateRoute({ ...base, stops: [kmNorth(1), kmNorth(2)] });
    assertTimeClose(endEta, startTime + 2200_000);
  });

  test('with a finish, ends on arrival at the finish', () => {
    const { endEta } = evaluateRoute({ ...base, stops: [kmNorth(1), kmNorth(2)], finish: castlePark });
    assertTimeClose(endEta, startTime + 4200_000);
  });

  test('without stops or a finish, ends at the start time', () => {
    const { arrivalTimes, endEta } = evaluateRoute({ ...base, stops: [] });
    assert.deepEqual(arrivalTimes, []);
    assert.equal(endEta, startTime);
  });

  test('without stops but with a finish, walks straight to the finish', () => {
    const { endEta } = evaluateRoute({ ...base, stops: [], finish: kmNorth(3) });
    assertTimeClose(endEta, startTime + 3000_000);
  });

  test('is within budget when it ends before the deadline minus the safety margin', () => {
    const { isWithinBudget, spareSeconds } = evaluateRoute({ ...base, stops: [kmNorth(1)], finish: castlePark });
    // 2100 s used out of 5 h minus 600 s.
    assert.equal(isWithinBudget, true);
    assert.ok(Math.abs(spareSeconds - (5 * 3600 - 600 - 2100)) < 2);
  });

  test('is not within budget when it ends inside the safety margin', () => {
    const stops = [kmNorth(1)];
    // The route takes 1100 s, so a deadline 1500 s away leaves only 400 s,
    // which is less than the 600 s safety margin.
    for (const finish of [null, kmNorth(1)]) {
      const { isWithinBudget, spareSeconds } = evaluateRoute({ ...base, stops, finish, deadline: startTime + 1500_000 });
      assert.equal(isWithinBudget, false);
      assert.ok(spareSeconds < 0);
    }
  });

  test('uses the default speed, detour factor, selfie time and safety margin', () => {
    const { arrivalTimes, endEta, spareSeconds } = evaluateRoute({ start: castlePark, stops: [kmNorth(1)], startTime, deadline });
    // 1 km × 1.3 at 4.5 km/h = 1040 s, then 180 s for the selfie.
    assertTimesClose(arrivalTimes, [startTime + 1040_000]);
    assertTimeClose(endEta, startTime + 1220_000);
    assert.ok(Math.abs(spareSeconds - (5 * 3600 - 900 - 1220)) < 2);
  });
});

describe('greedyInsertion', () => {
  // Points walked at 3.6 km/h (1 m/s) with no detour, so each kilometre takes
  // exactly 1000 s.
  const kmFrom = (northKm, eastKm = 0) => ({
    lat: castlePark.lat + (northKm * 1000) / 111195,
    lng: castlePark.lng + (eastKm * 1000) / (111195 * Math.cos((castlePark.lat * Math.PI) / 180)),
  });
  const startTime = Date.parse('2026-10-03T11:00:00+01:00');
  const base = {
    start: castlePark,
    startTime,
    deadline: Date.parse('2026-10-03T16:00:00+01:00'),
    speedKmh: 3.6,
    detourFactor: 1,
    dwellSeconds: 100,
    safetyMarginSeconds: 600,
  };
  const withDeadlineAfter = (seconds) => ({ ...base, deadline: startTime + (seconds + base.safetyMarginSeconds) * 1000 });

  // Small seeded random number generator (mulberry32), so the random tests
  // are repeatable.
  const random = (seed) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  test('returns an empty route when there are no points', () => {
    assert.deepEqual(greedyInsertion({ ...base, points: [] }), []);
  });

  test('visits every point in order along a line when there is plenty of time', () => {
    const points = [kmFrom(3), kmFrom(1), kmFrom(2)];
    assert.deepEqual(greedyInsertion({ ...base, points }), [1, 2, 0]);
  });

  test('visits every point and returns to a finish at the start when there is plenty of time', () => {
    const points = [kmFrom(1), kmFrom(1, 1), kmFrom(0, 1)];
    const order = greedyInsertion({ ...base, points, finish: castlePark });
    assert.deepEqual([...order].sort(), [0, 1, 2]);
  });

  test('leaves out points that do not fit, keeping the nearest', () => {
    const points = [kmFrom(3), kmFrom(1), kmFrom(2)];
    // 2 km of walking plus two selfies is 2200 s; a third point needs 1100 s more.
    assert.deepEqual(greedyInsertion({ ...withDeadlineAfter(2500), points }), [1, 2]);
  });

  test('prefers points on the way to the finish over detours', () => {
    const points = [kmFrom(-1), kmFrom(1)];
    // The walk to the finish takes 3000 s, the point on the way adds only its
    // 100 s selfie, and the detour south adds 2100 s.
    const order = greedyInsertion({ ...withDeadlineAfter(3500), points, finish: kmFrom(3) });
    assert.deepEqual(order, [1]);
  });

  test('returns an empty route when even the walk to the finish does not fit', () => {
    const order = greedyInsertion({ ...withDeadlineAfter(1000), points: [kmFrom(1)], finish: kmFrom(3) });
    assert.deepEqual(order, []);
  });

  test('visits at least as many points without a finish as with one', () => {
    const points = [kmFrom(1), kmFrom(2), kmFrom(3), kmFrom(4)];
    const options = { ...withDeadlineAfter(4500), points };
    const withoutFinish = greedyInsertion(options);
    const withFinish = greedyInsertion({ ...options, finish: castlePark });
    assert.equal(withoutFinish.length, 4);
    assert.equal(withFinish.length, 2);
  });

  test('never goes over the time budget on random routes', () => {
    const next = random(42);
    for (let run = 0; run < 200; run += 1) {
      const points = Array.from({ length: 2 + Math.floor(next() * 30) }, () => kmFrom(next() * 6 - 3, next() * 6 - 3));
      const finish = next() < 0.5 ? null : kmFrom(next() * 6 - 3, next() * 6 - 3);
      const options = { ...withDeadlineAfter(next() * 20000), points, finish };
      const order = greedyInsertion(options);
      assert.equal(new Set(order).size, order.length, 'visits each point at most once');
      assert.ok(order.every((index) => index >= 0 && index < points.length), 'returns valid indexes');
      const stops = order.map((index) => points[index]);
      if (order.length > 0 || finish === null) {
        assert.ok(evaluateRoute({ ...options, stops }).isWithinBudget, `run ${run} is over budget`);
      }
    }
  });
});

describe('plan', () => {
  // Points walked at 3.6 km/h (1 m/s) with no detour, so each kilometre takes
  // exactly 1000 s.
  const kmNorth = (km) => ({ lat: castlePark.lat + (km * 1000) / 111195, lng: castlePark.lng });
  const startTime = Date.parse('2026-10-03T11:00:00+01:00');
  const base = {
    start: castlePark,
    startTime,
    deadline: Date.parse('2026-10-03T16:00:00+01:00'),
    speedKmh: 3.6,
    detourFactor: 1,
    dwellSeconds: 100,
    safetyMarginSeconds: 600,
  };
  const withDeadlineAfter = (seconds) => ({ ...base, deadline: startTime + (seconds + base.safetyMarginSeconds) * 1000 });
  const finishes = [
    ['without a finish', null],
    ['with a finish', castlePark],
  ];

  for (const [name, finish] of finishes) {
    describe(name, () => {
      test('visits every point when there is plenty of time', () => {
        const points = [kmNorth(2), kmNorth(1)];
        const result = plan({ ...base, points, finish });
        // With a finish back at the start, either direction along the line
        // takes the same time.
        assert.deepEqual([...result.order].sort(), [0, 1]);
        assert.deepEqual(result.skipped, []);
      });

      test('stays within the time budget', () => {
        const points = [kmNorth(1), kmNorth(2), kmNorth(3), kmNorth(4)];
        const options = { ...withDeadlineAfter(4500), points, finish };
        const result = plan(options);
        assert.ok(result.spareSeconds >= 0);
        assert.ok(result.endEta <= options.deadline - options.safetyMarginSeconds * 1000);
      });

      test('skips points when time is short', () => {
        const points = [kmNorth(1), kmNorth(2), kmNorth(3), kmNorth(4)];
        const result = plan({ ...withDeadlineAfter(2500), points, finish });
        assert.ok(result.skipped.length > 0);
        assert.deepEqual([...result.order, ...result.skipped].sort(), [0, 1, 2, 3]);
        assert.deepEqual(result.skipped, [...result.skipped].sort());
      });

      test('matches the timings from evaluateRoute', () => {
        const points = [kmNorth(1), kmNorth(2)];
        const options = { ...base, points, finish };
        const result = plan(options);
        const timeline = evaluateRoute({ ...options, stops: result.order.map((index) => points[index]) });
        assert.deepEqual(result.arrivalTimes, timeline.arrivalTimes);
        assert.equal(result.endEta, timeline.endEta);
        assert.equal(result.spareSeconds, timeline.spareSeconds);
      });

      test('skips every point when the deadline has passed', () => {
        const points = [kmNorth(1), kmNorth(2)];
        const result = plan({ ...base, points, finish, deadline: startTime - 1000 });
        assert.deepEqual(result.order, []);
        assert.deepEqual(result.arrivalTimes, []);
        assert.deepEqual(result.skipped, [0, 1]);
      });
    });
  }

  test('ignores extra properties on points, such as labels', () => {
    const points = [{ ...kmNorth(1), label: 'Old Kent Road', key: '51.464600,-2.589400' }];
    assert.deepEqual(plan({ ...base, points }).order, [0]);
  });

  test('rejects invalid walking settings', () => {
    assert.throws(() => plan({ ...base, points: [kmNorth(1)], speedKmh: 0 }), RangeError);
  });
});

describe('improveWithTwoOpt', () => {
  // Points walked at 3.6 km/h (1 m/s) with no detour, so each kilometre takes
  // exactly 1000 s.
  const kmFrom = (northKm, eastKm = 0) => ({
    lat: castlePark.lat + (northKm * 1000) / 111195,
    lng: castlePark.lng + (eastKm * 1000) / (111195 * Math.cos((castlePark.lat * Math.PI) / 180)),
  });
  const startTime = Date.parse('2026-10-03T11:00:00+01:00');
  const base = {
    start: castlePark,
    startTime,
    deadline: Date.parse('2026-10-03T16:00:00+01:00'),
    speedKmh: 3.6,
    detourFactor: 1,
    dwellSeconds: 100,
    safetyMarginSeconds: 600,
  };
  const seconds = (options, order) => {
    const { endEta } = evaluateRoute({ ...options, stops: order.map((index) => options.points[index]) });
    return (endEta - options.startTime) / 1000;
  };
  const random = (seed) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  test('uncrosses a crossing route', () => {
    // A square 1 km north and east of the start, back to a finish at the
    // start. Visiting the corners as 0, 2, 1, 3 crosses over itself.
    const points = [kmFrom(1, 0), kmFrom(1, 1), kmFrom(2, 1), kmFrom(2, 0)];
    const options = { ...base, points, finish: castlePark };
    const crossing = [0, 2, 1, 3];
    const improved = improveWithTwoOpt(options, crossing);
    // Compare with the best of every order of the four corners.
    const permutations = (items) =>
      items.length <= 1 ? [items] : items.flatMap((item, index) => permutations(items.filter((_, other) => other !== index)).map((rest) => [item, ...rest]));
    const best = Math.min(...permutations([0, 1, 2, 3]).map((order) => seconds(options, order)));
    assert.ok(seconds(options, improved) < seconds(options, crossing) - 100);
    assert.ok(Math.abs(seconds(options, improved) - best) < 1e-6, `${seconds(options, improved)} vs best ${best}`);
  });

  test('reverses the tail when there is no finish', () => {
    // Visiting the far point first means walking back past the near one.
    const options = { ...base, points: [kmFrom(1), kmFrom(3)] };
    assert.deepEqual(improveWithTwoOpt(options, [1, 0]), [0, 1]);
  });

  test("doesn't reverse the tail when there is a finish", () => {
    // With a finish 4 km north, near then far is quicker once the walk to
    // the finish is counted, so the order changes.
    const withFinish = { ...base, points: [kmFrom(1), kmFrom(3)], finish: kmFrom(4) };
    assert.deepEqual(improveWithTwoOpt(withFinish, [1, 0]), [0, 1]);
    // With the finish back at the start, both directions take the same time,
    // so the order is left alone.
    const outAndBack = { ...base, points: [kmFrom(1), kmFrom(3)], finish: castlePark };
    assert.deepEqual(improveWithTwoOpt(outAndBack, [1, 0]), [1, 0]);
  });

  test('leaves an empty or one-stop route alone', () => {
    assert.deepEqual(improveWithTwoOpt({ ...base, points: [] }, []), []);
    assert.deepEqual(improveWithTwoOpt({ ...base, points: [kmFrom(1)] }, [0]), [0]);
  });

  test('never makes a route slower or changes which points it visits, on random routes', () => {
    const next = random(7);
    for (let run = 0; run < 200; run += 1) {
      const points = Array.from({ length: 2 + Math.floor(next() * 20) }, () => kmFrom(next() * 6 - 3, next() * 6 - 3));
      const finish = next() < 0.5 ? null : kmFrom(next() * 6 - 3, next() * 6 - 3);
      const options = { ...base, points, finish };
      const order = points.map((_, index) => index).sort(() => next() - 0.5);
      const improved = improveWithTwoOpt(options, order);
      assert.deepEqual([...improved].sort((a, b) => a - b), [...order].sort((a, b) => a - b), `run ${run} changed the points`);
      assert.ok(seconds(options, improved) <= seconds(options, order) + 1e-6, `run ${run} got slower`);
    }
  });
});

describe('plan with 2-opt', () => {
  const kmFrom = (northKm, eastKm = 0) => ({
    lat: castlePark.lat + (northKm * 1000) / 111195,
    lng: castlePark.lng + (eastKm * 1000) / (111195 * Math.cos((castlePark.lat * Math.PI) / 180)),
  });
  const startTime = Date.parse('2026-10-03T11:00:00+01:00');
  const random = (seed) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  test('visits at least as many points as greedy insertion and stays within budget, on random routes', () => {
    const next = random(11);
    let extraPoints = 0;
    for (let run = 0; run < 200; run += 1) {
      const points = Array.from({ length: 5 + Math.floor(next() * 30) }, () => kmFrom(next() * 6 - 3, next() * 6 - 3));
      const finish = next() < 0.5 ? null : kmFrom(next() * 6 - 3, next() * 6 - 3);
      const options = {
        start: castlePark,
        points,
        finish,
        startTime,
        deadline: startTime + (3000 + next() * 15000 + 600) * 1000,
        speedKmh: 3.6,
        detourFactor: 1,
        dwellSeconds: 100,
        safetyMarginSeconds: 600,
      };
      const greedy = greedyInsertion(options);
      const result = plan(options);
      assert.ok(result.order.length >= greedy.length, `run ${run} visits fewer points`);
      assert.ok(result.spareSeconds >= 0 || result.order.length === 0, `run ${run} is over budget`);
      extraPoints += result.order.length - greedy.length;
    }
    // 2-opt frees up time on some routes, which is used for more points.
    assert.ok(extraPoints > 0, 'expected 2-opt to fit extra points on some routes');
  });
});

describe('plan with swaps', () => {
  // Points walked at 3.6 km/h (1 m/s) with no detour, so each kilometre takes
  // exactly 1000 s.
  const kmFrom = (northKm, eastKm = 0) => ({
    lat: castlePark.lat + (northKm * 1000) / 111195,
    lng: castlePark.lng + (eastKm * 1000) / (111195 * Math.cos((castlePark.lat * Math.PI) / 180)),
  });
  const startTime = Date.parse('2026-10-03T11:00:00+01:00');
  const options = (points, seconds, extra = {}) => ({
    start: castlePark,
    points,
    startTime,
    deadline: startTime + (seconds + 600) * 1000,
    speedKmh: 3.6,
    detourFactor: 1,
    dwellSeconds: 0,
    safetyMarginSeconds: 600,
    ...extra,
  });

  test('swaps one out-of-the-way stop for two nearby ones', () => {
    // The nearest point is 1 km east, so greedy insertion goes there first
    // and then has no time left. Two points 1.05 km and 1.1 km west fit
    // together in 1100 s.
    const points = [kmFrom(0, 1), kmFrom(0, -1.05), kmFrom(0, -1.1)];
    const planOptions = options(points, 1500);
    assert.deepEqual(greedyInsertion(planOptions), [0]);
    const result = plan(planOptions);
    assert.deepEqual(result.order, [1, 2]);
    assert.deepEqual(result.skipped, [0]);
    assert.ok(result.spareSeconds >= 0);
  });

  test('stops improving after about the time limit, even for 60 locations', () => {
    const points = Array.from({ length: 60 }, (_, index) => kmFrom(Math.sin(index * 7.1) * 2.5, Math.cos(index * 3.3) * 2.5));
    const planOptions = options(points, 5 * 3600, { dwellSeconds: 180, finish: castlePark });
    const started = performance.now();
    const result = plan(planOptions);
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 600, `took ${elapsed.toFixed(0)} ms`);
    assert.ok(result.spareSeconds >= 0);
    assert.ok(result.order.length >= greedyInsertion(planOptions).length);
  });

  test('still returns a route within budget with no time to improve it', () => {
    const points = [kmFrom(0, 1), kmFrom(0, -1.05), kmFrom(0, -1.1)];
    const result = plan({ ...options(points, 1500), timeLimitMs: 0 });
    assert.deepEqual(result.order, [0]);
    assert.ok(result.spareSeconds >= 0);
  });
});

describe('plan compared with the best possible route', () => {
  // Points walked at 3.6 km/h (1 m/s) with no detour, so each kilometre takes
  // exactly 1000 s.
  const kmFrom = (northKm, eastKm = 0) => ({
    lat: castlePark.lat + (northKm * 1000) / 111195,
    lng: castlePark.lng + (eastKm * 1000) / (111195 * Math.cos((castlePark.lat * Math.PI) / 180)),
  });
  const random = (seed) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const randomOptions = (next, { count, hasFinish }) => ({
    start: castlePark,
    points: Array.from({ length: count }, () => kmFrom(next() * 6 - 3, next() * 6 - 3)),
    finish: hasFinish ? kmFrom(next() * 6 - 3, next() * 6 - 3) : null,
    startTime: 0,
    deadline: (2000 + next() * 12000 + 600) * 1000,
    speedKmh: 3.6,
    detourFactor: 1,
    dwellSeconds: 100,
    safetyMarginSeconds: 600,
  });

  /**
   * Finds the most points any route can visit, by trying every order.
   * Adding a stop never makes a route quicker, so an order that doesn't fit
   * can't be extended into one that does, and is skipped.
   */
  const bestPossible = (options) => {
    let best = 0;
    const extend = (order, used) => {
      best = Math.max(best, order.length);
      for (let index = 0; index < options.points.length; index += 1) {
        if (used.has(index)) {
          continue;
        }
        const candidate = [...order, index];
        if (evaluateRoute({ ...options, stops: candidate.map((point) => options.points[point]) }).isWithinBudget) {
          used.add(index);
          extend(candidate, used);
          used.delete(index);
        }
      }
    };
    extend([], new Set());
    return best;
  };

  // plan() is a heuristic, so it can't always find the best route, but
  // starting from several routes keeps it close.
  test('visits the most points possible on at least 98% of small random cases, and is never more than 1 short', () => {
    const next = random(20);
    const runs = 300;
    let matches = 0;
    for (let run = 0; run < runs; run += 1) {
      const options = randomOptions(next, { count: 3 + Math.floor(next() * 6), hasFinish: next() < 0.5 });
      const best = bestPossible(options);
      const visited = plan(options).order.length;
      assert.ok(visited <= best, `run ${run} visits more than is possible`);
      assert.ok(best - visited <= 1, `run ${run} visits ${visited} of a possible ${best}`);
      matches += visited === best ? 1 : 0;
    }
    assert.ok(matches >= runs * 0.98, `matched the best route on ${matches} of ${runs} cases`);
  });

  test('without a finish, visits at least as many points as with one, on random cases', () => {
    const next = random(21);
    for (let run = 0; run < 300; run += 1) {
      const options = randomOptions(next, { count: 3 + Math.floor(next() * 30), hasFinish: false });
      const withoutFinish = plan(options).order.length;
      const withFinish = plan({ ...options, finish: kmFrom(next() * 6 - 3, next() * 6 - 3) }).order.length;
      assert.ok(withoutFinish >= withFinish, `run ${run} visits ${withoutFinish} without a finish but ${withFinish} with one`);
    }
  });
});

describe('plan with must-visit points', () => {
  // Points walked at 3.6 km/h (1 m/s) with no detour, so each kilometre takes
  // exactly 1000 s.
  const kmFrom = (northKm, eastKm = 0) => ({
    lat: castlePark.lat + (northKm * 1000) / 111195,
    lng: castlePark.lng + (eastKm * 1000) / (111195 * Math.cos((castlePark.lat * Math.PI) / 180)),
  });
  const startTime = Date.parse('2026-10-03T11:00:00+01:00');
  const options = (budgetSeconds, overrides) => ({
    start: castlePark,
    startTime,
    deadline: startTime + (budgetSeconds + 600) * 1000,
    speedKmh: 3.6,
    detourFactor: 1,
    dwellSeconds: 100,
    safetyMarginSeconds: 600,
    ...overrides,
  });
  const random = (seed) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // A far point to the north, which takes 3100 s on its own, and two near
  // points to the south, which take 1200 s together. Only one or the other
  // fits in 3200 s.
  const points = [kmFrom(3), kmFrom(-0.5), kmFrom(-1)];

  test('visits more points without must-visit points', () => {
    const result = plan(options(3200, { points }));
    assert.deepEqual(result.order, [1, 2]);
    assert.equal(result.isMustVisitLate, false);
  });

  test('includes a must-visit point over a route that visits more points without it', () => {
    const result = plan(options(3200, { points, mustVisit: [0] }));
    assert.deepEqual(result.order, [0]);
    assert.deepEqual(result.skipped, [1, 2]);
    assert.equal(result.isMustVisitLate, false);
    assert.ok(result.spareSeconds >= 0);
  });

  test('adds other points around the must-visit points when they fit', () => {
    const result = plan(options(10000, { points, mustVisit: [0] }));
    assert.deepEqual([...result.order].sort(), [0, 1, 2]);
  });

  test("plans only the must-visit points, in the shortest order, when they don't fit", () => {
    // Points 1, 2 and 3 km north, listed out of order: the shortest route
    // visits them nearest first, taking 3300 s.
    const line = [kmFrom(3), kmFrom(-0.5), kmFrom(1), kmFrom(2)];
    const result = plan(options(2000, { points: line, mustVisit: [0, 2, 3] }));
    assert.equal(result.isMustVisitLate, true);
    assert.deepEqual(result.order, [2, 3, 0]);
    assert.deepEqual(result.skipped, [1]);
    assert.ok(Math.abs(result.spareSeconds - (2000 - 3300)) < 1, `spare ${result.spareSeconds}`);
  });

  test("ends at the finish when the must-visit points don't fit", () => {
    const line = [kmFrom(3), kmFrom(1), kmFrom(2)];
    // The finish alone, 3.5 km away, fits in 3700 s, but not with the
    // must-visit points on the way, which take 3800 s.
    const finish = kmFrom(3.5);
    const result = plan(options(3700, { points: line, mustVisit: [0, 1, 2], finish }));
    assert.equal(result.isMustVisitLate, true);
    assert.deepEqual(result.order, [1, 2, 0]);
    assert.ok(Math.abs(result.endEta - (startTime + 3800 * 1000)) < 1000, `ends ${result.endEta - startTime} ms after the start`);
  });

  test("isn't late without must-visit points, even when nothing fits", () => {
    const result = plan(options(3200, { points, finish: kmFrom(10) }));
    assert.deepEqual(result.order, []);
    assert.equal(result.isMustVisitLate, false);
  });

  test("isn't late when even the walk to the finish doesn't fit", () => {
    const result = plan(options(3200, { points, mustVisit: [1], finish: kmFrom(10) }));
    assert.equal(result.isMustVisitLate, false);
    assert.ok(result.spareSeconds < 0);
  });

  test('always includes every must-visit point that fits, and never removes one to fit others in, on random routes', () => {
    const next = random(46);
    for (let run = 0; run < 150; run += 1) {
      const randomPoints = Array.from({ length: 5 + Math.floor(next() * 25) }, () => kmFrom(next() * 6 - 3, next() * 6 - 3));
      const mustVisit = randomPoints.map((_, index) => index).filter(() => next() < 0.2);
      const finish = next() < 0.5 ? null : kmFrom(next() * 6 - 3, next() * 6 - 3);
      const result = plan(options(3000 + next() * 15000, { points: randomPoints, mustVisit, finish, timeLimitMs: 20 }));
      for (const index of mustVisit) {
        assert.ok(result.order.includes(index), `run ${run} leaves out must-visit point ${index}`);
      }
      if (result.isMustVisitLate) {
        assert.deepEqual([...result.order].sort((a, b) => a - b), mustVisit, `run ${run} visits others although the must-visit points are late`);
      } else {
        assert.ok(result.spareSeconds >= 0, `run ${run} is over budget`);
      }
    }
  });
});

describe('plan with scores', () => {
  // Points walked at 3.6 km/h (1 m/s) with no detour, so each kilometre takes
  // exactly 1000 s.
  const kmFrom = (northKm, eastKm = 0) => ({
    lat: castlePark.lat + (northKm * 1000) / 111195,
    lng: castlePark.lng + (eastKm * 1000) / (111195 * Math.cos((castlePark.lat * Math.PI) / 180)),
  });
  const startTime = Date.parse('2026-10-03T11:00:00+01:00');
  const options = (budgetSeconds, overrides) => ({
    start: castlePark,
    startTime,
    deadline: startTime + (budgetSeconds + 600) * 1000,
    speedKmh: 3.6,
    detourFactor: 1,
    dwellSeconds: 100,
    safetyMarginSeconds: 600,
    ...overrides,
  });
  const random = (seed) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const randomOptions = (next, { count, hasFinish }) => {
    const randomPoints = Array.from({ length: count }, () => kmFrom(next() * 6 - 3, next() * 6 - 3));
    return options(2000 + next() * 12000, {
      points: randomPoints,
      scores: randomPoints.map(() => 1 + Math.floor(next() * 30)),
      finish: hasFinish ? kmFrom(next() * 6 - 3, next() * 6 - 3) : null,
    });
  };
  const score = (order, scores) => order.reduce((total, index) => total + scores[index], 0);
  // A far point to the north, which takes 3100 s on its own, and two near
  // points to the south, which take 1200 s together. Only one or the other
  // fits in 3200 s.
  const points = [kmFrom(3), kmFrom(-0.5), kmFrom(-1)];

  test('visits a high-scoring point over two low-scoring ones that score less together', () => {
    const result = plan(options(3200, { points, scores: [30, 10, 10] }));
    assert.deepEqual(result.order, [0]);
    assert.deepEqual(result.skipped, [1, 2]);
    assert.ok(result.spareSeconds >= 0);
  });

  test('visits two low-scoring points over a high-scoring one when they score more together', () => {
    const result = plan(options(3200, { points, scores: [15, 10, 10] }));
    assert.deepEqual(result.order, [1, 2]);
    assert.deepEqual(result.skipped, [0]);
  });

  test('visits the quicker route when two routes score the same', () => {
    const result = plan(options(3200, { points, scores: [20, 10, 10] }));
    assert.deepEqual(result.order, [1, 2]);
  });

  test('includes a must-visit point over points that score more', () => {
    const result = plan(options(3200, { points, scores: [1, 50, 50], mustVisit: [0] }));
    assert.deepEqual(result.order, [0]);
    assert.equal(result.isMustVisitLate, false);
  });

  test('plans the same must-visit points in the same order whatever they score, on random routes', () => {
    const next = random(47);
    for (let run = 0; run < 150; run += 1) {
      const randomPoints = Array.from({ length: 4 + Math.floor(next() * 10) }, () => kmFrom(next() * 6 - 3, next() * 6 - 3));
      // A short budget, so the must-visit points are often late and the
      // route is only them.
      const planOptions = options(1000 + next() * 15000, {
        points: randomPoints,
        mustVisit: randomPoints.map((_, index) => index),
        finish: next() < 0.5 ? null : kmFrom(next() * 6 - 3, next() * 6 - 3),
      });
      const scored = plan({ ...planOptions, scores: randomPoints.map(() => Math.floor(next() * 50)) });
      assert.deepEqual(scored.order, plan(planOptions).order, `run ${run} differs`);
    }
  });

  test('greedy insertion adds the point that scores the most for each second it adds', () => {
    // The point 1 km east adds 1100 s for 1 point. The point 2 km west adds
    // 2100 s for 10 points, so it's added first, and then the other no
    // longer fits.
    const greedyOptions = options(2500, { points: [kmFrom(0, 1), kmFrom(0, -2)], scores: [1, 10] });
    assert.deepEqual(greedyInsertion(greedyOptions), [1]);
  });

  test('greedy insertion still adds points that fit after one that scores more per second does not', () => {
    // The point 2 km west scores the most per second, but doesn't fit.
    const greedyOptions = options(1500, { points: [kmFrom(0, 1), kmFrom(0, -2)], scores: [1, 100] });
    assert.deepEqual(greedyInsertion(greedyOptions), [0]);
  });

  test('plans the same routes with all scores equal as without scores, on random routes', () => {
    const next = random(45);
    for (let run = 0; run < 150; run += 1) {
      const randomPoints = Array.from({ length: 3 + Math.floor(next() * 25) }, () => kmFrom(next() * 6 - 3, next() * 6 - 3));
      const planOptions = options(2000 + next() * 15000, {
        points: randomPoints,
        mustVisit: randomPoints.map((_, index) => index).filter(() => next() < 0.1),
        finish: next() < 0.5 ? null : kmFrom(next() * 6 - 3, next() * 6 - 3),
        timeLimitMs: Infinity,
      });
      // 0 points each too, which shouldn't stop the route visiting as many as fit.
      const equalScore = Math.floor(next() * 20);
      assert.deepEqual(plan({ ...planOptions, scores: randomPoints.map(() => equalScore) }), plan(planOptions), `run ${run} differs`);
    }
  });

  /**
   * Finds the most any route can score, by trying every order. Adding a
   * stop never makes a route quicker, so an order that doesn't fit can't be
   * extended into one that does, and is skipped.
   */
  const bestPossible = (options) => {
    let best = 0;
    const extend = (order, used) => {
      best = Math.max(best, score(order, options.scores));
      for (let index = 0; index < options.points.length; index += 1) {
        if (used.has(index)) {
          continue;
        }
        const candidate = [...order, index];
        if (evaluateRoute({ ...options, stops: candidate.map((point) => options.points[point]) }).isWithinBudget) {
          used.add(index);
          extend(candidate, used);
          used.delete(index);
        }
      }
    };
    extend([], new Set());
    return best;
  };

  // plan() is a heuristic, so it can't always find the best route, but
  // starting from several routes keeps it close.
  test('scores the most possible on at least 98% of small random cases, and never less than 90% of it', () => {
    const next = random(22);
    const runs = 300;
    let matches = 0;
    for (let run = 0; run < runs; run += 1) {
      const planOptions = randomOptions(next, { count: 3 + Math.floor(next() * 6), hasFinish: next() < 0.5 });
      const best = bestPossible(planOptions);
      const scored = score(plan(planOptions).order, planOptions.scores);
      assert.ok(scored <= best, `run ${run} scores more than is possible`);
      assert.ok(scored >= best * 0.9, `run ${run} scores ${scored} of a possible ${best}`);
      matches += scored === best ? 1 : 0;
    }
    assert.ok(matches >= runs * 0.98, `matched the best route on ${matches} of ${runs} cases`);
  });

  test('stays within budget and the time limit for 30 locations with varied scores', () => {
    const next = random(30);
    const randomPoints = Array.from({ length: 30 }, () => kmFrom(next() * 6 - 3, next() * 6 - 3));
    const planOptions = options(5 * 3600, { points: randomPoints, scores: randomPoints.map(() => Math.floor(next() * 50)), finish: castlePark, dwellSeconds: 180 });
    const started = performance.now();
    const result = plan(planOptions);
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 600, `took ${elapsed.toFixed(0)} ms`);
    assert.ok(result.spareSeconds >= 0);
  });
});
