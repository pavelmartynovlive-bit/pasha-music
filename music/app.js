const STORAGE_KEY = "pashaMusicConnectionV1";
const SEARCH_RESULT_LIMIT = 5;
const SUGGESTION_DELAY = 280;
const PUBLIC_BACKEND_URL = "https://pasha-music.132-243-23-229.sslip.io";
const LEGACY_BACKEND_URLS = new Set([
  "https://pasha-vk-music-backend.onrender.com",
]);

const elements = Object.fromEntries(
  ["audio", "apiKeyInput", "backendUrlInput", "clearSearchButton", "closePlayerButton", "closeSetupButton", "coverFallback", "coverImage", "currentTime", "duration", "fullPlayer", "miniCoverFallback", "miniCoverImage", "miniNextButton", "miniPlayButton", "miniPlayer", "miniProgress", "miniTrackArtist", "miniTrackTitle", "nextButton", "openPlayerButton", "playButton", "previousButton", "searchForm", "searchInput", "searchResultCount", "searchResultList", "searchResults", "searchSuggestions", "sectionTabs", "sectionTitle", "seek", "settingsButton", "setupForm", "setupPanel", "status", "trackArtist", "trackCount", "trackLabel", "trackList", "trackTitle"]
    .map((id) => [id, document.getElementById(id)])
);

function readConfig() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}

const state = {
  config: readConfig(),
  sections: [],
  currentSectionId: null,
  libraryTracks: [],
  searchTracks: [],
  searchTotal: 0,
  searchQuery: "",
  searchActive: false,
  playbackQueue: [],
  currentTrackKey: null,
  currentTrack: null,
  suggestionTimer: null,
  suggestionRequestId: 0,
};

const CYRILLIC_TO_LATIN = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "i",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", isError);
}

function showSetup(show = true) {
  elements.setupPanel.hidden = !show;
  if (show) elements.backendUrlInput.focus();
}

function normalizeBackendUrl(value) {
  const url = new URL(value.trim());
  const isLocal = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(isLocal && url.protocol === "http:")) {
    throw new Error("Для backend нужен HTTPS-адрес");
  }
  return url.href.replace(/\/$/, "");
}

async function api(path) {
  if (!state.config.backendUrl) throw new Error("Сначала укажите адрес backend");
  const headers = { Accept: "application/json" };
  if (state.config.apiKey) headers.Authorization = `Bearer ${state.config.apiKey}`;
  const response = await fetch(`${state.config.backendUrl}${path}`, { headers, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    if (response.status === 401) throw new Error("Ключ доступа не подошёл");
    throw new Error(data.error || `Backend ответил ${response.status}`);
  }
  return data;
}

function artworkFor(track) {
  const thumbnail = track.thumbnail || track.album?.thumbnail || {};
  return thumbnail.photo_1200 || thumbnail.photo_600 || thumbnail.photo_300 || thumbnail.photo_270 || thumbnail.photo_135 || "";
}

function formatTime(value) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  return `${Math.floor(value / 60)}:${Math.floor(value % 60).toString().padStart(2, "0")}`;
}

function trackKey(track) {
  return `${track.ownerId}_${track.id}`;
}

function showPlayer(show = true) {
  if (show && !state.currentTrack) return;
  elements.fullPlayer.hidden = !show;
  document.body.classList.toggle("player-open", show);
}

function setPlaybackButtonState(isPlaying) {
  const label = isPlaying ? "Пауза" : "Воспроизвести";
  const symbol = isPlaying ? "❚❚" : "▶";
  elements.playButton.textContent = symbol;
  elements.miniPlayButton.textContent = symbol;
  elements.playButton.setAttribute("aria-label", label);
  elements.miniPlayButton.setAttribute("aria-label", label);
}

function normalizeSearchText(value) {
  return value
    .toLocaleLowerCase("ru")
    .split("")
    .map((letter) => CYRILLIC_TO_LATIN[letter] ?? letter)
    .join("")
    .replace(/[^a-z0-9]+/g, "");
}

