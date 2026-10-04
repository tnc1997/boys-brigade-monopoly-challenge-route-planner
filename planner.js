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
 * time there.
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
    if (index > 0) {
      time += dwellSeconds * 1000;
    }
    time += walkSeconds(position, stop, walkOptions) * 1000;
    arrivalTimes.push(time);
    position = stop;
  }

  if (stops.length > 0) {
    time += dwellSeconds * 1000;
  }
  if (finish) {
    time += walkSeconds(position, finish, walkOptions) * 1000;
  }

  const spareSeconds = (deadline - safetyMarginSeconds * 1000 - time) / 1000;
  return { arrivalTimes, endEta: time, spareSeconds, isWithinBudget: spareSeconds >= 0 };
}

/**
 * Options for planning a route, the same as {@link RouteOptions} except that
 * `points` are the candidate locations in any order, rather than `stops` in
 * visiting order.
 *
 * `mustVisit` lists indexes into `points` that every route must include,
 * even if leaving them out would fit in more points (none by default).
 * `timeLimitMs` limits how long {@link plan} spends improving the route,
 * in milliseconds (200 by default).
 *
 * @typedef {Omit<RouteOptions, 'stops'> & { points: LatLng[], mustVisit?: number[], timeLimitMs?: number }} PlanOptions
 */

/**
 * Builds a route by greedy insertion. It repeatedly adds the unvisited point
 * that adds the least time at its cheapest position in the route, for as long
 * as the route still fits within the deadline minus the safety margin. With a
 * finish, the route runs start → … → finish. Without one, it runs start → … →
 * last stop, so adding a point at the end costs only the walk to it.
 *
 * @param {PlanOptions} options The candidate points and the settings to plan with.
 * @returns {number[]} Indexes into `points`, in visiting order. Points that don't fit are left out.
 * @example
 * greedyInsertion({
 *   start: { lat: 51.4556, lng: -2.5894 },
 *   points: [{ lat: 51.4549, lng: -2.6278 }, { lat: 51.4492, lng: -2.5813 }],
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
 * route. It never makes the route slower or adds or removes points.
 *
 * @param {PlanOptions} options The candidate points and the settings to plan with.
 * @param {number[]} order Indexes into `points`, in visiting order.
 * @returns {number[]} The same indexes, in an order that's no slower.
 * @example
 * // Points at the corners of a square, visited in a crossing order.
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
 * @property {number} startNode The node for the start (always 0). Point `i` is node `i + 1`.
 * @property {number | null} finishNode The node for the finish, or `null` if there's no finish.
 * @property {number} pointCount How many candidate points there are.
 * @property {Set<number>} mustVisitNodes Point nodes that every route must include.
 * @property {number} dwellSeconds Time spent at each stop taking the selfie, in seconds.
 * @property {number} budgetSeconds Time available for the route, in seconds.
 */

/**
 * Works out the walking times between every pair of places once, so
 * planning doesn't recalculate them.
 *
 * @param {PlanOptions} options The candidate points and the settings to plan with.
 * @returns {RouteContext} The walking times and limits.
 */
function routeContext({
  start,
  points,
  mustVisit = [],
  finish = null,
  startTime,
  deadline,
  speedKmh = 4.5,
  detourFactor = 1.3,
  dwellSeconds = 180,
  safetyMarginSeconds = 900,
}) {
  // Nodes are the start, then each point, then the finish (if there is one).
  const nodes = [start, ...points, ...(finish ? [finish] : [])];
  return {
    walk: nodes.map((a) => nodes.map((b) => walkSeconds(a, b, { speedKmh, detourFactor }))),
    startNode: 0,
    finishNode: finish ? nodes.length - 1 : null,
    pointCount: points.length,
    mustVisitNodes: new Set(mustVisit.map((index) => index + 1)),
    dwellSeconds,
    budgetSeconds: (deadline - startTime) / 1000 - safetyMarginSeconds,
  };
}

/**
 * Converts point nodes back to indexes into `points`.
 *
 * @param {number[]} route Point nodes in visiting order.
 * @returns {number[]} Indexes into `points`.
 */
const toIndexes = (route) => route.map((node) => node - 1);

/**
 * Works out how long a route takes, from the start to the finish (or the
 * last selfie if there's no finish).
 *
 * @param {number[]} route Point nodes in visiting order.
 * @param {RouteContext} context The walking times and limits.
 * @returns {number} The time in seconds.
 */
function routeSeconds(route, { walk, startNode, finishNode, dwellSeconds }) {
  let seconds = route.length * dwellSeconds;
  let previous = startNode;
  for (const node of route) {
    seconds += walk[previous][node];
    previous = node;
  }
  return finishNode === null ? seconds : seconds + walk[previous][finishNode];
}

