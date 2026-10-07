import { countdownText, describeRoute, formatDuration, isAppleDevice, isPlanForToday, mapRoute, movableSetupLocation, newLocationMarkers, plural, progress, timeWarning } from './route.js';
import { createSearchQueue, searchKey } from './search.js';
import { FINISH_KEY, START_KEY, atError, hasOwnPoints, isTime, movableRow, newLocationId, parsePoints, pointsById, pointsOf, routeLocationOf, routeLocationOfText, rowLabel, usableRouteLocations, visitedKeys } from './locations.js';
import { createMap, showPosition, showRoute } from './map.js';
import { SPEED_PRESETS, SPEED_RANGE, checkInFormUrl, dwellSecondsForCheckInForm, settingsSummary, speedPreset } from './settings.js';
import { planFromSetup, replanStartingPoint, searchesNeeded, timeToday } from './setup.js';
import { canCompress, preparedShareFragment, readShareFragment, shareFragment } from './share.js';
import { defaultState, isOutOfDate, loadState, resetChallenge, saveState } from './storage.js';

/** The app's state, loaded from the previous visit if there was one. */
const state = loadState();

const form = /** @type {HTMLFormElement} */ (document.getElementById('setup-form'));
const locationRows = /** @type {HTMLOListElement} */ (document.getElementById('location-rows'));
const locationAnnouncement = /** @type {HTMLParagraphElement} */ (document.getElementById('location-announcement'));
const startField = /** @type {HTMLInputElement} */ (document.getElementById('start'));
const finishField = /** @type {HTMLInputElement} */ (document.getElementById('finish'));
const startStatus = /** @type {HTMLParagraphElement} */ (document.getElementById('start-status'));
const finishStatus = /** @type {HTMLParagraphElement} */ (document.getElementById('finish-status'));
const setupError = /** @type {HTMLParagraphElement} */ (document.getElementById('setup-error'));
const stopList = /** @type {HTMLDivElement} */ (document.getElementById('stop-list'));
const stopsHeading = /** @type {HTMLHeadingElement} */ (document.getElementById('stops-heading'));
const replan = /** @type {HTMLDivElement} */ (document.getElementById('replan'));
const replanButton = /** @type {HTMLButtonElement} */ (document.getElementById('replan-button'));
const replanStatus = /** @type {HTMLParagraphElement} */ (document.getElementById('replan-status'));
const planButton = /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]'));
/** What the Plan route button says when it isn't planning. */
const PLAN_BUTTON_TEXT = planButton.textContent;
const planStatus = /** @type {HTMLParagraphElement} */ (document.getElementById('plan-status'));
const shareButton = /** @type {HTMLButtonElement} */ (document.getElementById('share-button'));
const shareStatus = /** @type {HTMLParagraphElement} */ (document.getElementById('share-status'));
const shareLink = /** @type {HTMLInputElement} */ (document.getElementById('share-link'));
const tabs = /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('[role="tab"][data-view]')]);
const mapContainer = /** @type {HTMLDivElement} */ (document.getElementById('map'));
const settingsButton = /** @type {HTMLButtonElement} */ (document.getElementById('settings-button'));
const settingsDialog = /** @type {HTMLDialogElement} */ (document.getElementById('settings-dialog'));
const speedPresets = /** @type {HTMLDivElement} */ (document.getElementById('speed-presets'));
const speedSlider = /** @type {HTMLInputElement} */ (document.getElementById('settings-speed'));
const speedField = /** @type {HTMLInputElement} */ (document.getElementById('speed'));
const speedValue = /** @type {HTMLOutputElement} */ (document.getElementById('settings-speed-value'));
const settingsSave = /** @type {HTMLButtonElement} */ (document.getElementById('settings-save'));
const settingsSummaryText = /** @type {HTMLParagraphElement} */ (document.getElementById('settings-summary'));
const checkInFormField = /** @type {HTMLInputElement} */ (document.getElementById('settings-check-in-form'));
const selfieTimeField = /** @type {HTMLInputElement} */ (document.getElementById('settings-selfie'));
const timeWarningBanner = /** @type {HTMLDivElement} */ (document.getElementById('time-warning'));
const timeWarningText = /** @type {HTMLParagraphElement} */ (document.getElementById('time-warning-text'));
const timeWarningAlert = /** @type {HTMLParagraphElement} */ (document.getElementById('time-warning-alert'));

/**
 * The time warning last announced to screen readers, with its numbers
 * left out, or `null` if none is showing.
 */
let announcedWarning = null;

/** Clears the screen-reader alert once it's been read, so it can't go stale. */
let clearAlertTimer;

/** Whether the current plan was for today when the Route section was last drawn. */
let wasPlanForToday = true;
const countdown = /** @type {HTMLSpanElement} */ (document.getElementById('countdown'));
const offlineBadge = /** @type {HTMLSpanElement} */ (document.getElementById('offline-badge'));
const updateAvailable = /** @type {HTMLDivElement} */ (document.getElementById('update-available'));
const updateReloadButton = /** @type {HTMLButtonElement} */ (document.getElementById('update-reload'));
const countdownDeadline = /** @type {HTMLSpanElement} */ (document.getElementById('countdown-deadline'));

/** The settings panel's other fields, bound to `state.event` or `state.settings` by their data attributes. */
const panelFields = /** @type {NodeListOf<HTMLInputElement>} */ (settingsDialog.querySelectorAll('[data-panel-event], [data-panel-setting]'));
const mapStatus = /** @type {HTMLParagraphElement} */ (document.getElementById('map-status'));
const mapTilesStatus = /** @type {HTMLParagraphElement} */ (document.getElementById('map-tiles-status'));
const pinStatus = /** @type {HTMLParagraphElement} */ (document.getElementById('pin-status'));
const pinDialog = /** @type {HTMLDialogElement} */ (document.getElementById('pin-dialog'));
const pinLabel = /** @type {HTMLInputElement} */ (document.getElementById('pin-label'));
const pinCoordinates = /** @type {HTMLParagraphElement} */ (document.getElementById('pin-coordinates'));
const pinBanner = /** @type {HTMLDivElement} */ (document.getElementById('pin-banner'));
const pinBannerText = /** @type {HTMLParagraphElement} */ (document.getElementById('pin-banner-text'));
const pinBannerCancel = /** @type {HTMLButtonElement} */ (document.getElementById('pin-banner-cancel'));

/** What the line under the map says until a pin is dropped. */
const PIN_HINT = 'Long-press the map to add a location, or tap a marker and Move to fix its spot.';

/** Where the pin being named was dropped, or `null` if there isn't one. */
let droppedPin = null;

/** The id of the row the line under the map says was just added, or `null` if it shows the hint. */
let addedPinKey = null;

/**
 * The row being pinned on the map with 📍, or moved with a marker's Move,
 * or `null` if none is. Its `id` is `null` for the empty row at the end of
 * the list, which becomes a row once it's pinned. `isMove` says whether
 * it's being moved, for the message once it's placed.
 *
 * @type {{ id: string | null, isMove: boolean } | null}
 */
let pinTarget = null;

/** Ids of the rows whose More options are open, so they stay open when the rows are rebuilt. */
const openRows = new Set();

/** Sends lookups one at a time, following Nominatim's usage policy. */
const searchQueue = createSearchQueue();

/** Lookups that are queued or being sent, by search key, so the same search is only sent once at a time. */
const lookups = new Map();

/** Why lookups failed for a reason that may pass, such as no signal, by search key. These aren't saved, and are tried again. */
const temporaryFailures = new Map();

/**
 * Rows and fields the team has just finished, whose result is announced to
 * screen readers, by search key: their text, and whether they can be pinned.
 *
 * @type {Map<string, { label: string, canPin: boolean }>}
 */
const announcedLookups = new Map();

/** The map, created the first time the Map tab is shown, because Leaflet needs a visible container. */
let routeMap = null;

/** Whether the map should zoom to fit the route the next time it's drawn, as after planning. */
let shouldFitMap = true;

/** The locations not in the route yet when the map was last drawn, from {@link newLocationsText}, or `null` before it's drawn. */
let drawnNewLocations = null;

/**
 * Whether the walking speed has been changed in the settings panel since it
 * opened. A speed outside the slider's range can't be shown on it, so the
 * speed is only saved when it's changed there.
 */
let isSpeedChanged = false;

/**
 * Whether the check-in form URL in the settings panel was set when it was
 * last valid, to tell when it's set or cleared.
 */
let hadCheckInForm = false;

/**
 * Whether the selfie time has been changed in the settings panel since it
 * opened, in which case setting the check-in form URL leaves it alone.
 */
let isSelfieTimeEdited = false;

/** The team's latest position from watching the location, or `null` if there isn't one yet. */
let latestPosition = null;

/** Whether the location is being watched, which starts the first time the map is shown. */
let isWatchingPosition = false;

/** How old a watched position can be and still be used to re-plan, in milliseconds. */
const POSITION_MAX_AGE_MS = 60000;

/** The setup form's fields, which are bound to `state.event` or `state.settings` by their data attributes. */
const fields = /** @type {NodeListOf<HTMLInputElement>} */ (form.querySelectorAll('[data-event], [data-setting]'));

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

/**
 * Creates an element with optional classes and text.
 *
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag The element's tag name.
 * @param {string} [className] The element's classes.
 * @param {string} [text] The element's text.
 * @returns {HTMLElementTagNameMap[K]} The element.
 */
function element(tag, className = '', text = '') {
  const created = document.createElement(tag);
  created.className = className;
  created.textContent = text;
  return created;
}

/**
 * Finds the value a field is bound to by its data attributes: `data-event`
 * or `data-setting` in the setup form, and `data-panel-event` or
 * `data-panel-setting` in the settings panel.
 *
 * @param {HTMLInputElement} field The field.
 * @returns {{ group: Record<string, any>, key: string }} The part of the state it's in, and its key there.
 */
function boundTo(field) {
  const { event, panelEvent, setting, panelSetting } = field.dataset;
  return event || panelEvent ? { group: state.event, key: event || panelEvent } : { group: state.settings, key: setting || panelSetting };
}

/**
 * Shows the value a field is bound to in it, scaled by its `data-scale`.
 *
 * @param {HTMLInputElement} field The field.
 */
function fillField(field) {
  const { group, key } = boundTo(field);
  const value = group[key];
  field.value = field.dataset.scale ? String(value / Number(field.dataset.scale)) : String(value);
}

/** Fills the setup form from the state. */
function fillForm() {
  fields.forEach(fillField);
}

/**
 * Saves a field's value to the state.
 *
 * @param {HTMLInputElement} field The field that changed.
 */
function saveField(field) {
  const { group, key } = boundTo(field);
  if (field.dataset.number !== undefined) {
    const value = field.value.trim() === '' ? NaN : Number(field.value);
    group[key] = field.dataset.scale ? value * Number(field.dataset.scale) : value;
  } else {
    group[key] = field.value;
  }
  saveState(state);
  // Only settings affect the summary, and only the deadline the countdown.
  if (group === state.settings) {
    showSettingsSummary();
  }
  if (key === 'deadline') {
    showCountdown();
  }
  // Each row's At is checked against the start time and deadline. The
  // settings it's also checked against are only saved from the settings
  // panel, which shows the rows again.
  if (key === 'startTime' || key === 'deadline') {
    showAtErrors();
  }
}

