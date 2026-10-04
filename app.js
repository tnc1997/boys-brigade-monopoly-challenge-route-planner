import { countdownText, describeRoute, formatDuration, isAppleDevice, isPlanForToday, mapRoute, markDone, newLocationMarkers, plural, progress, timeWarning, toggleDone } from './route.js';
import { createSearchQueue, searchKey } from './search.js';
import { newLocationId, resolveRecord, resolveRecords, resolveText, usableLocations } from './locations.js';
import { createMap, showPosition, showRoute } from './map.js';
import { SPEED_PRESETS, SPEED_RANGE, checkInFormUrl, dwellSecondsForCheckInForm, settingsSummary, speedPreset } from './settings.js';
import { planFromSetup, replanStartingPoint, searchesNeeded, timeToday } from './setup.js';
import { defaultState, loadState, resetChallenge, saveState } from './storage.js';

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
const countdownDeadline = /** @type {HTMLSpanElement} */ (document.getElementById('countdown-deadline'));

/** The settings panel's other fields, bound to `state.settings` or `state.setup` by their data attributes. */
const panelFields = /** @type {NodeListOf<HTMLInputElement>} */ (settingsDialog.querySelectorAll('[data-panel-setting], [data-panel-setup]'));
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
const PIN_HINT = 'Long-press the map to add a location there.';

/** Where the pin being named was dropped, or `null` if there isn't one. */
let droppedPin = null;

/** The id of the row the line under the map says was just added, or `null` if it shows the hint. */
let addedPinKey = null;

/**
 * The row being pinned on the map with 📍, or `null` if none is. Its `id` is
 * `null` for the empty row at the end of the list, which becomes a row once
 * it's pinned.
 *
 * @type {{ id: string | null } | null}
 */
let pinTarget = null;

/** Sends lookups one at a time, following Nominatim's usage policy. */
const searchQueue = createSearchQueue();

/** Lookups that are queued or being sent, by search key. */
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

/** The setup form's fields, which are bound to `state.setup` or `state.settings` by their data attributes. */
const fields = /** @type {NodeListOf<HTMLInputElement>} */ (form.querySelectorAll('[data-setup], [data-setting]'));

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

/** Fills the setup form from the state. */
function fillForm() {
  for (const field of fields) {
    if (field.dataset.setup) {
      field.value = state.setup[field.dataset.setup];
    } else {
      const value = state.settings[field.dataset.setting];
      field.value = field.dataset.scale ? String(value / Number(field.dataset.scale)) : String(value);
    }
  }
}

/**
 * Saves a field's value to the state.
 *
 * @param {HTMLInputElement} field The field that changed.
 */
