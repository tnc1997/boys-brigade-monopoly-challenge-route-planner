import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const sw = readFileSync(new URL('sw.js', root), 'utf8');
const index = readFileSync(new URL('index.html', root), 'utf8');

/** Reads a list of strings, like `const NAME = ['a', 'b'];`, from the service worker. */
const listIn = (name) => {
  const match = sw.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`));
  assert.ok(match, `${name} not found in sw.js`);
  return [...match[1].matchAll(/'([^']+)'/g)].map(([, value]) => value);
};

describe('service worker', () => {
  test('saves every top-level module, except itself', () => {
    const modules = readdirSync(root).filter((file) => file.endsWith('.js') && file !== 'sw.js');
    const appFiles = listIn('APP_FILES');
    for (const module of modules) {
      assert.ok(appFiles.includes(module), `${module} is missing from APP_FILES in sw.js`);
    }
  });

  test('saves the page and the styles', () => {
    const appFiles = listIn('APP_FILES');
    for (const file of ['./', 'index.html', 'styles.css']) {
      assert.ok(appFiles.includes(file), `${file} is missing from APP_FILES in sw.js`);
    }
  });

  test('saves the same library versions the page loads', () => {
    const loaded = [...index.matchAll(/(?:href|src)="(https:\/\/cdnjs\.cloudflare\.com\/[^"]+)"/g)].map(([, url]) => url).sort();
    assert.deepEqual(listIn('LIBRARY_FILES').sort(), loaded);
  });

  test("doesn't save map tiles, which the tile usage policy doesn't allow offline", () => {
    assert.doesNotMatch(sw, /tile\.openstreetmap\.org\/\{|cache\.put\([^)]*tile/);
  });
});

describe('service worker saving', () => {
  test('only saves successful responses', () => {
    assert.match(sw, /async function saveResponse\(key, response\) \{\s*if \(response\.ok\)/);
  });

  test("doesn't let a failure to save Leaflet fail the install", () => {
    const saveLibraryFile = sw.slice(sw.indexOf('async function saveLibraryFile'), sw.indexOf("self.addEventListener('install'"));
    assert.match(saveLibraryFile, /try \{[\s\S]*\} catch \{/);
  });

  test('reuses a saved copy of Leaflet before downloading it, and tries again when activating', () => {
    assert.match(sw, /const existing = copies\.find\(\(copy\) => copy\?\.ok\);/);
    const activate = sw.slice(sw.indexOf("self.addEventListener('activate'"), sw.indexOf("self.addEventListener('fetch'"));
    assert.ok(activate.indexOf('saveLibraryFile') < activate.indexOf('caches.delete'), 'Leaflet is saved before old caches are deleted');
  });

});

describe('service worker caches', () => {
  test("only deletes this app's own old caches, since other sites share the storage", () => {
    assert.match(sw, /const names = await appCacheNames\(\);\s*await Promise\.all\(names\.filter\(\(name\) => name !== CACHE_NAME\)/);
    assert.match(sw, /const CACHE_NAME = `\$\{CACHE_PREFIX\}\$\{DEPLOY_VERSION\}`;/);
  });

  test("only reads this app's caches, without creating them", () => {
    // Every lookup names the cache to search; a bare caches.match would
    // search other sites' caches too.
    const lookups = [...sw.matchAll(/caches\.match\(([^)]*)\)/g)].map(([, args]) => args);
    assert.ok(lookups.length > 0);
    for (const args of lookups) {
      assert.match(args, /\{ cacheName(: CACHE_NAME)? \}/, `caches.match(${args}) doesn't name a cache`);
    }
    assert.match(sw, /const prefixes = \[CACHE_PREFIX, \.\.\.LEGACY_CACHE_PREFIXES\];/);
  });
});

describe('service worker cache names', () => {
  test('uses the new name, and treats caches with the old name as its own', () => {
    assert.match(sw, /const CACHE_PREFIX = 'monopoly-challenge-route-planner-';/);
    assert.match(sw, /const LEGACY_CACHE_PREFIXES = \['monopoly-challenge-planner-'\];/);
  });
});

const ORIGIN = 'https://tnc1997.github.io';
const BASE = `${ORIGIN}/boys-brigade-monopoly-challenge-route-planner/`;
const APP_FILE_URLS = listIn('APP_FILES').map((file) => new URL(file, BASE).href);

/**
 * A fake of the site, serving each file with the deploy it came from, or
 * an error for the paths in `failing`.
 */
