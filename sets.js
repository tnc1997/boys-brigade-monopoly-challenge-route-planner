/**
 * One of the Monopoly board's colour sets.
 *
 * @typedef {object} ColourSet
 * @property {SetId} id How a row saves it.
 * @property {string} name Its name, like "Light blue".
 * @property {number} size How many properties it has on the board.
 * @property {string} colour Its colour, as a hex colour.
 * @property {string} className The Tailwind class that fills an element with its colour. Written out in full, so Tailwind finds it.
 */

/**
 * How a row saves its set.
 *
 * @typedef {'brown' | 'lightBlue' | 'pink' | 'orange' | 'red' | 'yellow' | 'green' | 'darkBlue'} SetId
 */

/**
 * The Monopoly board's eight colour sets, in board order, with the classic
 * UK board's colours. Hasbro doesn't publish official values, so these are
 * common ones. Stations and utilities aren't sets here.
 *
 * @type {readonly ColourSet[]}
 */
export const SETS = Object.freeze([
  { id: 'brown', name: 'Brown', size: 2, colour: '#955436', className: 'bg-[#955436]' },
  { id: 'lightBlue', name: 'Light blue', size: 3, colour: '#AAE0FA', className: 'bg-[#AAE0FA]' },
  { id: 'pink', name: 'Pink', size: 3, colour: '#D93A96', className: 'bg-[#D93A96]' },
  { id: 'orange', name: 'Orange', size: 3, colour: '#F7941D', className: 'bg-[#F7941D]' },
  { id: 'red', name: 'Red', size: 3, colour: '#ED1B24', className: 'bg-[#ED1B24]' },
  { id: 'yellow', name: 'Yellow', size: 3, colour: '#FEF200', className: 'bg-[#FEF200]' },
  { id: 'green', name: 'Green', size: 3, colour: '#1FB25A', className: 'bg-[#1FB25A]' },
  { id: 'darkBlue', name: 'Dark blue', size: 2, colour: '#0072BB', className: 'bg-[#0072BB]' },
]);

/**
 * Whether a value is one of the sets' ids.
 *
 * @param {unknown} value The value.
 * @returns {value is SetId} Whether it is.
 */
export function isSetId(value) {
  return SETS.some(({ id }) => id === value);
}

/**
 * Finds a set by its id.
 *
 * @param {string | undefined} id The set's id, or `undefined` for none.
 * @returns {ColourSet | null} The set, or `null` if there isn't one with that id.
 * @example
 * setOf('red')?.name; // 'Red'
 */
export function setOf(id) {
  return SETS.find((set) => set.id === id) ?? null;
}

/**
 * Whether a set has as many locations as it has on the board, which it
 * needs to earn its bonus.
 *
 * @param {{ set: ColourSet, ids: string[] }} members The set and its rows' ids, from {@link setMembers}.
 * @returns {boolean} Whether it can be completed.
 */
const isCompletable = ({ set, ids }) => ids.length === set.size;

/**
 * Lists the sets that can be completed: those with as many locations as
 * they have on the board.
 *
 * @param {Pick<import('./locations.js').SetupLocation, 'id' | 'set'>[]} setupLocations The rows.
 * @returns {{ set: ColourSet, ids: string[] }[]} Each set that can be completed, and its rows' ids in list order.
 */
export function completableSets(setupLocations) {
  return setMembers(setupLocations).filter(isCompletable);
}

/**
 * A set with more or fewer locations than it has on the board, which can't
 * earn its bonus.
 *
 * @typedef {object} MismatchedSet
 * @property {ColourSet} set The set.
 * @property {number} count How many locations are in it.
 */

/**
 * Groups the rows of the location list by their set, in board order,
 * leaving out sets with no rows.
 *
 * @param {Pick<import('./locations.js').SetupLocation, 'id' | 'set'>[]} setupLocations The rows.
 * @returns {{ set: ColourSet, ids: string[] }[]} Each set with rows, and its rows' ids in list order.
 */
export function setMembers(setupLocations) {
  return SETS.map((set) => ({ set, ids: setupLocations.filter((setupLocation) => setupLocation.set === set.id).map(({ id }) => id) })).filter(({ ids }) => ids.length > 0);
}

/**
 * Lists the sets with more or fewer locations than they have on the board,
 * which can't earn their bonus.
 *
 * @param {Pick<import('./locations.js').SetupLocation, 'id' | 'set'>[]} setupLocations The rows.
 * @returns {MismatchedSet[]} The sets, in board order.
 * @example
 * mismatchedSets([{ id: 'a', set: 'brown' }]); // [{ set: SETS[0], count: 1 }]
 */
export function mismatchedSets(setupLocations) {
  return setMembers(setupLocations)
    .filter((members) => !isCompletable(members))
    .map(({ set, ids }) => ({ set, count: ids.length }));
}

/**
 * Says that a set has the wrong number of locations, so it can't earn its
 * bonus.
 *
 * @param {MismatchedSet} mismatched The set and how many locations are in it.
 * @returns {string} The note, like "Brown has 1 of 2 properties. Check the colours if you expected a set bonus."
 */
export function mismatchedSetText({ set, count }) {
  return `${set.name} has ${count} of ${set.size} properties. Check the colours if you expected a set bonus.`;
}

/**
 * A set with as many locations as it has on the board, but with locations
 * still to visit that couldn't be found, so it can't earn its bonus.
 *
 * @typedef {object} UnfoundSet
 * @property {ColourSet} set The set.
 * @property {string[]} labels What the locations that couldn't be found are called, in list order.
 */

/**
 * Lists names as English does, like "A", "A and B" or "A, B and C".
 *
 * @param {string[]} names The names.
 * @returns {string} The list.
 */
const listed = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/**
 * Says that a set can't be completed because some of its locations
 * couldn't be found, so it can't earn its bonus.
 *
 * @param {UnfoundSet} unfound The set and the locations that couldn't be found.
 * @returns {string} The note, like "Red set can't be completed, as Bow Street wasn't found. Pin it on the map to count the set bonus."
 */
export function unfoundSetText({ set, labels }) {
  const isOne = labels.length === 1;
  return `${set.name} set can't be completed, as ${listed(labels)} ${isOne ? "wasn't" : "weren't"} found. Pin ${isOne ? 'it' : 'them'} on the map to count the set bonus.`;
}

/**
 * Works out the set bonuses that visiting some locations earns: Points per
 * set for each set that's completed once they've been visited, along with
 * those already visited, and that they're part of. A set that's already
 * complete without them earned its bonus before, so isn't counted, and a
 * set with more or fewer locations than it has on the board can't be
 * completed.
 *
 * @param {string[]} keys The keys of the locations to visit.
 * @param {Pick<import('./locations.js').SetupLocation, 'id' | 'set' | 'isVisited'>[]} setupLocations The rows.
 * @param {number} pointsPerSet What completing a set is worth.
 * @returns {number} The bonuses, in points.
 * @example
 * setBonus(['b'], [{ id: 'a', set: 'brown', isVisited: true }, { id: 'b', set: 'brown' }], 10); // 10
 */
export function setBonus(keys, setupLocations, pointsPerSet) {
  const visiting = new Set(keys);
  const visited = new Set(setupLocations.filter(({ isVisited }) => isVisited).map(({ id }) => id));
  return completableSets(setupLocations)
    .filter(({ ids }) => ids.some((id) => visiting.has(id) && !visited.has(id)) && ids.every((id) => visiting.has(id) || visited.has(id)))
    .reduce((total) => total + pointsPerSet, 0);
}
