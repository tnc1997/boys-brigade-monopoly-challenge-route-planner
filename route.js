import { walkSeconds } from './planner.js';
import { timeToday } from './setup.js';

/**
 * A stop on the route, ready to show.
 *
 * @typedef {object} RouteStop
 * @property {number} number The stop's position in the route, starting at 1.
 * @property {import('./locations.js').RouteLocation} location The location.
 * @property {number} arrivalTime When the team arrives, in milliseconds since the Unix epoch.
 * @property {number} walkSeconds How long the walk from the previous stop (or the start) takes, in seconds.
 * @property {number | null} fixedTime The location's At, on the day of the plan, in milliseconds since the Unix epoch, or `null` if it doesn't have one.
 * @property {number} waitSeconds How long the team waits at the location for its At before taking the selfie, in seconds, or 0 if they don't.
 * @property {boolean} isLateForAt Whether the team arrives less than the safety margin before the location's At, or after it, to the minute, as times are shown. Only a must-visit location can be, since planning skips any other location it can't reach in time.
 * @property {string} googleMapsDirectionsUrl A Google Maps URL with walking directions to the location.
 * @property {string} appleMapsDirectionsUrl An Apple Maps URL with walking directions to the location.
 */

/**
 * The route, ready to show.
 *
 * @typedef {object} RouteView
 * @property {RouteStop[]} stops The stops in visiting order.
 * @property {RouteStop | null} finish The walk to the finish, or `null` if there's no finish. Its `number` is 0.
 * @property {number} endEta When the route ends, in milliseconds since the Unix epoch.
 * @property {import('./locations.js').RouteLocation[]} skipped The locations that don't fit, in list order, other than those in `skippedForAt`.
 * @property {import('./locations.js').RouteLocation[]} skippedForAt The locations with an At time that don't fit, since the route can't reach them in time, in list order.
 */

/**
 * Writes coordinates for a maps URL, to 6 decimal places (about 10 cm), so
 * a value very close to zero isn't written in exponent notation like
 * `-5e-7`, which maps apps can't read.
 *
 * @param {import('./planner.js').LatLng} location The location.
 * @returns {string} The coordinates as `lat,lng`, like `51.454500,-2.587900`.
 */
function coordinatesText({ lat, lng }) {
  // Rounding first also turns -0.000000 into 0.000000.
  const format = (value) => Number(value.toFixed(6)).toFixed(6);
  return `${format(lat)},${format(lng)}`;
}

/**
 * Creates a Google Maps URL with walking directions from the current
 * position to a location.
 *
 * @param {import('./planner.js').LatLng} location Where to go.
 * @returns {string} The URL.
 * @example
 * googleMapsDirectionsUrl({ lat: 51.4545, lng: -2.5879 });
 * // 'https://www.google.com/maps/dir/?api=1&destination=51.454500%2C-2.587900&travelmode=walking'
 */
export function googleMapsDirectionsUrl({ lat, lng }) {
  const params = new URLSearchParams({ api: '1', destination: coordinatesText({ lat, lng }), travelmode: 'walking' });
  return `https://www.google.com/maps/dir/?${params}`;
}

/**
 * Creates an Apple Maps URL with walking directions from the current
 * position to a location. It opens the Apple Maps app on an iPhone, and
 * Apple Maps on the web elsewhere.
 *
 * @param {import('./planner.js').LatLng} location Where to go.
 * @returns {string} The URL.
 * @example
 * appleMapsDirectionsUrl({ lat: 51.4545, lng: -2.5879 });
 * // 'https://maps.apple.com/?daddr=51.454500,-2.587900&dirflg=w'
 */
export function appleMapsDirectionsUrl({ lat, lng }) {
  return `https://maps.apple.com/?daddr=${coordinatesText({ lat, lng })}&dirflg=w`;
}

