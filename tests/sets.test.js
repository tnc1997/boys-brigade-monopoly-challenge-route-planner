import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { SETS, completableSets, isSetId, mismatchedSetText, mismatchedSets, setBonus, setOf } from '../sets.js';

describe('SETS', () => {
  test("has the board's eight colour sets, with two brown and dark blue properties and three of each other colour", () => {
    assert.deepEqual(
      SETS.map(({ id, size }) => [id, size]),
      [
        ['brown', 2],
        ['lightBlue', 3],
        ['pink', 3],
        ['orange', 3],
        ['red', 3],
        ['yellow', 3],
        ['green', 3],
        ['darkBlue', 2],
      ],
    );
  });

  test('fills each with its own colour', () => {
    for (const { colour, className } of SETS) {
      assert.equal(className, `bg-[${colour}]`);
    }
  });
});

describe('isSetId and setOf', () => {
  test('accept only the sets’ ids', () => {
    assert.equal(isSetId('darkBlue'), true);
    assert.equal(setOf('red').name, 'Red');
    for (const value of ['Red', 'stations', '', undefined, null, 1]) {
      assert.equal(isSetId(value), false, String(value));
    }
    assert.equal(setOf(undefined), null);
  });
});

describe('completableSets', () => {
  test('lists only sets with as many locations as they have on the board, in board order', () => {
    const setupLocations = [
      { id: 'a', set: 'red' },
      { id: 'b', set: 'darkBlue' },
      { id: 'c', set: 'brown' },
      { id: 'd', set: 'darkBlue' },
    ];
    assert.deepEqual(
      completableSets(setupLocations).map(({ set, ids }) => [set.id, ids]),
      [['darkBlue', ['b', 'd']]],
    );
  });
});

describe('mismatchedSets', () => {
  test('lists sets with more or fewer locations than they have on the board, in board order', () => {
    const setupLocations = [
      { id: 'a', set: 'red' },
      { id: 'b', set: 'brown' },
      { id: 'c', set: 'darkBlue' },
      { id: 'd', set: 'darkBlue' },
      { id: 'e' },
    ];
    assert.deepEqual(
      mismatchedSets(setupLocations).map(({ set, count }) => [set.id, count]),
      [
        ['brown', 1],
        ['red', 1],
      ],
    );
  });

  test('says what to check', () => {
    assert.equal(mismatchedSetText({ set: setOf('brown'), count: 1 }), 'Brown has 1 of 2 properties. Check the colours if you expected a set bonus.');
  });
});

describe('setBonus', () => {
  const setupLocations = [
    { id: 'a', set: 'brown', isVisited: true },
    { id: 'b', set: 'brown' },
    { id: 'c', set: 'darkBlue' },
    { id: 'd', set: 'darkBlue' },
    { id: 'e', set: 'red' },
  ];

  test('counts each set completed by the locations, along with those already visited', () => {
    assert.equal(setBonus(['b'], setupLocations, 10), 10);
    assert.equal(setBonus(['b', 'c', 'd'], setupLocations, 10), 20);
    assert.equal(setBonus(['c'], setupLocations, 10), 0);
  });

  test("doesn't count a set completed before, or one with the wrong number of locations", () => {
    const visited = setupLocations.map((setupLocation) => ({ ...setupLocation, isVisited: true }));
    assert.equal(setBonus([], visited, 10), 0);
    assert.equal(setBonus(['e'], setupLocations, 10), 0);
  });
});
