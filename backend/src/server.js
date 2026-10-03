import "dotenv/config";
import { timingSafeEqual } from "node:crypto";
import { types as utilTypes } from "node:util";
import express from "express";
import cors from "cors";

import { VKAudio } from "@toil/vk-audio";
import { VKWebClient } from "@toil/vk-audio/client";
import { getAudioItem } from "@toil/vk-audio/utils/index";
import { fetchBusArrivals, formatVoiceArrivals } from "./bus.js";

// @toil/vk-audio uses Error.isError(), which is unavailable in Node.js 18.
// Keep the backend compatible with the VPS runtime until Node is upgraded.
if (typeof Error.isError !== "function") {
  Object.defineProperty(Error, "isError", {
    configurable: true,
    value: utilTypes.isNativeError,
    writable: true,
  });
}

const app = express();

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST?.trim() || "0.0.0.0";
const COOKIE_P = process.env.VK_COOKIE_P?.trim();
const COOKIE_REMIXSID = process.env.VK_COOKIE_REMIXSID?.trim();
const API_KEY = process.env.API_KEY?.trim();
const isProduction = process.env.NODE_ENV === "production";

// Для локального PoC можно оставить *, но когда подключим PWA,
// лучше вписать точный адрес GitHub Pages в ALLOWED_ORIGIN.
const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
const allowedOrigins = allowedOrigin
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.disable("x-powered-by");

app.use(
  cors({
    origin(origin, callback) {
      const isAllowed =
        !origin ||
        allowedOrigins.includes("*") ||
        allowedOrigins.includes(origin);
      callback(null, isAllowed);
    },
    credentials: false,
  })
);

