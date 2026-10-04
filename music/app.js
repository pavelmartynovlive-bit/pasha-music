const CONNECTION_STORAGE_KEY = "pashaMusicConnectionV1";
const LIBRARY_STORAGE_KEY = "pashaMusicLibraryV2";
const PLAYBACK_DIAGNOSTICS_KEY = "pashaMusicPlaybackDiagnosticsV1";
const SEARCH_RESULT_LIMIT = 20;
const SUGGESTION_DELAY = 280;
const PUBLIC_BACKEND_URL = "https://pasha-music.132-243-23-229.sslip.io";
const LEGACY_BACKEND_URLS = new Set(["https://pasha-vk-music-backend.onrender.com"]);

/**
 * @typedef {{ id: string|null, name: string }} ArtistRef
 * @typedef {{ id: number|string, ownerId: number|string, title: string, artist: ArtistRef, year: number|null, artwork: object, trackCount: number, tracks: object[] }} Album
 * @typedef {{ kind: "track", track: object }|{ kind: "album", album: Album }} MixSource
 * @typedef {{ id: string, title: string, cover: string[], tracks: object[], createdAt: string, type: "manual"|"mix", sourceTrackId?: string, sourceAlbumId?: string }} Playlist
 */

const elementIds = [
  "actionSheetArtist", "actionSheetBackdrop", "actionSheetCloseButton", "actionSheetMixButton", "actionSheetTitle",
  "apiKeyInput", "audio", "backendUrlInput", "catMascot", "clearSearchButton", "closePlayerButton", "closeSetupButton",
  "collectionArtist", "collectionBackButton", "collectionCover", "collectionKind", "collectionKicker", "collectionMeta",
  "collectionMixButton", "collectionPlayButton", "collectionScreen", "collectionShuffleButton", "collectionTitle", "collectionTrackList",
  "coverFallback", "coverImage", "currentTime", "duration", "fullPlayer", "libraryAlbumList", "libraryPlaylistList",
  "libraryHomeView", "librarySwitcher", "mainScreen", "miniCoverFallback", "miniCoverImage", "miniMixButton", "miniNextButton", "miniPlayButton", "miniPlayer",
  "miniProgress", "miniTrackArtist", "miniTrackTitle", "nextButton", "openPlayerButton", "personalLibraryCount", "playButton",
  "playerMixButton", "playerLikeButton", "playerLikeLabel", "playerLibraryStatus", "libraryTracksSection", "previousButton", "searchAlbumGroup", "searchAlbumList", "searchForm", "searchInput", "searchFocusPreview",
  "searchResultList", "searchResults", "searchSuggestions", "searchTrackGroup", "sectionTabs", "sectionTitle",
  "searchHomeView", "seek", "settingsButton", "settingsScreen", "settingsStatus", "setupForm", "status", "trackActionSheet", "trackArtist", "trackCount", "trackLabel",
  "trackList", "trackTitle", "trackAlbum", "trackAlbumSeparator", "playbackDiagnosticsButton", "playbackDiagnosticsStatus",
  "artistScreen", "artistBackButton", "artistTitle", "artistStatus", "artistTrackList", "artistAlbumList", "artistHero", "artistImage", "artistPlayButton",
];
const elements = Object.fromEntries(elementIds.map((id) => [id, document.getElementById(id)]));

class CatMascot {
  constructor(element) {
    this.element = element;
    this.images = {
      idle: element.querySelector(".cat-mascot-idle"),
      playing: element.querySelector(".cat-mascot-playing"),
    };
    for (const image of Object.values(this.images)) {
      image.dataset.ready = String(image.complete && image.naturalWidth > 0);
      image.dataset.failed = String(Boolean(image.getAttribute("src")) && image.complete && !image.naturalWidth);
      image.addEventListener("load", () => { image.dataset.ready = "true"; image.dataset.failed = "false"; this.update(); });
      image.addEventListener("error", () => { image.dataset.ready = "false"; image.dataset.failed = "true"; this.update(); });
    }
    // Keep a small first frame visible until the animation has downloaded and
    // decoded. A failed image stays hidden instead of Safari's blue '?' icon.
    const poster = element.querySelector(".cat-mascot-poster");
    poster.dataset.ready = String(poster.complete && poster.naturalWidth > 0);
    poster.addEventListener("load", () => { poster.dataset.ready = "true"; });
    poster.addEventListener("error", () => { poster.dataset.ready = "false"; });
    this.retryFailed = () => {
      if (document.hidden || navigator.onLine === false) return;
      const image = this.images[this._isPlaying ? "playing" : "idle"];
      if (image.dataset.failed !== "true") return;
      image.dataset.failed = "false";
      const source = image.dataset.src || image.src;
      // WebKit keeps the failed image when the same URL is assigned directly.
      // Clear it for one task before retrying the original, cacheable URL.
      image.removeAttribute("src");
      setTimeout(() => { image.src = source; }, 0);
    };
    window.addEventListener("online", this.retryFailed);
    document.addEventListener("visibilitychange", this.retryFailed);
    this.isPlaying = false;
  }

  get isPlaying() { return this._isPlaying; }

  set isPlaying(value) {
    this._isPlaying = Boolean(value);
    const image = this.images[this._isPlaying ? "playing" : "idle"];
    if (!image.getAttribute("src") && image.dataset.src) image.src = image.dataset.src;
    this.update();
    this.retryFailed();
  }

  update() {
    const stateName = this._isPlaying ? "playing" : "idle";
    this.element.dataset.state = stateName;
    this.element.dataset.animationReady = this.images[stateName].dataset.ready;
  }
}

const catMascot = new CatMascot(elements.catMascot);

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; }
  catch { return fallback; }
}

function normalizeStoredLibrary(raw = {}) {
  return {
    albums: Array.isArray(raw.albums) ? raw.albums : [],
    playlists: Array.isArray(raw.playlists) ? raw.playlists : [],
    likedTracks: Array.isArray(raw.likedTracks) ? raw.likedTracks : [],
  };
}

const state = {
  config: readJson(CONNECTION_STORAGE_KEY, {}),
  library: normalizeStoredLibrary(readJson(LIBRARY_STORAGE_KEY, {})),
  sections: [], currentSectionId: null, libraryTracks: [], libraryView: "tracks",
  searchTracks: [], searchAlbums: [], searchTotal: 0, searchQuery: "", searchActive: false,
  playbackQueue: [], currentTrackKey: null, currentTrack: null,
  currentView: "home", homeTab: "search", currentCollection: null, actionTrack: null,
  suggestionTimer: null, suggestionRequestId: 0,
};

const CYRILLIC_TO_LATIN = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "i",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.hidden = !message;
  elements.status.classList.toggle("error", isError);
}
function saveLibrary(library = state.library) {
  try { localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(library)); }
  catch (error) {
    if (error.name !== "QuotaExceededError") throw error;
    // Album contents are fetched again when opened. Evict this replaceable
    // cache before refusing to save the user's tracks or playlists.
    const compact = { ...library, albums: library.albums.map((album) => ({ ...album, tracks: [] })) };
    localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(compact));
  }
}
function setSettingsStatus(message, isError = false) {
  elements.settingsStatus.textContent = message;
  elements.settingsStatus.hidden = !message;
  elements.settingsStatus.classList.toggle("error", isError);
}
function reportConnectionError(error) {
  let message = error.message || "Не удалось подключиться к музыке.";
  if (error.name === "AbortError" || error.name === "TimeoutError") {
    message = "Сервер отвечает слишком долго. Попробуйте ещё раз через настройки.";
  } else if (error.name === "TypeError" || /load failed|failed to fetch|networkerror/i.test(message)) {
    message = "Не удалось подключиться к музыке. Попробуйте позже или проверьте настройки.";
  } else if (/cookies|backend/i.test(message)) {
    message = "Не удалось подключиться к музыке. Проверьте настройки подключения.";
  }
  setStatus(message, true);
  setSettingsStatus(message, true);
}
function openSettings() {
  elements.searchInput.blur();
  elements.backendUrlInput.value = state.config.backendUrl || PUBLIC_BACKEND_URL;
  elements.apiKeyInput.value = state.config.apiKey || "";
  showView("settings");
}
function blurSettingsInputs() { elements.backendUrlInput.blur(); elements.apiKeyInput.blur(); }
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
document.documentElement.classList.toggle("is-standalone", isStandalone);

let searchFocusGuard = null;
let searchFocusTimer = 0;
let searchActivatedByGesture = false;
let searchKeyboardObserved = false;
function isKeyboardOpen() {
  const viewport = window.visualViewport;
  return Boolean(viewport && viewport.scale === 1 && elements.mainScreen.offsetHeight > 0 &&
    document.body.clientHeight - viewport.height > 120);
}
function updateSearchFocusPreview() {
  elements.searchFocusPreview.textContent = elements.searchInput.value || elements.searchInput.placeholder;
  elements.searchFocusPreview.classList.toggle("has-value", Boolean(elements.searchInput.value));
}
function finishSearchFocus() {
  clearTimeout(searchFocusTimer);
  searchFocusGuard = null;
  elements.searchForm.classList.remove("search-focus-opening");
  elements.searchFocusPreview.hidden = true;
  if (!isKeyboardOpen()) searchActivatedByGesture = false;
}
function scheduleSearchReveal() {
  if (!searchFocusGuard) return;
  clearTimeout(searchFocusTimer);
  const elapsed = performance.now() - searchFocusGuard.started;
  const wait = Math.min(Math.max(0, 650 - elapsed), Math.max(100, 300 - elapsed));
  searchFocusTimer = setTimeout(finishSearchFocus, wait);
}
function prepareSearchFocus() {
  finishSearchFocus();
  searchFocusGuard = { started: performance.now() };
  updateSearchFocusPreview();
  elements.searchFocusPreview.hidden = false;
  elements.searchForm.classList.add("search-focus-opening");
  // Flush the hidden style before native focus reveal starts. Restore only
  // after the keyboard transition, not in the next animation frame.
  getComputedStyle(elements.searchInput).opacity;
  searchFocusTimer = setTimeout(finishSearchFocus, 650);
}
function focusSearchInput(fromGesture = false) {
  if (state.currentView !== "home" || state.homeTab !== "search") return;
  const alreadyFocused = document.activeElement === elements.searchInput;
  const reopenKeyboard = fromGesture && isIOS && !isKeyboardOpen() && !searchActivatedByGesture;
  if (alreadyFocused && !reopenKeyboard) return;
  const scrollTop = elements.mainScreen.scrollTop;
  if (alreadyFocused) elements.searchInput.blur();
  if (isIOS && !isKeyboardOpen()) prepareSearchFocus();
  elements.searchInput.focus({ preventScroll: true });
  elements.mainScreen.scrollTop = scrollTop;
  if (fromGesture) searchActivatedByGesture = true;
}
function onSearchViewportChange() {
  if (isKeyboardOpen()) searchKeyboardObserved = true;
  else if (searchKeyboardObserved) {
    searchKeyboardObserved = false;
    searchActivatedByGesture = false;
  }
  scheduleSearchReveal();
}
window.visualViewport?.addEventListener("resize", onSearchViewportChange);
window.visualViewport?.addEventListener("scroll", scheduleSearchReveal);
window.addEventListener("orientationchange", () => {
  finishSearchFocus(); searchActivatedByGesture = false;
});
window.addEventListener("pagehide", finishSearchFocus);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { finishSearchFocus(); searchActivatedByGesture = false; }
});