function saveField(field) {
  if (field.dataset.setup) {
    state.setup[field.dataset.setup] = field.value;
  } else if (field.dataset.number !== undefined) {
    const value = field.value.trim() === '' ? NaN : Number(field.value);
    state.settings[field.dataset.setting] = field.dataset.scale ? value * Number(field.dataset.scale) : value;
  } else {
    state.settings[field.dataset.setting] = field.value;
  }
  saveState(state);
  // Only settings affect the summary, and only the deadline the countdown.
  if (field.dataset.setting) {
    showSettingsSummary();
  }
  if (field.dataset.setting === 'deadline') {
    showCountdown();
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
 * @param {import('./locations.js').Resolved} resolved Where it is, from the saved search results.
 * @param {object} [options] What can be done about it.
 * @param {boolean} [options.canPin=true] Whether it can be pinned on the map, which rows can but the Start and Finish fields can't.
 * @returns {{ text: string, isError: boolean }} What to show, and whether it's a problem.
 */
function describeResolved(resolved, { canPin = true } = {}) {
  switch (resolved.status) {
    case 'empty':
      return { text: '', isError: false };
    case 'pinned':
      return { text: '📍 Pinned on the map', isError: false };
    case 'coordinates':
      return { text: `Using the coordinates ${resolved.location.lat}, ${resolved.location.lng}`, isError: false };
    case 'found':
      return { text: `Found: ${resolved.location.matchedName}`, isError: false };
    case 'notFound':
      // Coordinates out of range say what's wrong with them.
      return state.searchResults[searchKey(resolved.label)]
        ? { text: canPin ? 'Not found. Check the spelling or pin it on the map with 📍' : 'Not found. Check the spelling, or enter its coordinates.', isError: true }
        : { text: resolved.error, isError: true };
    default: {
      const key = searchKey(resolved.query);
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
 * @param {{ text: string, isError: boolean }} description What to show, from {@link describeResolved}.
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
 * @returns {{ item: HTMLLIElement, record: import('./locations.js').LocationRecord | null } | null} The row's list item and saved row (`null` for the empty row at the end), or `null` if the element isn't in a row.
 */
function rowOf(target) {
  const item = target instanceof Element ? target.closest('#location-rows > li') : null;
  if (!(item instanceof HTMLLIElement)) {
    return null;
  }
  return { item, record: state.locations.find(({ id }) => id === item.dataset.id) ?? null };
}

/**
 * Creates the list item for a row of the location list: its text field, a
 * 📍 button to pin it on the map, a ✕ button to remove it and its status.
 *
 * @param {import('./locations.js').LocationRecord | null} record The row, or `null` for the empty row at the end.
 * @returns {HTMLLIElement} The list item. Its labels and status are filled in by {@link showRows}.
 */
function rowItem(record) {
  const item = element('li', 'flex flex-col gap-1');
  item.dataset.id = record?.id ?? '';
  const line = element('div', 'flex gap-1');
  const field = element(
    'input',
    'min-h-11 min-w-0 flex-1 rounded-md border border-field bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30',
  );
  field.type = 'text';
  field.value = record?.text ?? '';
  field.autocomplete = 'off';
  field.spellcheck = false;
  field.enterKeyHint = 'next';
  const pin = element('button', ROW_BUTTON_CLASSES, '📍');
  pin.type = 'button';
  pin.dataset.action = 'pin';
  const remove = element('button', `${ROW_BUTTON_CLASSES} text-lg`, '✕');
  remove.type = 'button';
  remove.dataset.action = 'remove';
  // The empty row at the end has nothing to remove, but keeps the space so
  // the fields line up.
  remove.classList.toggle('invisible', record === null);
  line.append(field, pin, remove);
  const status = element('p', 'flex flex-wrap items-center gap-x-2 text-xs break-words');
  status.id = `location-status-${Math.random().toString(36).slice(2)}`;
  field.setAttribute('aria-describedby', status.id);
  item.append(line, status);
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
  const record = state.locations.find(({ id }) => id === item.dataset.id) ?? null;
  const [field, pin, remove] = item.querySelectorAll('input, button');
  const status = /** @type {HTMLParagraphElement} */ (item.lastElementChild);
  field.setAttribute('aria-label', `Location ${number}`);
  pin.setAttribute('aria-label', `Pin location ${number} on the map`);
  remove.setAttribute('aria-label', `Remove location ${number}`);
  const resolved = record ? resolveRecord(record, number, state.searchResults) : { status: 'empty' };
  const description = describeResolved(resolved);
  // Only rebuild the status when it changes, so a focused ✕ isn't replaced.
  const shown = `${number} ${resolved.status} ${description.text}`;
  if (status.dataset.shown === shown) {
    return;
  }
  status.dataset.shown = shown;
  showDescription(status, description);
  if (resolved.status === 'pinned') {
    const clear = element('button', 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-base text-accent-ink hover:bg-accent-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-accent', '✕');
    clear.type = 'button';
    clear.dataset.action = 'clear-pin';
    clear.setAttribute('aria-label', `Clear the pin for location ${number} and look it up instead`);
    status.append(clear);
  }
}

/** Shows every row's labels and status, and the Start and Finish fields' statuses, and redraws the map if they've changed it. */
function showRows() {
  [...locationRows.children].forEach((item, index) => showRow(/** @type {HTMLLIElement} */ (item), index + 1));
  showDescription(startStatus, describeResolved(resolveText(state.setup.startText, 'start', state.searchResults), { canPin: false }));
  showDescription(finishStatus, describeResolved(resolveText(state.setup.finishText, 'finish', state.searchResults), { canPin: false }));
  updateMapIfChanged();
}

/** Builds the location list's rows from the state, with an empty row at the end, keeping focus in the same row. */
function buildRows() {
  const focusedId = rowOf(document.activeElement)?.item.dataset.id;
  locationRows.replaceChildren(...state.locations.map(rowItem), rowItem(null));
  if (focusedId !== undefined) {
    locationRows.querySelector(`li[data-id="${CSS.escape(focusedId)}"] input`)?.focus();
  }
  showRows();
}

/** Redraws the map if the locations not in the route yet have changed, or been renamed, so typing doesn't keep rebuilding it or closing an open popup. */
function updateMapIfChanged() {
  const locations = usableLocations(resolveRecords(state.locations, state.searchResults));
  if (newLocationsText(newLocationMarkers(locations, currentPlan())) !== drawnNewLocations) {
    updateMap();
  }
}

/**
 * Looks up an address or place name, unless it's already being looked up.
 * The result is saved unless the lookup failed for a reason that may pass,
 * such as no signal, in which case it's tried again later.
 *
 * @param {string} query The address or place name.
 * @returns {Promise<void>} Resolves once it's been looked up.
 */
function lookUp(query) {
  const key = searchKey(query);
  if (!lookups.has(key)) {
    const lookup = searchQueue.search(query).then((result) => {
      lookups.delete(key);
      if (result.isFound || !result.isTemporary) {
        state.searchResults[key] = result;
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
  showRows();
  return lookups.get(key);
}

/** Looks up anything still to look up whose last lookup failed for a reason that may pass. */
function retryLookups() {
  for (const query of searchesNeeded({ setup: state.setup, locations: state.locations, searchResults: state.searchResults })) {
    if (temporaryFailures.has(searchKey(query))) {
      lookUp(query);
    }
  }
}

/**
 * Looks up a row that's just been finished, if it needs it, and announces
 * the result to screen readers when it's in.
 *
 * @param {import('./locations.js').Resolved} resolved Where the row is, from the saved search results.
 * @param {object} [options] What can be done about it.
 * @param {boolean} [options.canPin=true] Whether it can be pinned on the map, which rows can but the Start and Finish fields can't.
 */
function lookUpFinished(resolved, { canPin = true } = {}) {
  if (resolved.status === 'unknown') {
    announcedLookups.set(searchKey(resolved.query), { label: resolved.label, canPin });
    lookUp(resolved.query);
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
  locationAnnouncement.textContent = `${label}: ${describeResolved(resolveText(label, '', state.searchResults), { canPin }).text}`;
}

/**
 * Unticks a row of the location list whose place has changed, since its
 * selfie was taken somewhere else.
 *
 * @param {import('./locations.js').LocationRecord} record The row.
 */
function untick(record) {
  if (state.doneKeys.includes(record.id)) {
    state.doneKeys = state.doneKeys.filter((key) => key !== record.id);
    saveState(state);
    showPlan();
  }
}

/**
 * Saves a pin for a row of the location list. Pinning the empty row at the
 * end, or a row that's been removed since, adds a new row.
 *
 * @param {string | null} id The row's id, or `null` for a new row.
 * @param {string} text The text for a new row.
 * @param {import('./planner.js').LatLng} latLng Where to pin it.
 * @returns {import('./locations.js').Location} The pinned location.
 */
function pinRow(id, text, { lat, lng }) {
  let record = state.locations.find((candidate) => candidate.id === id);
  if (!record) {
    record = { id: newLocationId(), text, pin: null };
    state.locations.push(record);
  }
  record.pin = { lat, lng };
  saveState(state);
  untick(record);
  buildRows();
  const number = state.locations.indexOf(record) + 1;
  return /** @type {{ location: import('./locations.js').Location }} */ (resolveRecord(record, number, state.searchResults)).location;
}

/**
 * Removes a row of the location list. If focus is in the row, it moves to
 * the row that takes its place.
 *
 * @param {HTMLLIElement} item The row's list item.
 * @param {import('./locations.js').LocationRecord} record The row.
 */
function removeRow(item, record) {
  state.locations = state.locations.filter((candidate) => candidate !== record);
  saveState(state);
  const next = /** @type {HTMLLIElement} */ (item.nextElementSibling);
  const hadFocus = item.contains(document.activeElement);
  item.remove();
  if (hadFocus) {
    next.querySelector('input').focus();
  }
  if (addedPinKey === record.id) {
    showPinStatus(PIN_HINT);
  }
  showRows();
}

locationRows.addEventListener('input', (event) => {
  const row = rowOf(event.target);
  if (!row || !(event.target instanceof HTMLInputElement)) {
    return;
  }
  let { record } = row;
  if (!record) {
    // Typing in the empty row at the end makes it a row, with a new empty row below.
    record = { id: newLocationId(), text: '', pin: null };
    state.locations.push(record);
    row.item.dataset.id = record.id;
    row.item.querySelector('[data-action="remove"]').classList.remove('invisible');
    locationRows.append(rowItem(null));
    showRow(/** @type {HTMLLIElement} */ (locationRows.lastElementChild), state.locations.length + 1);
  }
  record.text = event.target.value;
  saveState(state);
  showRow(row.item, state.locations.indexOf(record) + 1);
  // Wait for a pause in typing before checking the map, so long lists stay responsive.
  clearTimeout(mapTimer);
  mapTimer = setTimeout(updateMapIfChanged, 250);
});

// A row is looked up once it's finished: when it loses focus with changed
// text. Never while typing, which Nominatim's usage policy forbids.
locationRows.addEventListener('change', (event) => {
  const row = rowOf(event.target);
  if (!row?.record) {
    return;
  }
  const { item, record } = row;
  // A row that's been emptied, without a pin, is removed once it's
  // finished, so blank rows don't build up above the empty one at the end.
  if (record.text.trim() === '' && !record.pin) {
    removeRow(item, record);
    return;
  }
  // Changing an unpinned row's text changes its place, but changing a
  // pinned row's text only renames it.
  if (!record.pin) {
    untick(record);
  }
  lookUpFinished(resolveRecord(record, state.locations.indexOf(record) + 1, state.searchResults));
});

// Enter moves to the next row, rather than submitting the form, which
// finishes the row and looks it up.
locationRows.addEventListener('keydown', (event) => {
  const row = rowOf(event.target);
  if (row && event.target instanceof HTMLInputElement && event.key === 'Enter' && !event.isComposing) {
    event.preventDefault();
    const next = row.item.nextElementSibling?.querySelector('input');
    if (next) {
      next.focus();
    } else {
      event.target.blur();
      event.target.focus();
    }
  }
});

locationRows.addEventListener('click', (event) => {
  const button = event.target instanceof Element ? event.target.closest('button[data-action]') : null;
  const row = rowOf(button);
  if (!(button instanceof HTMLButtonElement) || !row) {
    return;
  }
  const { item, record } = row;
  const number = [...locationRows.children].indexOf(item) + 1;
  if (button.dataset.action === 'pin') {
    startPinning(record?.id ?? null, record?.text.trim() || `Location ${number}`);
  } else if (button.dataset.action === 'remove' && record) {
    removeRow(item, record);
  } else if (button.dataset.action === 'clear-pin' && record) {
    record.pin = null;
    saveState(state);
    item.querySelector('input').focus();
    showRows();
    lookUpFinished(resolveRecord(record, number, state.searchResults));
  }
});

// The Start and Finish fields are looked up once they're finished, too.
for (const field of [startField, finishField]) {
  field.addEventListener('change', () => lookUpFinished(resolveText(field.value, field.id, state.searchResults), { canPin: false }));
}

/**
 * Lists the locations not in the route yet, with their names, to tell
 * whether the map needs redrawing.
 *
 * @param {import('./map.js').MapMarker[]} markers Their markers, from {@link newLocationMarkers}.
 * @returns {string} Each location's key and marker title, one per line.
 */
function newLocationsText(markers) {
  return markers.map(({ location, title }) => `${location.key} ${title}`).join('\n');
}

/**
 * The current plan, if there is a usable one.
 *
 * @returns {import('./setup.js').SavedPlan | null} The plan, or `null` if there isn't one or it was saved by an older version without settings.
 */
function currentPlan() {
  return state.plan?.settings ? state.plan : null;
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
 * @param {import('./locations.js').Location} location The location.
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
 * @param {import('./locations.js').Location} location The location.
 * @param {boolean} isDone Whether the selfie is done.
 * @returns {HTMLAnchorElement} The link.
 */
function checkInLink(location, isDone) {
  const link = externalLink(state.settings.checkInFormUrl, 'Check in', `Check in at ${location.label}, opens the check-in form and marks the selfie done`);
  link.className = `inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold ${isDone ? 'text-accent-ink ring-1 ring-accent/30 hover:bg-accent-soft' : 'bg-accent text-white hover:bg-accent-strong'}`;
  link.dataset.checkInKey = location.key;
  return link;
}

/**
 * Creates the list item for a stop, or for the walk to the finish.
 *
 * @param {import('./route.js').RouteStop} stop The stop.
 * @param {boolean} isFinish Whether this is the walk to the finish.
 * @returns {HTMLLIElement} The list item.
 */
function stopItem(stop, isFinish) {
  const isDone = !isFinish && state.doneKeys.includes(stop.location.key);
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
  const timing = element(
    'p',
    'text-sm text-muted',
    `${isFinish ? 'Finish · arrive' : 'ETA'} ${timeFormat.format(stop.arrivalTime)} · ${formatDuration(stop.walkSeconds)} walk`,
  );
  const links = element('div', 'mt-1 flex flex-wrap gap-2');
  if (!isFinish) {
    links.append(...(state.settings.checkInFormUrl ? [checkInLink(stop.location, isDone)] : []), doneToggle(stop.location, isDone));
  }
  // Apple Maps on the web may not work on other devices, such as Android.
  const directions = [['Google Maps', stop.googleMapsDirectionsUrl], ...(isAppleDevice(navigator.userAgent) ? [['Apple Maps', stop.appleMapsDirectionsUrl]] : [])];
  links.append(...directions.map(([app, url]) => externalLink(url, app, `Walking directions to ${stop.location.label} in ${app}`)));
  details.append(title, timing, links);
  item.append(badge, details);
  return item;
}

/** Shows the time left until today's deadline in the header. */
function showCountdown() {
  const now = Date.now();
  const deadline = timeToday(state.settings.deadline ?? '', now);
  countdown.textContent = countdownText(deadline, now);
  countdownDeadline.textContent = deadline === null ? '' : `Deadline ${timeFormat.format(deadline)}`;
}

/** Updates everything that depends on the time: the countdown and the time warning. */
function showTime() {
  showCountdown();
  // Redraw the route when the day changes, so an older plan gets its note.
  if (state.plan?.settings && isPlanForToday(state.plan, Date.now()) !== wasPlanForToday) {
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
  const warning = state.plan?.settings ? timeWarning(state.plan, state.doneKeys, Date.now()) : null;
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

/** Shows the current plan as a list of stops, then any skipped and done locations. */
function showPlan() {
  const { plan } = state;
  // Plans saved before walk settings were kept with the plan can't be shown, so they need planning again.
  const hasPlan = Boolean(plan?.settings);
  replan.classList.toggle('hidden', !hasPlan);
  replan.classList.toggle('flex', hasPlan);
  updateMap();
  showTimeWarning();
  if (!hasPlan) {
    stopList.replaceChildren(element('p', 'text-sm text-muted', 'Add your locations above and press Plan route.'));
    return;
  }
  const route = describeRoute(plan);
  const ending = route.finish ? `arriving at the finish at ${timeFormat.format(route.endEta)}` : `with the last selfie at ${timeFormat.format(route.endEta)}`;
  const { done, total } = progress(plan, state.doneKeys);
  // Count only stops still to visit, since a stop on this route may have
  // been ticked off since it was planned.
  const stopsToVisit = route.stops.filter(({ location }) => !state.doneKeys.includes(location.key)).length;
  const remaining = total - done;
  const locations = (count) => (count === 1 ? 'location' : 'locations');
  const visiting = done === 0 ? `${stopsToVisit} of ${total} ${locations(total)}` : `${stopsToVisit} of ${remaining} ${locations(remaining)} still to do`;
  const summary = element('p', 'text-sm', remaining === 0 && total > 0 ? `All ${total} selfies done!` : `Visiting ${visiting}, ${ending}.`);
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
  stops.append(...route.stops.map((stop) => stopItem(stop, false)));
  if (route.finish) {
    stops.append(stopItem(route.finish, true));
  }
  const sections = [summary, counter];
  if (state.settings.checkInFormUrl && remaining > 0) {
    sections.push(
      element('p', 'mt-2 rounded-md bg-accent-soft px-3 py-2 text-sm text-accent-ink ring-1 ring-accent-line', 'Tip: check in straight after each selfie. The first team to upload at a location gets a bonus.'),
    );
  }
  sections.push(stops);

  if (route.skipped.length > 0) {
    const heading = element('h3', 'mt-4 text-sm font-semibold', `Skipped (${route.skipped.length}): not enough time`);
    const skipped = element('ul', 'mt-2 flex flex-col gap-1 text-sm text-muted');
    skipped.append(...route.skipped.map((location) => element('li', '', location.label)));
    sections.push(heading, skipped);
  }

  // Done locations that aren't stops on this route (because it was planned
  // after their selfie) are listed so a mistaken tick can be undone.
  const routeKeys = new Set(route.stops.map(({ location }) => location.key));
  const doneElsewhere = plan.points.filter(({ key }) => state.doneKeys.includes(key) && !routeKeys.has(key));
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
  state.doneKeys = markDone(state.doneKeys, key);
  saveState(state);
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
    state.doneKeys = toggleDone(state.doneKeys, toggle.dataset.doneKey);
    saveState(state);
    showPlan();
    // Re-rendering replaces the button, so move focus to its replacement.
    stopList.querySelector(`[data-done-key="${CSS.escape(toggle.dataset.doneKey)}"]`)?.focus();
  }
});

/** Waits for a pause in typing before checking whether the map needs redrawing. */
let mapTimer;

form.addEventListener('input', (event) => {
  // The location list's rows aren't bound to a setting, and save themselves.
  if (event.target instanceof HTMLInputElement && (event.target.dataset.setup || event.target.dataset.setting)) {
    saveField(event.target);
  }
  if (event.target === startField || event.target === finishField) {
    showRows();
  }
});

/**
 * Shows how planning went under Plan route, or hides the message.
 *
 * @param {string | null} message The message, or `null` to hide it.
 */
function showPlanStatus(message) {
  planStatus.textContent = message ?? '';
  planStatus.classList.toggle('hidden', message === null);
}

/**
 * Describes how planning went, including any rows that were left out
 * because they couldn't be found.
 *
 * @param {import('./setup.js').SetupResult} result The result of planning.
 * @returns {string} The message, like "Planned 22 stops."
 */
function planResultText(result) {
  const stops = `Planned ${plural(result.plan.order.length, 'stop')}.`;
  if (result.leftOut.length === 0) {
    return stops;
  }
  const labels = result.leftOut.map(({ number, resolved }) => ('label' in resolved ? resolved.label : `Location ${number}`));
  return `${stops} Left out because ${result.leftOut.length === 1 ? "it wasn't" : "they weren't"} found: ${labels.join(', ')}.`;
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
 * Looks up anything that still needs it, waiting for lookups already
 * running, then plans the route from the setup form and shows it.
 *
 * @param {import('./planner.js').LatLng | null} from The team's current position to re-plan from, or `null` to start at the Start field.
 * @returns {Promise<string | null>} What stopped planning, or `null` if a plan was made.
 */
async function planRoute(from) {
  planButton.disabled = true;
  replanButton.disabled = true;
  try {
    for (const query of searchesNeeded({ setup: state.setup, locations: state.locations, searchResults: state.searchResults, isFromPosition: from !== null })) {
      lookUp(query);
    }
    while (lookups.size > 0) {
      planButton.textContent = `Waiting for ${plural(lookups.size, 'search', 'searches')}…`;
      await Promise.race(lookups.values());
    }
    planButton.textContent = 'Planning…';
    await nextFrame();
    const result = planFromSetup({
      setup: state.setup,
      locations: state.locations,
      settings: state.settings,
      now: Date.now(),
      doneKeys: state.doneKeys,
      from,
      searchResults: state.searchResults,
    });
    showSetupError(result.error);
    showPlanStatus(result.plan ? planResultText(result) : null);
    if (result.plan) {
      state.plan = result.plan;
      saveState(state);
      shouldFitMap = true;
      showPlan();
      showSettingsSummary();
      showPinStatus(PIN_HINT);
    }
    showRows();
    if (result.plan && from === null) {
      // Move to the route, now it's ready.
      stopsHeading.focus({ preventScroll: true });
      stopsHeading.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    return result.error;
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
    const error = await planRoute(position);
    showReplanStatus(error ?? successMessage(), error !== null);
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
  navigator.geolocation.getCurrentPosition(
    (position) => replanAndReport({ lat: position.coords.latitude, lng: position.coords.longitude }, replannedFromPosition),
    (error) => {
      replanButton.disabled = false;
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
  const plan = currentPlan();
  const route = plan ? mapRoute(plan, state.doneKeys, (time) => timeFormat.format(time)) : { path: [], markers: [] };
  const newMarkers = newLocationMarkers(usableLocations(resolveRecords(state.locations, state.searchResults)), plan);
  route.markers.push(...newMarkers);
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
 */
function startPinning(id, label) {
  showView('map');
  if (!routeMap) {
    // The map couldn't load, and says so under it.
    mapContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  pinTarget = { id };
  pinBannerText.textContent = `Tap where ${label} is.`;
  pinBanner.classList.replace('hidden', 'flex');
  mapContainer.classList.add('is-pinning');
  pinBanner.scrollIntoView({ behavior: 'smooth', block: 'start' });
  pinBannerCancel.focus({ preventScroll: true });
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
  const location = pinRow(pinTarget.id, '', latLng);
  stopPinning();
  const action = state.plan?.settings ? 'Re-plan from here' : 'Plan route';
  showPinStatus(`Pinned ${location.label}. Press ${action} to use the pin in the route.`, location.key);
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
  const action = state.plan?.settings ? 'Re-plan from here' : 'Plan route';
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

document.getElementById('new-challenge').addEventListener('click', () => {
  if (!window.confirm('Start a new challenge? This clears the location list, the selfies ticked off and the route. Your settings are kept.')) {
    return;
  }
  Object.assign(state, resetChallenge(state));
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
  locationRows.querySelector('input').focus();
});

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
  for (const field of panelFields) {
    if (field.dataset.panelSetup) {
      field.value = state.setup[field.dataset.panelSetup];
    } else {
      const value = state.settings[field.dataset.panelSetting];
      field.value = field.dataset.scale ? String(value / Number(field.dataset.scale)) : String(value);
    }
  }
  hadCheckInForm = state.settings.checkInFormUrl !== '';
  isSelfieTimeEdited = false;
  // Check the link as filled in, since setting a value doesn't fire input.
  checkInFormField.dispatchEvent(new Event('input'));
  settingsSave.textContent = state.plan?.settings ? 'Save and re-plan' : 'Save';
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
  const savedCheckInFormUrl = state.settings.checkInFormUrl;
  // The fields are range-checked, and the check-in form URL checked by its
  // input listener, so the dialog only closes with "save" when they're valid.
  for (const field of panelFields) {
    if (field.dataset.panelSetup) {
      state.setup[field.dataset.panelSetup] = field.value;
    } else if (field.type === 'number') {
      state.settings[field.dataset.panelSetting] = Number(field.value) * Number(field.dataset.scale ?? 1);
    } else if (field === checkInFormField) {
      // Keep the saved link rather than clearing it if an invalid one gets through.
      state.settings.checkInFormUrl = checkInFormUrl(field.value) ?? state.settings.checkInFormUrl;
    } else {
      state.settings[field.dataset.panelSetting] = field.value;
    }
  }
  saveState(state);
  fillForm();
  showRows();
  showSettingsSummary();
  showCountdown();
  // Show or hide the Check in buttons now, even if re-planning fails.
  if (state.settings.checkInFormUrl !== savedCheckInFormUrl) {
    showPlan();
  }
  // Re-plan with the new settings, keeping ticks: from the Start field if
  // the team hasn't set off yet, otherwise from their position and now.
  if (state.plan?.settings) {
    const now = Date.now();
    // A plan's times are on the day it was made, so only today's counts.
    const isPlanForToday = new Date(state.plan.deadline).toDateString() === new Date(now).toDateString();
    const startingPoint = replanStartingPoint({
      startTimeText: state.setup.startTimeText,
      deadline: state.settings.deadline,
      doneKeys: state.doneKeys,
      isReplannedFromPositionToday: Boolean(state.plan.isFromPosition) && isPlanForToday,
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

// Save the app's files so it opens and works without signal after the first visit.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    // The app still works online without it.
  });
}

fillForm();
showConnection();
showCountdown();
showSettingsSummary();
buildRows();
showView(state.view);
showPlan();
