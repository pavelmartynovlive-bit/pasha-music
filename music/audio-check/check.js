"use strict";
const $ = id => document.getElementById(id);
const audio = $("audio");
const params = new URLSearchParams(location.search);
const mode = params.get("mode") === "session" && navigator.mediaSession ? "session" : "native";
if (!navigator.mediaSession) $("mode").querySelector('[value="session"]').disabled = true;
$("mode").value = mode;
if (["hls", "file", "current"].includes(params.get("source"))) $("source").value = params.get("source");
const run = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const storeKey = "pashaAudioCheckReportsV1";
let history = [];
try { history = JSON.parse(localStorage.getItem(storeKey) || "[]").slice(-5); } catch {}
let events = [], selectedSource = null, trial = 0, sampleTime = performance.now(), lastPersist = 0, sampleSignature = "", preparing = false;
function ranges(value) {
  const result = [];
  for (let i = 0; i < Math.min(value.length, 4); i++) result.push([+value.start(i).toFixed(3), +value.end(i).toFixed(3)]);
  return result;
}
function snapshot() {
  return { hidden: document.hidden, paused: audio.paused, position: +audio.currentTime.toFixed(3), duration: Number.isFinite(audio.duration) ? audio.duration : null, readyState: audio.readyState, networkState: audio.networkState, seeking: audio.seeking, playbackRate: audio.playbackRate, muted: audio.muted, volume: audio.volume, buffered: ranges(audio.buffered), seekable: ranges(audio.seekable), errorCode: audio.error?.code || null, sessionType: navigator.audioSession?.type || "unavailable", sessionState: navigator.audioSession?.state || "unavailable" };
}
function currentReport() {
  return { version: 1, run, trial, mode, source: selectedSource, mediaSessionSupported: !!navigator.mediaSession, userAgent: navigator.userAgent, standalone: navigator.standalone === true || matchMedia("(display-mode: standalone)").matches, events };
}
function persist() {
  try { localStorage.setItem(storeKey, JSON.stringify([...history, currentReport()].slice(-6))); } catch {}
  lastPersist = performance.now();
}
function record(event, detail = null) {
  events.push({ time: Date.now(), elapsed: +performance.now().toFixed(1), event, detail, ...snapshot() });
  if (events.length > 1800) events.shift();
  if (event !== "sample" || performance.now() - lastPersist > 1500) persist();
}
function status(message) { $("status").textContent = message; }
function play(origin) {
  record("play-call", origin);
  try { audio.play().then(() => record("play-resolved", origin), error => record("play-rejected", { origin, name: error.name })); }
  catch (error) { record("play-rejected", { origin, name: error.name }); }
}
function pause(origin) { record("pause-call", origin); audio.pause(); }
try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch { record("session-type-unavailable"); }
// Native baseline deliberately installs no MediaSession handlers or state setters.
if (mode === "session" && navigator.mediaSession) {
  $("custom").hidden = false;
  for (const [action, handler] of [["play", () => play("system")], ["pause", () => pause("system")]]) {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch { record("handler-unavailable", action); }
  }
  if (window.MediaMetadata) navigator.mediaSession.metadata = new MediaMetadata({ title: "Audio Check", artist: "Проверка звука" });
  audio.addEventListener("playing", () => { navigator.mediaSession.playbackState = "playing"; });
  audio.addEventListener("pause", () => { navigator.mediaSession.playbackState = "paused"; });
}
$("play").onclick = () => play("ui");
$("pause").onclick = () => pause("ui");
for (const event of ["loadstart", "emptied", "loadedmetadata", "loadeddata", "canplay", "canplaythrough", "play", "playing", "pause", "waiting", "stalled", "suspend", "error", "ended", "seeking", "seeked", "ratechange", "volumechange", "progress"])
  audio.addEventListener(event, () => record(`audio-${event}`));
document.addEventListener("visibilitychange", () => record("visibility"));
for (const event of ["pagehide", "pageshow", "freeze", "resume", "online", "offline"])
  (event === "freeze" || event === "resume" ? document : window).addEventListener(event, () => record(event));