let bottomInsetTimer = 0;
function calibrateBottomInset() {
  if (!isIOS || !isStandalone || document.hidden) return;
  const viewport = window.visualViewport;
  if (!viewport || viewport.scale !== 1 || viewport.height <= 0) return;
  if (searchFocusGuard) { scheduleBottomInset(); return; }
  const deficit = Math.max(0, document.body.clientHeight - viewport.height);
  // iOS standalone can clip a status-bar-sized strip below the visual viewport
  // (WebKit 313800). Keep that clearance, but never measure the open keyboard.
  if (deficit >= 120) return;
  const value = `${Math.ceil(deficit)}px`;
  if (document.documentElement.style.getPropertyValue("--viewport-bottom-inset") !== value) {
    document.documentElement.style.setProperty("--viewport-bottom-inset", value);
  }
}
function scheduleBottomInset() {
  clearTimeout(bottomInsetTimer);
  bottomInsetTimer = setTimeout(calibrateBottomInset, 400);
}
window.visualViewport?.addEventListener("resize", scheduleBottomInset);
window.addEventListener("resize", scheduleBottomInset);
window.addEventListener("pageshow", scheduleBottomInset);
window.addEventListener("pagehide", () => clearTimeout(bottomInsetTimer));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) clearTimeout(bottomInsetTimer);
  else scheduleBottomInset();
});
calibrateBottomInset();

function normalizeBackendUrl(value) {
  const url = new URL(value.trim());
  const isLocal = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(isLocal && url.protocol === "http:")) throw new Error("Для backend нужен HTTPS-адрес");
  return url.href.replace(/\/$/, "");
}
async function api(path, signal) {
  if (!state.config.backendUrl) throw new Error("Сначала укажите адрес backend");
  const headers = { Accept: "application/json" };
  if (state.config.apiKey) headers.Authorization = `Bearer ${state.config.apiKey}`;
  const response = await fetch(`${state.config.backendUrl}${path}`, { headers, cache: "no-store", signal });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    if (response.status === 401) throw new Error("Ключ доступа не подошёл");
    throw new Error(data.error || `Backend ответил ${response.status}`);
  }
  return data;
}

function thumbnailUrl(thumbnail = {}) { return thumbnail.photo_1200 || thumbnail.photo_600 || thumbnail.photo_300 || thumbnail.photo_270 || thumbnail.photo_135 || ""; }
function artworkFor(track) { return thumbnailUrl(track.thumbnail || track.album?.thumbnail || {}); }
function albumArtwork(album) { return thumbnailUrl(album.artwork || album.thumbnail || {}); }
function formatTime(value) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  return `${Math.floor(value / 60)}:${Math.floor(value % 60).toString().padStart(2, "0")}`;
}
function trackKey(track) { return `${track.ownerId}_${track.id}`; }
function albumKey(album) { return `${album.ownerId}_${album.id}`; }
function artistForTrack(track) {
  const artist = track.artists?.find((item) => item?.name);
  return { id: artist?.id || null, name: artist?.name || track.artist || "Неизвестный исполнитель" };
}
function albumFromTrack(track) {
  if (!track.album?.id) return null;
  return { id: track.album.id, ownerId: track.album.ownerId, title: track.album.title, artist: artistForTrack(track), year: null, artwork: track.album.thumbnail || track.thumbnail || {}, trackCount: 1, tracks: [track] };
}
function albumsFromTracks(tracks) {
  const albums = new Map();
  for (const track of tracks) {
    const candidate = albumFromTrack(track);
    if (!candidate) continue;
    const key = albumKey(candidate);
    const existing = albums.get(key);
    if (!existing) albums.set(key, candidate);
    else if (!existing.tracks.some((item) => trackKey(item) === trackKey(track))) {
      existing.tracks.push(track);
      existing.trackCount = existing.tracks.length;
    }
  }
  return [...albums.values()].slice(0, 12);
}
function mergeAlbumsFromTracks(tracks, persist = false) {
  const target = new Map(state.library.albums.map((album) => [albumKey(album), album]));
  for (const track of tracks) {
    const candidate = albumFromTrack(track);
    if (!candidate) continue;
    const key = albumKey(candidate);
    const existing = target.get(key);
    if (!existing) { target.set(key, candidate); continue; }
    const knownTracks = new Map((existing.tracks || []).map((item) => [trackKey(item), item]));
    knownTracks.set(trackKey(track), track);
    existing.tracks = [...knownTracks.values()];
    existing.trackCount = Math.max(existing.trackCount || 0, existing.tracks.length);
    existing.artist ||= candidate.artist;
    existing.artwork ||= candidate.artwork;
  }
  state.library.albums = [...target.values()];
  if (persist) saveLibrary();
}

function showPlayer(show = true) {
  if (show && !state.currentTrack) return;
  if (show) { elements.searchInput.blur(); blurSettingsInputs(); }
  elements.fullPlayer.hidden = !show;
  document.body.classList.toggle("player-open", show);
}
const homeScroll = { search: 0, library: 0 };
let homeTransition = null;
function setHomeTab(tab, animate = false) {
  const next = tab === "library" ? "library" : "search";
  const changed = state.homeTab !== next;
  if (changed) {
    if (!elements.mainScreen.hidden) homeScroll[state.homeTab] = elements.mainScreen.scrollTop;
    elements.searchInput.blur();
    finishSearchFocus();
  }
  homeTransition?.cancel();
  state.homeTab = next;
  const showingSearch = state.homeTab === "search";
  elements.searchHomeView.hidden = !showingSearch;
  elements.libraryHomeView.hidden = showingSearch;
  if (changed) elements.mainScreen.scrollTop = homeScroll[next];
  if (changed && animate && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const view = showingSearch ? elements.searchHomeView : elements.libraryHomeView;
    homeTransition = view.animate([
      { transform: `translateX(${showingSearch ? -100 : 100}%)` },
      { transform: "translateX(0)" },
    ], { duration: 220, easing: "cubic-bezier(.2,.7,.2,1)" });
  }
}

// Keep vertical scrolling and nested album/result rails native. Only claim a
// clearly horizontal, single-finger gesture on one of the two home screens.
let homeSwipe = null;
let suppressHomeClickUntil = 0;
function canSwipeHome() {
  return state.currentView === "home" && elements.fullPlayer.hidden && elements.trackActionSheet.hidden;
}
function isSwipeControl(target) {
  if (!(target instanceof Element)) return true;
  if (target.closest("input, textarea, select, [contenteditable], [data-no-home-swipe], .album-grid, .search-result-list, .section-tabs, .library-switcher")) return true;
  for (let parent = target; parent && parent !== elements.mainScreen; parent = parent.parentElement) {
    if (parent.scrollWidth > parent.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(parent).overflowX)) return true;
  }
  return false;
}
elements.mainScreen.addEventListener("touchstart", (event) => {
  // A new tap is intentional; suppress only the compatibility click belonging
  // to the completed swipe, not the next settings/track tap.
  suppressHomeClickUntil = 0;
  homeSwipe = null;
  if (!canSwipeHome() || event.touches.length !== 1 || isSwipeControl(event.target)) return;
  const touch = event.touches[0];
  // Leave Safari's history gesture at the browser edges; installed PWA has
  // no browser navigation there and can use the entire screen.
  if (!isStandalone && (touch.clientX < 24 || touch.clientX > innerWidth - 24)) return;
  homeSwipe = { id: touch.identifier, x: touch.clientX, y: touch.clientY, tab: state.homeTab, axis: null };
}, { passive: true });
elements.mainScreen.addEventListener("touchmove", (event) => {
  if (!homeSwipe) return;
  if (!canSwipeHome() || event.touches.length !== 1 || state.homeTab !== homeSwipe.tab) { homeSwipe = null; return; }
  const touch = event.touches[0];
  if (touch.identifier !== homeSwipe.id) { homeSwipe = null; return; }
  const dx = touch.clientX - homeSwipe.x;
  const dy = touch.clientY - homeSwipe.y;
  if (!homeSwipe.axis && Math.max(Math.abs(dx), Math.abs(dy)) >= 12) {
    homeSwipe.axis = Math.abs(dx) > Math.abs(dy) * 1.5 ? "horizontal" : "vertical";
  }
  if (homeSwipe.axis === "vertical") { homeSwipe = null; return; }
  const towardsNext = homeSwipe.tab === "search" ? dx < 0 : dx > 0;
  if (homeSwipe.axis === "horizontal" && towardsNext && event.cancelable) event.preventDefault();
}, { passive: false });
elements.mainScreen.addEventListener("touchend", (event) => {
  const swipe = homeSwipe;
  homeSwipe = null;
  if (!swipe || !canSwipeHome() || event.touches.length || state.homeTab !== swipe.tab) return;
  const touch = [...event.changedTouches].find((item) => item.identifier === swipe.id);
  if (!touch) return;
  const dx = touch.clientX - swipe.x;
  const dy = touch.clientY - swipe.y;
  const towardsNext = swipe.tab === "search" ? dx < 0 : dx > 0;
  const threshold = Math.max(60, elements.mainScreen.clientWidth * .18);
  if (swipe.axis !== "horizontal" || !towardsNext || Math.abs(dx) < threshold || Math.abs(dx) <= Math.abs(dy) * 1.5) return;
  if (event.cancelable) event.preventDefault();
  suppressHomeClickUntil = performance.now() + 400;
  setHomeTab(swipe.tab === "search" ? "library" : "search", true);
}, { passive: false });
elements.mainScreen.addEventListener("touchcancel", () => { homeSwipe = null; }, { passive: true });
elements.mainScreen.addEventListener("click", (event) => {
  if (event.detail !== 0 && performance.now() < suppressHomeClickUntil) {
    event.preventDefault(); event.stopImmediatePropagation();
  }
}, { capture: true });
const navigationStack = [];
function showView(view, collection = null, remember = true) {
  if (remember && view !== "home") {
    navigationStack.push({
      view: state.currentView, collection: state.currentCollection,
      artist: state.currentArtist, homeTab: state.homeTab,
      playerOpen: !elements.fullPlayer.hidden,
      scroll: [elements.mainScreen.scrollTop, elements.collectionScreen.scrollTop, elements.artistScreen.scrollTop],
    });
  }
  if (state.currentView === "settings" && view !== "settings") blurSettingsInputs();
  showPlayer(false);
  state.currentView = view;
  state.currentCollection = collection;
  elements.mainScreen.hidden = view !== "home";
  elements.collectionScreen.hidden = view !== "album" && view !== "playlist";
  elements.artistScreen.hidden = view !== "artist";
  elements.settingsScreen.hidden = view !== "settings";
  document.body.classList.toggle("detail-open", view !== "home");
  elements.mainScreen.scrollTo({ top: 0, behavior: "auto" });
  elements.collectionScreen.scrollTo({ top: 0, behavior: "auto" });
  elements.artistScreen.scrollTo({ top: 0, behavior: "auto" });
}
async function goBack() {
  const previous = navigationStack.pop();
  if (!previous) { showView("home", null, false); return; }
  setHomeTab(previous.homeTab);
  if (previous.view === "artist") await openArtist(previous.artist, false);
  else if (previous.view === "album" && !previous.collection?.tracks?.length) await openAlbum(previous.collection, false);
  else {
    showView(previous.view, previous.collection, false);
    if (previous.collection) renderCollection();
  }
  showPlayer(previous.playerOpen);
  requestAnimationFrame(() => {
    [elements.mainScreen, elements.collectionScreen, elements.artistScreen].forEach((screen, index) => {
      screen.scrollTop = previous.scroll[index];
    });
  });
}
function setPlaybackButtonState(isPlaying, publishMediaState = true) {
  const label = isPlaying ? "Пауза" : "Воспроизвести";
  elements.playButton.querySelector(".player-play-icon").toggleAttribute("hidden", isPlaying);
  elements.playButton.querySelector(".player-pause-icon").toggleAttribute("hidden", !isPlaying);
  elements.miniPlayButton.querySelector(".mini-play-icon").toggleAttribute("hidden", isPlaying);
  elements.miniPlayButton.querySelector(".mini-pause-icon").toggleAttribute("hidden", !isPlaying);
  elements.playButton.setAttribute("aria-label", label); elements.miniPlayButton.setAttribute("aria-label", label);
  catMascot.isPlaying = isPlaying;
  if (publishMediaState && "mediaSession" in navigator) navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
}
function normalizeSearchText(value) {
  return value.toLocaleLowerCase("ru").split("").map((letter) => CYRILLIC_TO_LATIN[letter] ?? letter).join("").replace(/[^a-z0-9]+/g, "");
}
function editDistance(left, right) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let previous = row[0]; row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (left[i - 1] === right[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[right.length];
}
function localSuggestions(query) {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length < 2) return [];
  const artists = [...new Set(state.libraryTracks.flatMap((track) => track.artists?.map((artist) => artist.name) || [track.artist]).filter(Boolean))];
  return artists.map((artist) => {
    const normalizedArtist = normalizeSearchText(artist);
    let score = Number.POSITIVE_INFINITY;
    if (normalizedArtist.startsWith(normalizedQuery)) score = 0;
    else if (normalizedArtist.includes(normalizedQuery)) score = 1;
    else if (normalizedQuery.length >= 3 && editDistance(normalizedQuery, normalizedArtist.slice(0, normalizedQuery.length)) <= 1) score = 2;
    return { artist, score };
  }).filter(({ score }) => Number.isFinite(score)).sort((a, b) => a.score - b.score || a.artist.localeCompare(b.artist, "ru")).map(({ artist }) => artist);
}