/**
 * Shows the walking speed and selfie time under the Route heading, noting
 * when they've changed since the current plan was made.
 */
function showSettingsSummary() {
  const planned = state.plan?.settings;
  const isOutOfDate = planned && (planned.speedKmh !== state.settings.speedKmh || planned.dwellSeconds !== state.settings.dwellSeconds);
  settingsSummaryText.textContent = `Planning for ${settingsSummary(state.settings)}${isOutOfDate ? ' (re-plan to use these)' : ''}`;
}

/** Classes for the 📍 and ✕ buttons on each row. */
const ROW_BUTTON_CLASSES =
  'flex size-11 shrink-0 items-center justify-center rounded-md text-accent-ink ring-1 ring-accent/30 hover:bg-accent-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-accent';

/**
 * Describes where a row, or the Start or Finish field, is, to show under it.
 *
 * @param {import('./locations.js').RouteLocationResult} routeLocationResult Where it is, from the saved search results.
 * @param {object} [options] What can be done about it.
 * @param {boolean} [options.canPin=true] Whether it can be pinned on the map, which rows can but the Start and Finish fields can't.
 * @returns {{ text: string, isError: boolean }} What to show, and whether it's a problem.
 */
function describeRouteLocationResult(routeLocationResult, { canPin = true } = {}) {
  switch (routeLocationResult.status) {
    case 'empty':
      return { text: '', isError: false };
    case 'pinned':
      return { text: '📍 Pinned on the map', isError: false };
    case 'coordinates':
      return { text: `Using the coordinates ${routeLocationResult.routeLocation.lat}, ${routeLocationResult.routeLocation.lng}`, isError: false };
    case 'found':
      return { text: `Found: ${routeLocationResult.routeLocation.matchedName}`, isError: false };
    case 'notFound':
      // Coordinates out of range say what's wrong with them.
      return state.searchResults[searchKey(routeLocationResult.label)]
        ? { text: canPin ? 'Not found. Check the spelling or pin it on the map with 📍' : 'Not found. Check the spelling, or enter its coordinates.', isError: true }
        : { text: routeLocationResult.error, isError: true };
    default: {
      const key = searchKey(routeLocationResult.query);
      if (lookups.has(key)) {
        return { text: 'Searching…', isError: false };
      }
      if (temporaryFailures.has(key)) {
        return { text: temporaryFailures.get(key), isError: true };
      }
      return { text: 'Not looked up yet', isError: false };
    }
  }
}

/**
 * Shows a description under a row or field.
 *
 * @param {HTMLElement} status The element to show it in.
 * @param {{ text: string, isError: boolean }} description What to show, from {@link describeRouteLocationResult}.
 */
function showDescription(status, { text, isError }) {
  status.textContent = text;
  status.classList.toggle('text-danger', isError);
  status.classList.toggle('text-muted', !isError);
}

/**
 * Finds the row of the location list that an element is in.
 *
 * @param {EventTarget | null} target The element.
 * @returns {{ item: HTMLLIElement, setupLocation: import('./locations.js').SetupLocation | null } | null} The row's list item and saved row (`null` for the empty row at the end), or `null` if the element isn't in a row.
 */
function rowOf(target) {
  const item = target instanceof Element ? target.closest('#location-rows > li') : null;
  if (!(item instanceof HTMLLIElement)) {
    return null;
  }
  return { item, setupLocation: state.setupLocations.find(({ id }) => id === item.dataset.id) ?? null };
}

/**
 * Creates the list item for a row of the location list: its text field, a
 * 📍 button to pin it on the map, a ✕ button to remove it and its status.
 *
 * @param {import('./locations.js').SetupLocation | null} setupLocation The row, or `null` for the empty row at the end.
 * @returns {HTMLLIElement} The list item. Its labels and status are filled in by {@link showRows}.
 */
function rowItem(setupLocation) {
  const item = element('li', 'flex flex-col gap-1');
  item.dataset.id = setupLocation?.id ?? '';
  const line = element('div', 'flex gap-1');
  const field = element(
    'input',
    'min-h-11 min-w-0 flex-1 rounded-md border border-field bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30',
  );
  field.type = 'text';
  field.dataset.field = 'text';
  field.value = setupLocation?.text ?? '';
  field.autocomplete = 'off';
  field.spellcheck = false;
  field.enterKeyHint = 'next';
  const pin = element('button', ROW_BUTTON_CLASSES, '📍');
  pin.type = 'button';
  pin.dataset.action = 'pin';
  const remove = element('button', `${ROW_BUTTON_CLASSES} text-lg`, '✕');
  remove.type = 'button';
  remove.dataset.action = 'remove';
  line.append(field, pin, remove);
  const id = Math.random().toString(36).slice(2);
  const footer = element('div', 'flex items-start gap-2');
  const status = element('p', 'flex min-w-0 flex-1 flex-wrap items-center gap-x-2 self-center text-xs break-words');
  status.id = `location-status-${id}`;
  status.dataset.status = '';
  field.setAttribute('aria-describedby', status.id);
  // Optional fields for the location, such as Must visit, are under More.
  const more = element(
    'button',
    'inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md px-3 text-xs font-semibold text-accent-ink hover:bg-accent-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
  );
  more.type = 'button';
  more.dataset.action = 'more';
  more.setAttribute('aria-controls', `location-more-${id}`);
  footer.append(status, more);
  const options = element('div', 'flex flex-col gap-1 rounded-md bg-page px-3 ring-1 ring-line');
  options.id = `location-more-${id}`;
  options.hidden = true;
  const mustVisit = element('label', 'flex min-h-11 items-center gap-2 text-sm');
  const mustVisitBox = element('input', 'size-5 accent-accent-ink');
  mustVisitBox.type = 'checkbox';
  mustVisitBox.dataset.field = 'isMustVisit';
  mustVisit.append(mustVisitBox, 'Must visit');
  const points = element('div', 'flex flex-col gap-1');
  const pointsLine = element('label', 'flex items-center gap-2 text-sm');
  const pointsField = element(
    'input',
    'min-h-11 w-24 rounded-md border border-field bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 aria-invalid:border-danger',
  );
  // A text field rather than a number field, which would accept and hide
  // values like 2.5 or 1e3, so what's wrong can be shown.
  pointsField.type = 'text';
  pointsField.inputMode = 'numeric';
  pointsField.autocomplete = 'off';
  pointsField.dataset.field = 'points';
  pointsField.value = setupLocation?.points === undefined ? '' : String(setupLocation.points);
  const pointsError = element('p', 'text-xs text-danger');
  pointsError.id = `location-points-error-${id}`;
  pointsError.hidden = true;
  pointsField.setAttribute('aria-describedby', pointsError.id);
  pointsLine.append('Points', pointsField);
  points.append(pointsLine, pointsError);
  const atLine = element('label', 'flex items-center gap-2 pb-2 text-sm');
  const atField = element(
    'input',
    'min-h-11 w-32 rounded-md border border-field bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 aria-invalid:border-danger',
  );
  // A time field, so phones show their own time picker.
  atField.type = 'time';
  atField.dataset.field = 'at';
  atField.value = setupLocation?.at ?? '';
  atLine.append('At', atField);
  options.append(mustVisit, points, atLine);
  // At's error stays outside More, since a new start time or deadline can
  // make it wrong while More is closed.
  const atErrorLine = element('p', 'text-xs text-danger');
  atErrorLine.id = `location-at-error-${id}`;
  atErrorLine.dataset.atError = '';
  atErrorLine.hidden = true;
  atField.setAttribute('aria-describedby', atErrorLine.id);
  // The empty row at the end has nothing to remove or set options for. It
  // keeps the space for ✕ so the fields line up.
  remove.classList.toggle('invisible', setupLocation === null);
  more.hidden = setupLocation === null;
  item.append(line, footer, atErrorLine, options);
  return item;
}

/**
 * Shows a row's labels, which depend on its position in the list, and its
 * status. A pinned row's status has a ✕ to clear the pin.
 *
 * @param {HTMLLIElement} item The row's list item.
 * @param {number} number The row's position in the list, starting at 1.
 */