app.use(express.json());
app.use("/api", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

app.get("/api/arrivals", async (_req, res) => {
  try {
    const board = await fetchBusArrivals();
    res.set("Cache-Control", "public, max-age=10, stale-while-revalidate=20");
    res.json(board);
  } catch (error) {
    console.error(`Bus arrivals failed: ${error.message}`);
    res.status(502).json({
      ok: false,
      error: "Сейчас не удалось получить данные об автобусах",
    });
  }
});

app.get("/api/voice", async (_req, res) => {
  try {
    const board = await fetchBusArrivals();
    res.set({
      "Cache-Control": "public, max-age=10, stale-while-revalidate=20",
      "Content-Type": "text/plain; charset=utf-8",
    });
    res.send(formatVoiceArrivals(board));
  } catch (error) {
    console.error(`Bus voice failed: ${error.message}`);
    res
      .status(502)
      .type("text/plain; charset=utf-8")
      .send(
        "Сейчас не удалось получить данные об автобусах. Попробуйте ещё раз через минуту."
      );
  }
});

function matchesApiKey(candidate) {
  if (!API_KEY || !candidate) {
    return false;
  }

  const expected = Buffer.from(API_KEY);
  const received = Buffer.from(candidate);
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

app.use("/api", (req, res, next) => {
  if (!API_KEY && !isProduction) {
    return next();
  }

  if (!API_KEY) {
    return res.status(503).json({
      ok: false,
      error: "API_KEY не настроен на сервере",
    });
  }

  const authorization = req.get("authorization") || "";
  const candidate = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!matchesApiKey(candidate)) {
    return res.status(401).json({
      ok: false,
      error: "Требуется корректный ключ доступа",
    });
  }

  next();
});

function requireVkCookies() {
  if (!COOKIE_P || !COOKIE_REMIXSID) {
    const error = new Error(
      "Не заданы VK_COOKIE_P и/или VK_COOKIE_REMIXSID в .env"
    );
    error.statusCode = 500;
    throw error;
  }
}

function makeVkWebClient() {
  requireVkCookies();

  return new VKWebClient({
    cookies: {
      p: COOKIE_P,
      remixsid: COOKIE_REMIXSID,
    },
  });
}

let vkAudio;
let vkAudioPromise;

async function createAuthenticatedVkAudio() {
  const webClient = makeVkWebClient();
  const refreshedToken = await webClient.refresh();

  if (!refreshedToken.success) {
    throw refreshedToken.error;
  }

  const { accessToken, expiresIn } = refreshedToken.data;

  return new VKAudio({
    client: webClient,
    token: {
      value: accessToken,
      expiresIn,
    },
  });
}

function resetVkAudio(client) {
  if (!client || vkAudio === client) {
    vkAudio = undefined;
  }
}

function getVkAudio() {
  if (vkAudio) {
    return Promise.resolve(vkAudio);
  }

  if (!vkAudioPromise) {
    vkAudioPromise = createAuthenticatedVkAudio()
      .then((client) => {
        vkAudio = client;
        return client;
      })
      .finally(() => {
        vkAudioPromise = undefined;
      });
  }

  return vkAudioPromise;
}

function safeErrorMessage(error) {
  const message =
    error instanceof Error
      ? error.message
      : error?.error instanceof Error
        ? error.error.message
        : "Unknown error";

  return [COOKIE_P, COOKIE_REMIXSID].reduce(
    (safeMessage, secret) =>
      secret ? safeMessage.replaceAll(secret, "[redacted]") : safeMessage,
    message
  );
}

function isVkAuthorizationError(error) {
  const message = safeErrorMessage(error).toLowerCase();
  return [
    "authorization failed",
    "client_secret",
    "access token",
    "failed to refresh vkwebclient token",
    "invalid session",
  ].some((fragment) => message.includes(fragment));
}

async function withVkAudio(operation) {
  let client;

  try {
    client = await getVkAudio();
    return await operation(client);
  } catch (error) {
    if (!isVkAuthorizationError(error)) {
      throw error;
    }

    resetVkAudio(client);
    return operation(await getVkAudio());
  }
}

function normalizeSection(raw) {
  const audioById = new Map(
    (raw.audios || []).map((audio) => [
      `${audio.owner_id}_${audio.id}`,
      audio,
    ])
  );
  const orderedIds = (raw.section?.blocks || [])
    .filter((block) => block.data_type === "music_audios")
    .flatMap((block) => block.audios_ids || []);
  const uniqueOrderedIds = [...new Set(orderedIds)];
  const sourceAudios = uniqueOrderedIds.length
    ? uniqueOrderedIds.map((id) => audioById.get(id)).filter(Boolean)
    : raw.audios || [];

  return {
    id: raw.section?.id,
    title: raw.section?.title,
    breadcrumbs: raw.section?.breadcrumbs,
    nextOffset: raw.section?.next_from,
    tracks: sourceAudios.map((audio) => getAudioItem(audio)),
  };
}

async function getTrackRecommendations(vk, { ownerId, audioId, count }) {
  const result = await vk.request(
    "audio.getRecommendations",
    vk.createBody({
      target_audio: `${ownerId}_${audioId}`,
      count: String(count),
      offset: "0",
    })
  );

  if (!result.success) {
    throw result.error;
  }

  const items = result.data?.response?.items;
  return Array.isArray(items) ? items.map((audio) => getAudioItem(audio)) : [];
}

function albumKey(album) {
  return album ? `${album.ownerId}_${album.id}` : "";
}

function artistReference(track) {
  const artist = track.artists?.find((item) => item?.name);
  return {
    id: artist?.id || null,
    name: artist?.name || track.artist || "Неизвестный исполнитель",
  };
}

function albumsFromTracks(tracks, limit = 12) {
  const albums = new Map();

  for (const track of tracks) {
    if (!track.album?.id) continue;
    const key = albumKey(track.album);
    const existing = albums.get(key);
    if (existing) {
      if (!existing.tracks.some((item) => item.id === track.id && item.ownerId === track.ownerId)) {
        existing.tracks.push(track);
        existing.trackCount = existing.tracks.length;
      }
      continue;
    }

    albums.set(key, {
      id: track.album.id,
      ownerId: track.album.ownerId,
      title: track.album.title,
      artist: artistReference(track),
      year: null,
      artwork: track.album.thumbnail || track.thumbnail || {},
      trackCount: 1,
      tracks: [track],
    });
  }

  return [...albums.values()].slice(0, limit);
}

async function findAlbumTracks(vk, { ownerId, albumId }) {
  const collected = [];
  const seen = new Set();
  let offset = 0;
  while (true) {
    const response = await vk.request("audio.get", new URLSearchParams({
      owner_id: String(ownerId), album_id: String(albumId),
      count: "1000", offset: String(offset),
    }));
    if (!response.success) throw response.error;
    const result = response.data?.response;
    if (!Array.isArray(result?.items) || !Number.isInteger(result.count) || result.count < 0) {
      throw new Error("VK вернул некорректный трек-лист альбома");
    }
    let added = 0;
    for (const raw of result.items) {
      const key = `${raw.owner_id}_${raw.id}`;
      if (!seen.has(key)) { seen.add(key); collected.push(getAudioItem(raw)); added += 1; }
    }
    offset += result.items.length;
    if (offset >= result.count) break;
    if (!result.items.length || !added) throw new Error("VK не вернул полный трек-лист альбома");
  }
  return collected;
}

function sendVkError(res, error, operation) {
  const message = safeErrorMessage(error);
  console.error(`${operation} failed: ${message}`);

  if (isVkAuthorizationError(error)) {
    return res.status(502).json({
      ok: false,
      error: "Не удалось обновить сессию VK. Повторите запрос через несколько секунд.",
      hint:
        "Если ошибка повторяется постоянно, нужно обновить cookies VK на сервере.",
    });
  }

  res.status(error?.statusCode || 500).json({
    ok: false,
    error: message,
    hint:
      "Если cookies заданы, но запрос не проходит, вероятно VK-сессия истекла или внутренний API изменился.",
  });
}

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "pasha-vk-music-backend",
    next: "/api/health or /api/sections",
  });
});

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/health", (_req, res) => {
  res.json({
    hasCookieP: Boolean(COOKIE_P),
    hasRemixSid: Boolean(COOKIE_REMIXSID),
  });
});