function createArtwork(url, className, fallback = "♪") {
  if (url) return Object.assign(document.createElement("img"), { src: url, alt: "", loading: "lazy", className });
  return Object.assign(document.createElement("span"), { className: `${className} artwork-fallback`, textContent: fallback });
}
function openTrackActions(track) {
  state.actionTrack = track; elements.actionSheetTitle.textContent = track.title; elements.actionSheetArtist.textContent = track.artist;
  elements.trackActionSheet.hidden = false; document.body.classList.add("sheet-open");
}
function closeTrackActions() { state.actionTrack = null; elements.trackActionSheet.hidden = true; document.body.classList.remove("sheet-open"); }
function createTrackRow(track, queue, options = {}) {
  const row = document.createElement("div"); row.className = "track-row"; row.classList.toggle("active", trackKey(track) === state.currentTrackKey);
  const play = document.createElement("button"); play.type = "button"; play.className = "track-main";
  play.setAttribute("aria-label", `Воспроизвести ${track.title}`); play.addEventListener("click", () => playTrack(track, queue));
  const copy = document.createElement("span"); copy.className = "track-copy";
  const title = document.createElement("strong"); title.textContent = track.title;
  const artist = document.createElement("small"); artist.textContent = track.artist;
  copy.append(title, artist); play.append(createArtwork(artworkFor(track), "track-art"), copy);
  const trailing = document.createElement("span"); trailing.className = "track-trailing";
  const duration = document.createElement("span"); duration.className = "track-duration"; duration.textContent = options.index ? String(options.index) : formatTime(track.duration);
  const menu = document.createElement("button"); menu.type = "button"; menu.className = "track-menu"; menu.textContent = "•••";
  menu.setAttribute("aria-label", `Действия с треком ${track.title}`); menu.addEventListener("click", () => openTrackActions(track));
  trailing.append(duration, menu); row.append(play, trailing); return row;
}
function createAlbumCard(album) {
  const button = document.createElement("button"); button.type = "button"; button.className = "album-card"; button.addEventListener("click", () => openAlbum(album));
  const title = document.createElement("strong"); title.textContent = album.title;
  const meta = document.createElement("small"); meta.textContent = [album.artist?.name, album.year].filter(Boolean).join(" · ");
  button.append(createArtwork(albumArtwork(album), "album-art", "▣"), title, meta); return button;
}
function createMosaic(urls) {
  const mosaic = document.createElement("div"); mosaic.className = "cover-mosaic";
  const visible = [...new Set(urls.filter(Boolean))].slice(0, 4);
  if (!visible.length) mosaic.append(createArtwork("", "mosaic-art", "♫"));
  else mosaic.append(...visible.map((url) => createArtwork(url, "mosaic-art")));
  return mosaic;
}
function createPlaylistCard(playlist) {
  const button = document.createElement("button"); button.type = "button"; button.className = "playlist-card"; button.addEventListener("click", () => openPlaylist(playlist));
  const copy = document.createElement("span"); copy.className = "playlist-card-copy";
  const title = document.createElement("strong"); title.textContent = playlist.title;
  const meta = document.createElement("small"); meta.textContent = `${playlist.tracks.length} треков · ${playlist.type === "mix" ? "Микс" : "Плейлист"}`;
  copy.append(title, meta); button.append(createMosaic(playlist.cover || []), copy); return button;
}

function renderSections() {
  elements.sectionTabs.replaceChildren(...state.sections.map((section) => {
    const button = document.createElement("button"); button.type = "button"; button.className = "section-tab";
    button.classList.toggle("active", section.id === state.currentSectionId); button.textContent = section.title;
    button.addEventListener("click", () => loadSection(section.id)); return button;
  }));
}
function renderLibraryTracks() {
  const tracks = [...new Map([...state.library.likedTracks, ...state.libraryTracks].map((track) => [trackKey(track), track])).values()];
  elements.trackCount.textContent = `${tracks.length} треков`;
  if (!tracks.length) {
    elements.trackList.replaceChildren(Object.assign(document.createElement("div"), { className: "empty", textContent: "Добавляйте песни в свою музыку кнопкой с сердечком в плеере." })); return;
  }
  elements.trackList.replaceChildren(...tracks.map((track) => createTrackRow(track, tracks)));
}
function renderPersonalLibrary() {
  const showingAlbums = state.libraryView === "albums";
  const showingTracks = state.libraryView === "tracks";
  elements.libraryAlbumList.hidden = !showingAlbums;
  elements.libraryPlaylistList.hidden = state.libraryView !== "playlists";
  elements.libraryTracksSection.hidden = !showingTracks;
  elements.librarySwitcher.querySelectorAll("[data-library-view]").forEach((button) => button.classList.toggle("active", button.dataset.libraryView === state.libraryView));
  if (showingAlbums) {
    elements.personalLibraryCount.textContent = `${state.library.albums.length} альбомов`;
    elements.libraryAlbumList.replaceChildren(...state.library.albums.map(createAlbumCard));
    if (!state.library.albums.length) elements.libraryAlbumList.append(Object.assign(document.createElement("div"), { className: "empty library-empty", textContent: "Альбомы из вашей музыки появятся здесь." }));
  } else if (showingTracks) {
    elements.personalLibraryCount.textContent = "";
    renderLibraryTracks();
  } else {
    elements.personalLibraryCount.textContent = `${state.library.playlists.length} плейлистов`;
    elements.libraryPlaylistList.replaceChildren(...state.library.playlists.map(createPlaylistCard));
    if (!state.library.playlists.length) elements.libraryPlaylistList.append(Object.assign(document.createElement("div"), { className: "empty library-empty", textContent: "Создайте первый микс из меню трека." }));
  }
}
function renderTrackLike() {
  const liked = Boolean(state.currentTrackKey && state.library.likedTracks.some((track) => trackKey(track) === state.currentTrackKey));
  elements.playerLikeButton.disabled = !state.currentTrack;
  elements.playerLikeButton.setAttribute("aria-pressed", String(liked));
  elements.playerLikeButton.setAttribute("aria-label", liked ? "Убрать из моей музыки" : "Добавить в мою музыку");
  elements.playerLikeLabel.textContent = liked ? "В моей музыке" : "Добавить в мою музыку";
}
function toggleTrackLike() {
  if (!state.currentTrack) return;
  const index = state.library.likedTracks.findIndex((track) => trackKey(track) === state.currentTrackKey);
  const likedTracks = [...state.library.likedTracks];
  if (index < 0) likedTracks.unshift({ ...state.currentTrack });
  else likedTracks.splice(index, 1);
  const library = { ...state.library, likedTracks };
  try {
    saveLibrary(library);
    state.library = library;
    state.libraryView = "tracks";
    renderTrackLike(); renderPersonalLibrary();
    elements.playerLibraryStatus.textContent = index < 0 ? "Добавлено в мою музыку" : "Удалено из моей музыки";
    elements.playerLibraryStatus.classList.remove("error");
  } catch (error) {
    elements.playerLibraryStatus.textContent = error.name === "QuotaExceededError"
      ? "Не удалось сохранить: хранилище устройства заполнено."
      : "Не удалось сохранить трек. Проверьте доступ к хранилищу браузера.";
    elements.playerLibraryStatus.classList.add("error");
  }
  elements.playerLibraryStatus.hidden = false;
}
function renderSearchResults() {
  elements.searchResults.hidden = !state.searchActive;
  if (!state.searchActive) {
    elements.searchResultList.replaceChildren(); elements.searchAlbumList.replaceChildren(); return;
  }
  const visibleTracks = state.searchTracks.slice(0, SEARCH_RESULT_LIMIT);
  elements.searchTrackGroup.hidden = !visibleTracks.length; elements.searchAlbumGroup.hidden = !state.searchAlbums.length;
  elements.searchResultList.replaceChildren(...visibleTracks.map((track) => createTrackRow(track, state.searchTracks.slice(0, SEARCH_RESULT_LIMIT))));
  elements.searchAlbumList.replaceChildren(...state.searchAlbums.map(createAlbumCard));
  if (!visibleTracks.length && !state.searchAlbums.length) {
    const empty = Object.assign(document.createElement("div"), { className: "search-empty", textContent: "Ничего не найдено" });
    elements.searchTrackGroup.hidden = false;
    elements.searchResultList.replaceChildren(empty);
  }
}
function renderSuggestions(suggestions) {
  const queryKey = normalizeSearchText(elements.searchInput.value); const unique = []; const seen = new Set([queryKey]);
  for (const suggestion of suggestions) {
    const key = normalizeSearchText(suggestion); if (!key || seen.has(key)) continue;
    seen.add(key); unique.push(suggestion); if (unique.length === 5) break;
  }
  elements.searchSuggestions.hidden = unique.length === 0;
  elements.searchSuggestions.replaceChildren(...unique.map((suggestion) => {
    const button = document.createElement("button"); button.type = "button"; button.className = "suggestion-chip"; button.textContent = suggestion;
    button.addEventListener("click", () => { elements.searchInput.value = suggestion; elements.clearSearchButton.hidden = false; elements.searchSuggestions.hidden = true; searchMusic(suggestion); elements.searchInput.blur(); });
    return button;
  }));
}

