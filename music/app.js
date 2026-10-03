const CONNECTION_STORAGE_KEY = "pashaMusicConnectionV1";
const LIBRARY_STORAGE_KEY = "pashaMusicLibraryV2";
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
  "bottomBar", "homeTabs", "libraryHomeView", "librarySwitcher", "mainScreen", "miniCoverFallback", "miniCoverImage", "miniMixButton", "miniNextButton", "miniPlayButton", "miniPlayer",
  "miniProgress", "miniTrackArtist", "miniTrackTitle", "nextButton", "openPlayerButton", "personalLibraryCount", "playButton",
  "playerMixButton", "previousButton", "searchAlbumGroup", "searchAlbumList", "searchForm", "searchInput", "searchFocusPreview",
  "searchResultList", "searchResults", "searchSuggestions", "searchTrackGroup", "sectionTabs", "sectionTitle",
  "searchHomeView", "seek", "settingsButton", "settingsScreen", "settingsStatus", "setupForm", "status", "trackActionSheet", "trackArtist", "trackCount", "trackLabel",
  "trackList", "trackTitle", "trackAlbum", "trackAlbumSeparator",
  "artistScreen", "artistBackButton", "artistTitle", "artistStatus", "artistTrackList", "artistAlbumList", "artistHero", "artistImage", "artistPlayButton",
];
const elements = Object.fromEntries(elementIds.map((id) => [id, document.getElementById(id)]));

class CatMascot {
  constructor(element) {
    this.element = element;
    this.isPlaying = false;
  }

  get isPlaying() { return this._isPlaying; }

  set isPlaying(value) {
    this._isPlaying = Boolean(value);
    const stateName = this._isPlaying ? "playing" : "idle";
    this.element.dataset.state = stateName;
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
  };
}

