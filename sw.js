/*
 * Service worker that keeps the app working without signal.
 *
 * Each deploy stamps its version into this file, so every deploy installs a
 * new service worker, which saves a complete set of the app's files from that
 * deploy. The app's files are always served from that set, never one at a
 * time from the network, so a page load can't mix files from different
 * deploys, whatever the signal. A new set is only used once the new service
 * worker takes over: when the team taps Reload in the update prompt, or when
 * every tab of the app has been closed. Leaflet is saved when the service
 * worker installs or activates, or else the first time the page loads it.
 * It's versioned, so the saved copy is used first.
 *
 * Map tiles and address searches are left alone. OpenStreetMap's tile usage
 * policy doesn't allow saving tiles for offline use, so they're only cached
 * by the browser as usual: https://operations.osmfoundation.org/policies/tiles/
 */

/**
 * The deploy this service worker belongs to. The Deploy workflow replaces
 * it with the commit being deployed. Unstamped, as when running locally with
 * `npm start`, the app's files come from the network, so edits show straight away.
 */
const DEPLOY_VERSION = 'local';

/**
 * The start of this app's cache names. Other sites on tnc1997.github.io
 * share the same storage, so only caches with this prefix (or a legacy one)
 * are ever read or deleted.
 */
const CACHE_PREFIX = 'monopoly-challenge-route-planner-';

/**
 * Cache name prefixes used by earlier versions of this app. Their caches
 * count as this app's, so Leaflet can be reused from them and they're
 * deleted when the service worker activates.
 */
const LEGACY_CACHE_PREFIXES = ['monopoly-challenge-planner-'];

/**
 * The cache of the last service worker that fetched the app's files from the
 * network first. Pages it controls have no update prompt, so a new service
 * worker takes over from it straight away.
 */
const NETWORK_FIRST_CACHE_NAME = `${CACHE_PREFIX}v2`;

/** Each deploy saves its files in a cache of its own. */
const CACHE_NAME = `${CACHE_PREFIX}${DEPLOY_VERSION}`;

/** The app's own files, relative to this script. Every top-level module must be listed. */
const APP_FILES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'locations.js',
  'map.js',
  'planner.js',
  'route.js',
  'search.js',
  'settings.js',
  'setup.js',
  'storage.js',
];

/** Versioned files from cdnjs, which never change once published. */
const LIBRARY_FILES = [
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js',
];

/** The app's files as absolute URLs without query strings, which are the keys they're saved under. */
const APP_FILE_URLS = new Set(APP_FILES.map((file) => new URL(file, self.location.href).href));

/**
 * Finds a saved copy of a file in this app's current cache only, never in
 * other sites' caches, which share the same storage.
 *
 * @param {string} key The URL it's saved under.
 * @returns {Promise<Response | undefined>} The saved copy, if there is one.
 */
async function matchSaved(key) {
  // Matching by cacheName doesn't create the cache, unlike caches.open.
  return caches.match(key, { cacheName: CACHE_NAME });
}

/**
 * Lists this app's caches, including ones named by earlier versions. Other
 * sites on tnc1997.github.io share the same storage, so only caches with
 * this app's prefixes are ever read or deleted.
 *
 * @returns {Promise<string[]>} The names of this app's caches.
 */
async function appCacheNames() {
  const prefixes = [CACHE_PREFIX, ...LEGACY_CACHE_PREFIXES];
  return (await caches.keys()).filter((name) => prefixes.some((prefix) => name.startsWith(prefix)));
}

/**
 * Saves a successful response in the cache. Failed responses aren't saved.
 *
 * @param {string} key The URL to save it under.
 * @param {Response} response The response, which is used up, so pass a clone if it's needed elsewhere.
 * @returns {Promise<void>} Resolves once it's saved, or straight away if it isn't.
 */
async function saveResponse(key, response) {
  if (response.ok) {
    await (await caches.open(CACHE_NAME)).put(key, response);
  }
}

/**
 * Makes sure a library file is saved in the current cache. It reuses a
 * copy from this app's other caches, such as the one from before a deploy,
 * and only downloads it if there isn't one. A failure doesn't throw, so the app's own
 * files can still be saved; it's tried again later.
 *
 * @param {string} url The library file's URL.
 * @returns {Promise<void>} Resolves once it's saved, or once saving it has failed.
 */
async function saveLibraryFile(url) {
  try {
    if (await matchSaved(url)) {
      return;
    }
    const others = (await appCacheNames()).filter((name) => name !== CACHE_NAME);
    const copies = await Promise.all(others.map((cacheName) => caches.match(url, { cacheName })));
    const existing = copies.find((copy) => copy?.ok);
    // Leaflet is loaded with crossorigin="anonymous", so save it with a matching CORS request.
    await saveResponse(url, existing ?? (await fetch(url, { mode: 'cors' })));
  } catch {
    // Tried again when the service worker activates, and when the page loads it.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // All or nothing, bypassing the browser's HTTP cache, so the whole set
      // comes from this deploy.
      await cache.addAll(APP_FILES.map((file) => new Request(file, { cache: 'reload' })));
      await Promise.all(LIBRARY_FILES.map(saveLibraryFile));
      // Otherwise this waits for the page to ask, so the page that's open
      // keeps the set it loaded.
      if (await caches.has(NETWORK_FIRST_CACHE_NAME)) {
        await self.skipWaiting();
      }
    })(),
  );
});

// The update prompt's Reload button asks the waiting service worker to take over.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Try any library file that couldn't be saved at install, before the
      // old caches (which may still have a copy) are deleted.
      await Promise.all(LIBRARY_FILES.map(saveLibraryFile));
      const names = await appCacheNames();
      await Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }
  const url = new URL(request.url);

  if (LIBRARY_FILES.includes(url.href)) {
    // Use the saved copy, or load it and save a copy if it wasn't saved yet.
    event.respondWith(
      matchSaved(url.href).then(
        (saved) =>
          saved ??
          fetch(request).then((loaded) => {
            event.waitUntil(saveResponse(url.href, loaded.clone()).catch(() => {}));
            return loaded;
          }),
      ),
    );
    return;
  }

  // Only the app's own files are handled; tiles, searches and anything else
  // go to the network as usual. Unstamped, the app's files do too.
  const key = `${url.origin}${url.pathname}`;
  if (!APP_FILE_URLS.has(key) || DEPLOY_VERSION === 'local') {
    return;
  }
  // Serve the saved set, which install saved as a whole. The network is
  // only used if the browser has cleared the saved set; refreshing a single
  // file would mix deploys.
  event.respondWith(
    matchSaved(key)
      .catch(() => undefined)
      .then((saved) => saved ?? fetch(request)),
  );
});