async function loadSuggestions(query) {
  const requestId = ++state.suggestionRequestId; const local = localSuggestions(query); renderSuggestions(local);
  try {
    const data = await api(`/api/search/suggestions?q=${encodeURIComponent(query)}`);
    if (requestId !== state.suggestionRequestId || elements.searchInput.value.trim() !== query) return;
    renderSuggestions([...local, ...(data.result.suggestions || [])]);
  } catch { if (requestId === state.suggestionRequestId) renderSuggestions(local); }
}
function scheduleSuggestions() {
  clearTimeout(state.suggestionTimer); const query = elements.searchInput.value.trim(); elements.clearSearchButton.hidden = !query;
  if (query !== state.searchQuery) { state.searchActive = false; renderSearchResults(); }
  if (query.length < 2) { state.suggestionRequestId += 1; renderSuggestions([]); return; }
  renderSuggestions(localSuggestions(query)); state.suggestionTimer = setTimeout(() => loadSuggestions(query), SUGGESTION_DELAY);
}
async function loadSection(sectionId, { preserveSearch = false, signal } = {}) {
  if (!sectionId) return true;
  const canUpdateStatus = () => !preserveSearch || (!state.searchActive && !elements.searchInput.value.trim());
  try {
    state.currentSectionId = sectionId;
    if (!preserveSearch) clearSearch(true);
    renderSections();
    if (canUpdateStatus()) setStatus("Загружаю треки…");
    const data = await api(`/api/sections/${encodeURIComponent(sectionId)}`, signal);
    state.libraryTracks = data.result.tracks || []; elements.sectionTitle.textContent = data.result.title || "Треки";
    mergeAlbumsFromTracks(state.libraryTracks, true); renderLibraryTracks(); renderPersonalLibrary();
    if (canUpdateStatus()) setStatus(state.libraryTracks.length ? "" : "Раздел пуст");
    return true;
  } catch (error) {
    if (canUpdateStatus()) reportConnectionError(error);
    else setSettingsStatus("Не удалось загрузить мою музыку. Попробуйте подключиться ещё раз.", true);
    return false;
  }
}
async function searchMusic(query) {
  const normalizedQuery = query.trim(); if (normalizedQuery.length < 2) return setStatus("Введите минимум два символа для поиска", true);
  try {
    clearTimeout(state.suggestionTimer); state.suggestionRequestId += 1;
    Object.assign(state, { searchQuery: normalizedQuery, searchActive: true, searchTracks: [], searchAlbums: [], searchTotal: 0 });
    elements.clearSearchButton.hidden = false; elements.searchSuggestions.hidden = true; setStatus(`Ищу «${normalizedQuery}»…`);
    const data = await api(`/api/search?q=${encodeURIComponent(normalizedQuery)}`);
    state.searchTracks = data.result.tracks || [];
    state.searchAlbums = data.result.albums || albumsFromTracks(state.searchTracks);
    state.searchTotal = data.result.count || state.searchTracks.length;
    renderSearchResults(); setStatus(state.searchTracks.length || state.searchAlbums.length ? "Поиск завершён" : "Ничего не найдено");
  } catch (error) {
    Object.assign(state, { searchTracks: [], searchAlbums: [], searchTotal: 0 }); renderSearchResults(); reportConnectionError(error);
  }
}
function clearSearch(clearInput = true) {
  clearTimeout(state.suggestionTimer); state.suggestionRequestId += 1; if (clearInput) elements.searchInput.value = "";
  elements.clearSearchButton.hidden = true; elements.searchSuggestions.hidden = true;
  Object.assign(state, { searchActive: false, searchTracks: [], searchAlbums: [], searchTotal: 0, searchQuery: "" }); renderSearchResults();
  if (clearInput && elements.audio.paused) setStatus("");
}
async function loadLibrary() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    setStatus("Подключаюсь к VK Music…");
    const [, data] = await Promise.all([
      api("/api/health", controller.signal).then((health) => {
        if (!health.hasCookieP || !health.hasRemixSid) throw new Error("На backend не настроены VK cookies");
      }),
      api("/api/sections", controller.signal),
    ]);
    state.sections = data.result.sections || []; renderSections();
    const sectionId = data.result.defaultSection || state.sections[0]?.id;
    if (!sectionId) { setStatus(""); return true; }
    return await loadSection(sectionId, { preserveSearch: true, signal: controller.signal });
  } catch (error) { controller.abort(); reportConnectionError(error); return false; }
  finally { clearTimeout(timer); }
}

function renderCollectionArtwork(collection) {
  elements.collectionCover.replaceChildren();
  if (state.currentView === "album") elements.collectionCover.append(createArtwork(albumArtwork(collection), "collection-art", "▣"));
  else elements.collectionCover.append(createMosaic(collection.cover || []));
}
function renderCollection() {
  const collection = state.currentCollection; if (!collection) return;
  const isAlbum = state.currentView === "album"; const tracks = collection.tracks || [];
  elements.collectionKind.textContent = isAlbum ? "Альбом" : "Плейлист";
  elements.collectionKicker.textContent = isAlbum ? "Альбом" : collection.type === "mix" ? "Микс" : "Плейлист";
  elements.collectionTitle.textContent = collection.title; elements.collectionArtist.hidden = !isAlbum;
  elements.collectionArtist.textContent = isAlbum ? collection.artist?.name || "Неизвестный исполнитель" : "";
  elements.collectionMeta.textContent = isAlbum ? [collection.year, `${tracks.length || collection.trackCount || 0} треков`].filter(Boolean).join(" · ") : `${tracks.length} треков · ${new Date(collection.createdAt).toLocaleDateString("ru-RU")}`;
  elements.collectionMixButton.hidden = !isAlbum; elements.collectionPlayButton.disabled = !tracks.length; elements.collectionShuffleButton.disabled = !tracks.length;
  renderCollectionArtwork(collection);
  elements.collectionTrackList.replaceChildren(...tracks.map((track, index) => createTrackRow(track, tracks, { index: index + 1 })));
  if (!tracks.length) elements.collectionTrackList.append(Object.assign(document.createElement("div"), { className: "empty", textContent: "Загружаю треки…" }));
}
async function openAlbum(album, remember = true) {
  showView("album", { ...album, tracks: [] }, remember); renderCollection();
  elements.collectionTrackList.replaceChildren(Object.assign(document.createElement("div"), { className: "empty", textContent: "Загрузка трек-листа…" }));
  try {
    const path = `/api/albums/${encodeURIComponent(album.ownerId)}/${encodeURIComponent(album.id)}?title=${encodeURIComponent(album.title)}&artist=${encodeURIComponent(album.artist?.name || "")}`;
    const data = await api(path);
    if (state.currentView !== "album" || albumKey(state.currentCollection) !== albumKey(album)) return;
    state.currentCollection = data.result.album;
    const existingIndex = state.library.albums.findIndex((item) => albumKey(item) === albumKey(state.currentCollection));
    if (existingIndex >= 0) { state.library.albums[existingIndex] = state.currentCollection; saveLibrary(); renderPersonalLibrary(); }
    renderCollection();
  } catch (error) {
    if (state.currentView !== "album" || albumKey(state.currentCollection) !== albumKey(album)) return;
    if (!state.currentCollection.tracks?.length) elements.collectionTrackList.replaceChildren(Object.assign(document.createElement("div"), { className: "empty error", textContent: error.message }));
  }
}
let artistRequestId = 0;
function renderArtistArtwork(artist, albums = [], tracks = []) {
  const requestId = artistRequestId;
  const image = elements.artistImage;
  const fallback = (artist.artworkKind === "album" && thumbnailUrl(artist.artwork || {})) ||
    albums.map(albumArtwork).find(Boolean) || tracks.map(artworkFor).find(Boolean);
  const source = artist.photo || thumbnailUrl(artist.artwork || {}) || fallback;
  image.hidden = true;
  image.onload = image.onerror = null;
  image.removeAttribute("src");
  elements.artistHero.dataset.artwork = "none";
  const current = () => requestId === artistRequestId && state.currentView === "artist";
  function load(url, kind) {
    image.alt = kind === "artist" ? `Фото ${artist.name}` : `Обложка релиза ${artist.name}`;
    image.onload = () => {
      if (!current()) return;
      image.hidden = false;
      elements.artistHero.dataset.artwork = kind;
    };
    image.onerror = () => {
      if (!current()) return;
      if (fallback && url !== fallback) load(fallback, "album");
      else { image.hidden = true; elements.artistHero.dataset.artwork = "none"; }
    };
    image.src = url;
  }
  if (source) load(source, artist.photo || artist.artworkKind === "artist" ? "artist" : "album");
}
async function openArtist(artist, remember = true) {
  if (!artist?.name) return;
  showView("artist", null, remember);
  state.currentArtist = { ...artist, tracks: [] };
  const requestId = ++artistRequestId;
  elements.artistTitle.textContent = artist.name;
  elements.artistPlayButton.disabled = true;
  elements.artistPlayButton.setAttribute("aria-label", `Слушать ${artist.name}`);
  renderArtistArtwork(artist);
  elements.artistStatus.textContent = "Загрузка…";
  elements.artistStatus.classList.remove("error");
  elements.artistTrackList.replaceChildren(); elements.artistAlbumList.replaceChildren();
  try {
    const data = await api(`/api/artists/${encodeURIComponent(artist.id || "by-name")}?name=${encodeURIComponent(artist.name)}`);
    if (requestId !== artistRequestId || state.currentView !== "artist") return;
    const tracks = data.result.tracks || []; const albums = data.result.albums || [];
    state.currentArtist = { ...artist, ...data.result.artist, tracks };
    elements.artistTitle.textContent = state.currentArtist.name;
    elements.artistPlayButton.disabled = !tracks.length;
    elements.artistPlayButton.setAttribute("aria-label", `Слушать ${state.currentArtist.name}`);
    renderArtistArtwork(state.currentArtist, albums, tracks);
    elements.artistTrackList.replaceChildren(...tracks.map((track) => createTrackRow(track, tracks)));
    elements.artistAlbumList.replaceChildren(...albums.map(createAlbumCard));
    elements.artistStatus.textContent = tracks.length ? "" : "Треки этого исполнителя не найдены";
    if (!albums.length) elements.artistAlbumList.textContent = "Альбомы не найдены";
  } catch (error) {
    if (requestId === artistRequestId && state.currentView === "artist") {
      elements.artistStatus.textContent = error.message;
      elements.artistStatus.classList.add("error");
    }
  }
}
function openPlaylist(playlist) { showView("playlist", playlist); renderCollection(); }
function shuffled(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) { const swap = Math.floor(Math.random() * (index + 1)); [result[index], result[swap]] = [result[swap], result[index]]; }
  return result;
}
function uniqueTracks(tracks) { return [...new Map(tracks.filter((track) => track?.fileUrl).map((track) => [trackKey(track), track])).values()]; }