app.get("/api/sections", async (_req, res) => {
  try {
    const result = await withVkAudio((vk) => vk.getSections());

    res.json({
      ok: true,
      result,
    });
  } catch (error) {
    sendVkError(res, error, "VK getSections");
  }
});

app.get("/api/sections/:sectionId", async (req, res) => {
  try {
    const raw = await withVkAudio((vk) =>
      vk.rawGetSection(req.params.sectionId)
    );

    res.json({
      ok: true,
      result: normalizeSection(raw),
    });
  } catch (error) {
    sendVkError(res, error, "VK rawGetSection");
  }
});

app.get("/api/search/suggestions", async (req, res) => {
  const query = String(req.query.q || "").trim();

  if (query.length < 2) {
    return res.json({ ok: true, result: { query, suggestions: [] } });
  }

  if (query.length > 100) {
    return res.status(400).json({
      ok: false,
      error: "Поисковый запрос слишком длинный",
    });
  }

  try {
    const suggestions = await withVkAudio((vk) =>
      vk.getSearchSuggestion(query)
    );

    res.json({
      ok: true,
      result: {
        query,
        suggestions: [...new Set(suggestions)].slice(0, 5),
      },
    });
  } catch (error) {
    sendVkError(res, error, "VK getSearchSuggestion");
  }
});

app.get("/api/search", async (req, res) => {
  const query = String(req.query.q || "").trim();
  const offset = Math.max(0, Number.parseInt(String(req.query.offset || "0"), 10) || 0);

  if (query.length < 2) {
    return res.status(400).json({
      ok: false,
      error: "Введите минимум два символа для поиска",
    });
  }

  if (query.length > 100) {
    return res.status(400).json({
      ok: false,
      error: "Поисковый запрос слишком длинный",
    });
  }

  try {
    const result = await withVkAudio((vk) => vk.searchAudio(query, offset));

    res.json({
      ok: true,
      result: {
        query,
        count: result.count,
        tracks: result.audios,
        albums: albumsFromTracks(result.audios),
        nextOffset: offset + result.audios.length,
      },
    });
  } catch (error) {
    sendVkError(res, error, "VK searchAudio");
  }
});

app.get("/api/tracks/:ownerId/:audioId", async (req, res) => {
  const ownerId = Number(req.params.ownerId);
  const audioId = Number(req.params.audioId);
  if (!Number.isInteger(ownerId) || !Number.isInteger(audioId) || !ownerId || audioId <= 0) {
    return res.status(400).json({ ok: false, error: "Некорректный ID трека" });
  }
  try {
    const track = await withVkAudio(async (vk) => {
      const response = await vk.request("audio.getById", new URLSearchParams({ audios: `${ownerId}_${audioId}` }));
      if (!response.success) throw response.error;
      const raw = response.data?.response;
      const items = Array.isArray(raw) ? raw : raw?.items;
      const item = items?.find((audio) => Number(audio.owner_id) === ownerId && Number(audio.id) === audioId);
      if (!item?.url) throw new Error("VK не вернул ссылку на этот трек");
      return getAudioItem(item);
    });
    res.json({ ok: true, result: { track } });
  } catch (error) { sendVkError(res, error, "VK refreshTrack"); }
});

