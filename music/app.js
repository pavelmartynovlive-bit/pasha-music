const STORAGE_KEY = "pashaMusicConnectionV1";

const elements = Object.fromEntries(
  ["audio", "apiKeyInput", "backendUrlInput", "closeSetupButton", "coverFallback", "coverImage", "currentTime", "duration", "nextButton", "playButton", "previousButton", "sectionTabs", "sectionTitle", "seek", "settingsButton", "setupForm", "setupPanel", "status", "trackArtist", "trackCount", "trackLabel", "trackList", "trackTitle"]
    .map((id) => [id, document.getElementById(id)])
);

function readConfig() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}

const state = { config: readConfig(), sections: [], currentSectionId: null, tracks: [], currentIndex: -1 };

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

function renderTracks() {
  elements.trackCount.textContent = `${state.tracks.length} треков`;
  if (!state.tracks.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "В этом разделе пока нет доступных треков.";
    elements.trackList.replaceChildren(empty);
    return;
  }
  elements.trackList.replaceChildren(...state.tracks.map((track, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "track-row";
    button.classList.toggle("active", index === state.currentIndex);
    button.addEventListener("click", () => playTrack(index));
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
  }));
}

async function loadSection(sectionId) {
  if (!sectionId) return;
  try {
    state.currentSectionId = sectionId;
    renderSections();
    setStatus("Загружаю треки…");
    const data = await api(`/api/sections/${encodeURIComponent(sectionId)}`);
    state.tracks = data.result.tracks || [];
    elements.sectionTitle.textContent = data.result.title || "Музыка";
    renderTracks();
    setStatus(state.tracks.length ? "Готово к воспроизведению" : "Раздел пуст");
  } catch (error) {
    setStatus(error.message, true);
    showSetup(error.message.includes("ключ") || error.message.includes("backend"));
  }
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

async function playTrack(index) {
  const track = state.tracks[index];
  if (!track?.fileUrl) return setStatus("У этого трека нет ссылки для воспроизведения", true);
  state.currentIndex = index;
  elements.audio.src = track.fileUrl;
  elements.trackLabel.textContent = "Сейчас играет";
  elements.trackTitle.textContent = track.title;
  elements.trackArtist.textContent = track.artist;
  const artwork = artworkFor(track);
  elements.coverImage.hidden = !artwork;
  elements.coverFallback.hidden = Boolean(artwork);
  if (artwork) elements.coverImage.src = artwork;
  renderTracks();
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist, album: track.album?.title || "VK Music", artwork: artwork ? [{ src: artwork }] : [] });
  }
  try { await elements.audio.play(); setStatus("Воспроизведение"); }
  catch { setStatus("Нажмите Play ещё раз — браузер ожидает жест пользователя", true); }
}

function moveTrack(offset) {
  if (!state.tracks.length) return;
  const current = state.currentIndex < 0 ? 0 : state.currentIndex;
  playTrack((current + offset + state.tracks.length) % state.tracks.length);
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
elements.playButton.addEventListener("click", () => {
  if (!elements.audio.src) playTrack(state.currentIndex >= 0 ? state.currentIndex : 0);
  else if (elements.audio.paused) elements.audio.play();
  else elements.audio.pause();
});
elements.previousButton.addEventListener("click", () => moveTrack(-1));
elements.nextButton.addEventListener("click", () => moveTrack(1));
elements.seek.addEventListener("input", () => {
  if (Number.isFinite(elements.audio.duration)) elements.audio.currentTime = (Number(elements.seek.value) / 100) * elements.audio.duration;
});
elements.audio.addEventListener("play", () => { elements.playButton.textContent = "❚❚"; elements.playButton.setAttribute("aria-label", "Пауза"); });
elements.audio.addEventListener("pause", () => { elements.playButton.textContent = "▶"; elements.playButton.setAttribute("aria-label", "Воспроизвести"); });
elements.audio.addEventListener("timeupdate", () => {
  const { currentTime, duration } = elements.audio;
  elements.currentTime.textContent = formatTime(currentTime);
  elements.duration.textContent = formatTime(duration);
  elements.seek.value = Number.isFinite(duration) && duration > 0 ? String((currentTime / duration) * 100) : "0";
});
elements.audio.addEventListener("ended", () => moveTrack(1));
elements.audio.addEventListener("error", () => setStatus("Не удалось открыть аудио. Обновите раздел и попробуйте снова.", true));

if ("mediaSession" in navigator) {
  navigator.mediaSession.setActionHandler("play", () => elements.audio.play());
  navigator.mediaSession.setActionHandler("pause", () => elements.audio.pause());
  navigator.mediaSession.setActionHandler("previoustrack", () => moveTrack(-1));
  navigator.mediaSession.setActionHandler("nexttrack", () => moveTrack(1));
}
if ("serviceWorker" in navigator) navigator.serviceWorker.register("../sw.js", { scope: "../" });

const localDefault = ["localhost", "127.0.0.1"].includes(location.hostname) ? "http://localhost:8787" : "";
elements.backendUrlInput.value = state.config.backendUrl || localDefault;
elements.apiKeyInput.value = state.config.apiKey || "";
if (state.config.backendUrl || localDefault) {
  if (!state.config.backendUrl) state.config.backendUrl = localDefault;
  loadLibrary();
} else {
  showSetup(true);
  setStatus("Укажите адрес опубликованного backend");
}