const mixGenerators = {
  async track(source) {
    const seed = source.track;
    try {
      const data = await api(`/api/tracks/${encodeURIComponent(seed.ownerId)}/${encodeURIComponent(seed.id)}/recommendations?limit=35`);
      const recommendations = uniqueTracks(data.result.tracks || [])
        .filter((track) => trackKey(track) !== trackKey(seed))
        .slice(0, 25);
      if (recommendations.length) return recommendations;
    } catch {
      // The private VK endpoint may change; keep the previous artist search as a fallback.
    }

    const query = seed.artists?.[0]?.name || seed.artist || seed.title;
    const data = await api(`/api/search?q=${encodeURIComponent(query)}`);
    return uniqueTracks([...(data.result.tracks || []), ...state.libraryTracks, ...state.searchTracks]).filter((track) => trackKey(track) !== trackKey(seed)).slice(0, 25);
  },
  async album(source) {
    const album = source.album; const data = await api(`/api/search?q=${encodeURIComponent(album.artist?.name || album.title)}`);
    const albumKeys = new Set((album.tracks || []).map(trackKey));
    return uniqueTracks([...(album.tracks || []), ...(data.result.tracks || []), ...state.libraryTracks]).filter((track) => !albumKeys.has(trackKey(track))).slice(0, 25);
  },
};
/** @param {MixSource} source @returns {Promise<Playlist>} */
async function generateMix(source) {
  const tracks = await mixGenerators[source.kind](source);
  const subject = source.kind === "track" ? source.track.title : source.album.title;
  const sourceId = source.kind === "track" ? trackKey(source.track) : albumKey(source.album);
  return {
    id: `mix-${source.kind}-${sourceId}-${Date.now()}`, title: `Микс по «${subject}»`,
    cover: uniqueTracks(source.kind === "track" ? [source.track, ...tracks] : [...(source.album.tracks || []), ...tracks]).map(artworkFor).filter(Boolean).slice(0, 4),
    tracks, createdAt: new Date().toISOString(), type: "mix",
    ...(source.kind === "track" ? { sourceTrackId: sourceId } : { sourceAlbumId: sourceId }),
  };
}
async function createAndOpenMix(source) {
  setStatus("Создаю микс…");
  try {
    const playlist = await generateMix(source); if (!playlist.tracks.length) throw new Error("Не удалось подобрать похожие треки");
    state.library.playlists.unshift(playlist); saveLibrary(); renderPersonalLibrary(); closeTrackActions();
    await playTrack(playlist.tracks[0], playlist.tracks);
  } catch (error) { setStatus(error.message, true); }
}

let playbackWanted = false;
let interruptedPlayback = false;
let outputNeedsReset = false;
let resumePromise = null;
let resumeAttempt = 0;
let savedPlaybackPosition = 0;
let interruptionPosition = null;
let recoveryController = null;
let pendingMediaPause = null;
let recentMediaPause = null;
let mediaPauseTimer = 0;
let playbackWatchdog = 0;
let watchdogRepairs = 0;
let playbackClockWatch = null;
let backgroundWakeAttempts = 0;
let playbackClockStalled = false;
let pendingAudioReplacement = null;
let foregroundRepairPending = false;
const playbackRun = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const diagnosticAudioIds = new WeakMap();
const diagnosticLifecycleEvents = new WeakMap();
let nextDiagnosticAudioId = 0;
const storedPlaybackEvents = readJson(PLAYBACK_DIAGNOSTICS_KEY, []);
const playbackEvents = Array.isArray(storedPlaybackEvents) ? storedPlaybackEvents.slice(-80) : [];

function persistPlaybackEvents() {
  try { localStorage.setItem(PLAYBACK_DIAGNOSTICS_KEY, JSON.stringify(playbackEvents)); }
  catch { /* Diagnostics must never prevent playback when storage is full. */ }
}
function audioSessionState() {
  // Safari exposes AudioSession.type while .state is behind a separate flag.
  if (!navigator.audioSession) return "unsupported";
  return navigator.audioSession.state || "unavailable";
}
function diagnosticAudioSessionType() {
  try {
    if (!navigator.audioSession) return "unsupported";
    const type = navigator.audioSession.type;
    return ["auto", "playback", "transient", "transient-solo", "ambient", "play-and-record"].includes(type) ? type : "unavailable";
  } catch { return "unavailable"; }
}
function diagnosticTimeRanges(audio, property) {
  const result = [];
  try {
    // A timed range is not meaningful before metadata. Avoid querying the
    // native buffering/seek state while a new resource is still being opened.
    if (audio.readyState < 1) return result;
    const ranges = audio[property];
    const length = Math.min(3, Math.max(0, Math.floor(ranges.length)));
    for (let index = 0; index < length; index += 1) {
      try {
        const start = ranges.start(index), end = ranges.end(index);
        if (Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end >= start) result.push([Number(start.toFixed(3)), Number(end.toFixed(3))]);
      } catch { /* A range can disappear while the native resource changes. */ }
    }
  } catch { /* Resource diagnostics must not affect playback. */ }
  return result;
}
function diagnosticAudioResource(audio) {
  let duration = null, networkState = null, sourceKind = "unknown";
  try { if (Number.isFinite(audio.duration) && audio.duration >= 0) duration = Number(audio.duration.toFixed(3)); } catch { /* Optional diagnostic only. */ }
  try { if (Number.isInteger(audio.networkState) && audio.networkState >= 0 && audio.networkState <= 3) networkState = audio.networkState; } catch { /* Optional diagnostic only. */ }
  try {
    const extension = new URL(audio.currentSrc || audio.getAttribute("src"), location.href).pathname.split(".").pop().toLowerCase();
    if (["m3u8", "mp3", "m4a", "aac", "wav", "ogg", "webm"].includes(extension)) sourceKind = extension;
  } catch { /* Record only a format label, never a source URL. */ }
  return { networkState, duration, sourceKind, sessionType: diagnosticAudioSessionType(), buffered: diagnosticTimeRanges(audio, "buffered"), seekable: diagnosticTimeRanges(audio, "seekable") };
}

function recordPlaybackEvent(event, detail = "", resource = null) {
  const audio = elements.audio;
  if (!diagnosticAudioIds.has(audio)) diagnosticAudioIds.set(audio, ++nextDiagnosticAudioId);
  playbackEvents.push({ time: Date.now(), run: playbackRun, event, detail, audioId: diagnosticAudioIds.get(audio), session: audioSessionState(), hidden: document.hidden, wanted: playbackWanted, interrupted: interruptedPlayback, mediaState: navigator.mediaSession?.playbackState || "none", position: Math.round((audio.currentTime || 0) * 100) / 100, checkpoint: interruptionPosition ?? savedPlaybackPosition, paused: audio.paused, readyState: audio.readyState, seeking: audio.seeking, playbackRate: audio.playbackRate, clockStage: playbackClockWatch?.stage || "none", clockStalled: playbackClockStalled, errorCode: audio.error?.code || null, muted: audio.muted, volume: audio.volume, ...(resource || diagnosticAudioResource(audio)) });
  if (playbackEvents.length > 80) playbackEvents.shift();
  persistPlaybackEvents();
}
// No keys, URLs or track metadata: useful for diagnosing native event ordering.
window.getMusicPlaybackDiagnostics = () => JSON.stringify({ version: 67, run: playbackRun, userAgent: navigator.userAgent, events: playbackEvents }, null, 2);
recordPlaybackEvent("page-start");
window.addEventListener("pagehide", () => recordPlaybackEvent("page-hide"));
window.addEventListener("pageshow", () => recordPlaybackEvent("page-show"));
document.addEventListener("visibilitychange", () => recordPlaybackEvent("page-visibility", document.hidden ? "hidden" : "visible"));

function configureAudioSession() {
  try {
    if (!navigator.audioSession) return;
    navigator.audioSession.type = "playback";
  } catch { /* Older Safari versions manage the audio session themselves. */ }
}
configureAudioSession();

function cancelPlaybackWatchdog() {
  clearTimeout(playbackWatchdog);
  playbackWatchdog = 0;
  playbackClockWatch?.controller?.abort();
  playbackClockWatch = null;
}
function cancelPlaybackAttempt() {
  resumeAttempt += 1;
  recoveryController?.abort();
  recoveryController = null;
  resumePromise = null;
  cancelPlaybackWatchdog();
  rollbackAudioReplacement();
}
function rollbackAudioReplacement() {
  const replacement = pendingAudioReplacement;
  if (!replacement) return;
  pendingAudioReplacement = null;
  if (elements.audio === replacement.audio) elements.audio = replacement.backup;
  replacement.backup.id = "audio";
  replacement.audio.pause(); replacement.audio.removeAttribute("src"); replacement.audio.load(); replacement.audio.remove();
}
function clearPendingMediaPause() {
  clearTimeout(mediaPauseTimer);
  pendingMediaPause = null;
}
function playbackPosition() {
  return interruptionPosition ?? (Number.isFinite(elements.audio.currentTime) ? elements.audio.currentTime : savedPlaybackPosition);
}
function markPlaybackInterrupted(position = playbackPosition()) {
  if (!playbackWanted || !state.currentTrack) return;
  if (interruptionPosition === null) {
    interruptionPosition = Math.max(0, position || savedPlaybackPosition);
    savedPlaybackPosition = interruptionPosition;
    recordPlaybackEvent("interruption");
  }
  clearPendingMediaPause();
  interruptedPlayback = true;
  outputNeedsReset = true;
  cancelPlaybackAttempt();
  // Do not pause/load or publish MediaSession.paused here. WebKit records the
  // state to restore during capture; changing it can disable native auto-resume.
  setPlaybackButtonState(false, false);
  updateMediaPosition();
}
function pausePlayback() {
  recordPlaybackEvent("manual-pause");
  playbackWanted = false;
  interruptedPlayback = false;
  recentMediaPause = null;
  clearPendingMediaPause();
  cancelPlaybackAttempt();
  elements.audio.pause();
  setPlaybackButtonState(false);
  updateMediaPosition();
}
function handleMediaPause() {
  recordPlaybackEvent("system-pause");
  // Publish inside the native callback, while WebKit protects its saved
  // interruption state. Delaying this keeps the widget stuck on Pause.
  setPlaybackButtonState(false);
  if (!playbackWanted) return;
  if (navigator.audioSession?.state === "interrupted") {
    markPlaybackInterrupted();
    return;
  }
  // WebKit sends the same action for a microphone interruption and a remote
  // user Pause. AudioSession.state is updated on a later task, not synchronously.
  if (!pendingMediaPause) pendingMediaPause = { track: state.currentTrack, position: playbackPosition(), wanted: playbackWanted, nativePaused: elements.audio.paused, started: performance.now(), rearmed: false };
  recentMediaPause = pendingMediaPause;
  setPlaybackButtonState(false, false);
  clearTimeout(mediaPauseTimer);
  pendingMediaPause.deadline = performance.now() + 250;
  const settlePause = () => {
    const pending = pendingMediaPause;
    if (!pending || pending.track !== state.currentTrack) return;
    // A suspended process can deliver this timer before queued AudioSession
    // events after a long voice recording. Give those events one fresh turn;
    // elapsed wall time while suspended is not evidence of a manual Pause.
    if (!pending.rearmed && performance.now() - pending.deadline > 500) {
      pending.rearmed = true;
      pending.deadline = performance.now() + 250;
      mediaPauseTimer = setTimeout(settlePause, 250);
      return;
    }
    const sessionState = navigator.audioSession?.state;
    // With Safari's type-only AudioSession API, a native element Pause is the
    // available interruption signal. Our remote Pause handler has not paused
    // the element yet, so preserve the intent when iOS did it independently.
    if (sessionState === "interrupted" || (!sessionState && pending.nativePaused)) markPlaybackInterrupted(pending.position);
    else {
      pausePlayback();
      // Keep a short-lived checkpoint if the native statechange arrives late.
      recentMediaPause = pending;
    }
  };
  mediaPauseTimer = setTimeout(settlePause, 250);
}

