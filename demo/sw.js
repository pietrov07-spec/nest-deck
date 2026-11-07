// Demo en vivo de Nest Deck: este service worker hace el papel de la Mac.
// Responde las mismas rutas que server.js, pero guarda la botonera en el navegador (Cache Storage)
// y, en vez de ejecutar acciones en macOS, avisa a la página de la demo para que las muestre.
// Las páginas del Hub (hub.html) y del editor (editor.html) son copias sin cambios de public/.

const DATA = 'nest-deck-demo-data-v1';
const DECK_KEY = '/__demo/deck.json';
const ICON_PREFIX = '/__demo/icons/';
const channel = new BroadcastChannel('nest-deck-demo');

const APPS = ['App Store', 'Calculator', 'Calendar', 'FaceTime', 'Finder', 'Mail', 'Maps', 'Messages', 'Music', 'Notes',
  'Photos', 'Preview', 'Reminders', 'Safari', 'Screenshot', 'Spotify', 'System Settings', 'Terminal', 'TextEdit'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

async function loadDeck() {
  const cache = await caches.open(DATA);
  const hit = await cache.match(DECK_KEY);
  if (hit) return hit.json();
  const seed = await (await fetch('/deck.example.json', { cache: 'no-store' })).json();
  await saveDeck(seed);
  return seed;
}

async function saveDeck(deck) {
  const cache = await caches.open(DATA);
  await cache.put(DECK_KEY, new Response(JSON.stringify(deck), { headers: { 'Content-Type': 'application/json' } }));
}

// Lo mismo que /deck en server.js: el Hub nunca recibe los comandos.
function publicDeck(deck) {
  return {
    welcome: deck.welcome,
    pages: deck.pages.map(({ id, name, columns, buttons }) => ({
      id, name, columns,
      buttons: buttons.map(({ label, icon, color, gradient, image, style, action }) =>
        ({ label, icon, color, gradient, image, style, nav: action.type === 'page' ? action.to : undefined })),
    })),
  };
}

// En la Mac, emoji2png dibuja el emoji con la fuente de Apple; aquí basta con un SVG que usa la fuente del sistema.
function emojiSvg(e) {
  const safe = [...e].slice(0, 12).join('').replace(/[<>&"]/g, '');
  return new Response(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="50" y="54" font-size="78" text-anchor="middle" dominant-baseline="middle">${safe}</text></svg>`,
    { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'max-age=86400' } });
}

async function route(req, url) {
  const p = url.pathname;
  const m = req.method;

  if (m === 'GET' && p === '/deck') return json(publicDeck(await loadDeck()));
  if (m === 'GET' && p === '/emoji') return emojiSvg(url.searchParams.get('e') || '');
  if (m === 'GET' && p.startsWith('/icons/')) {
    const hit = await (await caches.open(DATA)).match(ICON_PREFIX + p.slice(7));
    return hit || new Response('', { status: 404 });
  }
  if (m === 'POST' && p === '/log') return new Response(null, { status: 204 });

  const press = p.match(/^\/press\/([a-z0-9-]+)\/(\d+)$/);
  if (m === 'POST' && press) {
    const page = (await loadDeck()).pages.find((x) => x.id === press[1]);
    const btn = page && page.buttons[Number(press[2])];
    if (!btn) return json({ ok: false, error: 'Botón inexistente' });
    channel.postMessage({ type: 'action', from: 'hub', label: btn.label, action: btn.action });
    return json({ ok: true });
  }

  if (m === 'GET' && p === '/editor/deck') return json(await loadDeck());
  if (m === 'GET' && p === '/editor/apps') return json(APPS);
  if (m === 'GET' && p === '/editor/status') return json({ state: 'deck', autoReopen: (await loadDeck()).autoReopen !== false });
  if (m === 'POST' && p === '/editor/cast') { channel.postMessage({ type: 'cast' }); return json({ ok: true }); }
  if (m === 'POST' && p === '/editor/test') {
    channel.postMessage({ type: 'action', from: 'editor', action: await req.json() });
    return json({ ok: true });
  }
  if (m === 'PUT' && p === '/editor/deck') {
    const deck = await req.json();
    if (!deck || !Array.isArray(deck.pages) || !deck.pages.length) return json({ ok: false, error: 'Falta la lista de pantallas' }, 400);
    if (deck.pages.length > 20) return json({ ok: false, error: 'Máximo 20 pantallas' }, 400);
    await saveDeck(deck);
    channel.postMessage({ type: 'saved' });
    return json({ ok: true });
  }
  if (m === 'POST' && p === '/editor/icon') {
    const blob = await req.blob();
    if (blob.size > 4e6) return json({ ok: false, error: 'Imagen demasiado grande' }, 413);
    const name = 'demo-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + '.png';
    await (await caches.open(DATA)).put(ICON_PREFIX + name, new Response(blob, { headers: { 'Content-Type': 'image/png' } }));
    return json({ ok: true, image: name });
  }
  if (m === 'POST' && p === '/__demo/reset') {
    await caches.delete(DATA);
    return json({ ok: true });
  }
  return null;
}

// Una navegación no acepta respuestas que vienen de una redirección (algunos hosts mandan /hub.html → /hub),
// así que se reconstruye una respuesta nueva con el contenido.
async function page(file) {
  const r = await fetch(file, { cache: 'no-store' });
  return new Response(await r.blob(), {
    status: r.status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Las pantallas: el Hub vive en "/" dentro de su marco (así funcionan sus recargas a "/?r=1"), y el editor en /editor.
  if (req.mode === 'navigate') {
    if (url.pathname === '/editor') return event.respondWith(page('/editor.html'));
    if (url.pathname === '/' && (req.destination === 'iframe' || url.searchParams.has('hub') || url.searchParams.has('r'))) {
      return event.respondWith(page('/hub.html'));
    }
    return;
  }

  const api = ['/deck', '/emoji', '/log', '/__demo/reset'].includes(url.pathname) ||
    /^\/(icons|press|editor)\//.test(url.pathname);
  if (!api) return;
  event.respondWith(route(req, url).then((r) => r || new Response('', { status: 404 }))
    .catch((e) => json({ ok: false, error: e.message }, 500)));
});
