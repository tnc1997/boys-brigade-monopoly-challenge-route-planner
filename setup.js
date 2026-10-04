import { FINISH_KEY, START_KEY, resolveRecords, resolveText, usableLocations, visitedKeys } from './locations.js';
import { plan } from './planner.js';
import { SPEED_RANGE } from './settings.js';

/**
 * A plan together with the locations and times it was made from, so it can
 * be shown again after the setup form has changed or the page has reloaded.
 *
 * @typedef {import('./planner.js').Plan & {
 *   points: import('./locations.js').Location[],
 *   start: import('./locations.js').Location,
 *   finish: import('./locations.js').Location | null,
 *   startTime: number,
 *   deadline: number,
 *   settings: Pick<import('./storage.js').Settings, 'speedKmh' | 'detourFactor' | 'dwellSeconds' | 'safetyMarginSeconds'>,
 *   isFromPosition?: boolean,
 * }} SavedPlan
 * `isFromPosition` is whether the plan was made with Re-plan from here. Plans saved before it existed don't have it.
 */

/**
 * The result of planning from the setup form.
 *
 * @typedef {object} SetupResult
 * @property {SavedPlan | null} plan The plan, or `null` if the form has a problem that stops planning.
 * @property {string | null} error What stops planning, or `null` if a plan was made.
 * @property {import('./locations.js').ResolvedRecord[]} rows Every row of the location list and where it is.
 * @property {import('./locations.js').ResolvedRecord[]} leftOut Rows of the location list with text that couldn't be found or hasn't been looked up, so were left out. They don't stop planning.
 */

/**
 * Says what's wrong with the Start or Finish field.
 *
 * @param {'Start' | 'Finish'} source Which field it is.
 * @param {import('./locations.js').Resolved} resolved Where the field is.
 * @returns {string | null} What's wrong, or `null` if it can be used.
 */