/**
 * Works out whether the app is running on an Apple device (iPhone, iPad or
 * Mac), where Apple Maps is available. Apple Maps on the web may not support
 * other devices' browsers, such as Chrome on Android, so its directions link
 * is only offered on Apple devices. iPads report themselves as Macs.
 *
 * @param {string} userAgent The browser's user agent, from `navigator.userAgent`.
 * @returns {boolean} Whether it's an Apple device.
 * @example
 * isAppleDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) …'); // true
 * isAppleDevice('Mozilla/5.0 (Linux; Android 15; Pixel 9) …'); // false
 */
export function isAppleDevice(userAgent) {
  return /\b(?:iPhone|iPad|iPod|Macintosh)\b/.test(userAgent);
}

/**
 * Formats a duration as minutes, or hours and minutes, rounding to the
 * nearest minute.
 *
 * @param {number} seconds The duration in seconds.
 * @returns {string} The duration, like `16 min` or `1 h 5 min`.
 * @example
 * formatDuration(943); // '16 min'
 */
export function formatDuration(seconds) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) {
    return 'under 1 min';
  }
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/**
 * Describes a saved plan as stops to show, with walk times and directions URLs.
 *
 * @param {import('./setup.js').SavedPlan} plan The plan.
 * @returns {RouteView} The stops, the walk to the finish, the end ETA and the skipped locations, with those skipped for their At times apart.
 */
export function describeRoute(plan) {
  const walkOptions = { speedKmh: plan.settings.speedKmh, detourFactor: plan.settings.detourFactor };
  const marginMs = plan.settings.safetyMarginSeconds * 1000;
  const stop = (number, location, previous, arrivalTime) => {
    const fixedTime = location.at === undefined ? null : timeToday(location.at, plan.startTime);
    return {
      number,
      location,
      arrivalTime,
      walkSeconds: walkSeconds(previous, location, walkOptions),
      fixedTime,
      waitSeconds: fixedTime === null ? 0 : Math.max(0, (fixedTime - arrivalTime) / 1000),
      isLateForAt: fixedTime !== null && Math.floor(arrivalTime / 60000) > Math.floor((fixedTime - marginMs) / 60000),
      googleMapsDirectionsUrl: googleMapsDirectionsUrl(location),
      appleMapsDirectionsUrl: appleMapsDirectionsUrl(location),
    };
  };

  const stops = plan.order.map((index, position) =>
    stop(position + 1, plan.routeLocations[index], position === 0 ? plan.start : plan.routeLocations[plan.order[position - 1]], plan.arrivalTimes[position]),
  );
  const last = stops.length === 0 ? plan.start : stops[stops.length - 1].location;

  return {
    stops,
    finish: plan.finish ? stop(0, plan.finish, last, plan.endEta) : null,
    endEta: plan.endEta,
    skipped: plan.skipped.map((index) => plan.routeLocations[index]).filter(({ at }) => at === undefined),
    skippedForAt: plan.skipped.map((index) => plan.routeLocations[index]).filter(({ at }) => at !== undefined),
  };
}

/**
 * Counts how many of a plan's locations have had their selfie taken.
 * Keys of locations that aren't in the plan (for example from an earlier
 * list) aren't counted.
 *
 * @param {import('./setup.js').SavedPlan} plan The plan.
 * @param {string[]} visitedKeys Keys of the locations that have been visited, whose selfie has been taken.
 * @returns {{ done: number, total: number }} The number of locations done, and the number in the list.
 */
export function progress(plan, visitedKeys) {
  const done = new Set(visitedKeys);
  return { done: plan.routeLocations.filter(({ key }) => done.has(key)).length, total: plan.routeLocations.length };
}

/**
 * Names the start or finish for its marker, without repeating the name
 * when the location is only called "Start" or "Finish".
 *
 * @param {'Start' | 'Finish'} kind Which it is.
 * @param {string} label The location's name.
 * @returns {string} The name, like "Start: Queen Square", or just "Start".
 */