function showRow(item, number) {
  const setupLocation = state.setupLocations.find(({ id }) => id === item.dataset.id) ?? null;
  const [field, pin, remove] = item.querySelectorAll('input, button');
  const status = /** @type {HTMLParagraphElement} */ (item.querySelector('[data-status]'));
  field.setAttribute('aria-label', `Location ${number}`);
  pin.setAttribute('aria-label', `Pin location ${number} on the map`);
  remove.setAttribute('aria-label', `Remove location ${number}`);
  const more = /** @type {HTMLButtonElement} */ (item.querySelector('[data-action="more"]'));
  const options = /** @type {HTMLDivElement} */ (item.lastElementChild);
  const isOpen = setupLocation !== null && openRows.has(setupLocation.id);
  // Must visit no longer applies once the location's been visited. The box
  // stays ticked, so it applies again if the tick is undone.
  const isMustVisit = Boolean(setupLocation?.isMustVisit && !setupLocation.isVisited);
  // Say what's set under More while it's closed.
  const summary = [
    ...(isMustVisit ? ['Must visit'] : []),
    ...(setupLocation?.points === undefined ? [] : [plural(setupLocation.points, 'point')]),
    ...(setupLocation?.at === undefined ? [] : [`At ${setupLocation.at}`]),
  ];
  more.textContent = ['More', ...summary].join(' · ');
  more.setAttribute('aria-label', [`More options for location ${number}`, ...summary.map((text) => text.toLowerCase())].join(', '));
  // Blank uses Points per location, which can change.
  const pointsField = /** @type {HTMLInputElement} */ (options.querySelector('[data-field="points"]'));
  pointsField.placeholder = String(state.event.pointsPerLocation);
  pointsField.setAttribute('aria-label', `Points for location ${number}`);
  more.setAttribute('aria-expanded', String(isOpen));
  options.hidden = !isOpen;
  /** @type {HTMLInputElement} */ (options.querySelector('[data-field="isMustVisit"]')).checked = Boolean(setupLocation?.isMustVisit);
  /** @type {HTMLInputElement} */ (options.querySelector('[data-field="at"]')).setAttribute('aria-label', `At, the fixed time for location ${number}`);
  showAtError(item, setupLocation);
  const routeLocationResult = setupLocation ? routeLocationOf(setupLocation, number, state.searchResults) : { status: 'empty' };
  const description = describeRouteLocationResult(routeLocationResult);
  // Only rebuild the status when it changes, so a focused ✕ isn't replaced.
  const shown = `${number} ${routeLocationResult.status} ${description.text}`;
  if (status.dataset.shown === shown) {
    return;
  }
  status.dataset.shown = shown;
  showDescription(status, description);
  if (routeLocationResult.status === 'pinned') {
    const clear = element('button', 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-base text-accent-ink hover:bg-accent-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-accent', '✕');
    clear.type = 'button';
    clear.dataset.action = 'clear-pin';
    clear.setAttribute('aria-label', `Clear the pin for location ${number} and look it up instead`);
    status.append(clear);
  }
}

/**
 * Shows what's wrong with a row's At, if anything, under the row.
 *
 * @param {HTMLLIElement} item The row's list item.
 * @param {import('./locations.js').SetupLocation | null} setupLocation The row, or `null` for the empty row at the end.
 */
function showAtError(item, setupLocation) {
  // Like Must visit, At no longer applies once the location's been visited.
  const error = setupLocation?.at === undefined || setupLocation.isVisited ? null : atError(setupLocation.at, state.event, state.settings);
  const errorLine = /** @type {HTMLParagraphElement} */ (item.querySelector('[data-at-error]'));
  /** @type {HTMLInputElement} */ (item.querySelector('[data-field="at"]')).setAttribute('aria-invalid', String(error !== null));
  errorLine.textContent = error ?? '';
  errorLine.hidden = error === null;
}

/** Shows what's wrong with each row's At, for a new start time or deadline, without redrawing the rest of the rows. */
function showAtErrors() {
  for (const item of /** @type {HTMLCollectionOf<HTMLLIElement>} */ (locationRows.children)) {
    showAtError(item, state.setupLocations.find(({ id }) => id === item.dataset.id) ?? null);
  }
}

/** Shows the Start and Finish fields' statuses. */
function showFieldStatuses() {
  showDescription(startStatus, describeRouteLocationResult(routeLocationOfText(state.event.startText, START_KEY, state.searchResults), { canPin: false }));
  showDescription(finishStatus, describeRouteLocationResult(routeLocationOfText(state.event.finishText, FINISH_KEY, state.searchResults), { canPin: false }));
}

/**
 * Shows every row's labels and status, and the Start and Finish fields'
 * statuses, and redraws the map if they've changed it. A row being moved
 * that's been removed or ticked off stops being moved.
 */
function showRows() {
  [...locationRows.children].forEach((item, index) => showRow(/** @type {HTMLLIElement} */ (item), index + 1));
  showFieldStatuses();
  updateMapIfChanged();
  stopMovingIfUnmovable();
}

/** Builds the location list's rows from the state, with an empty row at the end, keeping focus in the same row. */
function buildRows() {
  const focusedId = rowOf(document.activeElement)?.item.dataset.id;
  const focusedField = document.activeElement instanceof HTMLElement ? (document.activeElement.dataset.field ?? 'text') : 'text';
  locationRows.replaceChildren(...state.setupLocations.map(rowItem), rowItem(null));
  // Show the rows first, so a field in an open options panel can take focus.
  showRows();
  if (focusedId !== undefined) {
    locationRows.querySelector(`li[data-id="${CSS.escape(focusedId)}"] [data-field="${CSS.escape(focusedField)}"]`)?.focus();
  }
}

/**
 * Gets the keys of the must-visit rows still to visit.
 *
 * @returns {Set<string>} Their ids, which are their locations' keys.
 */
function mustVisitKeys() {
  return new Set(state.setupLocations.filter(({ isMustVisit, isVisited }) => isMustVisit && !isVisited).map(({ id }) => id));
}

/**
 * Updates what's said about a must-visit location skipped for its At after
 * its row changes: the notice in the route, which only applies while it's
 * still must-visit with the same At, and its marker as not in the route yet.
 */
function refreshSkippedMustVisit() {
  if (state.plan) {
    showPlan({ isMapUnchanged: true });
  }
  updateMapIfChanged();
}

/** Redraws the map if the locations not in the route yet have changed, or been renamed, so typing doesn't keep rebuilding it or closing an open popup. */
function updateMapIfChanged() {
  const usable = usableRouteLocations(state.setupLocations, state.searchResults);
  if (newLocationsText(newLocationMarkers(usable, state.plan, mustVisitKeys())) !== drawnNewLocations) {
    updateMap();
  }
}

/**
 * Looks up an address or place name, unless it's already being looked up.
 * The result is saved unless the lookup failed for a reason that may pass,
 * such as no signal, in which case it's tried again later. Call
 * {@link showRows} afterwards to show that it's being looked up, once
 * however many are started.
 *
 * @param {string} query The address or place name.
 * @returns {Promise<void>} Resolves once it's been looked up.
 */
function lookUp(query) {
  const key = searchKey(query);
  if (!lookups.has(key)) {
    const lookup = searchQueue.search(query).then((searchResult) => {
      lookups.delete(key);
      if (searchResult.isFound || !searchResult.isTemporary) {
        state.searchResults[key] = searchResult;
        temporaryFailures.delete(key);
        saveState(state);
      } else {
        // Not retried on a timer, which could keep sending requests while
        // Nominatim is busy or blocking them, but when the phone is back
        // online or Plan route is pressed.
        temporaryFailures.set(key, "Couldn't search, which usually means there's no signal. It'll try again when you're back online, or when you press Plan route.");
      }
      showRows();
      announceLookup(key);
    });
    lookups.set(key, lookup);
  }
  return lookups.get(key);
}

/** Looks up anything still to look up whose last lookup failed for a reason that may pass. */
function retryLookups() {
  for (const query of searchesNeeded({ event: state.event, setupLocations: state.setupLocations, searchResults: state.searchResults })) {
    if (temporaryFailures.has(searchKey(query))) {
      lookUp(query);
    }
  }
  showRows();
}

/**
 * Looks up a row that's just been finished, if it needs it, and announces
 * the result to screen readers when it's in.
 *
 * @param {import('./locations.js').RouteLocationResult} routeLocationResult Where the row is, from the saved search results.
 * @param {object} [options] What can be done about it.
 * @param {boolean} [options.canPin=true] Whether it can be pinned on the map, which rows can but the Start and Finish fields can't.
 */
function lookUpFinished(routeLocationResult, { canPin = true } = {}) {
  if (routeLocationResult.status === 'unknown') {
    announcedLookups.set(searchKey(routeLocationResult.query), { label: routeLocationResult.label, canPin });
    lookUp(routeLocationResult.query);
    showRows();
  }
}

/**
 * Tells screen readers the result of looking up a row or field the team has
 * just finished. Other lookups, such as those when Plan route is pressed,
 * aren't announced, so every row isn't announced at once.
 *
 * @param {string} key The search key that was looked up.
 */
function announceLookup(key) {
  const announced = announcedLookups.get(key);
  if (!announced) {
    return;
  }
  announcedLookups.delete(key);
  const { label, canPin } = announced;
  locationAnnouncement.textContent = `${label}: ${describeRouteLocationResult(routeLocationOfText(label, '', state.searchResults), { canPin }).text}`;
}

/**
 * Saves a pin for a row of the location list. Pinning the empty row at the
 * end, or a row that's been removed since, adds a new row.
 *
 * @param {string | null} id The row's id, or `null` for a new row.
 * @param {string} text The text for a new row.
 * @param {import('./planner.js').LatLng} latLng Where to pin it.
 * @returns {import('./locations.js').RouteLocation} The pinned location.
 */
function pinRow(id, text, { lat, lng }) {
  let setupLocation = state.setupLocations.find((candidate) => candidate.id === id);
  if (!setupLocation) {
    setupLocation = { id: newLocationId(), text };
    state.setupLocations.push(setupLocation);
  }
  setupLocation.pin = { lat, lng };
  saveState(state);
  buildRows();
  const number = state.setupLocations.indexOf(setupLocation) + 1;
  return /** @type {{ routeLocation: import('./locations.js').RouteLocation }} */ (routeLocationOf(setupLocation, number, state.searchResults)).routeLocation;
}

/**
 * Removes a row of the location list. If focus is in the row, it moves to
 * the row that takes its place.
 *
 * @param {HTMLLIElement} item The row's list item.
 * @param {import('./locations.js').SetupLocation} setupLocation The row.
 */
function removeRow(item, setupLocation) {
  state.setupLocations = state.setupLocations.filter((candidate) => candidate !== setupLocation);
  openRows.delete(setupLocation.id);
  saveState(state);
  const next = /** @type {HTMLLIElement} */ (item.nextElementSibling);
  const hadFocus = item.contains(document.activeElement);
  item.remove();
  if (hadFocus) {
    next.querySelector('input').focus();
  }
  if (addedPinKey === setupLocation.id) {
    showPinStatus(PIN_HINT);
  }
  showRows();
  // A removed row's stop no longer counts towards the route's points, and
  // removing the only row with its own points stops them being shown.
  if (state.plan) {
    showPlan({ isMapUnchanged: true });
  }
}

/** Waits for a pause in typing points before showing them in the route. */
let pointsTimer;

/** Whether a location the route plans for is worth different points since the route was planned. */
let isReplanForPointsNeeded = false;

/**
 * Saves the points typed into a row's Points field, or says what's wrong
 * with them on the row, without saving.
 *
 * @param {{ item: HTMLLIElement, setupLocation: import('./locations.js').SetupLocation | null }} row The row.
 * @param {HTMLInputElement} field Its Points field.
 */
function savePoints({ item, setupLocation }, field) {
  const parsed = parsePoints(field.value);
  const error = /** @type {HTMLParagraphElement} */ (item.querySelector(`#${CSS.escape(field.getAttribute('aria-describedby'))}`));
  field.setAttribute('aria-invalid', String(!parsed.isValid));
  error.textContent = parsed.isValid ? '' : parsed.error;
  error.hidden = parsed.isValid;
  // Leaving a field with an invalid value puts back the saved points, which
  // doesn't change them, so there's nothing to re-plan for.
  if (!parsed.isValid || !setupLocation || (parsed.points ?? undefined) === setupLocation.points) {
    return;
  }
  const worth = pointsOf(setupLocation, state.event.pointsPerLocation);
  if (parsed.points === null) {
    delete setupLocation.points;
  } else {
    setupLocation.points = parsed.points;
  }
  saveState(state);
  showRow(item, state.setupLocations.indexOf(setupLocation) + 1);
  // Points are shown from the rows, so the route's list shows them once
  // typing pauses. They don't change the map, and the route only changes
  // when it's planned again, which only matters when a location still to
  // visit is worth something different, not when a blank field is given
  // Points per location.
  clearTimeout(pointsTimer);
  if (state.plan) {
    const isPlanned = !setupLocation.isVisited && state.plan.routeLocations.some(({ key }) => key === setupLocation.id);
    if (isPlanned && pointsOf(setupLocation, state.event.pointsPerLocation) !== worth) {
      isReplanForPointsNeeded = true;
    }
    pointsTimer = setTimeout(() => {
      showPlan({ isMapUnchanged: true });
      if (isReplanForPointsNeeded && state.plan) {
        // Keep any warnings about the must-visit locations in front.
        const warnings = planWarnings(state.plan);
        showPlanStatus([...warnings, 'Press Re-plan from here to update the route with your new points.'].join(' '), warnings.length > 0);
      }
    }, 250);
  }
}

/**
 * Saves the time in a row's At field, or clears it when the field is
 * blank. A time outside the start time and deadline is still saved,
 * since either can change, and the row says what's wrong with it.
 *
 * @param {{ item: HTMLLIElement, setupLocation: import('./locations.js').SetupLocation | null }} row The row.
 * @param {HTMLInputElement} field Its At field.
 */
function saveAt({ item, setupLocation }, field) {
  // A time field is also blank while it's partly filled in, which isn't a
  // request to clear the time, so keep the saved one.
  if (!setupLocation || field.validity.badInput || (field.value || undefined) === setupLocation.at) {
    return;
  }
  // Only save what loading keeps, such as 13:30 but not 13:30:00.
  if (field.value !== '' && !isTime(field.value)) {
    return;
  }
  if (field.value === '') {
    delete setupLocation.at;
  } else {
    setupLocation.at = field.value;
  }
  saveState(state);
  showRow(item, state.setupLocations.indexOf(setupLocation) + 1);
  refreshSkippedMustVisit();
  // The route only changes when it's planned again, which only matters for
  // a location in the plan still to visit. Keep any warnings about the
  // must-visit locations in front.
  if (state.plan && !setupLocation.isVisited && state.plan.routeLocations.some(({ key }) => key === setupLocation.id)) {
    const warnings = planWarnings(state.plan);
    showPlanStatus([...warnings, 'Press Re-plan from here to update the route with your new At times.'].join(' '), warnings.length > 0);
  }
}

locationRows.addEventListener('input', (event) => {
  const row = rowOf(event.target);
  if (!row || !(event.target instanceof HTMLInputElement)) {
    return;
  }
  if (event.target.dataset.field === 'points') {
    savePoints(row, event.target);
    return;
  }
  if (event.target.dataset.field === 'at') {
    saveAt(row, event.target);
    return;
  }
  if (event.target.dataset.field !== 'text') {
    return;
  }
  let { setupLocation } = row;
  if (!setupLocation) {
    // Typing in the empty row at the end makes it a row, with a new empty row below.
    setupLocation = { id: newLocationId(), text: '' };
    state.setupLocations.push(setupLocation);
    row.item.dataset.id = setupLocation.id;
    row.item.querySelector('[data-action="remove"]').classList.remove('invisible');
    /** @type {HTMLButtonElement} */ (row.item.querySelector('[data-action="more"]')).hidden = false;
    locationRows.append(rowItem(null));
    showRow(/** @type {HTMLLIElement} */ (locationRows.lastElementChild), state.setupLocations.length + 1);
  }
  setupLocation.text = event.target.value;
  saveState(state);
  showRow(row.item, state.setupLocations.indexOf(setupLocation) + 1);
  // Wait for a pause in typing before checking the map, so long lists stay responsive.
  clearTimeout(mapTimer);
  mapTimer = setTimeout(updateMapIfChanged, 250);
});

// A row is looked up once it's finished: when it loses focus with changed
// text. Never while typing, which Nominatim's usage policy forbids.
locationRows.addEventListener('change', (event) => {
  const row = rowOf(event.target);
  if (!row?.setupLocation) {
    return;
  }
  if (event.target instanceof HTMLInputElement && event.target.dataset.field === 'isMustVisit') {
    if (event.target.checked) {
      row.setupLocation.isMustVisit = true;
    } else {
      delete row.setupLocation.isMustVisit;
    }
    saveState(state);
    showRow(row.item, state.setupLocations.indexOf(row.setupLocation) + 1);
    refreshSkippedMustVisit();
    // The route only changes when it's planned again.
    if (state.plan) {
      showPlanStatus('Press Re-plan from here to update the route with your must-visit locations.');
    }
    return;
  }
  // An invalid value isn't saved, so when the field is left with one, put
  // back the saved value rather than leave it there, hidden once More closes.
  if (event.target instanceof HTMLInputElement && event.target.dataset.field === 'points' && !parsePoints(event.target.value).isValid) {
    event.target.value = row.setupLocation.points === undefined ? '' : String(row.setupLocation.points);
    savePoints(row, event.target);
    return;
  }
  if (event.target instanceof HTMLInputElement && event.target.dataset.field === 'text') {
    lookUpFinished(routeLocationOf(row.setupLocation, state.setupLocations.indexOf(row.setupLocation) + 1, state.searchResults));
  }
});

// A partly filled in time isn't saved, so when its field is left, put back
// the saved time. This can't wait for change, which a time field fires as
// each part of the time is changed, before it's finished.
locationRows.addEventListener('focusout', (event) => {
  const row = rowOf(event.target);
  if (row?.setupLocation && event.target instanceof HTMLInputElement && event.target.dataset.field === 'at' && event.target.validity.badInput) {
    event.target.value = row.setupLocation.at ?? '';
  }
});

// A row that's been emptied, without a pin, is removed once focus leaves
// it, so blank rows don't build up above the empty one at the end. This
// can't wait for change, which doesn't fire when the empty row at the end
// is typed in and then emptied again.
locationRows.addEventListener('focusout', (event) => {
  const row = rowOf(event.target);
  if (
    row?.setupLocation &&
    !row.item.contains(/** @type {Node | null} */ (event.relatedTarget)) &&
    row.setupLocation.text.trim() === '' &&
    !row.setupLocation.pin
  ) {
    removeRow(row.item, row.setupLocation);
  }
});

// Enter moves to the next row, rather than submitting the form, which
// finishes the row and looks it up. In a row's other fields, it does
// nothing, rather than planning the route.
locationRows.addEventListener('keydown', (event) => {
  const row = rowOf(event.target);
  if (row && event.target instanceof HTMLInputElement && event.key === 'Enter' && !event.isComposing) {
    event.preventDefault();
    if (event.target.dataset.field === 'text') {
      row.item.nextElementSibling?.querySelector('[data-field="text"]')?.focus();
    }
  }
});

locationRows.addEventListener('click', (event) => {
  const button = event.target instanceof Element ? event.target.closest('button[data-action]') : null;
  const row = rowOf(button);
  if (!(button instanceof HTMLButtonElement) || !row) {
    return;
  }
  const { item, setupLocation } = row;
  const number = [...locationRows.children].indexOf(item) + 1;
  if (button.dataset.action === 'pin') {
    startPinning(setupLocation?.id ?? null, rowLabel(setupLocation?.text ?? '', number));
  } else if (button.dataset.action === 'remove' && setupLocation) {
    removeRow(item, setupLocation);
  } else if (button.dataset.action === 'more' && setupLocation) {
    if (!openRows.delete(setupLocation.id)) {
      openRows.add(setupLocation.id);
    }
    showRow(item, number);
  } else if (button.dataset.action === 'clear-pin' && setupLocation) {
    delete setupLocation.pin;
    saveState(state);
    item.querySelector('input').focus();
    showRows();
    lookUpFinished(routeLocationOf(setupLocation, number, state.searchResults));
  }
});

// The Start and Finish fields are looked up once they're finished, too.
for (const [field, key] of /** @type {const} */ ([
  [startField, START_KEY],
  [finishField, FINISH_KEY],
])) {
  field.addEventListener('change', () => lookUpFinished(routeLocationOfText(field.value, key, state.searchResults), { canPin: false }));
}

/**
 * Lists the locations not in the route yet, with their names and
 * positions, to tell whether the map needs redrawing, such as after one is
 * moved again.
 *
 * @param {import('./map.js').MapMarker[]} markers Their markers, from {@link newLocationMarkers}.
 * @returns {string} Each location's key, position and marker title, one per line.
 */
function newLocationsText(markers) {
  return markers.map(({ location, title }) => `${location.key} ${location.lat},${location.lng} ${title}`).join('\n');
}

/**
 * Shows what stops planning, or hides the message.
 *
 * @param {string | null} error The message, or `null` to hide it.
 */
function showSetupError(error) {
  setupError.textContent = error ?? '';
  setupError.classList.toggle('hidden', error === null);
}

/**
 * Creates a link that opens in a new tab.
 *
 * @param {string} href Where the link goes.
 * @param {string} text The link's text.
 * @param {string} label The link's accessible name, if it should say more than its text.
 * @returns {HTMLAnchorElement} The link.
 */
function externalLink(href, text, label = text) {
  const link = element(
    'a',
    'inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-accent-ink ring-1 ring-accent/30 hover:bg-accent-soft',
    text,
  );
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener';
  if (label !== text) {
    link.setAttribute('aria-label', label);
  }
  return link;
}

/**
 * Creates the button that marks a location's selfie as done, or not done.
 *
 * @param {import('./locations.js').RouteLocation} location The location.
 * @param {boolean} isDone Whether the selfie is done.
 * @returns {HTMLButtonElement} The button.
 */
function doneToggle(location, isDone) {
  const toggle = element(
    'button',
    `inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold ${isDone ? 'bg-accent text-white hover:bg-accent-strong' : 'bg-surface text-accent-ink ring-1 ring-accent hover:bg-accent-soft'}`,
    isDone ? '✓ Selfie done' : 'Mark selfie done',
  );
  toggle.type = 'button';
  toggle.dataset.doneKey = location.key;
  toggle.setAttribute('aria-pressed', String(isDone));
  toggle.setAttribute('aria-label', `Selfie done at ${location.label}`);
  return toggle;
}

/**
 * Creates the link that opens the check-in form in a new tab. Following it
 * also marks the location's selfie as done.
 *
 * @param {import('./locations.js').RouteLocation} location The location.
 * @param {boolean} isDone Whether the selfie is done.
 * @returns {HTMLAnchorElement} The link.
 */
function checkInLink(location, isDone) {
  const link = externalLink(state.event.checkInFormUrl, 'Check in', `Check in at ${location.label}, opens the check-in form and marks the selfie done`);
  link.className = `inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold ${isDone ? 'text-accent-ink ring-1 ring-accent/30 hover:bg-accent-soft' : 'bg-accent text-white hover:bg-accent-strong'}`;
  link.dataset.checkInKey = location.key;
  return link;
}

/**
 * Works out what each location is worth, from the rows now, so changing a
 * row's points shows straight away, without planning again. Points only show
 * once any location has its own points, so the route otherwise looks as it
 * does without them.
 *
 * @returns {Map<string, number> | null} Each row's points by its id, or `null` if no location has its own points. A location whose row has been removed since planning isn't in it, so it no longer counts.
 */
function currentPoints() {
  if (!hasOwnPoints(state.setupLocations)) {
    return null;
  }
  return pointsById(state.setupLocations, state.event.pointsPerLocation);
}

/**
 * Adds up what locations are worth, leaving out those whose rows have been
 * removed.
 *
 * @param {string[]} keys The locations' keys.
 * @param {Map<string, number>} points Each row's points by its id, from {@link currentPoints}.
 * @returns {number} Their total points.
 */
function totalPoints(keys, points) {
  return keys.reduce((total, key) => total + (points.get(key) ?? 0), 0);
}

/**
 * Creates the list item for a stop, or for the walk to the finish.
 *
 * @param {import('./route.js').RouteStop} stop The stop.
 * @param {boolean} isFinish Whether this is the walk to the finish.
 * @param {Map<string, number> | null} points Each row's points by its id, from {@link currentPoints}.
 * @returns {HTMLLIElement} The list item.
 */
function stopItem(stop, isFinish, points) {
  const isDone = !isFinish && visitedKeys(state.setupLocations).includes(stop.location.key);
  // Points show once any location has its own points, and not for the
  // finish or a removed row.
  const stopPoints = isFinish ? undefined : points?.get(stop.location.key);
  const item = element('li', `flex gap-3 rounded-md p-3 ring-1 ${isDone ? 'bg-accent-soft ring-accent-line' : 'ring-line'}`);
  const badgeColours = isFinish ? 'bg-ink text-surface' : isDone ? 'bg-accent-line text-accent-ink' : 'bg-accent text-white';
  const badge = element(
    'span',
    `flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${badgeColours}`,
    isFinish ? '🏁' : isDone ? '✓' : String(stop.number),
  );
  badge.setAttribute('aria-hidden', 'true');

  const details = element('div', 'flex min-w-0 flex-1 flex-col gap-1');
  const title = element('p', 'font-medium break-words', stop.location.label);
  // At a stop with an At, the team must be there then rather than take the
  // selfie on arrival and leave early, so its At shows in place of the ETA.
  const isAt = !isFinish && stop.fixedTime !== null && !isDone;
  let when = `ETA ${timeFormat.format(stop.arrivalTime)}`;
  if (isFinish) {
    when = `Finish · arrive ${timeFormat.format(stop.arrivalTime)}`;
  } else if (isAt) {
    when = `At ${timeFormat.format(stop.fixedTime)}`;
  }
  const timing = element(
    'p',
    `text-sm ${isAt ? 'font-medium text-accent-ink' : 'text-muted'}`,
    `${when} · ${formatDuration(stop.walkSeconds)} walk${stopPoints === undefined ? '' : ` · ${plural(stopPoints, 'point')}`}`,
  );
  details.append(title, timing);
  const links = element('div', 'mt-1 flex flex-wrap gap-2');
  if (!isFinish) {
    links.append(...(state.event.checkInFormUrl ? [checkInLink(stop.location, isDone)] : []), doneToggle(stop.location, isDone));
  }
  // Apple Maps on the web may not work on other devices, such as Android.
  const directions = [['Google Maps', stop.googleMapsDirectionsUrl], ...(isAppleDevice(navigator.userAgent) ? [['Apple Maps', stop.appleMapsDirectionsUrl]] : [])];
  links.append(...directions.map(([app, url]) => externalLink(url, app, `Walking directions to ${stop.location.label} in ${app}`)));
  details.append(links);
  item.append(badge, details);
  return item;
}

/** Shows the time left until today's deadline in the header. */
function showCountdown() {
  const now = Date.now();
  const deadline = timeToday(state.event.deadline ?? '', now);
  countdown.textContent = countdownText(deadline, now);
  countdownDeadline.textContent = deadline === null ? '' : `Deadline ${timeFormat.format(deadline)}`;
}

/** Updates everything that depends on the time: the countdown and the time warning. */
function showTime() {
  showCountdown();
  // Redraw the route when the day changes, so an older plan gets its note.
  if (state.plan && isPlanForToday(state.plan, Date.now()) !== wasPlanForToday) {
    showPlan();
  }
  showTimeWarning();
}

/**
 * Shows or hides the warning that time is running out. The visible banner
 * isn't announced, because its minutes change every minute. Instead, a
 * hidden alert is announced when the warning's wording changes, apart from
 * its numbers, and cleared once read so it can't disagree with the banner.
 */
function showTimeWarning() {
  const warning = state.plan ? timeWarning(state.plan, visitedKeys(state.setupLocations), Date.now(), timeFormat.format) : null;
  timeWarningText.textContent = warning?.message ?? '';
  timeWarningBanner.classList.toggle('hidden', warning === null);
  const wording = warning ? warning.message.replace(/\d+/g, '#') : null;
  if (wording !== announcedWarning) {
    announcedWarning = wording;
    timeWarningAlert.textContent = warning?.message ?? '';
    clearTimeout(clearAlertTimer);
    clearAlertTimer = setTimeout(() => {
      timeWarningAlert.textContent = '';
    }, 10000);
  }
}

/**
 * Shows the current plan as a list of stops, then any skipped and done
 * locations, and on the map.
 *
 * @param {object} [options] What to leave alone.
 * @param {boolean} [options.isMapUnchanged=false] Whether only the list has changed, such as a location's points, so the map needn't be redrawn, which would close an open popup.
 */
function showPlan({ isMapUnchanged = false } = {}) {
  const { plan } = state;
  const hasPlan = plan !== null;
  replan.classList.toggle('hidden', !hasPlan);
  replan.classList.toggle('flex', hasPlan);
  if (!isMapUnchanged) {
    updateMap();
  }
  showTimeWarning();
  if (!hasPlan) {
    stopList.replaceChildren(element('p', 'text-sm text-muted', 'Add your locations above and press Plan route.'));
    return;
  }
  const route = describeRoute(plan);
  const ending = route.finish ? `arriving at the finish at ${timeFormat.format(route.endEta)}` : `with the last selfie at ${timeFormat.format(route.endEta)}`;
  const visited = visitedKeys(state.setupLocations);
  const { done, total } = progress(plan, visited);
  // Count only stops still to visit, since a stop on this route may have
  // been ticked off since it was planned.
  const toVisit = route.stops.filter(({ location }) => !visited.includes(location.key));
  const stopsToVisit = toVisit.length;
  const remaining = total - done;
  const locationsWord = (count) => (count === 1 ? 'location' : 'locations');
  const visiting = done === 0 ? `${stopsToVisit} of ${total} ${locationsWord(total)}` : `${stopsToVisit} of ${remaining} ${locationsWord(remaining)} still to do`;
  const points = currentPoints();
  const pointsText = points ? ` (${plural(totalPoints(toVisit.map(({ location }) => location.key), points), 'point')})` : '';
  const summary = element('p', 'text-sm', remaining === 0 && total > 0 ? `All ${total} selfies done!` : `Visiting ${visiting}${pointsText}, ${ending}.`);
  // A plan's times are on the day it was made, so an older plan needs planning again.
  wasPlanForToday = isPlanForToday(plan, Date.now());
  if (!wasPlanForToday) {
    summary.prepend(
      element('strong', 'mb-1 block text-danger', 'This route was planned on an earlier day, so its times are out of date. Press Plan route to plan for today.'),
    );
  }
  const counter = element('p', 'mt-1 text-sm font-semibold text-accent-ink', `Selfies done: ${done} of ${total}`);
  counter.setAttribute('aria-live', 'polite');

  const stops = element('ol', 'mt-3 flex flex-col gap-2');
  stops.setAttribute('aria-label', 'Stops in order');
  stops.append(...route.stops.map((stop) => stopItem(stop, false, points)));
  if (route.finish) {
    stops.append(stopItem(route.finish, true, points));
  }
  const sections = [summary, counter];
  // The planning result says so too, but only until the next message, so a
  // skipped must-visit location is also noted here, where it stays.
  sections.push(
    ...skippedMustVisitTexts(plan, route, visited).map((text) => element('p', 'mt-2 rounded-md bg-danger-soft px-3 py-2 text-sm font-semibold text-danger ring-1 ring-danger-line', text)),
  );
  if (state.event.checkInFormUrl && remaining > 0) {
    sections.push(
      element('p', 'mt-2 rounded-md bg-accent-soft px-3 py-2 text-sm text-accent-ink ring-1 ring-accent-line', 'Tip: check in straight after each selfie. The first team to upload at a location gets a bonus.'),
    );
  }
  sections.push(stops);

  for (const [locations, reason] of [
    [route.skipped, 'not enough time'],
    [route.skippedForAt, "At time can't be met"],
  ]) {
    if (locations.length > 0) {
      const heading = element('h3', 'mt-4 text-sm font-semibold', `Skipped (${locations.length}): ${reason}`);
      const skipped = element('ul', 'mt-2 flex flex-col gap-1 text-sm text-muted');
      skipped.append(...locations.map((location) => element('li', '', location.label)));
      sections.push(heading, skipped);
    }
  }

  // Done locations that aren't stops on this route (because it was planned
  // after their selfie) are listed so a mistaken tick can be undone.
  const routeKeys = new Set(route.stops.map(({ location }) => location.key));
  const doneElsewhere = plan.routeLocations.filter(({ key }) => visited.includes(key) && !routeKeys.has(key));
  if (doneElsewhere.length > 0) {
    const heading = element('h3', 'mt-4 text-sm font-semibold', `Done (${doneElsewhere.length})`);
    const doneList = element('ul', 'mt-2 flex flex-col gap-2');
    doneList.append(
      ...doneElsewhere.map((location) => {
        const item = element('li', 'flex flex-wrap items-center justify-between gap-2 text-sm');
        item.append(element('span', 'min-w-0 break-words', location.label), doneToggle(location, true));
        return item;
      }),
    );
    sections.push(heading, doneList);
  }
  stopList.replaceChildren(...sections);
}

/**
 * Marks a row of the location list as visited, with its selfie taken, or
 * not visited, and saves it. A location whose row has been removed can't
 * be marked.
 *
 * @param {string} key The location's key, which is its row's id.
 * @param {boolean} isVisited Whether it's been visited.
 */
function setVisited(key, isVisited) {
  const setupLocation = state.setupLocations.find(({ id }) => id === key);
  if (!setupLocation) {
    return;
  }
  if (isVisited) {
    setupLocation.isVisited = true;
  } else {
    delete setupLocation.isVisited;
  }
  saveState(state);
  // A visited row no longer shows Must visit.
  showRows();
}

/**
 * Marks a stop's selfie as done when its Check in link is followed.
 *
 * @param {MouseEvent} event The click.
 * @returns {boolean} Whether the click was on a Check in link.
 */
function checkInClicked(event) {
  const checkIn = event.target instanceof Element ? event.target.closest('[data-check-in-key]') : null;
  if (!(checkIn instanceof HTMLAnchorElement)) {
    return false;
  }
  const key = checkIn.dataset.checkInKey;
  setVisited(key, true);
  // A link removed from the page can't open, so only re-render once it has.
  setTimeout(() => {
    showPlan();
    stopList.querySelector(`[data-check-in-key="${CSS.escape(key)}"]`)?.focus();
  });
  return true;
}

// A middle-click also opens the form, in a new tab. Opening it from a
// long-press menu can't be detected, so the selfie needs ticking by hand.
stopList.addEventListener('auxclick', (event) => {
  if (event.button === 1) {
    checkInClicked(event);
  }
});

stopList.addEventListener('click', (event) => {
  if (checkInClicked(event)) {
    return;
  }
  const toggle = event.target instanceof Element ? event.target.closest('[data-done-key]') : null;
  if (toggle instanceof HTMLButtonElement) {
    const key = toggle.dataset.doneKey;
    setVisited(key, !visitedKeys(state.setupLocations).includes(key));
    showPlan();
    // Re-rendering replaces the button, so move focus to its replacement.
    stopList.querySelector(`[data-done-key="${CSS.escape(toggle.dataset.doneKey)}"]`)?.focus();
  }
});

/** Waits for a pause in typing before checking whether the map needs redrawing. */
let mapTimer;

form.addEventListener('input', (event) => {
  // The location list's rows aren't bound to a setting, and save themselves.
  if (event.target instanceof HTMLInputElement && (event.target.dataset.event || event.target.dataset.setting)) {
    saveField(event.target);
  }
  if (event.target === startField || event.target === finishField) {
    showFieldStatuses();
  }
});

/**
 * Shows how planning went under Plan route, or hides the message.
 *
 * @param {string | null} message The message, or `null` to hide it.
 * @param {boolean} [isWarning=false] Whether it warns about the plan, so it stands out.
 */
function showPlanStatus(message, isWarning = false) {
  planStatus.textContent = message ?? '';
  planStatus.classList.toggle('hidden', message === null);
  planStatus.classList.toggle('text-danger', isWarning);
}

/**
 * Warns that the must-visit locations don't fit, so the route is only them.
 *
 * @param {import('./setup.js').SavedPlan} plan The plan, whose `isMustVisitLate` is `true`.
 * @returns {string} The warning, like "Your must-visit locations take until 16:25, past your 15:50 cut-off. …"
 */
function mustVisitLateText(plan) {
  const cutOff = plan.deadline - plan.settings.safetyMarginSeconds * 1000;
  return `Your must-visit locations take until ${timeFormat.format(plan.endEta)}, past your ${timeFormat.format(cutOff)} cut-off. Untick Must visit on some locations to fit others in.`;
}

/**
 * Says that each must-visit location still to visit was skipped because its
 * At can't be met, unless its row has changed since, so it's no longer
 * must-visit or has another At, or none.
 *
 * @param {import('./setup.js').SavedPlan} plan The plan.
 * @param {import('./route.js').RouteView} [route] The plan's route, if already described.
 * @param {string[]} [visited] Keys of the locations that have been visited, if already known.
 * @returns {string[]} The notices, like "Queen's Square was skipped: it can't be reached by 13:00. Clear its At to visit it later."
 */
function skippedMustVisitTexts(plan, route = describeRoute(plan), visited = visitedKeys(state.setupLocations)) {
  const rows = new Map(state.setupLocations.map((setupLocation) => [setupLocation.id, setupLocation]));
  return route.skippedMustVisit
    .filter(({ key, at }) => rows.get(key)?.isMustVisit === true && rows.get(key).at === at && !visited.includes(key))
    .map(({ label, at }) => `${label} was skipped: it can't be reached by ${timeFormat.format(timeToday(at, plan.startTime))}. Clear its At to visit it later.`);
}

/**
 * Warns about any must-visit locations the route can't fit in, or skips
 * because their At times can't be met.
 *
 * @param {import('./setup.js').SavedPlan} plan The plan.
 * @returns {string[]} The warnings, if any.
 */
function planWarnings(plan) {
  return [...(plan.isMustVisitLate ? [mustVisitLateText(plan)] : []), ...skippedMustVisitTexts(plan)];
}

/**
 * Describes how planning went, including any rows that were left out
 * because they couldn't be found, and whether the must-visit rows fit and
 * can keep their At times.
 *
 * @param {import('./setup.js').SetupResult} setupResult The result of planning.
 * @returns {string} The message, like "Planned 22 stops."
 */
function planResultText(setupResult) {
  const { order } = setupResult.plan;
  const points = currentPoints();
  const scored = points ? ` · ${plural(totalPoints(order.map((index) => setupResult.plan.routeLocations[index].key), points), 'point')}` : '';
  const parts = [`Planned ${plural(order.length, 'stop')}${scored}.`];
  if (setupResult.leftOut.length > 0) {
    const labels = setupResult.leftOut.map((routeLocationResult) => routeLocationResult.label);
    parts.push(`Left out because ${setupResult.leftOut.length === 1 ? "it wasn't" : "they weren't"} found: ${labels.join(', ')}.`);
  }
  parts.push(...planWarnings(setupResult.plan));
  return parts.join(' ');
}

/**
 * Waits for the next frame to be drawn, so a message shows before a long task.
 *
 * @returns {Promise<void>} Resolves after the frame.
 */
function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
}

