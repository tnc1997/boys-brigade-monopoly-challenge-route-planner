import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { BRISTOL_VIEWBOX, REQUEST_INTERVAL_MS, SEARCH_URL, createSearchQueue, searchKey, searchPlace } from '../search.js';

/** A fake fetch that returns the given JSON (or throws), and records the URLs it was called with. */
const fakeFetch = (respond) => {
  const urls = [];
  const fetch = async (url) => {
    urls.push(new URL(url));
    const { status = 200, body = [], error } = respond(new URL(url));
    if (error) {
      throw error;
    }
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { fetch, urls };
};

const queenSquare = { lat: '51.4504', lon: '-2.5947', display_name: 'Queen Square, City Centre, Bristol, England' };

describe('searchKey', () => {
  test('normalises spacing and case', () => {
    assert.equal(searchKey('  Queen   Square, BRISTOL '), 'queen square, bristol');
  });
});

describe('searchPlace', () => {
  test('searches Nominatim in the Bristol area', async () => {
    const { fetch, urls } = fakeFetch(() => ({ body: [queenSquare] }));
    await searchPlace('Queen Square, Bristol', { fetch });
    const [url] = urls;
    assert.equal(url.origin + url.pathname, SEARCH_URL);
    assert.equal(url.searchParams.get('q'), 'Queen Square, Bristol');
    assert.equal(url.searchParams.get('format'), 'jsonv2');
    assert.equal(url.searchParams.get('limit'), '1');
    assert.equal(url.searchParams.get('viewbox'), BRISTOL_VIEWBOX);
    assert.equal(url.searchParams.get('bounded'), '1');
  });

  test('returns the best match', async () => {
    const { fetch } = fakeFetch(() => ({ body: [queenSquare] }));
    assert.deepEqual(await searchPlace('Queen Square', { fetch }), {
      isFound: true,
      lat: 51.4504,
      lng: -2.5947,
      name: 'Queen Square, City Centre, Bristol, England',
    });
  });

  test('says when nothing is found, and that the result can be saved', async () => {
    const { fetch } = fakeFetch(() => ({ body: [] }));
    const result = await searchPlace('Nowhere Street', { fetch });
    assert.equal(result.isFound, false);
    assert.equal(result.isTemporary, false);
    assert.match(result.error, /No match for "Nowhere Street" in Bristol/);
  });

  test('says when offline, and that the result should not be saved', async () => {
    const { fetch } = fakeFetch(() => ({ error: new TypeError('Failed to fetch') }));
    const result = await searchPlace('Queen Square', { fetch });
    assert.equal(result.isFound, false);
    assert.equal(result.isTemporary, true);
    assert.match(result.error, /no signal/);
  });

  test('says when the search is busy, and that the result should not be saved', async () => {
    const { fetch } = fakeFetch(() => ({ status: 429 }));
    const result = await searchPlace('Queen Square', { fetch });
    assert.equal(result.isTemporary, true);
    assert.match(result.error, /busy \(error 429\)/);
  });

  test('treats an unexpected response as nothing found', async () => {
    const { fetch } = fakeFetch(() => ({ body: { error: 'nope' } }));
    assert.equal((await searchPlace('Queen Square', { fetch })).isFound, false);
  });
});

describe('createSearchQueue', () => {
  /** A clock that only moves when the queue sleeps, or when moved by hand. */
  const fakeClock = () => {
    const clock = { time: 0, waits: [] };
    clock.now = () => clock.time;
    clock.sleep = async (ms) => {
      clock.waits.push(ms);
      clock.time += ms;
    };
    return clock;
  };

  test('sends searches one at a time, at least the interval apart', async () => {
    const { fetch, urls } = fakeFetch(() => ({ body: [queenSquare] }));
    const clock = fakeClock();
    const queue = createSearchQueue({ fetch, now: clock.now, sleep: clock.sleep });
    const results = await Promise.all([queue.search('Queen Square'), queue.search('Temple Meads'), queue.search('Cabot Tower')]);
    assert.deepEqual(urls.map((url) => url.searchParams.get('q')), ['Queen Square', 'Temple Meads', 'Cabot Tower']);
    assert.deepEqual(clock.waits, [REQUEST_INTERVAL_MS, REQUEST_INTERVAL_MS]);
    assert.ok(REQUEST_INTERVAL_MS >= 1500, "leaves a generous buffer over Nominatim's 1 request per second");
    assert.ok(results.every((result) => result.isFound));
  });

  test('only waits for what is left of the interval since the last request', async () => {
    const { fetch } = fakeFetch(() => ({ body: [queenSquare] }));
    const clock = fakeClock();
    const queue = createSearchQueue({ fetch, now: clock.now, sleep: clock.sleep });
    await queue.search('Queen Square');
    clock.time += 1000;
    await queue.search('Temple Meads');
    clock.time += REQUEST_INTERVAL_MS;
    await queue.search('Cabot Tower');
    assert.deepEqual(clock.waits, [REQUEST_INTERVAL_MS - 1000]);
  });

  test('keeps going after a search fails', async () => {
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      if (calls === 1) {
        throw new TypeError('Failed to fetch');
      }
      return { ok: true, status: 200, json: async () => [queenSquare] };
    };
    const clock = fakeClock();
    const queue = createSearchQueue({ fetch, now: clock.now, sleep: clock.sleep });
    const [failed, found] = await Promise.all([queue.search('Queen Square'), queue.search('Temple Meads')]);
    assert.equal(failed.isTemporary, true);
    assert.equal(found.isFound, true);
  });
});
