const MOSCOW_TRANSPORT_BASE_URL = "https://moscowtransport.app/api/stop_v2";
const CACHE_TTL_MS = 15_000;
const STALE_TTL_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 8_000;

const STOPS = [
  {
    id: "627d1cfb-7127-4e85-bc10-ffccf4663630",
    label: "В сторону Каширской",
    routes: ["с848", "м83"],
  },
  {
    id: "c5700c22-05cf-474f-97e7-82457062f4af",
    label: "В сторону Орехово",
    routes: ["858", "м83"],
  },
];

let cachedBoard;
let cacheExpiresAt = 0;
let refreshPromise;

async function fetchStop(id) {
  const response = await fetch(`${MOSCOW_TRANSPORT_BASE_URL}/${id}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Moscow Transport returned ${response.status}`);
  }

  return response.json();
}

async function refreshArrivals() {
  const source = await Promise.all(STOPS.map((stop) => fetchStop(stop.id)));
  const fetchedAt = Date.now();
  const stops = STOPS.map((stop, index) => ({
    id: stop.id,
    label: stop.label,
    routes: stop.routes.map((routeNumber) => {
      const route = source[index].routePath?.find(
        (candidate) =>
          candidate.number.toLowerCase() === routeNumber.toLowerCase()
      );

      return {
        number: routeNumber,
        destination:
          route?.lastStopName?.replaceAll('"', "") ??
          "Направление неизвестно",
        color: route?.color ?? "#c2e6ff",
        arrivals: (route?.externalForecast ?? []).slice(0, 3).map((forecast) => ({
          seconds: forecast.time,
          realtime: forecast.byTelemetry === 1,
        })),
      };
    }),
  }));

  cachedBoard = { stops, fetchedAt };
  cacheExpiresAt = fetchedAt + CACHE_TTL_MS;
  return cachedBoard;
}

export async function fetchBusArrivals() {
  if (cachedBoard && Date.now() < cacheExpiresAt) {
    return cachedBoard;
  }

  if (!refreshPromise) {
    refreshPromise = refreshArrivals().finally(() => {
      refreshPromise = undefined;
    });
  }

  try {
    return await refreshPromise;
  } catch (error) {
    if (cachedBoard && Date.now() - cachedBoard.fetchedAt < STALE_TTL_MS) {
      console.warn(`Bus arrivals refresh failed, serving stale data: ${error.message}`);
      return cachedBoard;
    }
    throw error;
  }
}

function routeName(route) {
  return route.toUpperCase();
}

function minuteWord(value) {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return "минут";
  if (mod10 === 1) return "минуту";
  if (mod10 >= 2 && mod10 <= 4) return "минуты";
  return "минут";
}

function arrivalPhrase(arrival, omitRoute = false) {
  const prefix = omitRoute ? "Следующий" : routeName(arrival.route);
  const schedule = arrival.realtime ? "" : " по расписанию";

  if (arrival.seconds <= 45) return `${prefix}${schedule} подъезжает`;
  const minutes = Math.max(1, Math.round(arrival.seconds / 60));
  return `${prefix}${schedule} через ${minutes} ${minuteWord(minutes)}`;
}

function selectArrivals(stop) {
  const all = stop.routes
    .flatMap((route) =>
      route.arrivals.map((arrival) => ({ ...arrival, route: route.number }))
    )
    .filter((arrival) => arrival.seconds >= -45)
    .sort((a, b) => a.seconds - b.seconds);
  const live = all.filter((arrival) => arrival.realtime).slice(0, 2);

  if (live.length === 2) return live;
  const selected = new Set(live);
  const fallback = all
    .filter((arrival) => !selected.has(arrival))
    .slice(0, 2 - live.length);
  return [...live, ...fallback].sort((a, b) => a.seconds - b.seconds);
}

function stopPhrase(stop) {
  const arrivals = selectArrivals(stop);
  if (!arrivals.length) {
    return `${stop.label}: данных о ближайших автобусах нет`;
  }

  const spoken = arrivals.map((arrival, index) => {
    const previous = arrivals[index - 1];
    return arrivalPhrase(
      arrival,
      Boolean(previous && previous.route === arrival.route)
    );
  });
  return `${stop.label}: ${spoken.join(". ")}`;
}

export function formatVoiceArrivals(board) {
  return `${board.stops.map(stopPhrase).join(". ")}.`;
}