function named(kind, label) {
  return label === kind ? kind : `${kind}: ${label}`;
}

/**
 * Describes a saved plan as a line and markers to draw on the map. Stops are
 * numbered in visiting order, as in the list. Done locations that aren't on
 * the route are marked as done, and skipped locations are included so they
 * can be greyed out.
 *
 * @param {import('./setup.js').SavedPlan} plan The plan.
 * @param {string[]} visitedKeys Keys of the locations that have been visited, whose selfie has been taken.
 * @param {(time: number) => string} formatTime Formats a time for the marker descriptions.
 * @returns {{ path: import('./planner.js').LatLng[], markers: import('./map.js').MapMarker[] }} The line and the markers.
 */
export function mapRoute(plan, visitedKeys, formatTime) {
  const route = describeRoute(plan);
  const done = new Set(visitedKeys);
  const routeKeys = new Set(route.stops.map(({ location }) => location.key));

  /** @type {import('./map.js').MapMarker[]} */
  const markers = [{ kind: 'start', location: plan.start, label: 'S', title: named('Start', plan.start.label) }];
  for (const { number, location, arrivalTime, fixedTime } of route.stops) {
    const isDone = done.has(location.key);
    markers.push({
      kind: isDone ? 'done' : 'stop',
      location,
      label: String(number),
      title: `${number}. ${location.label}, ETA ${formatTime(arrivalTime)}${fixedTime === null ? '' : `, selfie at ${formatTime(fixedTime)}`}${isDone ? ', selfie done' : ''}`,
    });
  }
  for (const location of plan.routeLocations) {
    if (done.has(location.key) && !routeKeys.has(location.key)) {
      markers.push({ kind: 'done', location, label: '✓', title: `${location.label}, selfie done` });
    }
  }
  if (route.finish) {
    markers.push({
      kind: 'finish',
      location: route.finish.location,
      label: '🏁',
      title: `${named('Finish', route.finish.location.label)}, arrive ${formatTime(route.finish.arrivalTime)}`,
    });
  }
  for (const location of route.skipped) {
    markers.push({ kind: 'skipped', location, label: '', title: `${location.label}, skipped: not enough time` });
  }
  for (const location of route.skippedForAt) {
    markers.push({ kind: 'skipped', location, label: '', title: `${location.label}, skipped: its At time can't be met` });
  }

  const path = [plan.start, ...route.stops.map(({ location }) => location), ...(route.finish ? [route.finish.location] : [])];
  return { path, markers };
}

/**
 * Makes markers for the locations in the location list that aren't in the
 * plan yet, or have moved since it was made, such as a row just added or
 * pinned on the map, so the team can see them before planning again. A
 * must-visit location that the plan doesn't visit, such as one just marked
 * Must visit, is marked too. To remove one, remove its row from the
 * location list.
 *
 * @param {import('./locations.js').RouteLocation[]} routeLocations The route locations of the location list, those that can be planned.
 * @param {import('./setup.js').SavedPlan | null} plan The plan, or `null` if there isn't one.
 * @param {Set<string>} [mustVisitKeys] Keys of the must-visit locations still to visit.
 * @returns {import('./map.js').MapMarker[]} A marker for each location that isn't in the plan, is somewhere else in it, or must be visited but isn't in the route.
 * @example
 * newLocationMarkers([{ lat: 51.45174, lng: -2.6034, label: 'Cabot Tower', key: 'a' }], null);
 * // [{ kind: 'new', location: { lat: 51.45174, … }, label: '+', title: 'Cabot Tower, not in the route yet' }]
 */