function playWithTimeout(audio, signal, readmitSystemPlayback = false) {
  let timer;
  let abort;
  const cancelled = new Promise((_, reject) => {
    abort = () => reject(new DOMException("Playback cancelled", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
  const started = audio.play();
  // Older WebKit checks whether an active audio session is required BEFORE
  // moving the element's native session from Paused to Playing. A second
  // admission, still inside the explicit remote gesture, can activate that
  // now-Playing session. Keep the loaded resource and observe both promises.
  let admitted = started;
  if (readmitSystemPlayback && !signal?.aborted && !audio.paused && audio.readyState >= 2) {
    recordPlaybackEvent("system-play-readmit");
    admitted = audio.play();
  }
  return Promise.race([
    Promise.all([started, admitted]),
    cancelled,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new DOMException("Playback timed out", "PlaybackTimeoutError")), 8000); }),
  ]).finally(() => { clearTimeout(timer); signal?.removeEventListener("abort", abort); });
}
function waitForAudio(audio, events, ready, signal) {
  return new Promise((resolve, reject) => {
    let timer;
    const clean = () => { clearTimeout(timer); events.forEach((event) => audio.removeEventListener(event, check)); audio.removeEventListener("error", fail); signal.removeEventListener("abort", abort); };
    const check = () => { if (ready()) { clean(); resolve(); } };
    const fail = () => { clean(); reject(new Error("Audio decoder failed")); };
    const abort = () => { clean(); reject(new DOMException("Playback cancelled", "AbortError")); };
    events.forEach((event) => audio.addEventListener(event, check));
    audio.addEventListener("error", fail, { once: true });
    signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => { clean(); reject(new DOMException("Audio readiness timed out", "ReadinessTimeoutError")); }, 8000);
    if (signal.aborted) abort(); else check();
  });
}
async function reloadPlayback(source, position, isCurrent, signal, fresh = false) {
  let audio = elements.audio;
  const rate = audio.playbackRate || 1;
  let oldAudio = null;
  const loadController = new AbortController();
  const abort = () => loadController.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  if (fresh) {
    oldAudio = audio;
    oldAudio.pause();
    audio = audio.cloneNode(false);
    audio.removeAttribute("src");
    oldAudio.id = "audio-recovery-backup";
    audio.id = "audio";
    // Preserve the old, unlocked element until the replacement actually starts.
    oldAudio.after(audio);
    elements.audio = audio;
    pendingAudioReplacement = { audio, backup: oldAudio };
    bindAudioEvents(audio);
  }
  recordPlaybackEvent("decoder-reload", fresh ? "replacement" : "same-element");
  audio.pause();
  audio.muted = false;
  audio.volume = 1;
  configureAudioSession();
  // Both listeners must survive an early play() promise resolution.
  let actuallyPlaying = false;
  const onPlaying = () => { actuallyPlaying = true; };
  audio.addEventListener("playing", onPlaying);
  if (audio.getAttribute("src") !== source) audio.src = source;
  audio.load();
  if (audio.playbackRate !== rate) audio.playbackRate = rate;
  const metadata = waitForAudio(audio, ["loadedmetadata", "durationchange"], () => audio.readyState >= 1, loadController.signal);
  const playing = waitForAudio(audio, ["playing"], () => actuallyPlaying, loadController.signal);
  // Invoke play inside the system/user callback, before any await or network I/O.
  const started = playWithTimeout(audio, loadController.signal);
  const positioned = metadata.then(async () => {
    if (!isCurrent() || elements.audio !== audio) throw new DOMException("Playback cancelled", "AbortError");
    if (position > 0) {
      const target = Number.isFinite(audio.duration) ? Math.min(position, Math.max(0, audio.duration - .05)) : position;
      audio.currentTime = target;
      await waitForAudio(audio, ["seeked", "timeupdate"], () => !audio.seeking && Math.abs(audio.currentTime - target) < 1, loadController.signal);
    }
  });
  try {
    await Promise.all([started, playing, positioned]);
    if (!isCurrent()) throw new DOMException("Playback cancelled", "AbortError");
    if (oldAudio) {
      pendingAudioReplacement = null;
      oldAudio.pause(); oldAudio.removeAttribute("src"); oldAudio.load(); oldAudio.remove();
      audio.id = "audio";
      recordPlaybackEvent("decoder-replaced");
    }
  } catch (error) {
    // Observe every pending rejection, including promises invalidated by load().
    if (oldAudio) {
      // Cancellation rolls back synchronously before Next/Pause can change src.
      // A late rejection must never destroy an element owned by a newer command.
      if (pendingAudioReplacement?.audio === audio) rollbackAudioReplacement();
    }
    throw error;
  } finally {
    audio.removeEventListener("playing", onPlaying);
    signal.removeEventListener("abort", abort);
    loadController.abort();
  }
}
async function continueExistingPlayback(audio, position, restorePosition, signal, readmitSystemPlayback = false) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  configureAudioSession();
  audio.muted = false;
  audio.volume = 1;
  let actuallyPlaying = !audio.paused && audio.readyState >= 3 && !audio.seeking;
  const onPlaying = () => { actuallyPlaying = true; };
  audio.addEventListener("playing", onPlaying);
  try {
    const metadata = restorePosition ? waitForAudio(audio, ["loadedmetadata", "durationchange"], () => audio.readyState >= 1, controller.signal) : Promise.resolve();
    const positioned = metadata.then(async () => {
      if (!restorePosition) return;
      if (controller.signal.aborted || elements.audio !== audio) throw new DOMException("Playback cancelled", "AbortError");
      if (Math.abs(audio.currentTime - position) <= .5) return;
      const target = Number.isFinite(audio.duration) ? Math.min(position, Math.max(0, audio.duration - .05)) : position;
      audio.currentTime = target;
      await waitForAudio(audio, ["seeked", "timeupdate"], () => !audio.seeking && Math.abs(audio.currentTime - target) < 1, controller.signal);
    });
    const playing = waitForAudio(audio, ["playing"], () => actuallyPlaying, controller.signal);
    // Preserve the existing native player and call play in the control gesture.
    // pause()/load() here can deactivate iOS background audio before it resumes.
    const started = playWithTimeout(audio, controller.signal, readmitSystemPlayback);
    await Promise.all([started, playing, positioned]);
  } finally {
    audio.removeEventListener("playing", onPlaying);
    signal.removeEventListener("abort", abort);
    controller.abort();
  }
}

function schedulePlaybackWatchdog() {
  if (!playbackWanted || interruptedPlayback) return;
  const audio = elements.audio;
  const attempt = resumeAttempt;
  // Repeated native playing events are not clock progress and must not postpone
  // the same observation window indefinitely.
  if (playbackClockWatch?.audio === audio && playbackClockWatch.attempt === attempt) {
    if (audio.currentTime <= playbackClockWatch.start + .05) return;
    watchdogRepairs = backgroundWakeAttempts = 0;
    playbackClockStalled = false;
    recordPlaybackEvent("clock-progress", "resample");
  }
  cancelPlaybackWatchdog();
  const watch = { audio, attempt, track: state.currentTrack, start: audio.currentTime, stage: "observe", deadline: 0, wakeGrace: false, controller: null };
  playbackClockWatch = watch;
  const current = () => playbackClockWatch === watch && audio === elements.audio && attempt === resumeAttempt && playbackWanted && state.currentTrack === watch.track;
  const arm = (delay) => {
    clearTimeout(playbackWatchdog);
    watch.deadline = performance.now() + delay;
    playbackWatchdog = setTimeout(check, delay);
  };
  watch.arm = arm;
  const deferBackground = () => {
    interruptionPosition ??= watch.start;
    savedPlaybackPosition = interruptionPosition;
    interruptedPlayback = outputNeedsReset = playbackClockStalled = true;
    // After two observed flat-clock windows, publish paused without pausing the
    // native element. A known microphone interruption still keeps its restore
    // state; an opaque timed-out paused capture follows the separate play path.
    setPlaybackButtonState(false, navigator.audioSession?.state !== "interrupted");
    updateMediaPosition();
    recordPlaybackEvent("background-clock-deferred", watch.stage);
    cancelPlaybackWatchdog();
  };
  const check = () => {
    if (!current()) return;
    if (audio.ended || audio.seeking || audio.paused || audio.readyState < 3) { cancelPlaybackWatchdog(); return; }
    if (audio.currentTime > watch.start + .05) {
      watchdogRepairs = backgroundWakeAttempts = 0;
      playbackClockStalled = false;
      recordPlaybackEvent("clock-progress", watch.stage);
      cancelPlaybackWatchdog();
      return;
    }
    // A frozen WebProcess can deliver a timer immediately after wake. Elapsed
    // wall time is not a complete observation of the restarted native clock.
    if (!watch.wakeGrace && performance.now() - watch.deadline > 1000) {
      watch.wakeGrace = true;
      watch.start = audio.currentTime;
      recordPlaybackEvent("clock-wake-grace", watch.stage);
      arm(document.hidden ? 3000 : 1500);
      return;
    }
    if (audio.currentTime < watch.start - .05) {
      watch.start = audio.currentTime;
      arm(document.hidden ? 3000 : 1500);
      return;
    }
    if (document.hidden) {
      if (watch.stage === "probe" || backgroundWakeAttempts >= 1) { deferBackground(); return; }
      // A new element has no background playback admission. Keep the unlocked
      // player alive and reissue its existing rate to AVPlayer, then play once.
      // WebKit forwards even a same-value rate assignment to the native engine.
      if (navigator.audioSession?.state === "interrupted") { deferBackground(); return; }
      watch.stage = "probe";
      backgroundWakeAttempts += 1;
      playbackClockStalled = true;
      watch.controller = new AbortController();
      recordPlaybackEvent("background-clock-wake");
      arm(3000);
      try {
        configureAudioSession();
        audio.muted = false; audio.volume = 1;
        audio.playbackRate = audio.playbackRate || 1;
        void playWithTimeout(audio, watch.controller.signal).catch((error) => {
          if (current()) recordPlaybackEvent("background-clock-wake-rejected", error.name || "Error");
        });
      } catch (error) { if (current()) recordPlaybackEvent("background-clock-wake-rejected", error.name || "Error"); }
      return;
    }
    if (watchdogRepairs >= 1) {
      markPlaybackInterrupted(watch.start);
      setPlaybackButtonState(false);
      recordPlaybackEvent("decoder-still-stalled");
      setStatus("Аудиовывод не возобновился. Нажмите Play в системном плеере.", true);
      return;
    }
    watchdogRepairs += 1;
    recordPlaybackEvent("decoder-stalled");
    playbackClockStalled = true;
    markPlaybackInterrupted(watch.start);
    void resumePlayback(true, true);
  };
  arm(document.hidden ? 3000 : 1500);
}