app.get("/api/tracks/:ownerId/:audioId/recommendations", async (req, res) => {
  if (!/^-?\d+$/.test(req.params.ownerId) || !/^\d+$/.test(req.params.audioId)) {
    return res.status(400).json({
      ok: false,
      error: "Некорректный идентификатор трека",
    });
  }

  const ownerId = Number(req.params.ownerId);
  const audioId = Number(req.params.audioId);
  const requestedLimit = Number.parseInt(String(req.query.limit || "30"), 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(100, Math.max(1, requestedLimit))
    : 30;

  try {
    const recommendations = await withVkAudio((vk) =>
      getTrackRecommendations(vk, {
        ownerId,
        audioId,
        count: limit,
      })
    );
    const uniqueTracks = [
      ...new Map(
        recommendations
          .filter(
            (track) =>
              track.fileUrl &&
              !(track.id === audioId && track.ownerId === ownerId)
          )
          .map((track) => [`${track.ownerId}_${track.id}`, track])
      ).values(),
    ];

    res.json({
      ok: true,
      result: {
        sourceTrackId: `${ownerId}_${audioId}`,
        provider: "vk",
        tracks: uniqueTracks.slice(0, limit),
      },
    });
  } catch (error) {
    sendVkError(res, error, "VK getTrackRecommendations");
  }
});

app.get("/api/artists/:artistId", async (req, res) => {
  const name = String(req.query.name || "").trim();
  if (!name) return res.status(400).json({ ok: false, error: "Нужно имя исполнителя" });
  try {
    const tracks = await withVkAudio(async (vk) => {
      const response = await vk.request("audio.search", new URLSearchParams({
        q: name, performer_only: "1", sort: "2", count: "100", offset: "0",
      }));
      if (!response.success) throw response.error;
      const items = response.data?.response?.items;
      if (!Array.isArray(items)) throw new Error("VK не вернул треки исполнителя");
      const normalize = (value) => String(value || "").trim().toLocaleLowerCase();
      const seen = new Set();
      return items.map(getAudioItem).filter((track) => {
        const matches = track.artists?.some((artist) =>
          req.params.artistId !== "by-name" && artist.id
            ? String(artist.id) === req.params.artistId
            : normalize(artist.name) === normalize(name)
        ) || (!track.artists?.length && normalize(track.artist) === normalize(name));
        const key = `${track.ownerId}_${track.id}`;
        if (!matches || seen.has(key)) return false;
        seen.add(key); return true;
      });
    });
    res.json({ ok: true, result: { artist: { id: req.params.artistId, name }, tracks: tracks.slice(0, 20), albums: albumsFromTracks(tracks, 20) } });
  } catch (error) { sendVkError(res, error, "VK getArtist"); }
});

app.get("/api/albums/:ownerId/:albumId", async (req, res) => {
  const title = String(req.query.title || "").trim();
  const artist = String(req.query.artist || "").trim();
  if (!title) {
    return res.status(400).json({ ok: false, error: "Для загрузки альбома нужно название" });
  }

  try {
    const tracks = await withVkAudio((vk) =>
      findAlbumTracks(vk, {
        ownerId: req.params.ownerId,
        albumId: req.params.albumId,
        title,
        artist,
      })
    );

    const matchingAlbum = albumsFromTracks(tracks).find((item) =>
      String(item.ownerId) === req.params.ownerId && String(item.id) === req.params.albumId
    );
    if (!tracks.length) {
      return res.status(404).json({ ok: false, error: "Не удалось загрузить треки этого альбома" });
    }

    res.json({ ok: true, result: { album: {
      ...matchingAlbum, id: req.params.albumId, ownerId: req.params.ownerId,
      title: matchingAlbum?.title || title, artist: matchingAlbum?.artist || { name: artist },
      artwork: matchingAlbum?.artwork || tracks[0]?.thumbnail || {},
      trackCount: tracks.length, tracks,
    } } });
  } catch (error) {
    sendVkError(res, error, "VK getAlbum");
  }
});

app.get("/api/first-track", async (_req, res) => {
  try {
    const raw = await withVkAudio(async (vk) => {
      const { defaultSection } = await vk.getSections();
      return vk.rawGetSection(defaultSection);
    });
    const section = normalizeSection(raw);
    const track = section.tracks.find((item) => item.fileUrl);

    if (!track) {
      return res.status(404).json({
        ok: false,
        error: "VK не вернул ни одного трека с URL воспроизведения",
      });
    }

    res.json({
      ok: true,
      result: {
        section: {
          id: section.id,
          title: section.title,
        },
        track,
      },
    });
  } catch (error) {
    sendVkError(res, error, "VK getFirstTrack");
  }
});

app.use((err, _req, res, _next) => {
  const message = safeErrorMessage(err);
  console.error(`Request failed: ${message}`);
  res.status(err.statusCode || 500).json({
    ok: false,
    error: message,
  });
});

app.listen(PORT, HOST, () => {
  console.log(`VK Music backend listening on ${HOST}:${PORT}`);
});