/**
 * Counts the location lists shown, so planning that started for an earlier
 * list, before a new challenge or opening a shared setup, isn't shown.
 */
let listGeneration = 0;

/**
 * Looks up anything that still needs it, waiting for lookups already
 * running, then plans the route from the setup form and shows it. If a new
 * list is shown meanwhile, it stops without planning.
 *
 * @param {import('./planner.js').LatLng | null} from The team's current position to re-plan from, or `null` to start at the Start field.
 * @returns {Promise<import('./setup.js').SetupResult | null>} The result of planning, or `null` if a new list was shown before it planned.
 */
async function planRoute(from) {
  const generation = listGeneration;
  planButton.disabled = true;
  replanButton.disabled = true;
  try {
    for (const query of searchesNeeded({ event: state.event, setupLocations: state.setupLocations, searchResults: state.searchResults, isFromPosition: from !== null })) {
      lookUp(query);
    }
    showRows();
    while (lookups.size > 0 && generation === listGeneration) {
      planButton.textContent = `Waiting for ${plural(lookups.size, 'search', 'searches')}…`;
      await Promise.race(lookups.values());
    }
    planButton.textContent = 'Planning…';
    await nextFrame();
    if (generation !== listGeneration) {
      return null;
    }
    const setupResult = planFromSetup({
      event: state.event,
      setupLocations: state.setupLocations,
      settings: state.settings,
      now: Date.now(),
      from,
      searchResults: state.searchResults,
    });
    showSetupError(setupResult.error);
    showPlanStatus(setupResult.plan ? planResultText(setupResult) : null, setupResult.plan !== null && planWarnings(setupResult.plan).length > 0);
    if (setupResult.plan) {
      // The route now uses the rows' points, so it no longer needs the
      // pending message to re-plan for them.
      clearTimeout(pointsTimer);
      isReplanForPointsNeeded = false;
      state.plan = setupResult.plan;
      saveState(state);
      shouldFitMap = true;
      showPlan();
      showSettingsSummary();
      showPinStatus(PIN_HINT);
    }
    showRows();
    if (setupResult.plan && from === null) {
      // Move to the route, now it's ready.
      stopsHeading.focus({ preventScroll: true });
      stopsHeading.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    return setupResult;
  } finally {
    // Not the text from when this plan started, which can be another
    // plan's "Waiting for…" when two overlap, such as after saving settings.
    planButton.textContent = PLAN_BUTTON_TEXT;
    planButton.disabled = false;
    replanButton.disabled = false;
  }
}

/** Messages for each way getting the position can fail, by `GeolocationPositionError.code`. */
const GEOLOCATION_ERRORS = {
  1: 'Location access is blocked. Allow location for this site in your browser settings, or set Start to where you are, clear Start time and press Plan route.',
  2: "Your location isn't available right now. Try again in a moment, or set Start to where you are, clear Start time and press Plan route.",
  3: 'Getting your location took too long. Try again, ideally with a clear view of the sky.',
};

/**
 * Shows a message under the Re-plan from here button.
 *
 * @param {string} message The message.
 * @param {boolean} isError Whether the message is an error.
 */
function showReplanStatus(message, isError) {
  replanStatus.textContent = message;
  replanStatus.classList.toggle('text-danger', isError);
  replanStatus.classList.toggle('text-muted', !isError);
}

/**
 * Re-plans from a position and shows how it went.
 *
 * @param {import('./planner.js').LatLng} position The team's position.
 */
/** The message after re-planning from the team's position. */
const replannedFromPosition = () => `Re-planned from your position at ${timeFormat.format(Date.now())}.`;

/**
 * Re-plans and shows how it went under Re-plan from here, next to the route.
 *
 * @param {import('./planner.js').LatLng | null} position The team's position, or `null` to plan from the Start field.
 * @param {() => string} successMessage Makes the message to show when a plan is made.
 */
async function replanAndReport(position, successMessage) {
  try {
    const setupResult = await planRoute(position);
    if (setupResult === null) {
      return;
    }
    const { error, plan } = setupResult;
    if (error !== null) {
      showReplanStatus(error, true);
    } else {
      const warnings = planWarnings(plan);
      showReplanStatus([successMessage(), ...warnings].join(' '), warnings.length > 0);
    }
  } catch {
    showReplanStatus("Re-planning didn't work. Try again.", true);
  }
}

/** Re-plans from the team's current position and the current time, as Re-plan from here does. */
function requestReplan() {
  // Use the watched position if it's recent, rather than waiting for a new one.
  if (latestPosition && Date.now() - latestPosition.time <= POSITION_MAX_AGE_MS) {
    replanAndReport({ lat: latestPosition.lat, lng: latestPosition.lng }, replannedFromPosition);
    return;
  }
  if (!('geolocation' in navigator)) {
    showReplanStatus("This browser can't share your location. Set Start to where you are, clear Start time and press Plan route instead.", true);
    return;
  }
  replanButton.disabled = true;
  showReplanStatus('Getting your location…', false);
  const generation = listGeneration;
  navigator.geolocation.getCurrentPosition(
    (position) => {
      // A new list has been shown while finding the position, so there's nothing to re-plan.
      if (generation !== listGeneration) {
        replanButton.disabled = false;
        return;
      }
      replanAndReport({ lat: position.coords.latitude, lng: position.coords.longitude }, replannedFromPosition);
    },
    (error) => {
      replanButton.disabled = false;
      // As above, a new list has been shown meanwhile, so the error doesn't apply to it.
      if (generation !== listGeneration) {
        return;
      }
      showReplanStatus(GEOLOCATION_ERRORS[error.code] ?? "Your location couldn't be found. Try again.", true);
    },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 },
  );
}