function editDistance(left, right) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let previous = row[0];
    row[0] = i;
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
  return artists
    .map((artist) => {
      const normalizedArtist = normalizeSearchText(artist);
      let score = Number.POSITIVE_INFINITY;
      if (normalizedArtist.startsWith(normalizedQuery)) score = 0;
      else if (normalizedArtist.includes(normalizedQuery)) score = 1;
      else if (normalizedQuery.length >= 3 && editDistance(normalizedQuery, normalizedArtist.slice(0, normalizedQuery.length)) <= 1) score = 2;
      return { artist, score };
    })
    .filter(({ score }) => Number.isFinite(score))
    .sort((left, right) => left.score - right.score || left.artist.localeCompare(right.artist, "ru"))
    .map(({ artist }) => artist);
}

function renderSections() {
  elements.sectionTabs.replaceChildren(...state.sections.map((section) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "section-tab";
    button.classList.toggle("active", section.id === state.currentSectionId);
    button.textContent = section.title;
    button.addEventListener("click", () => loadSection(section.id));
    return button;
  }));
}

function createTrackRow(track, queue) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "track-row";
  button.classList.toggle("active", trackKey(track) === state.currentTrackKey);
  button.addEventListener("click", () => playTrack(track, queue));
  const artwork = artworkFor(track);
  const visual = artwork
    ? Object.assign(document.createElement("img"), { src: artwork, alt: "", loading: "lazy" })
    : Object.assign(document.createElement("span"), { className: "track-art-fallback", textContent: "♪" });
  const copy = document.createElement("span");
  copy.className = "track-copy";
  const title = document.createElement("strong");
  title.textContent = track.title;
  const artist = document.createElement("small");
  artist.textContent = track.artist;
  copy.append(title, artist);
  const duration = document.createElement("span");
  duration.className = "track-duration";
  duration.textContent = formatTime(track.duration);
  button.append(visual, copy, duration);
  return button;
}

function renderLibraryTracks() {
  elements.trackCount.textContent = `${state.libraryTracks.length} треков`;
  if (!state.libraryTracks.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "В этом разделе пока нет доступных треков.";
    elements.trackList.replaceChildren(empty);
    return;
  }
  elements.trackList.replaceChildren(...state.libraryTracks.map((track) => createTrackRow(track, state.libraryTracks)));
}

function renderSearchResults() {
  elements.searchResults.hidden = !state.searchActive;
  if (!state.searchActive) {
    elements.searchResultList.replaceChildren();
    elements.searchResultCount.textContent = "";
    return;
  }

  const visibleTracks = state.searchTracks.slice(0, SEARCH_RESULT_LIMIT);
  elements.searchResultCount.textContent = state.searchTotal > visibleTracks.length
    ? `${visibleTracks.length} из ${state.searchTotal}`
    : `${visibleTracks.length}`;

  if (!visibleTracks.length) {
    const empty = document.createElement("div");
    empty.className = "search-empty";
    empty.textContent = "Ничего не найдено";
    elements.searchResultList.replaceChildren(empty);
    return;
  }

  elements.searchResultList.replaceChildren(...visibleTracks.map((track) => createTrackRow(track, visibleTracks)));
}

function renderSuggestions(suggestions) {
  const queryKey = normalizeSearchText(elements.searchInput.value);
  const unique = [];
  const seen = new Set([queryKey]);
  for (const suggestion of suggestions) {
    const key = normalizeSearchText(suggestion);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(suggestion);
    if (unique.length === 5) break;
  }

  elements.searchSuggestions.hidden = unique.length === 0;
  elements.searchSuggestions.replaceChildren(...unique.map((suggestion) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "suggestion-chip";
    button.textContent = suggestion;
    button.addEventListener("click", () => {
      elements.searchInput.value = suggestion;
      elements.clearSearchButton.hidden = false;
      elements.searchSuggestions.hidden = true;
      searchTracks(suggestion);
      elements.searchInput.blur();
    });
    return button;
  }));
}

async function loadSuggestions(query) {
  const requestId = ++state.suggestionRequestId;
  const local = localSuggestions(query);
  renderSuggestions(local);
  try {
    const data = await api(`/api/search/suggestions?q=${encodeURIComponent(query)}`);
    if (requestId !== state.suggestionRequestId || elements.searchInput.value.trim() !== query) return;
    renderSuggestions([...local, ...(data.result.suggestions || [])]);
  } catch {
    if (requestId === state.suggestionRequestId) renderSuggestions(local);
  }
}