const newServer = (deploy) => {
  const server = {
    deploy,
    failing: new Set(),
    requests: [],
    fetch: async (input, init) => {
      const request = new Request(input, init);
      server.requests.push(request);
      const { pathname } = new URL(request.url);
      if (server.failing.has(pathname)) {
        return new Response('', { status: 503 });
      }
      return new Response(`${server.deploy} ${pathname}`);
    },
  };
  return server;
};

/** A fake of the browser's Cache Storage, which every service worker on the site shares. */
const newCacheStorage = () => {
  const stores = new Map();
  const keyOf = (input) => (typeof input === 'string' ? input : input.url);
  const newCache = (entries) => ({
    match: async (input) => entries.get(keyOf(input))?.clone(),
    put: async (input, response) => {
      entries.set(keyOf(input), response);
    },
  });
  return {
    stores,
    open: async (name) => {
      if (!stores.has(name)) {
        stores.set(name, new Map());
      }
      return newCache(stores.get(name));
    },
    has: async (name) => stores.has(name),
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    match: async (input, { cacheName }) => stores.get(cacheName)?.get(keyOf(input))?.clone(),
    /** Adds the files as a whole: if any fails, none are added, like Cache.addAll. */
    addAllWith: (fetch) => async (name, requests) => {
      const responses = await Promise.all(requests.map((request) => fetch(request)));
      if (responses.some((response) => !response.ok)) {
        throw new TypeError('addAll failed');
      }
      const entries = stores.get(name);
      requests.forEach((request, index) => entries.set(request.url, responses[index]));
    },
  };
};

/** Runs sw.js, stamped with a deploy version, against the fake site and cache storage. */
const newWorker = ({ server, cacheStorage, version = server.deploy }) => {
  const listeners = {};
  const worker = { skippedWaiting: false };
  const fetch = (input, init) => server.fetch(input, init);
  const caches = {
    ...cacheStorage,
    open: async (name) => {
      const cache = await cacheStorage.open(name);
      return { ...cache, addAll: (requests) => cacheStorage.addAllWith(fetch)(name, requests) };
    },
  };
  const self = {
    location: { href: new URL('sw.js', BASE).href },
    addEventListener: (type, listener) => {
      listeners[type] = listener;
    },
    skipWaiting: async () => {
      worker.skippedWaiting = true;
    },
    clients: { claim: async () => {} },
  };
  const source = version === 'local' ? sw : sw.replace("const DEPLOY_VERSION = 'local';", `const DEPLOY_VERSION = '${version}';`);
  // In a service worker, relative URLs are resolved against the script's.
  const WorkerRequest = class extends Request {
    constructor(input, init) {
      super(typeof input === 'string' ? new URL(input, self.location.href) : input, init);
    }
  };
  vm.runInNewContext(source, { self, caches, fetch, Request: WorkerRequest, Response, URL });

  /** Dispatches a lifecycle event, resolving once everything it waits on has finished. */
  const lifecycle = async (type, data) => {
    const pending = [];
    listeners[type]({ data, waitUntil: (promise) => pending.push(promise) });
    await Promise.all(pending);
  };
  worker.install = () => lifecycle('install');
  worker.activate = () => lifecycle('activate');
  worker.message = (data) => lifecycle('message', data);
  /** Requests a URL through the worker, resolving with the text served, or `null` if the worker left it to the network. */
  worker.load = async (url) => {
    let response = null;
    listeners.fetch({ request: new Request(url), respondWith: (promise) => (response = promise), waitUntil: () => {} });
    return response && (await response).text();
  };
  return worker;
};

/** Loads every one of the app's files, as a page load does. */
const loadPage = (worker) => Promise.all(APP_FILE_URLS.map((url) => worker.load(url)));