function resumePlayback(force = false, fresh = false, fromControl = false, fromSystem = false) {
  const readmitSystemPlayback = fromSystem && isIOS && document.hidden &&
    (!playbackWanted || playbackClockStalled) && navigator.audioSession?.state !== "interrupted";
  playbackWanted = true;
  clearPendingMediaPause();
  recentMediaPause = null;
  if (fromControl) {
    recordPlaybackEvent("control-play", fromSystem ? "system" : "ui");
    cancelPlaybackWatchdog();
    backgroundWakeAttempts = watchdogRepairs = 0;
    // A new control callback carries a fresh activation. A suspended timer or
    // an old pending play promise must not consume that new attempt.
    if (resumePromise) { recordPlaybackEvent("control-replaces-pending"); cancelPlaybackAttempt(); }
  }
  if (!fromControl && navigator.audioSession?.state === "interrupted") {
    markPlaybackInterrupted();
    recordPlaybackEvent("resume-deferred-for-capture");
    return Promise.resolve(false);
  }
  // Native Play, AudioSession and foreground notifications can arrive together.
  if (resumePromise) return resumePromise;
  const audio = elements.audio;
  const source = audio.getAttribute("src");
  if (!source || !state.currentTrack) return Promise.resolve(false);
  const attempt = ++resumeAttempt;
  const track = state.currentTrack;
  const position = outputNeedsReset ? savedPlaybackPosition : playbackPosition();
  const controller = new AbortController();
  recoveryController = controller;
  const isCurrent = () => attempt === resumeAttempt && playbackWanted && state.currentTrack === track && !controller.signal.aborted;
  // The iPhone trace showed background load()+seek stuck at HAVE_METADATA for
  // minutes until foregrounding. Even an explicit remote gesture must retain
  // the loaded player. Rebuilding a failed decoder is a foreground fallback.
  const resetOutput = (force || (fromControl && playbackClockStalled)) && !document.hidden;
  const restorePosition = outputNeedsReset || interruptionPosition !== null;
  if (resetOutput || restorePosition) {
    // A replacement may have currentTime=0 until metadata arrives. Never let
    // Pause/cancellation overwrite the position captured before its creation.
    interruptionPosition ??= position;
    savedPlaybackPosition = interruptionPosition;
    outputNeedsReset = true;
  }
  let resolveResume;
  let preserveNativeInterruption = false;
  const promise = new Promise((resolve) => { resolveResume = resolve; });
  resumePromise = promise;
  recordPlaybackEvent("resume", resetOutput ? "repair" : "play");
  void (async () => {
    try {
      try {
        if (resetOutput) await reloadPlayback(source, position, isCurrent, controller.signal, fresh && !document.hidden);
        else await continueExistingPlayback(audio, position, restorePosition, controller.signal, readmitSystemPlayback);
      } catch (error) {
        if (!isCurrent()) return false;
        const sessionState = navigator.audioSession?.state;
        const unknownCapture = !fromControl && !resetOutput && interruptedPlayback && !sessionState && !elements.audio.error && error.name !== "NotSupportedError";
        preserveNativeInterruption = unknownCapture && document.hidden;
        // An opaque session's pending play may time out during a long voice
        // recording. That is not proof of decoder failure: keep this automatic
        // probe play-only, preserving the native player until capture ends.
        if (error.name === "NotAllowedError" || (!fromControl && sessionState === "interrupted") || unknownCapture || document.hidden) throw error;
        // One fresh decoder attempt. Refresh a rejected/expired source first;
        // an otherwise stalled decoder does not need another backend request.
        let refreshedSource = source;
        if (error.name === "NotSupportedError" || elements.audio.error) {
          const requestController = new AbortController();
          const cancelRequest = () => requestController.abort();
          controller.signal.addEventListener("abort", cancelRequest, { once: true });
          const timer = setTimeout(() => requestController.abort(), 10000);
          let data;
          try { data = await api(`/api/tracks/${encodeURIComponent(track.ownerId)}/${encodeURIComponent(track.id)}`, requestController.signal); }
          finally { clearTimeout(timer); controller.signal.removeEventListener("abort", cancelRequest); }
          if (!isCurrent()) return false;
          if (!data.result.track?.fileUrl) throw new Error("Нет ссылки на трек");
          refreshedSource = data.result.track.fileUrl;
          track.fileUrl = refreshedSource;
        }
        if (fresh) throw error;
        await reloadPlayback(refreshedSource, position, isCurrent, controller.signal, true);
      }
      if (!isCurrent()) return false;
      if (elements.audio.paused) throw new Error("Audio session is not ready");
      if (pendingMediaPause) return false;
      interruptedPlayback = false;
      outputNeedsReset = false;
      interruptionPosition = null;
      setPlaybackButtonState(true);
      updateMediaPosition();
      schedulePlaybackWatchdog();
      recordPlaybackEvent("resumed");
      return true;
    } catch (error) {
      if (isCurrent()) {
        interruptedPlayback = true;
        outputNeedsReset = true;
        interruptionPosition ??= position;
        savedPlaybackPosition = interruptionPosition;
        // A late publication outside the native Pause callback can overwrite
        // WebKit's saved Playing state during an opaque background capture.
        setPlaybackButtonState(false, !preserveNativeInterruption && (fromControl || navigator.audioSession?.state !== "interrupted"));
        recordPlaybackEvent(preserveNativeInterruption ? "resume-held-for-capture" : "resume-failed", error.name || "Error");
        if (!preserveNativeInterruption) setStatus(error.name === "NotAllowedError" ? "iOS не разрешила автопродолжение. Нажмите Play в системном плеере." : "Не удалось продолжить воспроизведение. Нажмите Play ещё раз.", true);
      }
      return false;
    } finally {
      if (attempt === resumeAttempt) { resumePromise = null; recoveryController = null; }
    }
  })().then(resolveResume);
  return promise;
}
function resumeAfterInterruption(allowBackground = false) {
  if ((!document.hidden || allowBackground === true) && interruptedPlayback && playbackWanted && navigator.audioSession?.state !== "interrupted") void resumePlayback();
  else if (!document.hidden && playbackWanted && !pendingMediaPause && !resumePromise) schedulePlaybackWatchdog();
}
function onPlaybackForeground() {
  if (document.hidden) {
    foregroundRepairPending = playbackWanted;
    return;
  }
  const returnedWhilePlaying = foregroundRepairPending;
  foregroundRepairPending = false;
  // Let a queued AudioSession statechange run before deciding a remote Pause.
  if (pendingMediaPause) handleMediaPause();
  if (returnedWhilePlaying && playbackWanted && !pendingMediaPause && !resumePromise && !interruptedPlayback) {
    // Another app may interrupt without a web event. Try the existing player
    // on return; rebuild it only if playback fails or its clock stays stalled.
    recordPlaybackEvent("foreground-resume-check");
    void resumePlayback();
  } else resumeAfterInterruption();
}
document.addEventListener("visibilitychange", onPlaybackForeground);
window.addEventListener("pageshow", onPlaybackForeground);
window.addEventListener("focus", onPlaybackForeground);
let previousAudioSessionState = navigator.audioSession?.state;
navigator.audioSession?.addEventListener("statechange", () => {
  const sessionState = navigator.audioSession.state;
  const wasInterrupted = previousAudioSessionState === "interrupted";
  previousAudioSessionState = sessionState;
  recordPlaybackEvent("session-state", sessionState || "unavailable");
  if (!sessionState) {
    // Safari can dispatch statechange without exposing its state property.
    // A paused interrupted player may now be admitted by the native session;
    // try the existing element, letting iOS reject capture that is still active.
    if (playbackWanted && interruptedPlayback && elements.audio.paused && !resumePromise && !pendingMediaPause) void resumePlayback();
    return;
  }
  if (sessionState === "interrupted") {
    const pending = pendingMediaPause || recentMediaPause;
    if (!playbackWanted && pending?.wanted && pending.track === state.currentTrack && performance.now() - pending.started < 1500) playbackWanted = true;
    markPlaybackInterrupted(pending?.position);
    recentMediaPause = null;
  } else if (wasInterrupted) resumeAfterInterruption(true);
});
function updateMediaPosition() {
  const audio = elements.audio;
  if (!navigator.mediaSession?.setPositionState || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
  try { navigator.mediaSession.setPositionState({ duration: audio.duration, playbackRate: audio.playbackRate || 1, position: Math.min(audio.duration, Math.max(0, outputNeedsReset ? savedPlaybackPosition : audio.currentTime || 0)) }); } catch { /* Unsupported position reporting on older Safari. */ }
}
function seekPlayback(position) {
  let audio = elements.audio;
  if (!Number.isFinite(position)) return;
  const target = Math.max(0, Number.isFinite(audio.duration) ? Math.min(position, audio.duration) : position);
  const wasRecovering = Boolean(resumePromise);
  if (wasRecovering) { cancelPlaybackAttempt(); audio = elements.audio; }
  savedPlaybackPosition = target;
  if (interruptionPosition !== null) interruptionPosition = target;
  if (pendingMediaPause) pendingMediaPause.position = target;
  // finishSeek queues timeupdate before seeked; update the clock baseline now
  // so the seek jump cannot masquerade as resumed native playback.
  if (playbackClockWatch?.audio === audio) {
    playbackClockWatch.start = target;
    playbackClockWatch.arm(document.hidden ? 3000 : 1500);
  }
  if (audio.readyState >= 1) audio.currentTime = target;
  updateMediaPosition();
  if (wasRecovering && playbackWanted && navigator.audioSession?.state !== "interrupted") void resumePlayback();
}
function bindAudioEvents(audio) {
  const current = () => elements.audio === audio;
  for (const event of ["loadstart", "loadedmetadata", "canplay", "waiting", "seeking", "seeked", "suspend", "stalled", "emptied", "abort"]) {
    audio.addEventListener(event, () => {
      if (!current()) return;
      const resource = diagnosticAudioResource(audio);
      // Native waiting/suspend notifications can repeat without a state change.
      // Keep transitions and all seek/load ordering without flooding the ring.
      if (["canplay", "waiting", "suspend"].includes(event)) {
        let recent = diagnosticLifecycleEvents.get(audio);
        if (!recent) diagnosticLifecycleEvents.set(audio, recent = new Map());
        const signature = JSON.stringify([audio.readyState, audio.paused, audio.seeking, resource]);
        const previous = recent.get(event), now = Date.now();
        if (previous?.signature === signature && now - previous.time < 1000) return;
        recent.set(event, { signature, time: now });
      } else if (event === "loadstart") diagnosticLifecycleEvents.delete(audio);
      recordPlaybackEvent(`audio-${event}`, "", resource);
    });
  }
  audio.addEventListener("playing", () => {
    if (!current()) return;
    recordPlaybackEvent("audio-playing");
    if (!playbackWanted) { audio.pause(); return; }
    if (resumePromise) return;
    // Another playing notification alone cannot complete a confirmed clock
    // stall or turn the widget back to Pause. Real time progression below can.
    if (playbackClockStalled) return;
    const nativePause = pendingMediaPause?.nativePaused;
    if (pendingMediaPause) {
      if (!nativePause) return;
      clearPendingMediaPause(); recentMediaPause = null;
    }
    const wasInterrupted = interruptedPlayback || outputNeedsReset || nativePause;
    if (wasInterrupted && interruptionPosition !== null && audio.readyState >= 1 && Math.abs(audio.currentTime - interruptionPosition) > .5) {
      const target = Number.isFinite(audio.duration) ? Math.min(interruptionPosition, Math.max(0, audio.duration - .05)) : interruptionPosition;
      audio.currentTime = target;
    }
    // Native playing is stronger evidence than a missing/stale AudioSession
    // getter. Do not destroy successful iOS auto-resume with pause/load.
    interruptedPlayback = false;
    outputNeedsReset = false;
    interruptionPosition = null;
    if (wasInterrupted) recordPlaybackEvent("native-resumed");
    setPlaybackButtonState(true); schedulePlaybackWatchdog();
  });
  audio.addEventListener("pause", () => {
    if (!current()) return;
    recordPlaybackEvent("audio-pause");
    if (pendingMediaPause) pendingMediaPause.nativePaused = true;
    if (playbackWanted && !audio.ended && !resumePromise && !pendingMediaPause) markPlaybackInterrupted();
    setPlaybackButtonState(false, !playbackWanted);
  });
  audio.addEventListener("timeupdate", () => {
    if (!current()) return;
    const checkpoint = interruptionPosition ?? playbackClockWatch?.start ?? savedPlaybackPosition;
    if (playbackClockStalled && playbackWanted && !resumePromise && !audio.paused && !audio.seeking && audio.readyState >= 3 && audio.currentTime > checkpoint + .05) {
      interruptedPlayback = outputNeedsReset = playbackClockStalled = false;
      interruptionPosition = null;
      watchdogRepairs = backgroundWakeAttempts = 0;
      recordPlaybackEvent("clock-progress", "wake");
      cancelPlaybackWatchdog();
      setPlaybackButtonState(true);
    }
    const { duration } = audio;
    const currentTime = outputNeedsReset ? savedPlaybackPosition : audio.currentTime;
    if (!outputNeedsReset && !pendingMediaPause && Number.isFinite(currentTime) && currentTime > 0) savedPlaybackPosition = currentTime;
    elements.currentTime.textContent = formatTime(currentTime); elements.duration.textContent = formatTime(duration);
    const progress = Number.isFinite(duration) && duration > 0 ? (currentTime / duration) * 100 : 0;
    elements.seek.value = String(progress); elements.miniProgress.style.width = `${progress}%`;
    updateMediaPosition();
  });
  audio.addEventListener("loadedmetadata", updateMediaPosition);
  audio.addEventListener("seeked", () => {
    if (!current()) return;
    updateMediaPosition();
    if (playbackClockWatch?.audio === audio) {
      playbackClockWatch.start = audio.currentTime;
      playbackClockWatch.arm(document.hidden ? 3000 : 1500);
    }
  });
  audio.addEventListener("ended", () => { if (current() && playbackWanted && !outputNeedsReset && !resumePromise) moveTrack(1); });
  audio.addEventListener("error", () => {
    if (!current() || resumePromise) return;
    setPlaybackButtonState(false, false);
    if (playbackWanted) { markPlaybackInterrupted(); if (navigator.audioSession?.state !== "interrupted") void resumePlayback(); }
  });
}
bindAudioEvents(elements.audio);

async function playTrack(track, queue) {
  if (!track?.fileUrl) return setStatus("У этого трека нет ссылки для воспроизведения", true);
  interruptedPlayback = false;
  outputNeedsReset = false;
  clearPendingMediaPause(); recentMediaPause = null; cancelPlaybackAttempt();
  savedPlaybackPosition = 0; interruptionPosition = null; watchdogRepairs = backgroundWakeAttempts = 0; playbackClockStalled = false;
  state.playbackQueue = queue; state.currentTrackKey = trackKey(track); state.currentTrack = track; elements.audio.src = track.fileUrl;
  elements.seek.value = "0"; elements.miniProgress.style.width = "0%"; elements.trackLabel.textContent = "Сейчас играет";
  elements.trackTitle.textContent = track.title; elements.trackArtist.textContent = artistForTrack(track).name; elements.trackArtist.disabled = false;
  elements.trackAlbum.textContent = track.album?.title || "";
  elements.trackAlbum.hidden = elements.trackAlbumSeparator.hidden = !track.album?.id; elements.miniTrackTitle.textContent = track.title; elements.miniTrackArtist.textContent = track.artist;
  elements.miniPlayer.hidden = false; const artwork = artworkFor(track);
  elements.coverImage.hidden = !artwork; elements.coverFallback.hidden = Boolean(artwork); elements.miniCoverImage.hidden = !artwork; elements.miniCoverFallback.hidden = Boolean(artwork);
  if (artwork) { elements.coverImage.src = artwork; elements.miniCoverImage.src = artwork; }
  renderLibraryTracks(); renderSearchResults(); if (state.currentCollection) renderCollection();
  elements.playerLibraryStatus.hidden = true;
  renderTrackLike();
  if ("mediaSession" in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist, album: track.album?.title || "VK Music", artwork: artwork ? [{ src: artwork }] : [] });
  if (await resumePlayback()) setStatus("Воспроизведение");
}
function moveTrack(offset) {
  if (!state.playbackQueue.length) return;
  const activeIndex = state.playbackQueue.findIndex((track) => trackKey(track) === state.currentTrackKey); const current = activeIndex < 0 ? 0 : activeIndex;
  playTrack(state.playbackQueue[(current + offset + state.playbackQueue.length) % state.playbackQueue.length], state.playbackQueue);
}