function fieldError(source, resolved) {
  switch (resolved.status) {
    case 'empty':
      return `${source}: Enter where the route ${source === 'Start' ? 'starts' : 'finishes'}.`;
    case 'notFound':
      return `${source}: ${resolved.error}`;
    case 'unknown':
      return `${source}: "${resolved.label}" couldn't be looked up. Check you have signal and try again, or enter its coordinates.`;
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
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
  if (!match) {
    return null;
  }
  const date = new Date(now);
  date.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return date.getTime();
}

/**
 * Plans the route from the setup form and the location list. Rows of the
 * location list that couldn't be found or haven't been looked up are
 * returned so they can be listed, but don't stop the rest from being
 * planned. Locations whose selfie is done are kept in the plan's `points`
 * but left out of the route.
 *
 * To re-plan during the challenge, pass the team's position as `from`: the
 * route then starts there and now, instead of at the Start field and start
 * time.
 *
 * @param {object} options The setup form, location list and settings.
 * @param {import('./storage.js').Setup} options.setup What was entered in the setup form.
 * @param {import('./locations.js').LocationRecord[]} options.locations The location list.
 * @param {import('./storage.js').Settings} options.settings Settings for planning.
 * @param {number} options.now The current time, in milliseconds since the Unix epoch.
 * @param {import('./search.js').SearchResults} [options.searchResults={}] Search results for addresses and place names, by `searchKey`.
 * @param {import('./planner.js').LatLng | null} [options.from=null] The team's current position, to re-plan from.
 * @returns {SetupResult} The plan, or what stops planning, and the rows left out.
 */
export function planFromSetup({ setup, locations, settings, now, from = null, searchResults = {} }) {
  const rows = resolveRecords(locations, searchResults);
  const leftOut = rows.filter(({ resolved }) => resolved.status === 'notFound' || resolved.status === 'unknown');
  const failure = (error) => ({ plan: null, error, rows, leftOut });

  const points = usableLocations(rows);
  if (points.length === 0) {
    return failure('Add at least one location that can be found, or pin one on the map.');
  }

  const start = from
    ? { status: 'pinned', location: { lat: from.lat, lng: from.lng, label: 'Your position', key: START_KEY } }
    : resolveText(setup.startText, START_KEY, searchResults, { coordinatesLabel: 'Start' });
  const startError = fieldError('Start', start);
  if (startError) {
    return failure(startError);
  }
  const finish = setup.finishText.trim() === '' ? null : resolveText(setup.finishText, FINISH_KEY, searchResults, { coordinatesLabel: 'Finish' });
  const finishError = finish && fieldError('Finish', finish);
  if (finishError) {
    return failure(finishError);
  }

  const startTime = from ? now : startTimeToday(setup.startTimeText, now);
  if (startTime === null) {
    return failure('Start time: Enter a time like 11:00, or leave it blank to start now.');
  }
  const deadline = timeToday(settings.deadline, now);
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
  // Plan only the locations still to visit, then map the result back to
  // indexes into every location, leaving done ones out of `skipped`.
  const done = new Set(visitedKeys(locations));
  const remaining = points.map((point, index) => ({ point, index })).filter(({ point }) => !done.has(point.key));
  const result = plan({
    start: start.location,
    points: remaining.map(({ point }) => point),
    finish: finish?.location ?? null,
    startTime,
    deadline,
    ...planSettings,
  });
  const toPointIndex = (index) => remaining[index].index;

  return {
    plan: {
      ...result,
      order: result.order.map(toPointIndex),
      skipped: result.skipped.map(toPointIndex),
      points,
      start: start.location,
      finish: finish?.location ?? null,
      startTime,
      deadline,
      settings: planSettings,
      isFromPosition: from !== null,
    },
    error: null,
    rows,
    leftOut,
  };
}

/**
 * Lists the addresses and place names that still need looking up: rows of
 * the location list, the Start field (unless re-planning from the team's
 * position) and the Finish field.
 *
 * @param {object} options The setup form and location list.
 * @param {import('./storage.js').Setup} options.setup What was entered in the setup form.
 * @param {import('./locations.js').LocationRecord[]} options.locations The location list.
 * @param {import('./search.js').SearchResults} [options.searchResults={}] Search results already known, by `searchKey`.
 * @param {boolean} [options.isFromPosition=false] Whether the route starts from the team's position, so the Start field isn't used.
 * @returns {string[]} The addresses and place names to look up.
 */
export function searchesNeeded({ setup, locations, searchResults = {}, isFromPosition = false }) {
  const resolved = [
    ...resolveRecords(locations, searchResults).map((row) => row.resolved),
    ...(isFromPosition ? [] : [resolveText(setup.startText, START_KEY, searchResults, { coordinatesLabel: 'Start' })]),
    resolveText(setup.finishText, FINISH_KEY, searchResults, { coordinatesLabel: 'Finish' }),
  ];
  return resolved.flatMap((result) => (result.status === 'unknown' ? [result.query] : []));
}

/**
 * Converts the Start time field to a moment today, with a blank field
 * meaning now.
 *
 * @param {string} startTimeText The Start time field, as `HH:MM`, or an empty string to start now.
 * @param {number} now The current time, in milliseconds since the Unix epoch.
 * @returns {number | null} The start time in milliseconds since the Unix epoch, or `null` if the field isn't a valid time.
 */
export function startTimeToday(startTimeText, now) {
  return startTimeText.trim() === '' ? now : timeToday(startTimeText, now);
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
 * @param {string} options.startTimeText The Start time field, as `HH:MM`, or an empty string to start now.
 * @param {string} options.deadline The deadline, as `HH:MM`.
 * @param {boolean} options.hasVisited Whether any location has been visited, with its selfie taken.
 * @param {boolean} options.isReplannedFromPositionToday Whether the current plan was made today with Re-plan from here.
 * @param {number} options.now The current time, in milliseconds since the Unix epoch.
 * @returns {'start' | 'position'} Where to re-plan from.
 * @example
 * replanStartingPoint({ startTimeText: '11:00', deadline: '16:00', hasVisited: false, isReplannedFromPositionToday: false, now: Date.parse('2026-10-03T09:00:00') }); // 'start'
 * replanStartingPoint({ startTimeText: '11:00', deadline: '16:00', hasVisited: false, isReplannedFromPositionToday: false, now: Date.parse('2026-10-03T14:00:00') }); // 'position'
 */
export function replanStartingPoint({ startTimeText, deadline, hasVisited, isReplannedFromPositionToday, now }) {
  if (hasVisited || isReplannedFromPositionToday) {
    return 'position';
  }
  const startTime = startTimeToday(startTimeText, now);
  const deadlineTime = timeToday(deadline, now);
  const isDuringChallenge = startTime !== null && now >= startTime && (deadlineTime === null || now < deadlineTime);
  return isDuringChallenge ? 'position' : 'start';
}