const state = {
  config: readJson(CONNECTION_STORAGE_KEY, {}),
  library: normalizeStoredLibrary(readJson(LIBRARY_STORAGE_KEY, {})),
  sections: [], currentSectionId: null, libraryTracks: [], libraryView: "albums",
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
function saveLibrary() { localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(state.library)); }
function setSettingsStatus(message, isError = false) {
  elements.settingsStatus.textContent = message;
  elements.settingsStatus.hidden = !message;
  elements.settingsStatus.classList.toggle("error", isError);
}
function reportConnectionError(error) {
  let message = error.message || "Не удалось подключиться к музыке.";
  if (error.name === "TypeError" || /load failed|failed to fetch|networkerror/i.test(message)) {
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
function setHomeTab(tab) {
  state.homeTab = tab === "library" ? "library" : "search";
  const showingSearch = state.homeTab === "search";
  elements.searchHomeView.hidden = !showingSearch;
  elements.libraryHomeView.hidden = showingSearch;
  elements.homeTabs.querySelectorAll("[data-home-tab]").forEach((button) => {
    const active = button.dataset.homeTab === state.homeTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  elements.mainScreen.scrollTo({ top: 0, behavior: "auto" });
  elements.collectionScreen.scrollTo({ top: 0, behavior: "auto" });
  elements.artistScreen.scrollTo({ top: 0, behavior: "auto" });
}
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
  elements.homeTabs.hidden = view !== "home";
  elements.bottomBar.hidden = view !== "home";
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
function setPlaybackButtonState(isPlaying) {
  const label = isPlaying ? "Пауза" : "Воспроизвести";
  elements.playButton.querySelector(".player-play-icon").toggleAttribute("hidden", isPlaying);
  elements.playButton.querySelector(".player-pause-icon").toggleAttribute("hidden", !isPlaying);
  elements.miniPlayButton.querySelector(".mini-play-icon").toggleAttribute("hidden", isPlaying);
  elements.miniPlayButton.querySelector(".mini-pause-icon").toggleAttribute("hidden", !isPlaying);
  elements.playButton.setAttribute("aria-label", label); elements.miniPlayButton.setAttribute("aria-label", label);
  catMascot.isPlaying = isPlaying;
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
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
  elements.trackCount.textContent = `${state.libraryTracks.length} треков`;
  if (!state.libraryTracks.length) {
    elements.trackList.replaceChildren(Object.assign(document.createElement("div"), { className: "empty", textContent: "В этом разделе пока нет доступных треков." })); return;
  }
  elements.trackList.replaceChildren(...state.libraryTracks.map((track) => createTrackRow(track, state.libraryTracks)));
}
function renderPersonalLibrary() {
  const showingAlbums = state.libraryView === "albums";
  elements.libraryAlbumList.hidden = !showingAlbums; elements.libraryPlaylistList.hidden = showingAlbums;
  elements.librarySwitcher.querySelectorAll("[data-library-view]").forEach((button) => button.classList.toggle("active", button.dataset.libraryView === state.libraryView));
  if (showingAlbums) {
    elements.personalLibraryCount.textContent = `${state.library.albums.length} альбомов`;
    elements.libraryAlbumList.replaceChildren(...state.library.albums.map(createAlbumCard));
    if (!state.library.albums.length) elements.libraryAlbumList.append(Object.assign(document.createElement("div"), { className: "empty library-empty", textContent: "Альбомы из вашей музыки появятся здесь." }));
  } else {
    elements.personalLibraryCount.textContent = `${state.library.playlists.length} плейлистов`;
    elements.libraryPlaylistList.replaceChildren(...state.library.playlists.map(createPlaylistCard));
    if (!state.library.playlists.length) elements.libraryPlaylistList.append(Object.assign(document.createElement("div"), { className: "empty library-empty", textContent: "Создайте первый микс из меню трека." }));
  }
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
async function loadSection(sectionId) {
  if (!sectionId) return true;
  try {
    state.currentSectionId = sectionId; clearSearch(true); renderSections(); setStatus("Загружаю треки…");
    const data = await api(`/api/sections/${encodeURIComponent(sectionId)}`);
    state.libraryTracks = data.result.tracks || []; elements.sectionTitle.textContent = data.result.title || "Треки";
    mergeAlbumsFromTracks(state.libraryTracks, true); renderLibraryTracks(); renderPersonalLibrary();
    setStatus(state.libraryTracks.length ? "" : "Раздел пуст");
    return true;
  } catch (error) { reportConnectionError(error); return false; }
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
  try {
    setStatus("Подключаюсь к VK Music…"); const health = await api("/api/health");
    if (!health.hasCookieP || !health.hasRemixSid) throw new Error("На backend не настроены VK cookies");
    const data = await api("/api/sections"); state.sections = data.result.sections || []; renderSections();
    const sectionId = data.result.defaultSection || state.sections[0]?.id;
    if (!sectionId) { setStatus(""); return true; }
    return await loadSection(sectionId);
  } catch (error) { reportConnectionError(error); return false; }
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
let resumePromise = null;
let resumeAttempt = 0;
let savedPlaybackPosition = 0;

// Where supported, tell iOS this audio belongs to a media playback session.
try {
  if (navigator.audioSession) navigator.audioSession.type = "playback";
} catch { /* Older Safari versions manage the audio session themselves. */ }

function pausePlayback() {
  playbackWanted = false;
  interruptedPlayback = false;
  resumeAttempt += 1;
  resumePromise = null;
  elements.audio.pause();
}

function playWithTimeout(audio) {
  let timer;
  return Promise.race([
    audio.play(),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Playback timed out")), 8000); }),
  ]).finally(() => clearTimeout(timer));
}

function resumePlayback(force = false) {
  playbackWanted = true;
  if (resumePromise && !force) return resumePromise;
  const audio = elements.audio;
  if (!audio.getAttribute("src")) return Promise.resolve(false);
  const attempt = ++resumeAttempt;
  const track = state.currentTrack;
  const source = audio.getAttribute("src");
  const position = Math.max(audio.currentTime || 0, savedPlaybackPosition);
  const isCurrent = () => attempt === resumeAttempt && playbackWanted && state.currentTrack === track;
  const promise = (async () => {
    try {
      try {
        await playWithTimeout(audio);
      } catch (error) {
        if (!isCurrent()) return false;
        // A denied autoplay still needs an explicit user/system Play command.
        if (error.name === "NotAllowedError") throw error;
        let refreshedSource = source;
        if (track) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 10000);
          let data;
          try {
            data = await api(`/api/tracks/${encodeURIComponent(track.ownerId)}/${encodeURIComponent(track.id)}`, controller.signal);
          } finally { clearTimeout(timer); }
          if (!isCurrent()) return false;
          if (!data.result.track?.fileUrl) throw new Error("Нет ссылки на трек");
          refreshedSource = data.result.track.fileUrl;
          track.fileUrl = refreshedSource;
        }
        const restorePosition = () => {
          if (!isCurrent()) return;
          if (position > 0) {
            audio.currentTime = Number.isFinite(audio.duration) ? Math.min(position, audio.duration) : position;
          }
        };
        audio.addEventListener("loadedmetadata", restorePosition, { once: true });
        audio.src = refreshedSource;
        audio.load();
        try { await playWithTimeout(audio); }
        finally { audio.removeEventListener("loadedmetadata", restorePosition); }
      }
      if (!isCurrent()) return false;
      interruptedPlayback = false;
      setPlaybackButtonState(true);
      return true;
    } catch {
      if (isCurrent()) {
        interruptedPlayback = true;
        setPlaybackButtonState(false);
        setStatus("Не удалось продолжить воспроизведение. Нажмите Play ещё раз.", true);
      }
      return false;
    } finally { if (attempt === resumeAttempt) resumePromise = null; }
  })();
  resumePromise = promise;
  return promise;
}

function resumeAfterInterruption(allowBackground = false) {
  if ((!document.hidden || allowBackground === true) && interruptedPlayback && playbackWanted && elements.audio.paused && !elements.audio.ended) {
    void resumePlayback();
  }
}
document.addEventListener("visibilitychange", resumeAfterInterruption);
window.addEventListener("pageshow", resumeAfterInterruption);
window.addEventListener("focus", resumeAfterInterruption);
navigator.audioSession?.addEventListener("statechange", () => {
  if (navigator.audioSession.state === "interrupted" && playbackWanted) interruptedPlayback = true;
  if (navigator.audioSession.state === "active") resumeAfterInterruption(true);
});

async function playTrack(track, queue) {
  if (!track?.fileUrl) return setStatus("У этого трека нет ссылки для воспроизведения", true);
  interruptedPlayback = false;
  resumeAttempt += 1; resumePromise = null; savedPlaybackPosition = 0;
  state.playbackQueue = queue; state.currentTrackKey = trackKey(track); state.currentTrack = track; elements.audio.src = track.fileUrl;
  elements.seek.value = "0"; elements.miniProgress.style.width = "0%"; elements.trackLabel.textContent = "Сейчас играет";
  elements.trackTitle.textContent = track.title; elements.trackArtist.textContent = artistForTrack(track).name; elements.trackArtist.disabled = false;
  elements.trackAlbum.textContent = track.album?.title || "";
  elements.trackAlbum.hidden = elements.trackAlbumSeparator.hidden = !track.album?.id; elements.miniTrackTitle.textContent = track.title; elements.miniTrackArtist.textContent = track.artist;
  elements.miniPlayer.hidden = false; const artwork = artworkFor(track);
  elements.coverImage.hidden = !artwork; elements.coverFallback.hidden = Boolean(artwork); elements.miniCoverImage.hidden = !artwork; elements.miniCoverFallback.hidden = Boolean(artwork);
  if (artwork) { elements.coverImage.src = artwork; elements.miniCoverImage.src = artwork; }
  renderLibraryTracks(); renderSearchResults(); if (state.currentCollection) renderCollection();
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
elements.closeSetupButton.addEventListener("click", () => { void goBack(); });
elements.homeTabs.addEventListener("click", (event) => { const button = event.target.closest("[data-home-tab]"); if (button) { setHomeTab(button.dataset.homeTab); if (state.homeTab === "search") focusSearchInput(true); } });
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
elements.miniMixButton.addEventListener("click", () => { if (state.currentTrack) createAndOpenMix({ kind: "track", track: state.currentTrack }); });
elements.actionSheetMixButton.addEventListener("click", () => { if (state.actionTrack) createAndOpenMix({ kind: "track", track: state.actionTrack }); });
elements.actionSheetCloseButton.addEventListener("click", closeTrackActions); elements.actionSheetBackdrop.addEventListener("click", closeTrackActions);
elements.playButton.addEventListener("click", () => {
  if (!elements.audio.src) {
    const initialQueue = state.searchActive && state.searchTracks.length ? state.searchTracks.slice(0, SEARCH_RESULT_LIMIT) : state.libraryTracks;
    if (initialQueue.length) playTrack(initialQueue[0], initialQueue);
  } else if (elements.audio.paused) void resumePlayback(true); else pausePlayback();
});
elements.miniPlayButton.addEventListener("click", () => { if (elements.audio.paused) void resumePlayback(true); else pausePlayback(); });
elements.previousButton.addEventListener("click", () => moveTrack(-1)); elements.nextButton.addEventListener("click", () => moveTrack(1)); elements.miniNextButton.addEventListener("click", () => moveTrack(1));
elements.seek.addEventListener("input", () => {
  if (Number.isFinite(elements.audio.duration)) {
    savedPlaybackPosition = (Number(elements.seek.value) / 100) * elements.audio.duration;
    elements.audio.currentTime = savedPlaybackPosition;
  }
});
elements.audio.addEventListener("play", () => setPlaybackButtonState(true));
elements.audio.addEventListener("playing", () => setPlaybackButtonState(true));
elements.audio.addEventListener("pause", () => {
  if (playbackWanted && !elements.audio.ended) interruptedPlayback = true;
  setPlaybackButtonState(false);
});
elements.audio.addEventListener("timeupdate", () => {
  const { currentTime, duration } = elements.audio;
  if (Number.isFinite(currentTime) && currentTime > 0) savedPlaybackPosition = currentTime;
  elements.currentTime.textContent = formatTime(currentTime); elements.duration.textContent = formatTime(duration);
  const progress = Number.isFinite(duration) && duration > 0 ? (currentTime / duration) * 100 : 0;
  elements.seek.value = String(progress); elements.miniProgress.style.width = `${progress}%`;
});
elements.audio.addEventListener("ended", () => moveTrack(1));
elements.audio.addEventListener("error", () => { setPlaybackButtonState(false); setStatus("Не удалось открыть аудио. Обновите раздел и попробуйте снова.", true); });
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!elements.trackActionSheet.hidden) closeTrackActions(); else if (!elements.fullPlayer.hidden) showPlayer(false); else if (state.currentView !== "home") void goBack();
});
if ("mediaSession" in navigator) {
  navigator.mediaSession.setActionHandler("play", () => { void resumePlayback(true); }); navigator.mediaSession.setActionHandler("pause", pausePlayback);
  navigator.mediaSession.setActionHandler("previoustrack", () => moveTrack(-1)); navigator.mediaSession.setActionHandler("nexttrack", () => moveTrack(1));
}
if ("serviceWorker" in navigator) navigator.serviceWorker.register("../sw.js", { scope: "../" });

const defaultBackendUrl = ["localhost", "127.0.0.1"].includes(location.hostname) ? "http://localhost:8787" : PUBLIC_BACKEND_URL;
if (!state.config.backendUrl || LEGACY_BACKEND_URLS.has(state.config.backendUrl)) {
  state.config.backendUrl = defaultBackendUrl; localStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(state.config));
}
elements.backendUrlInput.value = state.config.backendUrl; elements.apiKeyInput.value = state.config.apiKey || "";
setHomeTab("search"); renderPersonalLibrary();
focusSearchInput();
loadLibrary();
