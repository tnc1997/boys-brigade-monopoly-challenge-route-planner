import { FINISH_KEY, START_KEY, isTime, pointsById, routeLocationOfText, routeLocationsOf, usableRouteLocations, visitedKeys } from './locations.js';
import { plan } from './planner.js';
import { SPEED_RANGE } from './settings.js';

/**
 * A plan together with the locations and times it was made from, so it can
 * be shown again after the setup form has changed or the page has reloaded.
 * It's a snapshot that planning can always make again, so a change to the
 * schema may drop a saved plan rather than move it to the new shape.
 *
 * @typedef {import('./planner.js').Plan & {
 *   routeLocations: import('./locations.js').RouteLocation[],
 *   fixedTimes: (number | null)[],
 *   start: import('./locations.js').RouteLocation,
 *   finish: import('./locations.js').RouteLocation | null,
 *   startTime: number,
 *   deadline: number,
 *   settings: Pick<import('./storage.js').Settings, 'speedKmh' | 'detourFactor' | 'dwellSeconds' | 'safetyMarginSeconds'>,
 *   isFromPosition: boolean,
 * }} SavedPlan
 * `fixedTimes` is when the team had to be at each of `routeLocations`, in
 * milliseconds since the Unix epoch, or `null` for one without an At time.
 * `isFromPosition` is whether the plan was made with Re-plan from here.
 */

/**
 * The result of planning from the setup form.
 *
 * @typedef {object} SetupResult
 * @property {SavedPlan | null} plan The plan, or `null` if the form has a problem that stops planning.
 * @property {string | null} error What stops planning, or `null` if a plan was made.
 * @property {Extract<import('./locations.js').RouteLocationResult, { status: 'notFound' | 'unknown' }>[]} leftOut The results for setup locations with text that couldn't be found or hasn't been looked up, so were left out. They don't stop planning.
 */

/**
 * Says what's wrong with the Start or Finish field.
 *
 * @param {'Start' | 'Finish'} source Which field it is.
 * @param {import('./locations.js').RouteLocationResult} routeLocationResult The field's route location, or why there isn't one yet.
 * @returns {string | null} What's wrong, or `null` if it can be used.
 */
function fieldError(source, routeLocationResult) {
  switch (routeLocationResult.status) {
    case 'empty':
      return `${source}: Enter where the route ${source === 'Start' ? 'starts' : 'finishes'}.`;
    case 'notFound':
      return `${source}: ${routeLocationResult.error}`;
    case 'unknown':
      return `${source}: "${routeLocationResult.label}" couldn't be looked up. Check you have signal and try again, or enter its coordinates.`;
    default:
      return null;
  }
}

/**
 * Converts an `HH:MM` time to a moment on the same local day as `now`.
 *
 * @param {string} time The time as `HH:MM`, from a time input.
 * @param {number} now The current time, in milliseconds since the Unix epoch.
 * @returns {number | null} The moment in milliseconds since the Unix epoch, or `null` if `time` isn't a valid `HH:MM` time.
 * @example
 * timeToday('16:00', Date.parse('2026-10-03T10:45:00+01:00')); // Date.parse('2026-10-03T16:00:00+01:00')
 */
export function timeToday(time, now) {
  const trimmed = time.trim();
  if (!isTime(trimmed)) {
    return null;
  }
  const [hours, minutes] = trimmed.split(':').map(Number);
  const date = new Date(now);
  date.setHours(hours, minutes, 0, 0);
  return date.getTime();
}

/**
 * Plans the route from the setup form and the location list. Rows of the
 * location list that couldn't be found or haven't been looked up are
 * returned so they can be listed, but don't stop the rest from being
 * planned. The route earns the most points it can, with each location
 * worth its row's points, or the event's Points per location if the row
 * doesn't say. Locations whose selfie is done are kept in the plan's `routeLocations`
 * but left out of the route. Must-visit locations still to visit are always
 * in the route, and the plan's `isMustVisitLate` says when they don't all fit
 * before the deadline minus the safety margin. A location with an At time
 * is only visited at that time, on the day of `now`, except a must-visit
 * one, which is visited late if it has to be and listed in the plan's
 * `lateForFixedTime`.
 *
 * To re-plan during the challenge, pass the team's position as `from`: the
 * route then starts there and now, instead of at the Start field and start
 * time.
 *
 * @param {object} options The event's details, location list and settings.
 * @param {import('./storage.js').EventDetails} options.event The event's details.
 * @param {import('./locations.js').SetupLocation[]} options.setupLocations The location list.
 * @param {import('./storage.js').Settings} options.settings The team's own settings for planning.
 * @param {number} options.now The current time, in milliseconds since the Unix epoch.
 * @param {import('./search.js').SearchResults} [options.searchResults={}] Search results for addresses and place names, by `searchKey`.
 * @param {import('./planner.js').LatLng | null} [options.from=null] The team's current position, to re-plan from.
 * @returns {SetupResult} The plan, or what stops planning, and the rows left out.
 */