/**
 * Adds unvisited points to a route by greedy insertion, for as long as the
 * route still fits the time budget.
 *
 * @param {number[]} route Point nodes already in the route, in visiting order. This isn't changed.
 * @param {RouteContext} context The walking times and limits.
 * @param {Set<number>} [excluded] Point nodes not to add.
 * @returns {number[]} The route with the points that fit added.
 */
function insertGreedily(route, context, excluded = new Set()) {
  const { walk, startNode, finishNode, pointCount, dwellSeconds, budgetSeconds } = context;
  const result = [...route];
  let seconds = routeSeconds(result, context);
  const unvisited = new Set(
    Array.from({ length: pointCount }, (_, index) => index + 1).filter((node) => !result.includes(node) && !excluded.has(node)),
  );

  while (unvisited.size > 0) {
    let best = null;
    for (const node of unvisited) {
      for (let position = 0; position <= result.length; position += 1) {
        const previous = position === 0 ? startNode : result[position - 1];
        const next = position === result.length ? finishNode : result[position];
        const addedSeconds =
          dwellSeconds + walk[previous][node] + (next === null ? 0 : walk[node][next] - walk[previous][next]);
        if (best === null || addedSeconds < best.addedSeconds) {
          best = { node, position, addedSeconds };
        }
      }
    }
    if (seconds + best.addedSeconds > budgetSeconds) {
      break;
    }
    result.splice(best.position, 0, best.node);
    seconds += best.addedSeconds;
    unvisited.delete(best.node);
  }
  return result;
}

/** Smallest saving in seconds that counts as an improvement, so rounding errors can't loop forever. */
const IMPROVEMENT_SECONDS = 1e-6;

/**
 * Improves a route with 2-opt. Walking times are the same in both
 * directions, so reversing a section only changes the walks at its two ends.
 *
 * @param {number[]} route Point nodes in visiting order. This isn't changed.
 * @param {RouteContext} context The walking times and limits.
 * @returns {number[]} The improved route.
 */
function twoOpt(route, { walk, startNode, finishNode }) {
  const result = [...route];
  let isImproved = true;
  while (isImproved) {
    isImproved = false;
    for (let i = 0; i < result.length - 1; i += 1) {
      for (let j = i + 1; j < result.length; j += 1) {
        const before = i === 0 ? startNode : result[i - 1];
        const after = j === result.length - 1 ? finishNode : result[j + 1];
        // Reversing result[i..j] replaces the walks before → result[i] and
        // result[j] → after with before → result[j] and result[i] → after.
        // Without a finish, reversing the tail (after === null) only changes
        // the first of those walks.
        const savedSeconds =
          walk[before][result[i]] -
          walk[before][result[j]] +
          (after === null ? 0 : walk[result[j]][after] - walk[result[i]][after]);
        if (savedSeconds > IMPROVEMENT_SECONDS) {
          result.splice(i, j - i + 1, ...result.slice(i, j + 1).reverse());
          isImproved = true;
        }
      }
    }
  }
  return result;
}

/**
 * Whether one route is better than another: it visits more points, or the
 * same number in less time.
 *
 * @param {number[]} candidate Point nodes in visiting order.
 * @param {number[]} current Point nodes in visiting order.
 * @param {RouteContext} context The walking times and limits.
 * @returns {boolean} Whether `candidate` is better than `current`.
 */
function isBetterRoute(candidate, current, context) {
  if (candidate.length !== current.length) {
    return candidate.length > current.length;
  }
  return routeSeconds(candidate, context) < routeSeconds(current, context) - IMPROVEMENT_SECONDS;
}

/**
 * Tries removing each stop in turn and greedily inserting other points into
 * the time that frees up, which can fit two nearby points in place of one
 * out-of-the-way one. The removed stop isn't put back in the same attempt.
 * Must-visit stops are never removed.
 *
 * @param {number[]} route Point nodes in visiting order. This isn't changed.
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
    const candidate = insertGreedily(twoOpt(without, context), context, new Set([route[position]]));
    if (isBetterRoute(candidate, route, context)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Improves a route until nothing helps or the time limit is reached: it
 * shortens the route with 2-opt and uses any time that frees up for more
 * points, then tries swapping one stop for others.
 *
 * @param {number[]} route Point nodes in visiting order. This isn't changed.
 * @param {RouteContext} context The walking times and limits.
 * @param {number} stopAt When to stop, from `performance.now()`.
 * @returns {number[]} The improved route.
 */