export function newLocationMarkers(routeLocations, plan, mustVisitKeys = new Set()) {
  const planned = new Map(plan?.routeLocations.map((routeLocation) => [routeLocation.key, routeLocation]));
  const routeKeys = new Set(plan?.order.map((index) => plan.routeLocations[index].key));
  const isMoved = ({ key, lat, lng }) => planned.get(key)?.lat !== lat || planned.get(key)?.lng !== lng;
  const isMissingMustVisit = ({ key }) => plan !== null && mustVisitKeys.has(key) && !routeKeys.has(key);
  return routeLocations
    .filter((routeLocation) => isMoved(routeLocation) || isMissingMustVisit(routeLocation))
    .map((routeLocation) => ({
      kind: 'new',
      location: routeLocation,
      label: '+',
      title: `${routeLocation.label}${isMissingMustVisit(routeLocation) ? ', must visit' : ''}, not in the route yet`,
    }));
}

/**
 * A warning that time is running out.
 *
 * @typedef {object} TimeWarning
 * @property {'short' | 'late' | 'passed'} kind Why it warns: short of time before the deadline, running late for the plan, or past the deadline.
 * @property {string} message What to tell the team, which depends on whether there's a finish.
 * @property {number} minutesLeft Minutes until the deadline, rounded up (0 once it has passed).
 * @property {number} minutesBehind Whole minutes the team is behind the plan (0 if on time).
 */

/**
 * Writes a count with a word in the singular or plural.
 *
 * @param {number} count The count.
 * @param {string} one The word for one, like `minute`.
 * @param {string} [many] The word for any other count. Defaults to `one` with an `s`.
 * @returns {string} The count and word, like `1 minute` or `3 minutes`.
 * @example
 * plural(2, 'line has a problem', 'lines have problems'); // '2 lines have problems'
 */