replanButton.addEventListener('click', requestReplan);

/**
 * Shows a tab of the Route section and remembers the choice.
 *
 * @param {'list' | 'map'} view The tab to show.
 * @param {boolean} [shouldFocus=false] Whether to move focus to the tab, as when choosing it with the arrow keys.
 */
function showView(view, shouldFocus = false) {
  for (const tab of tabs) {
    const isSelected = tab.dataset.view === view;
    tab.setAttribute('aria-selected', String(isSelected));
    tab.tabIndex = isSelected ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !isSelected;
    if (isSelected && shouldFocus) {
      tab.focus();
    }
  }
  if (view === 'map') {
    showMap();
  }
  if (state.view !== view) {
    state.view = view;
    saveState(state);
  }
}

/** Creates the map the first time it's shown, and resizes it to fit afterwards. */
function showMap() {
  if (routeMap) {
    routeMap.refresh();
    updateMap();
    return;
  }
  routeMap = createMap(mapContainer, {
    onTilesFailed: () => mapTilesStatus.classList.remove('hidden'),
    onTilesLoaded: () => mapTilesStatus.classList.add('hidden'),
    onLongPress: (latLng) => (pinTarget ? placePin(latLng) : openPinDialog(latLng)),
    onTap: (latLng) => pinTarget && placePin(latLng),
  });
  showMapStatus(routeMap ? null : "The map couldn't load, which usually means there's no signal. The List tab still works.");
  // Without a map, there's nowhere to drop a pin.
  pinStatus.classList.toggle('hidden', !routeMap);
  updateMap();
  if (routeMap && latestPosition) {
    showPosition(routeMap, latestPosition);
  }
  watchPosition();
}

