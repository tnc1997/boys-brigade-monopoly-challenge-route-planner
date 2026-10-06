/**
 * A point on the Earth's surface in decimal degrees.
 *
 * @typedef {object} LatLng
 * @property {number} lat Latitude, from -90 to 90.
 * @property {number} lng Longitude, from -180 to 180.
 */

/** Mean radius of the Earth in metres. */
const EARTH_RADIUS_METRES = 6371000;

const toRadians = (degrees) => (degrees * Math.PI) / 180;

/**
 * Calculates the great-circle (straight-line) distance between two points
 * using the haversine formula.
 *
 * @param {LatLng} a The first point.
 * @param {LatLng} b The second point.
 * @returns {number} The distance between the points in metres.
 * @example
 * haversineMetres({ lat: 51.4556, lng: -2.5894 }, { lat: 51.4549, lng: -2.6278 }); // ≈ 2662
 */
export function haversineMetres(a, b) {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Options for estimating walking time.
 *
 * @typedef {object} WalkOptions
 * @property {number} [speedKmh=4.5] Walking speed of the whole group in km/h. Must be greater than 0.
 * @property {number} [detourFactor=1.3] How much longer the walk along streets is than the straight line. Must be at least 1.
 */

/**
 * Estimates the time taken to walk between two points. Streets aren't
 * straight, so the straight-line distance is multiplied by a detour factor.
 *
 * @param {LatLng} a Where the walk starts.
 * @param {LatLng} b Where the walk ends.
 * @param {WalkOptions} [options] Walking speed and detour factor.
 * @returns {number} The estimated walking time in seconds.
 * @throws {RangeError} If `speedKmh` isn't greater than 0 or `detourFactor` is less than 1.
 * @example
 * walkSeconds({ lat: 51.4556, lng: -2.5894 }, { lat: 51.4492, lng: -2.5813 }); // ≈ 943 (about 16 minutes)
 */
export function walkSeconds(a, b, { speedKmh = 4.5, detourFactor = 1.3 } = {}) {
  if (!(speedKmh > 0)) {
    throw new RangeError(`speedKmh must be greater than 0, but was ${speedKmh}`);
  }
  if (!(detourFactor >= 1)) {
    throw new RangeError(`detourFactor must be at least 1, but was ${detourFactor}`);
  }
  const metresPerSecond = (speedKmh * 1000) / 3600;
  return (haversineMetres(a, b) * detourFactor) / metresPerSecond;
}

/**
 * Options for timing a route.
 *
 * @typedef {object} RouteOptions
 * @property {LatLng} start Where the team is at `startTime`.
 * @property {LatLng[]} stops The locations to visit, in order.
 * @property {(number | null)[]} [fixedTimes] When the team must be at each of `stops`, in the same order, in milliseconds since the Unix epoch, or `null` for a stop without a fixed time (none by default).
 * @property {LatLng | null} [finish=null] Where the team must end up, or `null` if there's no physical finish.
 * @property {number} startTime When the route starts, in milliseconds since the Unix epoch (as from `Date.now()`).
 * @property {number} deadline When the team must have finished, in milliseconds since the Unix epoch.
 * @property {number} [speedKmh=4.5] Walking speed of the whole group in km/h.
 * @property {number} [detourFactor=1.3] How much longer the walk along streets is than the straight line.
 * @property {number} [dwellSeconds=180] Time spent at each stop taking the selfie, in seconds.
 * @property {number} [safetyMarginSeconds=900] Spare time to keep before the deadline, in seconds.
 */

/**
 * The timings of a route.
 *
 * @typedef {object} RouteTimeline
 * @property {number[]} arrivalTimes When the team arrives at each stop, in milliseconds since the Unix epoch, in the same order as `stops`.
 * @property {number} endEta When the route ends, in milliseconds since the Unix epoch. With a finish, this is the arrival time at the finish. Without one, it's when the last selfie is taken (or `startTime` if there are no stops).
 * @property {number} spareSeconds Time left between `endEta` and the deadline minus the safety margin. Negative when the route doesn't fit.
 * @property {boolean} isWithinBudget Whether the route ends no later than the deadline minus the safety margin.
 */

/**
 * Works out when the team reaches each stop on a route, when the route ends
 * and whether it ends in time. Each stop takes the walk to it plus the selfie
 * time there. At a stop with a fixed time, the team waits until that time
 * if they arrive early, then takes the selfie.
 *
 * @param {RouteOptions} options The route and the settings to time it with.
 * @returns {RouteTimeline} The arrival times, end ETA and whether the route fits the time budget.
 * @example
 * const startTime = Date.parse('2026-10-03T11:00:00+01:00');
 * evaluateRoute({
 *   start: { lat: 51.4556, lng: -2.5894 },
 *   stops: [{ lat: 51.4492, lng: -2.5813 }],
 *   startTime,
 *   deadline: Date.parse('2026-10-03T16:00:00+01:00'),
 * }).isWithinBudget; // true
 */
export function evaluateRoute({
  start,
  stops,
  fixedTimes = [],
  finish = null,
  startTime,
  deadline,
  speedKmh = 4.5,
  detourFactor = 1.3,
  dwellSeconds = 180,
  safetyMarginSeconds = 900,
}) {
  const walkOptions = { speedKmh, detourFactor };
  const arrivalTimes = [];
  let position = start;
  let time = startTime;

  for (const [index, stop] of stops.entries()) {
    time += walkSeconds(position, stop, walkOptions) * 1000;
    arrivalTimes.push(time);
    time = Math.max(time, fixedTimes[index] ?? time) + dwellSeconds * 1000;
    position = stop;
  }

  if (finish) {
    time += walkSeconds(position, finish, walkOptions) * 1000;
  }

  const spareSeconds = (deadline - safetyMarginSeconds * 1000 - time) / 1000;
  return { arrivalTimes, endEta: time, spareSeconds, isWithinBudget: spareSeconds >= 0 };
}

/**
 * Options for planning a route, the same as {@link RouteOptions} except that
 * `locations` are the candidates in any order, rather than `stops` in
 * visiting order.
 *
 * `points` is what each of `locations` is worth, in the same order, as
 * numbers of 0 or more (1 each by default).
 * `mustVisit` lists indexes into `locations` that every route must include,
 * even if leaving them out would earn more points (none by default).
 * `fixedTimes` is when the team must be at each of `locations`, in the same
 * order, in milliseconds since the Unix epoch, or `null` for a location
 * without a fixed time (none by default). A route must reach each of them
 * at least the safety margin before its fixed time, then waits until that
 * time. A must-visit location whose fixed time can't be met is still
 * visited, as early as the planner can manage.
 * `timeLimitMs` limits how long {@link plan} spends improving the route,
 * in milliseconds (200 by default).
 *
 * @typedef {Omit<RouteOptions, 'stops' | 'fixedTimes'> & { locations: LatLng[], points?: number[], mustVisit?: number[], fixedTimes?: (number | null)[], timeLimitMs?: number }} PlanOptions
 */

/**
 * Builds a route by greedy insertion. It repeatedly adds the unvisited
 * location that earns the most points for each second it adds at its
 * cheapest position in the route, of those that still fit within the
 * deadline minus the safety margin and keep every fixed time, until none
 * fit. With every location worth the same, that's the location that adds
 * the least time. With a finish, the route runs start → … → finish. Without
 * one, it runs start → … → last stop, so adding a location at the end costs
 * only the walk to it.
 *
 * @param {PlanOptions} options The candidate locations and the settings to plan with.
 * @returns {number[]} Indexes into `locations`, in visiting order. Locations that don't fit are left out.
 * @example
 * greedyInsertion({
 *   start: { lat: 51.4556, lng: -2.5894 },
 *   locations: [{ lat: 51.4549, lng: -2.6278 }, { lat: 51.4492, lng: -2.5813 }],
 *   startTime: Date.parse('2026-10-03T11:00:00+01:00'),
 *   deadline: Date.parse('2026-10-03T16:00:00+01:00'),
 * }); // [1, 0]
 */
export function greedyInsertion(options) {
  const context = routeContext(options);
  return toIndexes(insertGreedily([], context));
}

/**
 * Improves a route with 2-opt: it reverses sections of the route wherever
 * that makes it quicker, until no reversal helps. Without a finish, the end
 * of the route isn't fixed, so it can also reverse the whole tail of the
 * route. It never adds or removes locations, never reaches a location with a
 * fixed time any later than allowed if the route didn't already, and never
 * makes the route slower, unless that makes it less late for its fixed
 * times.
 *
 * @param {PlanOptions} options The candidate locations and the settings to plan with.
 * @param {number[]} order Indexes into `locations`, in visiting order.
 * @returns {number[]} The same indexes, in an order that's no slower.
 * @example
 * // Locations at the corners of a square, visited in a crossing order.
 * improveWithTwoOpt(options, [0, 2, 1, 3]); // [0, 1, 2, 3]
 */
export function improveWithTwoOpt(options, order) {
  const context = routeContext(options);
  return toIndexes(twoOpt(order.map((index) => index + 1), context));
}

/**
 * The walking times and limits used while planning.
 *
 * @typedef {object} RouteContext
 * @property {number[][]} walk Walking time in seconds between every pair of nodes.
 * @property {number} startNode The node for the start (always 0). Location `i` is node `i + 1`.
 * @property {number | null} finishNode The node for the finish, or `null` if there's no finish.
 * @property {number} locationCount How many candidate locations there are.
 * @property {number[]} points What each node is worth. Only location nodes are worth anything.
 * @property {Set<number>} mustVisitNodes Location nodes that every route must include.
 * @property {(number | null)[]} fixedSeconds When the team must be at each node, in seconds after the start time, or `null` for a node without a fixed time.
 * @property {number[]} latestSeconds The latest the team may reach each node with a fixed time, in seconds after the start time: the safety margin before its fixed time, unless {@link plan} has allowed a must-visit location to be late.
 * @property {number} dwellSeconds Time spent at each stop taking the selfie, in seconds.
 * @property {number} budgetSeconds Time available for the route, in seconds.
 */

/**
 * Works out the walking times between every pair of places once, so
 * planning doesn't recalculate them.
 *
 * @param {PlanOptions} options The candidate locations and the settings to plan with.
 * @returns {RouteContext} The walking times and limits.
 */
function routeContext({
  start,
  locations,
  points = locations.map(() => 1),
  mustVisit = [],
  fixedTimes = [],
  finish = null,
  startTime,
  deadline,
  speedKmh = 4.5,
  detourFactor = 1.3,
  dwellSeconds = 180,
  safetyMarginSeconds = 900,
}) {
  // Nodes are the start, then each location, then the finish (if there is one).
  const nodes = [start, ...locations, ...(finish ? [finish] : [])];
  const isLocation = (node) => node >= 1 && node <= locations.length;
  const fixedSeconds = nodes.map((_, node) => {
    const fixedTime = isLocation(node) ? (fixedTimes[node - 1] ?? null) : null;
    return fixedTime === null ? null : (fixedTime - startTime) / 1000;
  });
  return {
    walk: nodes.map((a) => nodes.map((b) => walkSeconds(a, b, { speedKmh, detourFactor }))),
    startNode: 0,
    finishNode: finish ? nodes.length - 1 : null,
    locationCount: locations.length,
    points: nodes.map((_, node) => (isLocation(node) ? points[node - 1] : 0)),
    mustVisitNodes: new Set(mustVisit.map((index) => index + 1)),
    fixedSeconds,
    latestSeconds: fixedSeconds.map((seconds) => (seconds === null ? Infinity : seconds - safetyMarginSeconds)),
    dwellSeconds,
    budgetSeconds: (deadline - startTime) / 1000 - safetyMarginSeconds,
  };
}

/**
 * Converts location nodes back to indexes into `locations`.
 *
 * @param {number[]} route Location nodes in visiting order.
 * @returns {number[]} Indexes into `locations`.
 */
const toIndexes = (route) => route.map((node) => node - 1);

/** Most lateness in seconds that still counts as on time, so rounding errors can't make a route late. */
const LATE_SECONDS = 1e-6;

/**
 * The timings of a route while planning, in seconds after the start time.
 *
 * @typedef {object} RouteTiming
 * @property {number[]} arrivals When the team reaches each stop.
 * @property {number[]} departures When the team leaves each stop, after any wait for its fixed time and the selfie.
 * @property {number[]} fixedPositions Indexes into the route of the stops with fixed times, in ascending order.
 * @property {number} seconds How long the route takes, from the start to the finish (or the last selfie if there's no finish), including waits.
 * @property {number} walkSeconds How much of that is spent walking.
 * @property {number} lateSeconds How much later than allowed the route reaches its stops with fixed times, in total. 0 when it keeps them all.
 * @property {number[]} walkSecondsBefore How much walking there is before reaching each stop.
 * @property {number[]} lateSecondsBefore How much later than allowed the route is for the stops before each stop, in total.
 */

/**
 * Works out the timings of a route by stepping through it from the start,
 * waiting at each stop with a fixed time until that time.
 *
 * @param {number[]} route Location nodes in visiting order.
 * @param {RouteContext} context The walking times and limits.
 * @returns {RouteTiming} The timings.
 */
function routeTiming(route, { walk, startNode, finishNode, dwellSeconds, fixedSeconds, latestSeconds }) {
  const arrivals = [];
  const departures = [];
  const fixedPositions = [];
  const walkSecondsBefore = [];
  const lateSecondsBefore = [];
  let lateSeconds = 0;
  let walkSeconds = 0;
  let time = 0;
  let previous = startNode;
  for (const [position, node] of route.entries()) {
    walkSecondsBefore.push(walkSeconds);
    lateSecondsBefore.push(lateSeconds);
    time += walk[previous][node];
    walkSeconds += walk[previous][node];
    arrivals.push(time);
    if (fixedSeconds[node] !== null) {
      fixedPositions.push(position);
      lateSeconds += Math.max(0, time - latestSeconds[node]);
      time = Math.max(time, fixedSeconds[node]);
    }
    time += dwellSeconds;
    departures.push(time);
    previous = node;
  }
  const finishWalkSeconds = finishNode === null ? 0 : walk[previous][finishNode];
  return {
    arrivals,
    departures,
    fixedPositions,
    seconds: time + finishWalkSeconds,
    walkSeconds: walkSeconds + finishWalkSeconds,
    lateSeconds,
    walkSecondsBefore,
    lateSecondsBefore,
  };
}

/**
 * Works out how long a route would take, how much of that is walking and
 * how late it would be for its fixed times, with a section reversed. The
 * stops before the section are reached at the same times, so only the
 * section and the stops after it are stepped through.
 *
 * @param {number[]} route Location nodes in visiting order.
 * @param {number} i Where the section starts, as an index into `route`.
 * @param {number} j Where the section ends, as an index into `route`.
 * @param {RouteContext} context The walking times and limits.
 * @param {RouteTiming} timing The route's timings.
 * @returns {Timing} The time taken, walking and lateness with the section reversed.
 */
function reversedTiming(route, i, j, { walk, startNode, finishNode, dwellSeconds, fixedSeconds, latestSeconds }, timing) {
  let lateSeconds = timing.lateSecondsBefore[i];
  let walkSeconds = timing.walkSecondsBefore[i];
  let time = i === 0 ? 0 : timing.departures[i - 1];
  let previous = i === 0 ? startNode : route[i - 1];
  for (let position = i; position < route.length; position += 1) {
    const node = position <= j ? route[i + j - position] : route[position];
    time += walk[previous][node];
    walkSeconds += walk[previous][node];
    if (fixedSeconds[node] !== null) {
      lateSeconds += Math.max(0, time - latestSeconds[node]);
      time = Math.max(time, fixedSeconds[node]);
    }
    time += dwellSeconds;
    previous = node;
  }
  const finishWalkSeconds = finishNode === null ? 0 : walk[previous][finishNode];
  return { seconds: time + finishWalkSeconds, walkSeconds: walkSeconds + finishWalkSeconds, lateSeconds };
}

/**
 * Works out how long a route takes, from the start to the finish (or the
 * last selfie if there's no finish), including waits for fixed times.
 *
 * @param {number[]} route Location nodes in visiting order.
 * @param {RouteContext} context The walking times and limits.
 * @returns {number} The time in seconds.
 */
const routeSeconds = (route, context) => routeTiming(route, context).seconds;

/**
 * Whether a route fits the time budget and keeps every fixed time.
 *
 * @param {number[]} route Location nodes in visiting order.
 * @param {RouteContext} context The walking times and limits.
 * @returns {boolean} Whether it fits.
 */
function fits(route, context) {
  const { seconds, lateSeconds } = routeTiming(route, context);
  return seconds <= context.budgetSeconds && lateSeconds <= LATE_SECONDS;
}

/**
 * Whether one way to time a route is better than another: it's less late
 * for its fixed times, or no later and quicker, or no later or slower with
 * less walking. Walking less matters when a wait for a fixed time takes up
 * the difference, since it leaves more of the wait for other locations.
 *
 * @typedef {{ seconds: number, walkSeconds: number, lateSeconds: number }} Timing
 * @param {Timing} candidate The time taken, walking and lateness of one.
 * @param {Timing} current The time taken, walking and lateness of the other.
 * @returns {boolean} Whether `candidate` is better than `current`.
 */
const isQuicker = (candidate, current) =>
  candidate.lateSeconds < current.lateSeconds - LATE_SECONDS ||
  (candidate.lateSeconds <= current.lateSeconds &&
    (candidate.seconds < current.seconds - IMPROVEMENT_SECONDS ||
      (candidate.seconds <= current.seconds && candidate.walkSeconds < current.walkSeconds - IMPROVEMENT_SECONDS)));

/**
 * Works out how many points a route earns.
 *
 * @param {number[]} route Location nodes in visiting order.
 * @param {RouteContext} context The walking times and limits.
 * @returns {number} The total of the locations' points.
 */
const routePoints = (route, { points }) => route.reduce((total, node) => total + points[node], 0);

/**
 * Lists every location node, in order.
 *
 * @param {RouteContext} context The walking times and limits.
 * @returns {number[]} The location nodes, 1 to `locationCount`.
 */
const locationNodes = ({ locationCount }) => Array.from({ length: locationCount }, (_, index) => index + 1);

/**
 * Finds where adding a location to a route adds the least time, of the
 * places where it makes the route least late for its fixed times, then
 * where it adds the least walking. Adding a location delays every stop
 * after it, until a wait for a fixed time takes up the delay, so waiting is
 * time a nearby location can be added in.
 *
 * @param {number[]} route Location nodes in visiting order.
 * @param {number} node The location node to add.
 * @param {RouteContext} context The walking times and limits.
 * @param {RouteTiming} [timing] The route's timings, if already worked out.
 * @returns {{ position: number, addedSeconds: number, walkSeconds: number, lateSeconds: number }} Where to add it, as an index into `route`, the time and walking it adds, and how much later than allowed it makes the route for its fixed times.
 */
function cheapestInsertion(route, node, context, timing = routeTiming(route, context)) {
  const { walk, startNode, finishNode, dwellSeconds, fixedSeconds, latestSeconds } = context;
  let best = null;
  for (let position = 0; position <= route.length; position += 1) {
    const previous = position === 0 ? startNode : route[position - 1];
    const next = position === route.length ? finishNode : route[position];
    const walkSeconds = walk[previous][node] + (next === null ? 0 : walk[node][next] - walk[previous][next]);
    const arrival = (position === 0 ? 0 : timing.departures[position - 1]) + walk[previous][node];
    let lateSeconds = 0;
    let departure = arrival + dwellSeconds;
    if (fixedSeconds[node] !== null) {
      lateSeconds = Math.max(0, arrival - latestSeconds[node]);
      departure = Math.max(arrival, fixedSeconds[node]) + dwellSeconds;
    }
    let addedSeconds;
    if (position === route.length) {
      addedSeconds = departure + (finishNode === null ? 0 : walk[node][finishNode]) - timing.seconds;
    } else {
      // How much later the team reaches each later stop, until a wait for a
      // fixed time takes it up.
      let delay = departure + walk[node][next] - timing.arrivals[position];
      for (const later of timing.fixedPositions) {
        if (delay <= 0) {
          break;
        }
        if (later >= position) {
          const laterNode = route[later];
          const delayed = timing.arrivals[later] + delay;
          lateSeconds += Math.max(0, delayed - latestSeconds[laterNode]) - Math.max(0, timing.arrivals[later] - latestSeconds[laterNode]);
          delay = Math.max(delayed, fixedSeconds[laterNode]) + dwellSeconds - timing.departures[later];
        }
      }
      addedSeconds = delay;
    }
    if (best === null || isQuicker({ seconds: addedSeconds, walkSeconds, lateSeconds }, { seconds: best.addedSeconds, walkSeconds: best.walkSeconds, lateSeconds: best.lateSeconds })) {
      best = { position, addedSeconds, walkSeconds, lateSeconds };
    }
  }
  return best;
}

/** Smallest added time in seconds to earn points per second against, so a location that adds no time doesn't divide by 0. */
const MIN_ADDED_SECONDS = 1e-9;

/**
 * Adds locations to a route by greedy insertion, for as long as any still fit
 * the time budget and keep every fixed time: each time, of the locations
 * that fit where they add the least time, the one that earns the most points
 * for each second it adds. Ties go to the location that adds the least time,
 * so with every location worth the same, that's the location that adds the
 * least time, then to the one that adds the least walking, such as the
 * nearest of those that fit in a wait for a fixed time.
 *
 * @param {number[]} route Location nodes already in the route, in visiting order. This isn't changed.
 * @param {RouteContext} context The walking times and limits.
 * @param {object} [options] Which locations to add, and the budget.
 * @param {number[]} [options.candidates] Location nodes that may be added, in order. Defaults to every location.
 * @param {number} [options.budgetSeconds] The time the route must fit in. Defaults to the context's.
 * @param {boolean} [options.isLateAllowed=false] Whether locations may be added that make the route later than allowed for its fixed times, those that make it least late first.
 * @returns {number[]} The route with the locations that fit added.
 */
function insertGreedily(route, context, { candidates = locationNodes(context), budgetSeconds = context.budgetSeconds, isLateAllowed = false } = {}) {
  const extended = [...route];
  const unvisited = new Set(candidates.filter((node) => !extended.includes(node)));

  while (unvisited.size > 0) {
    const timing = routeTiming(extended, context);
    let best = null;
    for (const node of unvisited) {
      const insertion = cheapestInsertion(extended, node, context, timing);
      if (timing.seconds + insertion.addedSeconds > budgetSeconds || (!isLateAllowed && insertion.lateSeconds > LATE_SECONDS)) {
        continue;
      }
      const pointsPerSecond = context.points[node] / Math.max(insertion.addedSeconds, MIN_ADDED_SECONDS);
      if (
        best === null ||
        insertion.lateSeconds < best.lateSeconds - LATE_SECONDS ||
        (insertion.lateSeconds <= best.lateSeconds + LATE_SECONDS &&
          (pointsPerSecond > best.pointsPerSecond || (pointsPerSecond === best.pointsPerSecond && isQuicker({ ...insertion, seconds: insertion.addedSeconds, lateSeconds: 0 }, { ...best, seconds: best.addedSeconds, lateSeconds: 0 }))))
      ) {
        best = { node, pointsPerSecond, ...insertion };
      }
    }
    if (best === null) {
      break;
    }
    extended.splice(best.position, 0, best.node);
    unvisited.delete(best.node);
  }
  return extended;
}

/** Smallest saving in seconds that counts as an improvement, so rounding errors can't loop forever. */
const IMPROVEMENT_SECONDS = 1e-6;

/**
 * Improves a route with 2-opt. Walking times are the same in both
 * directions, so reversing a section only changes the walks at its two ends.
 * With a fixed time in the route, it also changes the waits after it, so
 * the route from the start of each reversal is stepped through instead, and
 * the reversal is only kept if it's no later for the fixed times.
 *
 * @param {number[]} route Location nodes in visiting order. This isn't changed.
 * @param {RouteContext} context The walking times and limits.
 * @returns {number[]} The improved route.
 */
function twoOpt(route, context) {
  const { walk, startNode, finishNode, fixedSeconds } = context;
  const shortened = [...route];
  const hasFixedTimes = shortened.some((node) => fixedSeconds[node] !== null);
  let timing = hasFixedTimes ? routeTiming(shortened, context) : null;
  let isImproved = true;
  while (isImproved) {
    isImproved = false;
    for (let i = 0; i < shortened.length - 1; i += 1) {
      for (let j = i + 1; j < shortened.length; j += 1) {
        if (hasFixedTimes) {
          if (isQuicker(reversedTiming(shortened, i, j, context, timing), timing)) {
            shortened.splice(i, j - i + 1, ...shortened.slice(i, j + 1).reverse());
            timing = routeTiming(shortened, context);
            isImproved = true;
          }
          continue;
        }
        const before = i === 0 ? startNode : shortened[i - 1];
        const after = j === shortened.length - 1 ? finishNode : shortened[j + 1];
        // Reversing shortened[i..j] replaces the walks before → shortened[i] and
        // shortened[j] → after with before → shortened[j] and shortened[i] → after.
        // Without a finish, reversing the tail (after === null) only changes
        // the first of those walks.
        const savedSeconds =
          walk[before][shortened[i]] -
          walk[before][shortened[j]] +
          (after === null ? 0 : walk[shortened[j]][after] - walk[shortened[i]][after]);
        if (savedSeconds > IMPROVEMENT_SECONDS) {
          shortened.splice(i, j - i + 1, ...shortened.slice(i, j + 1).reverse());
          isImproved = true;
        }
      }
    }
  }
  return shortened;
}

/**
 * Whether one route is better than another: it earns more points, or as
 * many with more stops, or as many with as many stops in less time. With
 * every location worth the same, that's more stops, or as many in less
 * time.
 *
 * @param {number[]} candidate Location nodes in visiting order.
 * @param {number[]} current Location nodes in visiting order.
 * @param {RouteContext} context The walking times and limits.
 * @returns {boolean} Whether `candidate` is better than `current`.
 */
function isBetterRoute(candidate, current, context) {
  const candidatePoints = routePoints(candidate, context);
  const currentPoints = routePoints(current, context);
  if (candidatePoints !== currentPoints) {
    return candidatePoints > currentPoints;
  }
  if (candidate.length !== current.length) {
    return candidate.length > current.length;
  }
  return routeSeconds(candidate, context) < routeSeconds(current, context) - IMPROVEMENT_SECONDS;
}

/**
 * Tries removing each stop in turn and greedily inserting other locations into
 * the time that frees up, which can fit two nearby locations in place of one
 * out-of-the-way one, or a location worth more in place of one or more
 * worth less. The removed stop isn't put back in the same attempt.
 * Must-visit stops are never removed.
 *
 * @param {number[]} route Location nodes in visiting order. This isn't changed.
 * @param {RouteContext} context The walking times and limits.
 * @param {number} stopAt When to give up, from `performance.now()`.
 * @returns {number[] | null} The first better route found, or `null` if there isn't one.
 */
function swapOneForMore(route, context, stopAt) {
  for (let position = 0; position < route.length && performance.now() < stopAt; position += 1) {
    if (context.mustVisitNodes.has(route[position])) {
      continue;
    }
    const without = route.filter((_, index) => index !== position);
    const candidates = locationNodes(context).filter((node) => node !== route[position]);
    const candidate = insertGreedily(twoOpt(without, context), context, { candidates });
    if (isBetterRoute(candidate, route, context)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Improves a route until nothing helps or the time limit is reached: it
 * shortens the route with 2-opt and uses any time that frees up for more
 * locations, then tries swapping one stop for others.
 *
 * @param {number[]} route Location nodes in visiting order. This isn't changed.
 * @param {RouteContext} context The walking times and limits.
 * @param {number} stopAt When to stop, from `performance.now()`.
 * @returns {number[]} The improved route.
 */
function improveRoute(route, context, stopAt) {
  let best = route;
  while (performance.now() < stopAt) {
    const improved = insertGreedily(twoOpt(best, context), context);
    if (isBetterRoute(improved, best, context)) {
      best = improved;
      continue;
    }
    const swapped = swapOneForMore(best, context, stopAt);
    if (!swapped) {
      break;
    }
    best = swapped;
  }
  return best;
}

/**
 * Builds the route that every route the planner considers starts from: every
 * must-visit location, each added where it adds the least time, then shortened
 * with 2-opt. It may not fit the time budget, nor keep every fixed time, in
 * which case it's as little late for them as the planner can manage. Every
 * must-visit location is included whatever it's worth, so points don't
 * change the route.
 *
 * @param {RouteContext} context The walking times and limits.
 * @returns {number[]} The must-visit location nodes, in visiting order.
 */
function mustVisitRoute(context) {
  const candidates = locationNodes(context).filter((node) => context.mustVisitNodes.has(node));
  // With every location worth the same, greedy insertion adds the location that adds the least time.
  const unweighted = { ...context, points: context.points.map(() => 1) };
  return twoOpt(insertGreedily([], unweighted, { candidates, budgetSeconds: Infinity, isLateAllowed: true }), context);
}

/**
 * Adds a location to a route where it adds the least time.
 *
 * @param {number[]} route Location nodes in visiting order. This isn't changed.
 * @param {number} node The location node to add.
 * @param {RouteContext} context The walking times and limits.
 * @returns {number[]} The route with the location added.
 */
function insertCheapest(route, node, context) {
  const { position } = cheapestInsertion(route, node, context);
  return [...route.slice(0, position), node, ...route.slice(position)];
}

/**
 * A planned route.
 *
 * @typedef {object} Plan
 * @property {number[]} order Indexes into `locations` in visiting order.
 * @property {number[]} arrivalTimes When the team arrives at each stop in `order`, in milliseconds since the Unix epoch.
 * @property {number} endEta When the route ends, in milliseconds since the Unix epoch. With a finish, this is the arrival time at the finish. Without one, it's when the last selfie is taken.
 * @property {number} spareSeconds Time left between `endEta` and the deadline minus the safety margin. Negative only when even the walk to the finish doesn't fit, or when `isMustVisitLate` is `true`.
 * @property {number[]} skipped Indexes into `locations` that aren't in `order`, in ascending order.
 * @property {boolean} isMustVisitLate Whether the must-visit locations alone don't fit before the deadline minus the safety margin, so the route is only those, in the shortest order found.
 */

/**
 * Plans the route that earns the most points before the deadline minus the
 * safety margin, ending at the finish if there is one. Of routes that earn
 * as many points, it prefers more stops, then less time, so with every
 * location worth the same, it visits as many locations as possible. It
 * builds a route by greedy insertion, then improves it with 2-opt and by
 * swapping one stop for others. It does this again starting from each
 * location in turn, for up to `timeLimitMs` in total, and keeps the best
 * route.
 *
 * Every route includes every must-visit location: each route starts from them,
 * added where they add the least time, and no improvement removes one. If
 * they don't all fit on their own, the route is only them, in the shortest
 * order found, and `isMustVisitLate` is `true`.
 *
 * Every route reaches each location with a fixed time at least the safety
 * margin before that time, then waits until it, so a location whose fixed
 * time can't be kept is skipped. Waiting counts towards the time a route
 * takes, so a route fills a wait with a nearby location where it can. A
 * must-visit location whose fixed time can't be kept is visited anyway, as
 * early as the planner can manage. Other routes may reach it no later than
 * the must-visit locations alone do.
 *
 * @param {PlanOptions} options The candidate locations and the settings to plan with.
 * @returns {Plan} The visiting order, the timings and the locations left out.
 * @throws {RangeError} If `speedKmh` isn't greater than 0 or `detourFactor` is less than 1.
 * @example
 * const { order, skipped } = plan({
 *   start: { lat: 51.4556, lng: -2.5894 },
 *   locations: [{ lat: 51.4549, lng: -2.6278 }, { lat: 51.4492, lng: -2.5813 }],
 *   finish: null,
 *   startTime: Date.parse('2026-10-03T11:00:00+01:00'),
 *   deadline: Date.parse('2026-10-03T16:00:00+01:00'),
 * });
 * order; // [1, 0]
 * skipped; // []
 */
export function plan({ timeLimitMs = 200, ...options }) {
  // Build a route greedily, then improve it until nothing helps or the time
  // limit is reached: shorten it with 2-opt and use any time that frees up
  // for more locations, then try swapping one stop for others.
  const strictContext = routeContext(options);
  const stopAt = performance.now() + timeLimitMs;
  const mustVisit = mustVisitRoute(strictContext);
  // A must-visit location may be late for its fixed time when it can't be
  // kept, but no later than with only the must-visit locations.
  const latestSeconds = [...strictContext.latestSeconds];
  const { arrivals } = routeTiming(mustVisit, strictContext);
  for (const [position, node] of mustVisit.entries()) {
    latestSeconds[node] = Math.max(latestSeconds[node], arrivals[position]);
  }
  const context = { ...strictContext, latestSeconds };
  // An empty route can be over budget too, when even the walk to the finish
  // doesn't fit, so the must-visit locations are only late when the route
  // would fit without them.
  const isOverBudget = routeSeconds(mustVisit, context) > context.budgetSeconds;
  const isMustVisitLate = isOverBudget && routeSeconds([], context) <= context.budgetSeconds;
  let route = mustVisit;
  if (!isOverBudget) {
    // A poor starting route can leave the improvements stuck, so also start
    // from each other location that fits alongside the must-visit locations,
    // and keep the best route found.
    route = improveRoute(insertGreedily(mustVisit, context), context, stopAt);
    for (let node = 1; node <= context.locationCount && performance.now() < stopAt; node += 1) {
      const start = context.mustVisitNodes.has(node) ? null : insertCheapest(mustVisit, node, context);
      if (start && fits(start, context)) {
        const candidate = improveRoute(insertGreedily(start, context), context, stopAt);
        if (isBetterRoute(candidate, route, context)) {
          route = candidate;
        }
      }
    }
  }
  const order = toIndexes(route);
  const { arrivalTimes, endEta, spareSeconds } = evaluateRoute({
    ...options,
    stops: order.map((index) => options.locations[index]),
    fixedTimes: order.map((index) => options.fixedTimes?.[index] ?? null),
  });
  const visited = new Set(order);
  const skipped = options.locations.map((_, index) => index).filter((index) => !visited.has(index));
  return { order, arrivalTimes, endEta, spareSeconds, skipped, isMustVisitLate };
}