navigator.audioSession?.addEventListener("statechange", () => record("session-state"));
// Best-effort browser resource timings. AVFoundation may load HLS outside this
// timeline; missing entries must not be interpreted as absent network traffic.
try {
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
      const url = new URL(entry.name);
      if (url.origin !== location.origin || !url.pathname.includes("/audio-check/assets/")) continue;
      const name = url.pathname.split("/").pop();
      if (!/^(reference\.(m3u8|m4a)|segment-\d+\.ts)$/.test(name)) continue;
      record("resource-timing", { asset: name, start: +entry.startTime.toFixed(1), duration: +entry.duration.toFixed(1), transferSize: entry.transferSize, responseStatus: entry.responseStatus || null });
    }
  }).observe({ type: "resource", buffered: true });
} catch { record("resource-timing-unavailable"); }
setInterval(() => {
  const now = performance.now(), gap = now - sampleTime;
  sampleTime = now;
  if (gap > 2000) record("sampling-gap", { milliseconds: Math.round(gap) });
  const state = snapshot(), signature = JSON.stringify(state);
  if (signature !== sampleSignature) { sampleSignature = signature; record("sample"); }
  $("snapshot").textContent = `Позиция: ${state.position.toFixed(2)} с\nБуфер: ${JSON.stringify(state.buffered)}\npaused: ${state.paused} · ready: ${state.readyState} · network: ${state.networkState}\nРежим: ${mode} · источник: ${selectedSource || "не выбран"}`;
}, 500);
$("mode").onchange = () => {
  persist();
  location.search = new URLSearchParams({ mode: $("mode").value, source: $("source").value });
};
$("source").onchange = () => { pause("source-selection"); status("Нажми «Подготовить источник», затем включи звук."); };
$("prepare").onclick = async () => {
  if (preparing) return;
  preparing = true; $("prepare").disabled = true;
  pause("prepare");
  if (events.length) { history = [...history, currentReport()].slice(-5); events = []; }
  trial += 1;
  selectedSource = $("source").value;
  record("prepare", selectedSource);
  // A failed library request must not leave an old file playable under a new label.
  audio.removeAttribute("src"); audio.load(); record("source-cleared");
  try {
    let url;
    if (selectedSource === "current") {
      status("Получаю свежий источник из библиотеки…");
      const config = JSON.parse(localStorage.getItem("pashaMusicConnectionV1") || "{}");
      const backend = config.backendUrl || "https://pasha-music.132-243-23-229.sslip.io";
      const headers = config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {};
      const response = await fetch(`${backend}/api/first-track`, { headers, cache: "no-store", signal: AbortSignal.timeout(20000) });
      record("source-response", { status: response.status });
      if (!response.ok) throw new Error("connection");
      const data = await response.json();
      url = data.result?.track?.fileUrl;
      if (!url) throw new Error("source");
      // Store only format classification; never persist the temporary URL.
      record("source-format", /\.m3u8(?:[?#]|$)/i.test(url) ? "hls" : "other");
    } else url = new URL(selectedSource === "hls" ? "assets/reference.m3u8" : "assets/reference.m4a", location.href).href;
    record("src-assignment"); audio.src = url; audio.load(); record("load-call");
    status("Источник готов. Включи звук кнопкой плеера. Тестовые HLS и M4A содержат одинаковые спокойные тоны.");
  } catch (error) {
    record("prepare-failed", error.name);
    status("Не удалось подготовить источник. Для библиотеки сначала настрой подключение в музыкальном приложении. Тестовые HLS и M4A работают без подключения.");
  } finally { preparing = false; $("prepare").disabled = false; }
};
for (const button of document.querySelectorAll("[data-result]")) button.onclick = () => {
  record("heard-result", { scenario: $("scenario").value, result: button.dataset.result });
  $("exportStatus").textContent = "Результат записан. Скопируй отчёт перед следующей проверкой.";
};
function exportReport() {
  record("export");
  const report = JSON.stringify({ version: 1, reports: [...history, currentReport()].slice(-6) }, null, 2);
  $("report").value = report;
  return report;
}
$("copy").onclick = async () => {
  const report = exportReport();
  try { await navigator.clipboard.writeText(report); $("exportStatus").textContent = "Отчёт скопирован."; }
  catch { $("report").closest("details").open = true; $("report").select(); $("exportStatus").textContent = "Скопируй выделенный отчёт вручную или скачай файл."; }
};
$("download").onclick = () => {
  const url = URL.createObjectURL(new Blob([exportReport()], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = `audio-check-${run}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
};
$("environment").textContent = `${navigator.standalone || matchMedia("(display-mode: standalone)").matches ? "PWA" : "Вкладка браузера"} · ${mode === "native" ? "штатное управление" : "Media Session"}`;
record("page-start");
(async () => {
  try {
    if ("serviceWorker" in navigator) {
      await navigator.serviceWorker.register("sw.js", { scope: "./", updateViaCache: "none" });
      if (!navigator.serviceWorker.controller?.scriptURL.endsWith("/audio-check/sw.js")) await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { navigator.serviceWorker.removeEventListener("controllerchange", changed); reject(new Error("worker")); }, 10000);
        function changed() { if (navigator.serviceWorker.controller?.scriptURL.endsWith("/audio-check/sw.js")) { clearTimeout(timeout); navigator.serviceWorker.removeEventListener("controllerchange", changed); resolve(); } }
        navigator.serviceWorker.addEventListener("controllerchange", changed); changed();
      });
    }
    record("cache-isolation-ready"); $("prepare").disabled = false;
    status("Выбери источник и нажми «Подготовить источник».");
  } catch { record("cache-isolation-failed"); status("Не удалось исключить кеш приложения. Перезагрузи страницу перед проверкой."); }
})();