export function planFromSetup({ event, setupLocations, settings, now, from = null, searchResults = {} }) {
  const leftOut = routeLocationsOf(setupLocations, searchResults).filter(({ status }) => status === 'notFound' || status === 'unknown');
  const failure = (error) => ({ plan: null, error, leftOut });

  const usable = usableRouteLocations(setupLocations, searchResults);
  if (usable.length === 0) {
    return failure('Add at least one location that can be found, or pin one on the map.');
  }

  const start = from
    ? { status: 'pinned', routeLocation: { lat: from.lat, lng: from.lng, label: 'Your position', key: START_KEY } }
    : routeLocationOfText(event.startText, START_KEY, searchResults, { coordinatesLabel: 'Start' });
  const startError = fieldError('Start', start);
  if (startError) {
    return failure(startError);
  }
  const finish = event.finishText.trim() === '' ? null : routeLocationOfText(event.finishText, FINISH_KEY, searchResults, { coordinatesLabel: 'Finish' });
  const finishError = finish && fieldError('Finish', finish);
  if (finishError) {
    return failure(finishError);
  }

  const startTime = from ? now : startTimeToday(event.startTime, now);
  if (startTime === null) {
    return failure('Start time: Enter a time like 11:00, or leave it blank to start now.');
  }
  const deadline = timeToday(event.deadline, now);
  if (deadline === null) {
    return failure('Deadline: Enter a time like 16:00.');
  }
  if (deadline <= startTime) {
    return failure('Deadline: The deadline must be after the start time.');
  }
  if (!(settings.speedKmh >= SPEED_RANGE.min && settings.speedKmh <= SPEED_RANGE.max)) {
    return failure(`Walking speed: Enter a speed between ${SPEED_RANGE.min} and ${SPEED_RANGE.max} km/h.`);
  }
  if (!(settings.dwellSeconds >= 0)) {
    return failure('Selfie time: Enter a time of 0 minutes or more.');
  }

  const planSettings = {
    speedKmh: settings.speedKmh,
    detourFactor: settings.detourFactor,
    dwellSeconds: settings.dwellSeconds,
    safetyMarginSeconds: settings.safetyMarginSeconds,
  };
  // Plan only the locations still to visit, then map the plan back to
  // indexes into every route location, leaving done ones out of `skipped`.
  const done = new Set(visitedKeys(setupLocations));
  const remaining = usable.map((routeLocation, index) => ({ routeLocation, index })).filter(({ routeLocation }) => !done.has(routeLocation.key));
  // Only locations still to visit can be must-visit, since a ticked-off one
  // has already been visited.
  const mustVisitKeys = new Set(setupLocations.filter(({ isMustVisit }) => isMustVisit).map(({ id }) => id));
  const pointsByKey = pointsById(setupLocations, event.pointsPerLocation);
  const atByKey = new Map(setupLocations.flatMap(({ id, at }) => (at === undefined ? [] : [[id, at]])));
  const fixedTimes = usable.map(({ key }) => (atByKey.has(key) ? timeToday(atByKey.get(key), now) : null));
  const planned = plan({
    start: start.routeLocation,
    locations: remaining.map(({ routeLocation }) => routeLocation),
    points: remaining.map(({ routeLocation }) => pointsByKey.get(routeLocation.key)),
    mustVisit: remaining.flatMap(({ routeLocation }, index) => (mustVisitKeys.has(routeLocation.key) ? [index] : [])),
    fixedTimes: remaining.map(({ index }) => fixedTimes[index]),
    finish: finish?.routeLocation ?? null,
    startTime,
    deadline,
    ...planSettings,
  });
  const toRouteLocationIndex = (index) => remaining[index].index;

  return {
    plan: {
      ...planned,
      order: planned.order.map(toRouteLocationIndex),
      skipped: planned.skipped.map(toRouteLocationIndex),
      lateForFixedTime: planned.lateForFixedTime.map(toRouteLocationIndex),
      routeLocations: usable,
      fixedTimes,
      start: start.routeLocation,
      finish: finish?.routeLocation ?? null,
      startTime,
      deadline,
      settings: planSettings,
      isFromPosition: from !== null,
    },
    error: null,
    leftOut,
  };
}