/**
 * Shows a message under the map, or hides it.
 *
 * @param {string | null} message The message, or `null` to hide it.
 */
function showMapStatus(message) {
  mapStatus.textContent = message ?? '';
  mapStatus.classList.toggle('hidden', message === null);
}

/** Messages for each way watching the position can fail, by `GeolocationPositionError.code`. */
const WATCH_ERRORS = {
  1: "Location access is blocked, so your position isn't shown. Allow location for this site in your browser settings to see it.",
  2: "Your position isn't available right now. It will appear when your phone finds it.",
  3: 'Still looking for your position…',
};

/** Starts watching the team's position, so it's shown on the map and can be used to re-plan. */
function watchPosition() {
  if (isWatchingPosition || !('geolocation' in navigator)) {
    return;
  }
  isWatchingPosition = true;
  navigator.geolocation.watchPosition(
    (position) => {
      latestPosition = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
        time: position.timestamp,
      };
      if (routeMap) {
        showPosition(routeMap, latestPosition);
        showMapStatus(null);
      }
    },
    (error) => {
      if (routeMap) {
        showMapStatus(WATCH_ERRORS[error.code] ?? "Your position couldn't be found.");
      }
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 },
  );
}

/**
 * Draws the current plan on the map, if the map has been created and is
 * showing, with any locations that aren't in it yet. It zooms to fit the
 * route the first time it's drawn after planning, but not after ticking off
 * a stop, so the team's view stays put.
 */