export function plural(count, one, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Whether a plan was made for today. The plan's times are on the day it was
 * made, so a plan from an earlier day needs planning again.
 *
 * @param {import('./setup.js').SavedPlan} plan The plan.
 * @param {number} now The current time, in milliseconds since the Unix epoch.
 * @returns {boolean} Whether the plan's deadline is on the same local day as `now`.
 */
export function isPlanForToday(plan, now) {
  return new Date(plan.deadline).toDateString() === new Date(now).toDateString();
}

/**
 * Works out whether to warn the team that time is running out. It warns when
 * the time left before the deadline is down to the safety margin (or the plan
 * already ends inside it), when the team is at least a minute late for the
 * next stop and that pushes the end of the route into the safety margin or
 * means reaching a stop less than the safety margin before its At, or once
 * the deadline has passed. A wait for an At ahead takes up being late, so
 * only what's left of it carries on to later stops and the end. The selfie
 * at a stop with an At can't be taken before its At, so the team is only
 * late for it once its At has passed, since until then they may be there,
 * waiting. It doesn't warn about a plan from an earlier day, whose times no
 * longer apply.
 *
 * @param {import('./setup.js').SavedPlan} plan The plan.
 * @param {string[]} visitedKeys Keys of the locations that have been visited, whose selfie has been taken.
 * @param {number} now The current time, in milliseconds since the Unix epoch.
 * @returns {TimeWarning | null} The warning, or `null` if there's enough time.
 * @example
 * timeWarning(plan, [], deadline - 10 * 60_000);
 * // { kind: 'short', message: 'Head to the finish now: 10 minutes until the deadline.', minutesLeft: 10, minutesBehind: 0 }
 */
export function timeWarning(plan, visitedKeys, now) {
  if (!isPlanForToday(plan, now)) {
    return null;
  }
  const marginMs = plan.settings.safetyMarginSeconds * 1000;
  const leftMs = plan.deadline - now;
  const minutesLeft = Math.max(0, Math.ceil(leftMs / 60000));

  // How late the team is for the selfie at the first stop that isn't done
  // yet: when they arrive, or at its At if they'd have to wait for it.
  const done = new Set(visitedKeys);
  const { stops } = describeRoute(plan);
  const next = stops.findIndex(({ location }) => !done.has(location.key));
  const behindMs = next === -1 ? 0 : Math.max(0, now - Math.max(stops[next].arrivalTime, stops[next].fixedTime ?? -Infinity));
  const minutesBehind = Math.floor(behindMs / 60000);

  // Step through the stops after it still to visit, to see whether the team
  // would reach one too late for its At, and how late they'd be at the end.
  // A stop already planned late for its At has been warned about.
  let delayMs = behindMs;
  let missedAt = next !== -1 && stops[next].fixedTime !== null && !stops[next].isLateForAt && behindMs > 0 ? stops[next] : null;
  for (const stop of next === -1 ? [] : stops.slice(next + 1)) {
    if (delayMs <= 0) {
      break;
    }
    if (stop.fixedTime === null || done.has(stop.location.key)) {
      continue;
    }
    const arrivalTime = stop.arrivalTime + delayMs;
    if (missedAt === null && !stop.isLateForAt && arrivalTime > stop.fixedTime - marginMs) {
      missedAt = stop;
    }
    delayMs = Math.max(arrivalTime, stop.fixedTime) - Math.max(stop.arrivalTime, stop.fixedTime);
  }

  // A plan can already end inside the safety margin when even the walk to
  // the finish doesn't fit. That counts as short of time once the route has
  // started, but not before, such as when planning ahead. A plan can also
  // end late because its must-visit locations don't fit, which the planning
  // result has already warned about, so that doesn't count until the time
  // left is down to the margin, or the team falls behind.
  const isShortOfTime = leftMs <= marginMs || (plan.spareSeconds < 0 && !plan.isMustVisitLate && now >= plan.startTime);
  const isRunningLate = minutesBehind >= 1 && (missedAt !== null || plan.endEta + delayMs > plan.deadline - marginMs);
  // With every location ticked off and no finish to reach, there's nothing
  // to hurry for. An empty route isn't enough, because it can also mean
  // nothing fits before the deadline.
  const isAllDone = plan.routeLocations.every(({ key }) => done.has(key)) && !plan.finish;
  if ((!isShortOfTime && !isRunningLate) || (isAllDone && leftMs > 0)) {
    return null;
  }

  if (leftMs <= 0) {
    const message = plan.finish ? 'The deadline has passed. Head to the finish now.' : "The deadline has passed. Time's up.";
    return { kind: 'passed', message, minutesLeft, minutesBehind };
  }
  if (isShortOfTime) {
    const time = `${plural(minutesLeft, 'minute')} until the deadline`;
    const message = plan.finish ? `Head to the finish now: ${time}.` : `Last few selfies, time's nearly up: ${time}.`;
    return { kind: 'short', message, minutesLeft, minutesBehind };
  }
  const risk = missedAt ? `you may not reach ${missedAt.location.label} in time for its ${missedAt.location.at} At` : 'the route may not fit';
  return {
    kind: 'late',
    message: `Running ${plural(minutesBehind, 'minute')} behind plan, so ${risk}. Re-plan from here to see what still fits.`,
    minutesLeft,
    minutesBehind,
  };
}

/**
 * Describes the time left until the deadline, for the countdown in the header.
 *
 * @param {number | null} deadline The deadline in milliseconds since the Unix epoch, or `null` if it isn't set.
 * @param {number} now The current time, in milliseconds since the Unix epoch.
 * @returns {string} The time left, like `3 h 12 min left`, or a message once the deadline has passed or if it isn't set.
 * @example
 * countdownText(Date.parse('2026-10-03T16:00:00'), Date.parse('2026-10-03T12:48:00')); // '3 h 12 min left'
 */
export function countdownText(deadline, now) {
  if (deadline === null || !Number.isFinite(deadline)) {
    return 'No deadline set';
  }
  const leftSeconds = (deadline - now) / 1000;
  if (leftSeconds <= 0) {
    return 'Deadline passed';
  }
  // Round up, so the countdown doesn't show "under 1 min" while a minute is left.
  return `${formatDuration(Math.ceil(leftSeconds / 60) * 60)} left`;
}