/**
 * Lists the addresses and place names that still need looking up: rows of
 * the location list, the Start field (unless re-planning from the team's
 * position) and the Finish field.
 *
 * @param {object} options The event's details and location list.
 * @param {import('./storage.js').EventDetails} options.event The event's details.
 * @param {import('./locations.js').SetupLocation[]} options.setupLocations The location list.
 * @param {import('./search.js').SearchResults} [options.searchResults={}] Search results already known, by `searchKey`.
 * @param {boolean} [options.isFromPosition=false] Whether the route starts from the team's position, so the Start field isn't used.
 * @returns {string[]} The addresses and place names to look up.
 */
export function searchesNeeded({ event, setupLocations, searchResults = {}, isFromPosition = false }) {
  const routeLocationResults = [
    ...routeLocationsOf(setupLocations, searchResults),
    ...(isFromPosition ? [] : [routeLocationOfText(event.startText, START_KEY, searchResults, { coordinatesLabel: 'Start' })]),
    routeLocationOfText(event.finishText, FINISH_KEY, searchResults, { coordinatesLabel: 'Finish' }),
  ];
  return routeLocationResults.flatMap((routeLocationResult) => (routeLocationResult.status === 'unknown' ? [routeLocationResult.query] : []));
}

/**
 * Converts the Start time field to a moment today, with a blank field
 * meaning now.
 *
 * @param {string} startTime The Start time field, as `HH:MM`, or an empty string to start now.
 * @param {number} now The current time, in milliseconds since the Unix epoch.
 * @returns {number | null} The start time in milliseconds since the Unix epoch, or `null` if the field isn't a valid time.
 */
export function startTimeToday(startTime, now) {
  return startTime.trim() === '' ? now : timeToday(startTime, now);
}

/**
 * Decides where to re-plan from after the settings change, from what's
 * known now rather than from the old plan's times, which may be from
 * another day. The team is on the move, so the route starts from their
 * position and the current time, once a selfie has been ticked off, once
 * they've re-planned from their position today, or between today's start
 * time and deadline. Otherwise, such as before the start time or the
 * evening before, the route starts at the Start field and start time.
 *
 * @param {object} options What's known now.
 * @param {string} options.startTime The Start time field, as `HH:MM`, or an empty string to start now.
 * @param {string} options.deadline The deadline, as `HH:MM`.
 * @param {boolean} options.hasVisited Whether any location has been visited, with its selfie taken.
 * @param {boolean} options.isReplannedFromPositionToday Whether the current plan was made today with Re-plan from here.
 * @param {number} options.now The current time, in milliseconds since the Unix epoch.
 * @returns {'start' | 'position'} Where to re-plan from.
 * @example
 * replanStartingPoint({ startTime: '11:00', deadline: '16:00', hasVisited: false, isReplannedFromPositionToday: false, now: Date.parse('2026-10-03T09:00:00') }); // 'start'
 * replanStartingPoint({ startTime: '11:00', deadline: '16:00', hasVisited: false, isReplannedFromPositionToday: false, now: Date.parse('2026-10-03T14:00:00') }); // 'position'
 */
export function replanStartingPoint({ startTime, deadline, hasVisited, isReplannedFromPositionToday, now }) {
  if (hasVisited || isReplannedFromPositionToday) {
    return 'position';
  }
  const startMoment = startTimeToday(startTime, now);
  const deadlineMoment = timeToday(deadline, now);
  const isDuringChallenge = startMoment !== null && now >= startMoment && (deadlineMoment === null || now < deadlineMoment);
  return isDuringChallenge ? 'position' : 'start';
}