function improveRoute(route, context, stopAt) {
  let result = route;
  while (performance.now() < stopAt) {
    const improved = insertGreedily(twoOpt(result, context), context);
    if (isBetterRoute(improved, result, context)) {
      result = improved;
      continue;
    }
    const swapped = swapOneForMore(result, context, stopAt);
    if (!swapped) {
      break;
    }
    result = swapped;
  }
  return result;
}

/**
 * Builds the route that every route the planner considers starts from: every
 * must-visit point, each added where it adds the least time, then shortened
 * with 2-opt. It may not fit the time budget.
 *
 * @param {RouteContext} context The walking times and limits.
 * @returns {number[]} The must-visit point nodes, in visiting order.
 */
function mustVisitRoute(context) {
  const others = Array.from({ length: context.pointCount }, (_, index) => index + 1).filter((node) => !context.mustVisitNodes.has(node));
  return twoOpt(insertGreedily([], { ...context, budgetSeconds: Infinity }, new Set(others)), context);
}

/**
 * Adds a point to a route where it adds the least time.
 *
 * @param {number[]} route Point nodes in visiting order. This isn't changed.
 * @param {number} node The point node to add.
 * @param {RouteContext} context The walking times and limits.
 * @returns {number[]} The route with the point added.
 */
function insertCheapest(route, node, context) {
  // Only this point may be added, however long the route gets.
  const others = Array.from({ length: context.pointCount }, (_, index) => index + 1).filter((other) => other !== node);
  return insertGreedily(route, { ...context, budgetSeconds: Infinity }, new Set(others));
}

/**
 * A planned route.
 *
 * @typedef {object} Plan
 * @property {number[]} order Indexes into `points` in visiting order.
 * @property {number[]} arrivalTimes When the team arrives at each stop in `order`, in milliseconds since the Unix epoch.
 * @property {number} endEta When the route ends, in milliseconds since the Unix epoch. With a finish, this is the arrival time at the finish. Without one, it's when the last selfie is taken.
 * @property {number} spareSeconds Time left between `endEta` and the deadline minus the safety margin. Negative only when even the walk to the finish doesn't fit, or when `isMustVisitLate` is `true`.
 * @property {number[]} skipped Indexes into `points` that aren't in `order`, in ascending order.
 * @property {boolean} isMustVisitLate Whether the must-visit points alone don't fit before the deadline minus the safety margin, so the route is only those, in the shortest order found.
 */

/**
 * Plans the route that visits as many points as possible before the deadline
 * minus the safety margin, ending at the finish if there is one. It builds a
 * route by greedy insertion, then improves it with 2-opt and by swapping one
 * stop for others. It does this again starting from each point in turn, for
 * up to `timeLimitMs` in total, and keeps the best route.
 *
 * Every route includes every must-visit point: each route starts from them,
 * added where they add the least time, and no improvement removes one. If
 * they don't all fit on their own, the route is only them, in the shortest
 * order found, and `isMustVisitLate` is `true`.
 *
 * @param {PlanOptions} options The candidate points and the settings to plan with.
 * @returns {Plan} The visiting order, the timings and the points left out.
 * @throws {RangeError} If `speedKmh` isn't greater than 0 or `detourFactor` is less than 1.
 * @example
 * const { order, skipped } = plan({
 *   start: { lat: 51.4556, lng: -2.5894 },
 *   points: [{ lat: 51.4549, lng: -2.6278 }, { lat: 51.4492, lng: -2.5813 }],
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
  // for more points, then try swapping one stop for others.
  const context = routeContext(options);
  const stopAt = performance.now() + timeLimitMs;
  const mustVisit = mustVisitRoute(context);
  // Without must-visit points, an empty route can still be over budget,
  // when even the walk to the finish doesn't fit.
  const isOverBudget = routeSeconds(mustVisit, context) > context.budgetSeconds;
  const isMustVisitLate = isOverBudget && mustVisit.length > 0;
  let route = mustVisit;
  if (!isOverBudget) {
    // A poor starting route can leave the improvements stuck, so also start
    // from each other point that fits alongside the must-visit points, and
    // keep the best route found.
    route = improveRoute(insertGreedily(mustVisit, context), context, stopAt);
    for (let node = 1; node <= context.pointCount && performance.now() < stopAt; node += 1) {
      const start = context.mustVisitNodes.has(node) ? null : insertCheapest(mustVisit, node, context);
      if (start && routeSeconds(start, context) <= context.budgetSeconds) {
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
    stops: order.map((index) => options.points[index]),
  });
  const visited = new Set(order);
  const skipped = options.points.map((_, index) => index).filter((index) => !visited.has(index));
  return { order, arrivalTimes, endEta, spareSeconds, skipped, isMustVisitLate };
}