function scheduleSuggestions() {
  clearTimeout(state.suggestionTimer);
  const query = elements.searchInput.value.trim();
  elements.clearSearchButton.hidden = !query;
  if (query !== state.searchQuery) {
    state.searchActive = false;
    renderSearchResults();
  }
  if (query.length < 2) {
    state.suggestionRequestId += 1;
    renderSuggestions([]);
    return;
  }
  renderSuggestions(localSuggestions(query));
  state.suggestionTimer = setTimeout(() => loadSuggestions(query), SUGGESTION_DELAY);
}

async function loadSection(sectionId) {
  if (!sectionId) return;
  try {
    state.currentSectionId = sectionId;
    clearSearch(true);
    renderSections();
    setStatus("Загружаю треки…");
    const data = await api(`/api/sections/${encodeURIComponent(sectionId)}`);
    state.libraryTracks = data.result.tracks || [];
    elements.sectionTitle.textContent = data.result.title || "Музыка";
    renderLibraryTracks();
    setStatus(state.libraryTracks.length ? "Готово к воспроизведению" : "Раздел пуст");
  } catch (error) {
    setStatus(error.message, true);
    showSetup(error.message.includes("ключ") || error.message.includes("backend"));
  }
}

async function searchTracks(query) {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length < 2) {
    return setStatus("Введите минимум два символа для поиска", true);
  }

  try {
    clearTimeout(state.suggestionTimer);
    state.suggestionRequestId += 1;
    state.searchQuery = normalizedQuery;
    state.searchActive = true;
    state.searchTracks = [];
    state.searchTotal = 0;
    elements.clearSearchButton.hidden = false;
    elements.searchSuggestions.hidden = true;
    elements.searchResults.hidden = true;
    setStatus(`Ищу «${normalizedQuery}»…`);
    const data = await api(`/api/search?q=${encodeURIComponent(normalizedQuery)}`);
    state.searchTracks = data.result.tracks || [];
    state.searchTotal = data.result.count || state.searchTracks.length;
    renderSearchResults();
    setStatus(state.searchTracks.length ? `Найдено: ${state.searchTotal}` : "Ничего не найдено");
  } catch (error) {
    state.searchTracks = [];
    state.searchTotal = 0;
    renderSearchResults();
    setStatus(error.message, true);
    showSetup(error.message.includes("ключ") || error.message.includes("backend"));
  }
}

function clearSearch(clearInput = true) {
  clearTimeout(state.suggestionTimer);
  state.suggestionRequestId += 1;
  if (clearInput) elements.searchInput.value = "";
  elements.clearSearchButton.hidden = true;
  elements.searchSuggestions.hidden = true;
  state.searchActive = false;
  state.searchTracks = [];
  state.searchTotal = 0;
  state.searchQuery = "";
  renderSearchResults();
  if (clearInput && elements.audio.paused) setStatus("Готово к воспроизведению");
}

async function loadLibrary() {
  try {
    setStatus("Подключаюсь к VK Music…");
    const health = await api("/api/health");
    if (!health.hasCookieP || !health.hasRemixSid) throw new Error("На backend не настроены VK cookies");
    const data = await api("/api/sections");
    state.sections = data.result.sections || [];
    renderSections();
    await loadSection(data.result.defaultSection || state.sections[0]?.id);
  } catch (error) {
    setStatus(error.message, true);
    showSetup(true);
  }
}

async function playTrack(track, queue) {
  if (!track?.fileUrl) return setStatus("У этого трека нет ссылки для воспроизведения", true);
  state.playbackQueue = queue;
  state.currentTrackKey = trackKey(track);
  state.currentTrack = track;
  elements.audio.src = track.fileUrl;
  elements.seek.value = "0";
  elements.miniProgress.style.width = "0%";
  elements.trackLabel.textContent = "Сейчас играет";
  elements.trackTitle.textContent = track.title;
  elements.trackArtist.textContent = track.artist;
  elements.miniTrackTitle.textContent = track.title;
  elements.miniTrackArtist.textContent = track.artist;
  elements.miniPlayer.hidden = false;
  const artwork = artworkFor(track);
  elements.coverImage.hidden = !artwork;
  elements.coverFallback.hidden = Boolean(artwork);
  elements.miniCoverImage.hidden = !artwork;
  elements.miniCoverFallback.hidden = Boolean(artwork);
  if (artwork) {
    elements.coverImage.src = artwork;
    elements.miniCoverImage.src = artwork;
  }
  renderLibraryTracks();
  renderSearchResults();
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist, album: track.album?.title || "VK Music", artwork: artwork ? [{ src: artwork }] : [] });
  }
  try { await elements.audio.play(); setStatus("Воспроизведение"); }
  catch { setStatus("Нажмите Play ещё раз — браузер ожидает жест пользователя", true); }
}