describe('service worker deploys', () => {
  test("serves the app's files from the saved set, not the network", async () => {
    const server = newServer('a');
    const worker = newWorker({ server, cacheStorage: newCacheStorage() });
    await worker.install();
    await worker.activate();
    server.deploy = 'b';
    server.requests.length = 0;
    const files = await loadPage(worker);
    assert.ok(files.every((file) => file.startsWith('a ')), files.join('\n'));
    assert.deepEqual(server.requests, []);
  });

  test("saves the whole set at install, bypassing the browser's HTTP cache", async () => {
    const server = newServer('a');
    const cacheStorage = newCacheStorage();
    await newWorker({ server, cacheStorage }).install();
    const appRequests = server.requests.filter((request) => request.url.startsWith(ORIGIN));
    assert.deepEqual(appRequests.map((request) => request.url).sort(), [...APP_FILE_URLS].sort());
    assert.ok(appRequests.every((request) => request.cache === 'reload'));
  });

  test("doesn't mix deploys when a new deploy's files only partly load", async () => {
    const server = newServer('a');
    const cacheStorage = newCacheStorage();
    const a = newWorker({ server, cacheStorage });
    await a.install();
    await a.activate();
    // Deploy b, but on a weak signal some of its files fail to load.
    server.deploy = 'b';
    server.failing.add(new URL('route.js', BASE).pathname);
    const b = newWorker({ server, cacheStorage });
    await assert.rejects(b.install());
    const files = await loadPage(a);
    assert.ok(files.every((file) => file.startsWith('a ')), files.join('\n'));
  });

  test('installs each deploy into a new cache, deleting the old one only once it takes over', async () => {
    const server = newServer('a');
    const cacheStorage = newCacheStorage();
    const a = newWorker({ server, cacheStorage });
    await a.install();
    await a.activate();
    server.deploy = 'b';
    const b = newWorker({ server, cacheStorage });
    await b.install();
    assert.equal(b.skippedWaiting, false, "the open page keeps deploy a's files until it asks to update");
    assert.ok(cacheStorage.stores.has('monopoly-challenge-route-planner-a'));
    assert.ok((await loadPage(a)).every((file) => file.startsWith('a ')));

    await b.message({ type: 'SKIP_WAITING' });
    assert.equal(b.skippedWaiting, true);
    await b.activate();
    assert.deepEqual([...cacheStorage.stores.keys()], ['monopoly-challenge-route-planner-b']);
    server.deploy = 'c';
    assert.ok((await loadPage(b)).every((file) => file.startsWith('b ')));
  });

  test('takes over straight away from the service worker that fetched from the network first', async () => {
    const server = newServer('a');
    const cacheStorage = newCacheStorage();
    await cacheStorage.open('monopoly-challenge-route-planner-v2');
    const worker = newWorker({ server, cacheStorage });
    await worker.install();
    assert.equal(worker.skippedWaiting, true);
    await worker.activate();
    assert.ok(!cacheStorage.stores.has('monopoly-challenge-route-planner-v2'));
  });

  test('serves the saved file for any query string, and the saved page for the start URL', async () => {
    const server = newServer('a');
    const worker = newWorker({ server, cacheStorage: newCacheStorage() });
    await worker.install();
    server.deploy = 'b';
    assert.equal(await worker.load(`${BASE}app.js?v=1`), `a ${new URL(BASE).pathname}app.js`);
    assert.equal(await worker.load(`${BASE}?source=pwa`), `a ${new URL(BASE).pathname}`);
  });

  test('uses the network if the browser has cleared the saved set', async () => {
    const server = newServer('a');
    const cacheStorage = newCacheStorage();
    const worker = newWorker({ server, cacheStorage });
    await worker.install();
    cacheStorage.stores.clear();
    server.deploy = 'b';
    assert.ok((await loadPage(worker)).every((file) => file.startsWith('b ')));
  });

  test("leaves map tiles and other sites' files to the network", async () => {
    const server = newServer('a');
    const worker = newWorker({ server, cacheStorage: newCacheStorage() });
    await worker.install();
    assert.equal(await worker.load('https://tile.openstreetmap.org/15/16000/10000.png'), null);
    assert.equal(await worker.load(`${ORIGIN}/another-site/app.js`), null);
  });

  test('leaves the app\'s files to the network when unstamped, as with npm start', async () => {
    const server = newServer('a');
    const worker = newWorker({ server, cacheStorage: newCacheStorage(), version: 'local' });
    await worker.install();
    assert.deepEqual(await loadPage(worker), APP_FILE_URLS.map(() => null));
  });
});

describe('service worker deploy version', () => {
  test('is a placeholder the Deploy workflow replaces with the commit', () => {
    assert.match(sw, /^const DEPLOY_VERSION = 'local';$/m);
    const workflow = readFileSync(new URL('.github/workflows/deploy.yml', root), 'utf8');
    assert.match(workflow, /sed -i "s\/\^const DEPLOY_VERSION = 'local';\$\/const DEPLOY_VERSION = '\$\{GITHUB_SHA\}';\/" _site\/sw\.js/);
  });
});
