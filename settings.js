/**
 * A walking speed preset.
 *
 * @typedef {object} SpeedPreset
 * @property {string} name The preset's name.
 * @property {number} speedKmh Its walking speed in km/h.
 */

/** Walking speed presets for the settings panel, from slowest to fastest. */
export const SPEED_PRESETS = [
  { name: 'Slow', speedKmh: 3.5 },
  { name: 'Medium', speedKmh: 4.5 },
  { name: 'Fast', speedKmh: 5.5 },
];

/** The range of the walking speed slider, in km/h. */
export const SPEED_RANGE = { min: 2, max: 7, step: 0.1 };

/**
 * Finds the preset a walking speed matches, if any.
 *
 * @param {number} speedKmh The walking speed in km/h.
 * @returns {SpeedPreset | null} The matching preset, or `null` if the speed is between presets.
 * @example
 * speedPreset(4.5); // { name: 'Medium', speedKmh: 4.5 }
 * speedPreset(4.2); // null
 */
export function speedPreset(speedKmh) {
  return SPEED_PRESETS.find((preset) => Math.abs(preset.speedKmh - speedKmh) < 0.05) ?? null;
}

/**
 * Summarises the settings the plan assumes, so the whole team can see them.
 *
 * @param {Pick<import('./storage.js').Settings, 'speedKmh' | 'dwellSeconds'>} settings The settings.
 * @returns {string} A summary like `Medium 4.5 km/h · 3 min/selfie`.
 * @example
 * settingsSummary({ speedKmh: 3.5, dwellSeconds: 300 }); // 'Slow 3.5 km/h · 5 min/selfie'
 * settingsSummary({ speedKmh: 4.2, dwellSeconds: 90 }); // '4.2 km/h · 1.5 min/selfie'
 */
export function settingsSummary({ speedKmh, dwellSeconds }) {
  const speed = Number.isFinite(speedKmh) ? `${speedKmh.toFixed(1)} km/h` : 'speed not set';
  const preset = speedPreset(speedKmh);
  const minutes = dwellSeconds / 60;
  const selfie = Number.isFinite(minutes) ? `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)} min/selfie` : 'selfie time not set';
  return `${preset ? `${preset.name} ` : ''}${speed} · ${selfie}`;
}

/**
 * The default selfie time. It's longer when there's a check-in form, to
 * allow for uploading the selfie to it.
 *
 * @param {boolean} hasCheckInForm Whether a check-in form URL is set.
 * @returns {number} The selfie time in seconds.
 */
export function defaultDwellSeconds(hasCheckInForm) {
  return hasCheckInForm ? 300 : 180;
}

/**
 * Changes the selfie time to the new default when the check-in form URL is
 * set or cleared, unless it's been changed from the old default.
 *
 * @param {number} dwellSeconds The selfie time in seconds.
 * @param {boolean} hadCheckInForm Whether a check-in form URL was set.
 * @param {boolean} hasCheckInForm Whether a check-in form URL is set now.
 * @returns {number} The selfie time to use, in seconds.
 * @example
 * dwellSecondsForCheckInForm(180, false, true); // 300
 * dwellSecondsForCheckInForm(240, false, true); // 240
 */
export function dwellSecondsForCheckInForm(dwellSeconds, hadCheckInForm, hasCheckInForm) {
  return dwellSeconds === defaultDwellSeconds(hadCheckInForm) ? defaultDwellSeconds(hasCheckInForm) : dwellSeconds;
}

/**
 * Reads a check-in form URL as typed in the settings panel. Only http and
 * https links are accepted, since the form is opened in a new tab and other
 * schemes (such as `javascript:`) could run code or fail to open.
 *
 * @param {string} text The URL as typed.
 * @returns {string | null} The URL, an empty string if none was given, or `null` if it isn't an http or https URL.
 * @example
 * checkInFormUrl(' https://forms.example.com/check-in '); // 'https://forms.example.com/check-in'
 * checkInFormUrl(''); // ''
 * checkInFormUrl('javascript:alert(1)'); // null
 */
export function checkInFormUrl(text) {
  const trimmed = text.trim();
  if (trimmed === '') {
    return '';
  }
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
}
