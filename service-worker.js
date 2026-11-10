// Sube VERSION cada vez que cambies imágenes o sonidos (los archivos con el mismo
// nombre se sirven desde caché). El código (html/js/css) se actualiza solo cuando hay red.
const VERSION = "v1.3.0";
const CACHE = `snake-pwa-${VERSION}`;

const PRECACHE = [
  "./",
  "index.html",
  "style.css",
  "game.js",
  "manifest.json",
  "icon/descarga.svg",
  "icon/apple-touch-icon.png",
  "icon/icon-192.png",
  "icon/icon-512.png",
  "icon/icon-maskable-512.png",
  "icon/icon_title.webp",
  "icon/Escenario.webp",
  "icon/estalactita.webp",
  "icon/soul.webp",
  "icon/snake_head_0.webp",
  "icon/snake_head_1.webp",
  "icon/snake_head_2.webp",
  "icon/snake_head_3.webp",
  "icon/snake_head_4.webp",
  "icon/snake_body_0.webp",
  "icon/snake_body_1.webp",
  "icon/snake_body_2.webp",
  "icon/snake_body_3.webp",
  "icon/snake_body_4.webp",
  "sounds/bite.mp3",
  "sounds/coin.mp3",
  "sounds/game_over.mp3",
  "sounds/hit.mp3",
  "sounds/sound_menu.mp3",
  "sounds/music_game.mp3",
  "sounds/fight_boss.mp3",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith("snake-pwa-") && k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Safari pide el audio con cabecera Range: hay que responder con 206 desde la caché.
  if (req.headers.has("range")) {
    event.respondWith(rangeResponse(req));
    return;
  }

  const isCode =
    req.mode === "navigate" || url.pathname.endsWith("/") || /\.(html|js|css|json)$/.test(url.pathname);
  event.respondWith(isCode ? networkFirst(req) : cacheFirst(req));
});

// Código: red primero (siempre la última versión con conexión), caché si no hay red.
async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await withTimeout(fetch(req), 4000);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const cached =
      (await cache.match(req, { ignoreSearch: true })) ||
      (req.mode === "navigate" ? await cache.match("index.html") : undefined);
    return cached || Response.error();
  }
}

// Imágenes y sonidos: caché primero.
async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function rangeResponse(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req.url);
  if (!cached) return fetch(req);

  const buf = await cached.arrayBuffer();
  const size = buf.byteLength;
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") || "");

  let start = 0;
  let end = size - 1;
  if (m) {
    if (m[1] !== "") {
      start = parseInt(m[1], 10);
      if (m[2] !== "") end = parseInt(m[2], 10);
    } else if (m[2] !== "") {
      start = Math.max(0, size - parseInt(m[2], 10)); // "últimos N bytes"
    }
  }
  end = Math.min(end, size - 1);

  if (Number.isNaN(start) || start > end) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }

  return new Response(buf.slice(start, end + 1), {
    status: 206,
    statusText: "Partial Content",
    headers: {
      "Content-Type": cached.headers.get("Content-Type") || "audio/mpeg",
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
    },
  });
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}
