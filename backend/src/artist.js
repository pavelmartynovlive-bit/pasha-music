const PHOTO_CACHE_TTL = 6 * 60 * 60 * 1000;
const EMPTY_PHOTO_CACHE_TTL = 5 * 60 * 1000;
const PHOTO_REQUEST_TIMEOUT = 1200;
const PHOTO_CACHE_LIMIT = 200;
const photoCache = new Map();

const normalizeName = (value) => String(value || "").trim().toLocaleLowerCase();

function imageUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

// VK artist portraits are photo arrays, while album thumbnails use photo_N keys.
// Keep their provenance separate so a cover is never labelled as an artist photo.
export function artistPhoto(artist) {
  const photos = Array.isArray(artist?.photo) ? artist.photo : [];
  const candidates = photos
    .map((photo) => ({
      url: imageUrl(photo?.url),
      width: Number(photo?.width) || 0,
      height: Number(photo?.height) || 0,
    }))
    .filter((photo) => photo.url)
    .sort((left, right) => right.width * right.height - left.width * left.height);
  return candidates[0]?.url || null;
}

export function matchesArtist(artist, id, name) {
  if (!artist || typeof artist !== "object") return false;
  return id && id !== "by-name" && artist.id
    ? String(artist.id) === String(id)
    : normalizeName(artist.name) === normalizeName(name);
}

export function findArtistMetadata(response, id, name) {
  const candidates = [
    ...(Array.isArray(response?.artists) ? response.artists : []),
    ...(Array.isArray(response?.items)
      ? response.items.flatMap((track) => track.main_artists || []) : []),
  ].filter((artist) => matchesArtist(artist, id, name));
  // Prefer a portrait-bearing entry if the same artist appears on several tracks.
  return candidates.find((artist) => artistPhoto(artist)) || candidates[0] || null;
}

export function getArtistPhoto(vk, id, name) {
  if (!id || id === "by-name") return Promise.resolve(null);
  const key = String(id);
  const cached = photoCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  if (cached) photoCache.delete(key);

  let timeout;
  const request = Promise.resolve()
    .then(() => vk.request("audio.getArtistById", new URLSearchParams({ artist_id: key })))
    .then((result) => {
      if (!result?.success) return null;
      const artist = result.data?.response;
      return matchesArtist(artist, key, name) ? artistPhoto(artist) : null;
    })
    .catch(() => null);
  const promise = Promise.race([
    request,
    new Promise((resolve) => { timeout = setTimeout(() => resolve(null), PHOTO_REQUEST_TIMEOUT); }),
  ]).then((photo) => {
    clearTimeout(timeout);
    const entry = photoCache.get(key);
    if (entry?.promise === promise) {
      entry.expiresAt = Date.now() + (photo ? PHOTO_CACHE_TTL : EMPTY_PHOTO_CACHE_TTL);
    }
    return photo;
  });

  if (photoCache.size >= PHOTO_CACHE_LIMIT) photoCache.delete(photoCache.keys().next().value);
  photoCache.set(key, { promise, expiresAt: Date.now() + PHOTO_REQUEST_TIMEOUT + EMPTY_PHOTO_CACHE_TTL });
  return promise;
}

export function artistPresentation({ id, name, photo, tracks }) {
  if (photo) {
    return { id, name, photo, photoSource: "vk", artwork: { photo_1200: photo }, artworkKind: "artist" };
  }
  for (const artwork of tracks.flatMap((track) => [track.album?.thumbnail, track.thumbnail])) {
    if (!artwork || typeof artwork !== "object") continue;
    const images = Object.fromEntries(Object.entries(artwork)
      .filter(([key, value]) => /^photo_\d+$/.test(key) && imageUrl(value))
      .map(([key, value]) => [key, imageUrl(value)]));
    if (Object.keys(images).length) {
      return { id, name, photo: null, photoSource: null, artwork: images, artworkKind: "album" };
    }
  }
  return { id, name, photo: null, photoSource: null, artwork: {}, artworkKind: null };
}
