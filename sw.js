/* Дневник работает без сети: оболочка кладётся в кеш при установке,
   шрифты — по мере загрузки. Версию поднимать при каждом изменении
   index.html, иначе у установленных копий останется старая. */
const VERSION = "dnevnik-v4";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./icon-maskable.svg",
  "./style/paper.css", "./core/core.js", "./core/parse.js", "./ui/app.js",
  "./fonts/pt-sans-narrow-400-cyrillic.woff2", "./fonts/pt-sans-narrow-700-cyrillic.woff2",
  "./fonts/pt-serif-400-cyrillic.woff2", "./fonts/pt-serif-700-cyrillic.woff2",
  "./fonts/caveat-cyrillic.woff2"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  // Оболочка: сначала сеть, кеш — подстраховка. Так правка index.html
  // доезжает сразу, а без сети открывается вчерашняя копия.
  const isShell = req.mode === "navigate" || new URL(req.url).origin === self.location.origin;
  if (isShell) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html")))
    );
    return;
  }

  // Шрифты и прочее чужое: сначала кеш, он не меняется.
  // Если шрифта нет ни в кеше, ни в сети — запрос падает, и страница
  // берёт запасную гарнитуру. Дневник от этого рабочим быть не перестаёт.
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === "opaque") {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }))
  );
});
