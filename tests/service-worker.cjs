// Run with: node tests/service-worker.cjs (no dependencies or network access).
// The production worker runs unchanged against an in-memory CacheStorage.
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const scope = 'https://example.test/pasha-music/';
let currentName;
const previousName = 'pasha-music-github-pages-previous-test';
const olderName = 'pasha-music-github-pages-older-test';
const idle = `${scope}music/assets/cat-idle.webp?v=5`;
const playing = `${scope}music/assets/cat-playing.webp?v=6`;
const listeners = {}, stores = new Map(), requests = [];
let delay = 0, offline = false, installed = false, claimed = false;
const key = value => typeof value === 'string' ? value : value.url || value.href;
function cacheFor(name) {
  if (!stores.has(name)) stores.set(name, new Map());
  const store = stores.get(name);
  return {
    match: async request => store.get(key(request))?.clone(),
    put: async (request, response) => store.set(key(request), response),
    add: async request => {
      if (key(request).includes('icon-180')) throw Error('Unavailable optional icon');
      store.set(key(request), new Response('precached'));
    },
  };
}
const context = vm.createContext({URL, Request, Response, Promise, setTimeout, clearTimeout,
  self: {registration: {scope}, location: {origin: 'https://example.test'},
    clients: {claim: async () => { claimed = true; }},
    skipWaiting: async () => { installed = true; },
    addEventListener: (name, handler) => { listeners[name] = handler; }},
  caches: {open: async name => cacheFor(name), keys: async () => [...stores.keys()], delete: async name => stores.delete(name)},
  fetch: async request => {
    requests.push({url: key(request), cache: request.cache});
    if (offline) throw Error('Network unavailable');
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    return new Response(`network:${key(request)}`);
  },
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'), context);
currentName = vm.runInContext('CACHE', context);
function event(request) {
  const pending = [];
  return {request, pending, waitUntil: promise => pending.push(promise)};
}
async function request(url, destination = 'image', options = {}) {
  const input = new Request(url, options);
  Object.defineProperty(input, 'destination', {value: destination});
  const evt = event(input);
  let response;
  evt.respondWith = promise => { response = promise; };
  listeners.fetch(evt);
  const result = response ? await response : null;
  await Promise.all(evt.pending);
  return result;
}
async function run() {
  const install = event(); listeners.install(install); await Promise.all(install.pending);
  assert(installed, 'An unavailable optional icon must not block installation');
  const current = stores.get(currentName);
  assert(current.has(`${scope}music/`), 'Precache the document');
  assert(![...current.keys()].some(url => /cat-(idle|playing)\.webp/.test(url)), 'Do not duplicate initial animation downloads');
  assert(current.has(`${scope}music/assets/cat-poster.webp?v=1`), 'Precache the small fallback frame');

  await cacheFor(olderName).put(idle, new Response('previous-idle'));
  await cacheFor(previousName).put(idle, new Response('failed-download', {status: 503}));
  await cacheFor(previousName).put(`${scope}music/assets/cat-idle.webp?v=4`, new Response('obsolete-version'));
  await cacheFor(previousName).put(playing, new Response('previous-playing'));
  await cacheFor(currentName).put(playing, new Response('current-playing'));
  stores.set('unrelated-app', new Map());
  const activate = event(); listeners.activate(activate); await Promise.all(activate.pending);
  assert(claimed); assert(stores.has('unrelated-app')); assert(!stores.has(previousName)); assert(!stores.has(olderName));
  assert.equal(await (await cacheFor(currentName).match(idle)).text(), 'previous-idle', 'Migrate the unchanged exact animation version');
  assert.equal(await (await cacheFor(currentName).match(playing)).text(), 'current-playing', 'Preserve an already populated new-cache entry');
  assert(!current.has(`${scope}music/assets/cat-idle.webp?v=4`), 'Never migrate another version');
  assert.equal(await (await request(idle)).text(), 'previous-idle');
  assert.equal(requests.length, 0, 'A migrated animation must not need a network request');

  const asset = `${scope}music/app.js?v=future-test`;
  assert.match(await (await request(asset)).text(), /^network:/);
  assert.match(await (await request(asset)).text(), /^network:/);
  assert.equal(requests.filter(value => value.url === asset).length, 1, 'Repeated static assets must use the cache');
  offline = true;
  assert.match(await (await request(asset)).text(), /^network:/);
  assert.equal(await (await request(`${scope}music/`, 'document')).text(), 'precached', 'Open the installed document offline');

  offline = false; delay = 1700;
  const input = new Request(`${scope}music/`);
  Object.defineProperty(input, 'destination', {value: 'document'});
  const navigation = event(input); let response;
  navigation.respondWith = promise => { response = promise; };
  const started = Date.now(); listeners.fetch(navigation);
  assert.equal(await (await response).text(), 'precached');
  assert(Date.now() - started < 1650, 'A slow document request must use the installed copy');
  await Promise.all(navigation.pending);
  assert.match(await (await cacheFor(currentName).match(input)).text(), /^network:/, 'The slow network request must refresh the cache in the background');

  assert.equal(await request('https://other.test/cover.png'), null, 'Keep external requests outside the worker');
  assert.equal(await request(`${scope}private.png`, 'image', {headers: {Authorization: 'Bearer test-only'}}), null, 'Never cache authenticated requests');
  assert.equal(await request(`${scope}fresh.png`, 'image', {cache: 'no-store'}), null, 'Honor explicit no-store');
  assert.equal(await request(`${scope}api/library`), null, 'Never cache API paths');
  assert.equal(await request(`${scope}music/`, 'document', {method: 'POST'}), null, 'Only intercept GET requests');
  console.log('PASS: precache, animation migration, cache reuse, offline and slow navigation, background refresh, API/auth/no-store exclusions');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