elements.setupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = elements.setupForm.querySelector("button[type=submit]");
  submitButton.disabled = true;
  try {
    state.config = { backendUrl: normalizeBackendUrl(elements.backendUrlInput.value), apiKey: elements.apiKeyInput.value.trim() };
    localStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(state.config));
    setSettingsStatus("Подключаюсь…");
    if (await loadLibrary()) setSettingsStatus("Подключение сохранено.");
  } catch (error) { setSettingsStatus(error.message, true); }
  finally { submitButton.disabled = false; }
});
elements.settingsButton.addEventListener("click", openSettings);
elements.playbackDiagnosticsButton.addEventListener("click", async () => {
  try {
    recordPlaybackEvent("diagnostics-copy");
    await navigator.clipboard.writeText(window.getMusicPlaybackDiagnostics());
    elements.playbackDiagnosticsStatus.textContent = "Диагностика скопирована. Ключ доступа и ссылки на треки в неё не входят.";
  } catch {
    elements.playbackDiagnosticsStatus.textContent = "Не удалось скопировать диагностику. Попробуйте ещё раз.";
  }
  elements.playbackDiagnosticsStatus.hidden = false;
});
elements.closeSetupButton.addEventListener("click", () => { void goBack(); });
elements.searchForm.addEventListener("submit", (event) => { event.preventDefault(); searchMusic(elements.searchInput.value); elements.searchInput.blur(); });
elements.searchInput.addEventListener("input", () => { updateSearchFocusPreview(); scheduleSuggestions(); });
elements.searchInput.addEventListener("pointerdown", (event) => {
  if (event.isPrimary && event.button === 0 &&
    (document.activeElement !== elements.searchInput || (isIOS && !isKeyboardOpen() && !searchActivatedByGesture))) {
    event.preventDefault();
    focusSearchInput(true);
  }
});
elements.searchInput.addEventListener("focus", scheduleSuggestions);
elements.searchInput.addEventListener("blur", () => { finishSearchFocus(); searchActivatedByGesture = false; });
function clearSearchAndFocus() {
  clearSearch(true); updateSearchFocusPreview(); focusSearchInput(true);
}
let clearSearchPointerId = null;
let clearSearchPointerHandled = false;
elements.clearSearchButton.addEventListener("pointerdown", (event) => {
  clearSearchPointerHandled = false;
  if (event.isPrimary && event.button === 0 && document.activeElement === elements.searchInput) {
    event.preventDefault();
    clearSearchPointerId = event.pointerId;
    clearSearchPointerHandled = true;
    elements.clearSearchButton.setPointerCapture(event.pointerId);
  }
});
elements.clearSearchButton.addEventListener("pointerup", (event) => {
  if (clearSearchPointerId !== event.pointerId) return;
  clearSearchPointerId = null;
  const bounds = elements.clearSearchButton.getBoundingClientRect();
  if (event.clientX >= bounds.left && event.clientX <= bounds.right &&
    event.clientY >= bounds.top && event.clientY <= bounds.bottom) clearSearchAndFocus();
});
elements.clearSearchButton.addEventListener("pointercancel", () => { clearSearchPointerId = null; });
elements.clearSearchButton.addEventListener("click", (event) => {
  if (!clearSearchPointerHandled || event.detail === 0) clearSearchAndFocus();
});
elements.librarySwitcher.addEventListener("click", (event) => { if (event.target.dataset.libraryView) { state.libraryView = event.target.dataset.libraryView; renderPersonalLibrary(); } });
elements.collectionBackButton.addEventListener("click", () => { void goBack(); });
elements.collectionPlayButton.addEventListener("click", () => { const tracks = state.currentCollection?.tracks || []; if (tracks.length) playTrack(tracks[0], tracks); });
elements.collectionShuffleButton.addEventListener("click", () => { const tracks = shuffled(state.currentCollection?.tracks || []); if (tracks.length) playTrack(tracks[0], tracks); });
elements.collectionMixButton.addEventListener("click", () => { if (state.currentView === "album") createAndOpenMix({ kind: "album", album: state.currentCollection }); });
elements.openPlayerButton.addEventListener("click", () => showPlayer(true)); elements.closePlayerButton.addEventListener("click", () => showPlayer(false));
elements.trackArtist.addEventListener("click", () => { if (state.currentTrack) void openArtist(artistForTrack(state.currentTrack)); });
elements.trackAlbum.addEventListener("click", () => {
  const album = albumFromTrack(state.currentTrack);
  if (album) { void openAlbum(album); }
});
elements.collectionArtist.addEventListener("click", () => { if (state.currentCollection?.artist) void openArtist(state.currentCollection.artist); });
elements.artistBackButton.addEventListener("click", () => { void goBack(); });
elements.artistPlayButton.addEventListener("click", () => {
  const tracks = state.currentArtist?.tracks || [];
  if (tracks.length) void playTrack(tracks[0], tracks);
});
elements.playerMixButton.addEventListener("click", () => { if (state.currentTrack) createAndOpenMix({ kind: "track", track: state.currentTrack }); });
elements.playerLikeButton.addEventListener("click", toggleTrackLike);
elements.miniMixButton.addEventListener("click", () => { if (state.currentTrack) createAndOpenMix({ kind: "track", track: state.currentTrack }); });
elements.actionSheetMixButton.addEventListener("click", () => { if (state.actionTrack) createAndOpenMix({ kind: "track", track: state.actionTrack }); });
elements.actionSheetCloseButton.addEventListener("click", closeTrackActions); elements.actionSheetBackdrop.addEventListener("click", closeTrackActions);
elements.playButton.addEventListener("click", () => {
  if (!elements.audio.src) {
    const initialQueue = state.searchActive && state.searchTracks.length ? state.searchTracks.slice(0, SEARCH_RESULT_LIMIT) : state.libraryTracks;
    if (initialQueue.length) playTrack(initialQueue[0], initialQueue);
  } else if (elements.audio.paused || interruptedPlayback || outputNeedsReset) void resumePlayback(false, false, true); else pausePlayback();
});
elements.miniPlayButton.addEventListener("click", () => { if (elements.audio.paused || interruptedPlayback || outputNeedsReset) void resumePlayback(false, false, true); else pausePlayback(); });
elements.previousButton.addEventListener("click", () => moveTrack(-1)); elements.nextButton.addEventListener("click", () => moveTrack(1)); elements.miniNextButton.addEventListener("click", () => moveTrack(1));
elements.seek.addEventListener("input", () => {
  if (Number.isFinite(elements.audio.duration)) {
    seekPlayback((Number(elements.seek.value) / 100) * elements.audio.duration);
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!elements.trackActionSheet.hidden) closeTrackActions(); else if (!elements.fullPlayer.hidden) showPlayer(false); else if (state.currentView !== "home") void goBack();
});
if ("mediaSession" in navigator) {
  const actions = {
    play: () => { void resumePlayback(false, false, true, true); }, pause: handleMediaPause,
    previoustrack: () => moveTrack(-1), nexttrack: () => moveTrack(1),
    seekto: ({ seekTime }) => seekPlayback(seekTime),
    seekbackward: ({ seekOffset = 10 }) => seekPlayback(playbackPosition() - seekOffset),
    seekforward: ({ seekOffset = 10 }) => seekPlayback(playbackPosition() + seekOffset),
  };
  for (const [action, handler] of Object.entries(actions)) {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* Older iOS may omit individual actions. */ }
  }
}
if ("serviceWorker" in navigator) navigator.serviceWorker.register("../sw.js", { scope: "../" });

const defaultBackendUrl = ["localhost", "127.0.0.1"].includes(location.hostname) ? "http://localhost:8787" : PUBLIC_BACKEND_URL;
if (!state.config.backendUrl || LEGACY_BACKEND_URLS.has(state.config.backendUrl)) {
  state.config.backendUrl = defaultBackendUrl; localStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(state.config));
}
elements.backendUrlInput.value = state.config.backendUrl; elements.apiKeyInput.value = state.config.apiKey || "";
setHomeTab("search"); renderPersonalLibrary(); renderTrackLike();
focusSearchInput();
loadLibrary();