function moveTrack(offset) {
  if (!state.playbackQueue.length) return;
  const activeIndex = state.playbackQueue.findIndex((track) => trackKey(track) === state.currentTrackKey);
  const current = activeIndex < 0 ? 0 : activeIndex;
  playTrack(state.playbackQueue[(current + offset + state.playbackQueue.length) % state.playbackQueue.length], state.playbackQueue);
}

elements.setupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    state.config = { backendUrl: normalizeBackendUrl(elements.backendUrlInput.value), apiKey: elements.apiKeyInput.value.trim() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.config));
    showSetup(false);
    await loadLibrary();
  } catch (error) { setStatus(error.message, true); }
});
elements.settingsButton.addEventListener("click", () => showSetup(true));
elements.closeSetupButton.addEventListener("click", () => showSetup(false));
elements.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  searchTracks(elements.searchInput.value);
  elements.searchInput.blur();
});
elements.searchInput.addEventListener("input", scheduleSuggestions);
elements.searchInput.addEventListener("focus", scheduleSuggestions);
elements.clearSearchButton.addEventListener("click", () => clearSearch(true));
elements.openPlayerButton.addEventListener("click", () => showPlayer(true));
elements.closePlayerButton.addEventListener("click", () => showPlayer(false));
elements.playButton.addEventListener("click", () => {
  if (!elements.audio.src) {
    const initialQueue = state.searchActive && state.searchTracks.length
      ? state.searchTracks.slice(0, SEARCH_RESULT_LIMIT)
      : state.libraryTracks;
    if (initialQueue.length) playTrack(initialQueue[0], initialQueue);
  } else if (elements.audio.paused) elements.audio.play();
  else elements.audio.pause();
});
elements.miniPlayButton.addEventListener("click", () => {
  if (elements.audio.paused) elements.audio.play();
  else elements.audio.pause();
});
elements.previousButton.addEventListener("click", () => moveTrack(-1));
elements.nextButton.addEventListener("click", () => moveTrack(1));
elements.miniNextButton.addEventListener("click", () => moveTrack(1));
elements.seek.addEventListener("input", () => {
  if (Number.isFinite(elements.audio.duration)) elements.audio.currentTime = (Number(elements.seek.value) / 100) * elements.audio.duration;
});
elements.audio.addEventListener("play", () => setPlaybackButtonState(true));
elements.audio.addEventListener("pause", () => setPlaybackButtonState(false));
elements.audio.addEventListener("timeupdate", () => {
  const { currentTime, duration } = elements.audio;
  elements.currentTime.textContent = formatTime(currentTime);
  elements.duration.textContent = formatTime(duration);
  const progress = Number.isFinite(duration) && duration > 0 ? (currentTime / duration) * 100 : 0;
  elements.seek.value = String(progress);
  elements.miniProgress.style.width = `${progress}%`;
});
elements.audio.addEventListener("ended", () => moveTrack(1));
elements.audio.addEventListener("error", () => setStatus("Не удалось открыть аудио. Обновите раздел и попробуйте снова.", true));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.fullPlayer.hidden) showPlayer(false);
});

if ("mediaSession" in navigator) {
  navigator.mediaSession.setActionHandler("play", () => elements.audio.play());
  navigator.mediaSession.setActionHandler("pause", () => elements.audio.pause());
  navigator.mediaSession.setActionHandler("previoustrack", () => moveTrack(-1));
  navigator.mediaSession.setActionHandler("nexttrack", () => moveTrack(1));
}
if ("serviceWorker" in navigator) navigator.serviceWorker.register("../sw.js", { scope: "../" });

const defaultBackendUrl = ["localhost", "127.0.0.1"].includes(location.hostname)
  ? "http://localhost:8787"
  : PUBLIC_BACKEND_URL;

if (!state.config.backendUrl || LEGACY_BACKEND_URLS.has(state.config.backendUrl)) {
  state.config.backendUrl = defaultBackendUrl;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.config));
}

elements.backendUrlInput.value = state.config.backendUrl;
elements.apiKeyInput.value = state.config.apiKey || "";
loadLibrary();