function updateMap() {
  if (!routeMap || mapContainer.closest('[hidden]')) {
    return;
  }
  const { plan } = state;
  const route = plan ? mapRoute(plan, visitedKeys(state.setupLocations), (time) => timeFormat.format(time)) : { path: [], markers: [] };
  const newMarkers = newLocationMarkers(usableRouteLocations(state.setupLocations, state.searchResults), plan, mustVisitKeys());
  route.markers.push(...newMarkers);
  // A stop, skipped location or + can be moved from its popup, which pins
  // its row there, as 📍 does, so it keeps its text and ticked-off state.
  // Its row is looked up when the popup opens and when Move is pressed,
  // not now, as it can be renamed, removed or ticked off in the list
  // without the map being redrawn.
  for (const marker of route.markers) {
    const target = () => {
      const setupLocation = movableSetupLocation(marker, state.setupLocations);
      return setupLocation && { id: setupLocation.id, label: rowLabel(setupLocation.text, state.setupLocations.indexOf(setupLocation) + 1) };
    };
    marker.moveTarget = () => target()?.label ?? null;
    marker.onMove = () => {
      const current = target();
      if (current) {
        startPinning(current.id, current.label, { isMove: true });
      }
    };
  }
  drawnNewLocations = newLocationsText(newMarkers);
  showRoute(routeMap, route, shouldFitMap);
  shouldFitMap = false;
}

/**
 * Shows a message under the map about dropping pins.
 *
 * @param {string} message The message.
 * @param {string | null} [addedKey] The id of the row the message says was added, if it does.
 */
function showPinStatus(message, addedKey = null) {
  pinStatus.textContent = message;
  addedPinKey = addedKey;
}

/**
 * Asks for a name for a pin dropped on the map.
 *
 * @param {import('./planner.js').LatLng} latLng Where the pin was dropped.
 */
function openPinDialog(latLng) {
  // Keep the first pin if a long press is reported twice.
  if (pinDialog.open) {
    return;
  }
  droppedPin = latLng;
  pinLabel.value = '';
  pinCoordinates.textContent = `At ${latLng.lat.toFixed(6)}, ${latLng.lng.toFixed(6)}`;
  // Escape and the back button close the dialog without changing
  // returnValue, so clear it to stop an earlier Add applying again.
  pinDialog.returnValue = '';
  pinDialog.showModal();
}

/**
 * Starts pinning a row of the location list on the map: shows the map with
 * a banner saying what to tap, and waits for a tap.
 *
 * @param {string | null} id The row's id, or `null` for the empty row at the end.
 * @param {string} label What the row is called, for the banner.
 * @param {object} [options] How it was started.
 * @param {boolean} [options.isMove=false] Whether it's being moved with a marker's Move, rather than pinned with 📍.
 */
function startPinning(id, label, { isMove = false } = {}) {
  showView('map');
  if (!routeMap) {
    // The map couldn't load, and says so under it.
    mapContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  pinTarget = { id, isMove };
  pinBannerText.textContent = `Tap where ${label} is.`;
  pinBanner.classList.replace('hidden', 'flex');
  mapContainer.classList.add('is-pinning');
  pinBanner.scrollIntoView({ behavior: 'smooth', block: 'start' });
  pinBannerCancel.focus({ preventScroll: true });
}

/**
 * Stops moving a row on the map if it's been removed or ticked off since
 * Move was pressed, so the banner doesn't ask for a tap that can't move it.
 */
function stopMovingIfUnmovable() {
  if (pinTarget?.isMove && !movableRow(state.setupLocations, pinTarget.id)) {
    stopPinning();
  }
}

/** Stops pinning a row on the map, and hides the banner. */
function stopPinning() {
  pinTarget = null;
  pinBanner.classList.replace('flex', 'hidden');
  mapContainer.classList.remove('is-pinning');
}

/**
 * Pins the row being pinned where the map was tapped.
 *
 * @param {import('./planner.js').LatLng} latLng Where the map was tapped.
 */
function placePin(latLng) {
  const { id, isMove } = pinTarget;
  if (isMove && !movableRow(state.setupLocations, id)) {
    // Its row was removed or ticked off while it was being moved, so
    // there's nothing to move.
    stopPinning();
    return;
  }
  const location = pinRow(id, '', latLng);
  stopPinning();
  const action = state.plan ? 'Re-plan from here' : 'Plan route';
  showPinStatus(
    isMove ? `Moved ${location.label}. Press ${action} to update the route.` : `Pinned ${location.label}. Press ${action} to use the pin in the route.`,
    location.key,
  );
}

pinBannerCancel.addEventListener('click', stopPinning);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && pinTarget) {
    stopPinning();
  }
});

document.getElementById('pin-cancel').addEventListener('click', () => pinDialog.close('cancel'));

pinDialog.addEventListener('close', () => {
  const latLng = pinDialog.returnValue === 'add' ? droppedPin : null;
  droppedPin = null;
  if (!latLng) {
    return;
  }
  const location = pinRow(null, pinLabel.value.trim(), latLng);
  const action = state.plan ? 'Re-plan from here' : 'Plan route';
  showPinStatus(`Added ${location.label} to the location list. Press ${action} to include it in the route.`, location.key);
});

for (const tab of tabs) {
  tab.addEventListener('click', () => showView(/** @type {'list' | 'map'} */ (tab.dataset.view)));
  // Arrow keys, Home and End move between tabs, following the ARIA tabs pattern.
  tab.addEventListener('keydown', (event) => {
    const index = tabs.indexOf(tab);
    const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (next !== undefined) {
      event.preventDefault();
      showView(/** @type {'list' | 'map'} */ (tabs[(next + tabs.length) % tabs.length].dataset.view), true);
    }
  });
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  planRoute(null);
});

/**
 * Shows a new location list, after starting a new challenge or opening a
 * shared setup: stops anything still going for the old list, such as
 * pinning, planning or the message to re-plan for new points, and shows
 * the new list without a plan.
 */
function showNewList() {
  listGeneration++;
  stopPinning();
  openRows.clear();
  clearTimeout(pointsTimer);
  isReplanForPointsNeeded = false;
  saveState(state);
  fillForm();
  buildRows();
  showSetupError(null);
  showPlanStatus(null);
  showReplanStatus('Uses your current location and time, and the locations still to visit.', false);
  showPinStatus(PIN_HINT);
  shouldFitMap = true;
  showPlan();
  showSettingsSummary();
  showCountdown();
  // A message about sharing the old list doesn't apply to the new one.
  showShareStatus('');
  prepareShare();
}

document.getElementById('new-challenge').addEventListener('click', () => {
  if (!window.confirm('Start a new challenge? This clears the location list, the selfies ticked off and the route. Your settings are kept.')) {
    return;
  }
  Object.assign(state, resetChallenge(state));
  showNewList();
  locationRows.querySelector('input').focus();
});

/**
 * Shows a message by the Share setup button, and the link to copy by hand
 * if it couldn't be shared or copied.
 *
 * @param {string} message The message, or an empty string to hide it.
 * @param {{ isError?: boolean, link?: string | null }} [options] Whether the message is an error, and the link to show.
 */
function showShareStatus(message, { isError = false, link = null } = {}) {
  shareStatus.textContent = message;
  shareStatus.classList.toggle('text-danger', isError);
  shareStatus.classList.toggle('text-muted', !isError);
  shareLink.hidden = link === null;
  shareLink.value = link ?? '';
}

/**
 * Makes the link for the current setup ahead of a tap on Share setup, since
 * sharing and copying have to start straight from the tap, and some
 * browsers (such as Safari) don't allow them after waiting to compress it.
 */
function prepareShare() {
  if (canCompress() && state.setupLocations.length > 0) {
    shareFragment(state).catch(() => {
      // Share setup says so if it can't be made when tapped.
    });
  }
}

// Make the link when the button's about to be used: when it's pressed or
// focused, before the click, and once the page has loaded.
shareButton.addEventListener('pointerdown', prepareShare);
shareButton.addEventListener('focus', prepareShare);

shareButton.addEventListener('click', async () => {
  if (state.setupLocations.length === 0) {
    showShareStatus('Add some locations before sharing the setup.', { isError: true });
    return;
  }
  if (!canCompress()) {
    showShareStatus("This browser can't make a link for the setup. Update it, or share the setup from another phone.", { isError: true });
    return;
  }
  // Use the link made ahead if the setup hasn't changed since, so sharing
  // starts straight from the tap. Otherwise, make it now, which works in
  // most browsers.
  let fragment = preparedShareFragment(state);
  if (fragment === null) {
    try {
      fragment = await shareFragment(state);
    } catch {
      showShareStatus("Couldn't make a link for the setup. Try again.", { isError: true });
      return;
    }
  }
  const link = `${window.location.origin}${window.location.pathname}${fragment}`;
  const count = plural(state.setupLocations.length, 'location');
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Monopoly Challenge setup', text: `Our Monopoly Challenge setup, with ${count}, for the route planner.`, url: link });
      showShareStatus('');
      return;
    } catch (error) {
      // Closing the share sheet isn't a failure. Anything else falls back to copying.
      if (error instanceof DOMException && error.name === 'AbortError') {
        showShareStatus('');
        return;
      }
    }
  }
  try {
    await navigator.clipboard.writeText(link);
    showShareStatus(`Link copied, with ${count}. Send it to the other phones.`);
  } catch {
    showShareStatus("Couldn't copy the link. Copy it from here instead:", { link });
    shareLink.focus();
    shareLink.select();
  }
});

/**
 * Replaces the location list and the event's details with a shared setup's.
 * The ticks and the plan go with the old list. Its search results are added
 * to the phone's own, but the phone's own that found a place are kept, and
 * those that didn't are dropped, as for a new challenge, so a place that
 * wasn't found can be looked up again. The team's own settings are kept,
 * apart from a default selfie time, which changes to suit a check-in form
 * as it does in the settings panel.
 *
 * @param {import('./share.js').SharedState} shared The shared setup, checked.
 */
function loadSharedSetup(shared) {
  state.settings.dwellSeconds = dwellSecondsForCheckInForm(state.settings.dwellSeconds, state.event.checkInFormUrl !== '', shared.event.checkInFormUrl !== '');
  Object.assign(state, { event: shared.event, setupLocations: shared.setupLocations, searchResults: { ...shared.searchResults, ...resetChallenge(state).searchResults }, plan: null });
  showNewList();
}

