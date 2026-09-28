import "dotenv/config";
import { timingSafeEqual } from "node:crypto";
import express from "express";
import cors from "cors";

import { VKAudio } from "@toil/vk-audio";
import { VKWebClient } from "@toil/vk-audio/client";
import { getAudioItem } from "@toil/vk-audio/utils/index";

const app = express();

const PORT = Number(process.env.PORT || 8787);
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

function makeVkAudio() {
  requireVkCookies();

  const webClient = new VKWebClient({
    cookies: {
      p: COOKIE_P,
      remixsid: COOKIE_REMIXSID,
    },
  });

  return new VKAudio({
    client: webClient,
    token: {
      value: "",
      expiresIn: -1,
    },
  });
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

function sendVkError(res, error, operation) {
  const message = safeErrorMessage(error);
  console.error(`${operation} failed: ${message}`);

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
    const vk = makeVkAudio();
    const result = await vk.getSections();

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
    const vk = makeVkAudio();
    const raw = await vk.rawGetSection(req.params.sectionId);

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
    const vk = makeVkAudio();
    const suggestions = await vk.getSearchSuggestion(query);

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
    const vk = makeVkAudio();
    const result = await vk.searchAudio(query, offset);

    res.json({
      ok: true,
      result: {
        query,
        count: result.count,
        tracks: result.audios,
        nextOffset: offset + result.audios.length,
      },
    });
  } catch (error) {
    sendVkError(res, error, "VK searchAudio");
  }
});

app.get("/api/first-track", async (_req, res) => {
  try {
    const vk = makeVkAudio();
    const { defaultSection } = await vk.getSections();
    const raw = await vk.rawGetSection(defaultSection);
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

app.listen(PORT, () => {
  console.log(`VK Music backend: http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/api/health`);
  console.log(`Sections: http://localhost:${PORT}/api/sections`);
});