/** Removes a shared setup from the address bar, so reloading doesn't open it again. */
function removeShareFragment() {
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
}

/**
 * Opens the shared setup in the address bar's link, if there is one. It
 * replaces the setup straight away if the location list is empty, and otherwise
 * only if the team agrees. A link that can't be read yet, because it's from
 * a newer version, the browser needs updating or this copy of the planner
 * can't save, is kept in the address bar, so it opens once they're updated.
 */
async function openSharedSetup() {
  const result = await readShareFragment(window.location.hash);
  if (result.status === 'none') {
    return;
  }
  shareButton.scrollIntoView({ block: 'center' });
  if (result.status === 'newer') {
    showShareStatus('This link is from a newer version of the planner. Reload with signal to update it, then open the link again.', { isError: true });
    return;
  }
  if (result.status === 'unsupported') {
    showShareStatus("This browser can't open the shared setup. Update it, then open the link again.", { isError: true });
    return;
  }
  if (result.status === 'damaged') {
    removeShareFragment();
    showShareStatus("This link is damaged or incomplete, so the shared setup couldn't be opened. Ask for it to be shared again.", { isError: true });
    return;
  }
  if (isOutOfDate()) {
    showShareStatus("This copy of the planner is out of date, so it can't open the shared setup. Reload with signal to update it, then open the link again.", { isError: true });
    return;
  }
  const { shared } = result;
  if (state.setupLocations.length > 0 && !window.confirm('Replace your setup with the shared one? This replaces your locations, Start, Finish, times and points, and clears the selfies ticked off and the route. Your walking speed and other settings are kept.')) {
    removeShareFragment();
    showShareStatus("Kept your setup. The shared setup wasn't opened.");
    return;
  }
  loadSharedSetup(shared);
  removeShareFragment();
  showShareStatus(`Opened the shared setup, with ${plural(shared.setupLocations.length, 'location')}.`);
}

// A link opened in a tab that already has the planner open only changes the fragment.
window.addEventListener('hashchange', openSharedSetup);


/**
 * Shows a walking speed in the settings panel: the slider, its value and
 * which preset (if any) it matches.
 *
 * @param {number} speedKmh The walking speed in km/h.
 */
function showSettingsSpeed(speedKmh) {
  speedSlider.value = String(speedKmh);
  const preset = speedPreset(speedKmh);
  speedValue.textContent = `${speedKmh.toFixed(1)} km/h`;
  for (const button of speedPresets.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.preset === preset?.name));
  }
}

// The setup form's speed field uses the slider's range too, which planning checks.
for (const input of [speedSlider, speedField]) {
  input.min = String(SPEED_RANGE.min);
  input.max = String(SPEED_RANGE.max);
}
speedSlider.step = String(SPEED_RANGE.step);
speedPresets.replaceChildren(
  ...SPEED_PRESETS.map(({ name, speedKmh }) => {
    const button = element(
      'button',
      'flex min-h-11 flex-col items-center justify-center rounded-md px-2 py-1 text-sm font-semibold text-accent-ink ring-1 ring-accent/30 hover:bg-accent-soft aria-pressed:bg-accent aria-pressed:text-white aria-pressed:ring-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
      name,
    );
    button.type = 'button';
    button.dataset.preset = name;
    button.append(element('span', 'text-xs font-normal', `${speedKmh} km/h`));
    button.addEventListener('click', () => {
      isSpeedChanged = true;
      showSettingsSpeed(speedKmh);
    });
    return button;
  }),
);
speedSlider.addEventListener('input', () => {
  isSpeedChanged = true;
  showSettingsSpeed(Number(speedSlider.value));
});

settingsButton.addEventListener('click', () => {
  // A speed saved outside the slider's range (by an older version) can't be
  // planned with, so treat the slider's in-range value as a change to save.
  // An empty speed (NaN) is treated the same way, so Save stores the speed shown.
  const { speedKmh } = state.settings;
  isSpeedChanged = !Number.isFinite(speedKmh) || speedKmh < SPEED_RANGE.min || speedKmh > SPEED_RANGE.max;
  // Escape and the back button close the panel without changing
  // returnValue, so clear it to stop an earlier Save applying again.
  settingsDialog.returnValue = '';
  // The setup form's speed field can be empty, which saves NaN, and an old
  // speed can be out of range, so show the speed that Save would store.
  const shownSpeed = Number.isFinite(speedKmh) ? speedKmh : defaultState().settings.speedKmh;
  showSettingsSpeed(Math.min(SPEED_RANGE.max, Math.max(SPEED_RANGE.min, shownSpeed)));
  panelFields.forEach(fillField);
  hadCheckInForm = state.event.checkInFormUrl !== '';
  isSelfieTimeEdited = false;
  // Check the link as filled in, since setting a value doesn't fire input.
  checkInFormField.dispatchEvent(new Event('input'));
  settingsSave.textContent = state.plan ? 'Save and re-plan' : 'Save';
  settingsDialog.showModal();
});

// A url field accepts any scheme, such as javascript:, so also check that
// the check-in form is an http or https link.
// Setting or clearing it also changes the selfie time to suit, unless it's
// been changed from the default or edited since the panel opened.
checkInFormField.addEventListener('input', () => {
  const url = checkInFormUrl(checkInFormField.value);
  checkInFormField.setCustomValidity(url === null ? 'Enter a link starting with http:// or https://.' : '');
  if (url === null) {
    return;
  }
  const hasCheckInForm = url !== '';
  if (!isSelfieTimeEdited && selfieTimeField.value.trim() !== '') {
    const dwellSeconds = Number(selfieTimeField.value) * Number(selfieTimeField.dataset.scale);
    selfieTimeField.value = String(dwellSecondsForCheckInForm(dwellSeconds, hadCheckInForm, hasCheckInForm) / Number(selfieTimeField.dataset.scale));
  }
  hadCheckInForm = hasCheckInForm;
});

selfieTimeField.addEventListener('input', () => {
  isSelfieTimeEdited = true;
});

// Cancel is a plain button, so pressing Enter in a field submits with Save
// rather than the first button in the form.
document.getElementById('settings-cancel').addEventListener('click', () => settingsDialog.close('cancel'));

settingsDialog.addEventListener('close', () => {
  if (settingsDialog.returnValue !== 'save') {
    return;
  }
  if (isSpeedChanged) {
    state.settings.speedKmh = Number(speedSlider.value);
  }
  const savedCheckInFormUrl = state.event.checkInFormUrl;
  const savedPointsPerLocation = state.event.pointsPerLocation;
  // The fields are range-checked, and the check-in form URL checked by its
  // input listener, so the dialog only closes with "save" when they're valid.
  for (const field of panelFields) {
    const { group, key } = boundTo(field);
    if (field.type === 'number') {
      group[key] = Number(field.value) * Number(field.dataset.scale ?? 1);
    } else if (field === checkInFormField) {
      // Keep the saved link rather than clearing it if an invalid one gets through.
      group[key] = checkInFormUrl(field.value) ?? group[key];
    } else {
      group[key] = field.value;
    }
  }
  saveState(state);
  fillForm();
  showRows();
  showSettingsSummary();
  showCountdown();
  // Show or hide the Check in buttons, and show new points if points are
  // shown, now, even if re-planning fails.
  const isPointsChanged = state.event.pointsPerLocation !== savedPointsPerLocation && hasOwnPoints(state.setupLocations);
  if (state.event.checkInFormUrl !== savedCheckInFormUrl || isPointsChanged) {
    showPlan();
  }
  // Re-plan with the new settings, keeping ticks: from the Start field if
  // the team hasn't set off yet, otherwise from their position and now.
  if (state.plan) {
    const now = Date.now();
    // A plan's times are on the day it was made, so only today's counts.
    const isPlanForToday = new Date(state.plan.deadline).toDateString() === new Date(now).toDateString();
    const startingPoint = replanStartingPoint({
      startTime: state.event.startTime,
      deadline: state.event.deadline,
      hasVisited: state.setupLocations.some(({ isVisited }) => isVisited),
      isReplannedFromPositionToday: state.plan.isFromPosition && isPlanForToday,
      now,
    });
    if (startingPoint === 'position') {
      requestReplan();
    } else {
      replanAndReport(null, () => 'Re-planned from the Start field with the new settings.');
    }
  }
});

// Recheck the time warning every minute, and when the team comes back to
// the app, since timers can be paused while the phone is locked.
setInterval(showTime, 60000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    showTime();
  }
});

/** Shows the Offline badge in the header when the phone has no connection. */
function showConnection() {
  offlineBadge.classList.toggle('hidden', navigator.onLine);
  offlineBadge.classList.toggle('inline-block', !navigator.onLine);
}

window.addEventListener('online', () => {
  showConnection();
  retryLookups();
});
window.addEventListener('offline', showConnection);

/** The new deploy's service worker, once it's saved its files and is waiting to take over. */
let waitingWorker = /** @type {ServiceWorker | null} */ (null);

/**
 * Shows the update prompt for a new deploy. The page keeps the files it
 * loaded until the team taps Reload, so it never mixes files from two deploys.
 *
 * @param {ServiceWorker} worker The new deploy's service worker, which is waiting.
 */
function offerUpdate(worker) {
  // A page that isn't controlled yet loaded its files from the network, and
  // the first service worker takes over without waiting.
  if (!navigator.serviceWorker.controller) {
    return;
  }
  waitingWorker = worker;
  updateAvailable.classList.remove('hidden');
}

/**
 * Offers the update once a new deploy's service worker has saved its files.
 *
 * @param {ServiceWorker} worker The new deploy's service worker, which is installing.
 */
function offerUpdateOnceInstalled(worker) {
  worker.addEventListener('statechange', () => {
    if (worker.state === 'installed') {
      offerUpdate(worker);
    }
  });
}

updateReloadButton.addEventListener('click', () => {
  updateReloadButton.disabled = true;
  waitingWorker?.postMessage({ type: 'SKIP_WAITING' });
});

// Save the app's files so it opens and works without signal after the first visit.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('sw.js')
    .then((registration) => {
      if (registration.waiting) {
        offerUpdate(registration.waiting);
      }
      // The browser may have started installing it before the page asked.
      if (registration.installing) {
        offerUpdateOnceInstalled(registration.installing);
      }
      registration.addEventListener('updatefound', () => {
        if (registration.installing) {
          offerUpdateOnceInstalled(registration.installing);
        }
      });
    })
    .catch(() => {
      // The app still works online without it.
    });
  // Once a new deploy's service worker has taken over, reload every tab
  // that loaded an older deploy, not just the one where Reload was tapped,
  // so an old tab can't save its state over the new deploy's. A page that
  // wasn't controlled loaded its files from the network, so it's up to date.
  const wasControlled = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (wasControlled) {
      window.location.reload();
    }
  });
}

// Saved state from a newer version can't be read, and isn't saved over.
document.getElementById('out-of-date').classList.toggle('hidden', !isOutOfDate());
fillForm();
showConnection();
showCountdown();
showSettingsSummary();
buildRows();
showView(state.view);
showPlan();
openSharedSetup().then(prepareShare);
