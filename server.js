// Nest Deck para Mac: sirve la botonera y ejecuta las acciones en esta Mac.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { localIp, hubStatus, castDeck, discoverHubs } = require('./castlib');

const DECK_PATH = path.join(__dirname, 'deck.json');
const EXAMPLE_PATH = path.join(__dirname, 'deck.example.json');

// La primera vez no hay deck.json: se crea a partir de la botonera de ejemplo.
if (!fs.existsSync(DECK_PATH)) {
  fs.copyFileSync(EXAMPLE_PATH, DECK_PATH);
  console.log('Se creó deck.json a partir de deck.example.json');
}

function loadDeck() {
  const deck = JSON.parse(fs.readFileSync(DECK_PATH, 'utf8'));
  // Formato anterior (una sola pantalla): se convierte al vuelo; al guardar desde el editor queda en el nuevo.
  if (!deck.pages) {
    deck.pages = [{ id: 'principal', name: 'Principal', columns: deck.columns || 5, buttons: deck.buttons || [] }];
    delete deck.columns;
    delete deck.buttons;
  }
  return deck;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)));
  });
}

const osa = (script) => run('osascript', ['-e', script]);

// Play/pausa, siguiente y anterior. Con "app" (Spotify o Music) se controla esa app directamente;
// sin ella se simula la tecla multimedia con el ayudante nativo compilado de mediakey.swift.
const MEDIA_SCRIPT = { playpause: 'playpause', next: 'next track', previous: 'previous track' };
function media(a) {
  if (a.app) return osa(`tell application "${esc(a.app)}" to ${MEDIA_SCRIPT[a.command]}`);
  return run(path.join(__dirname, 'mediakey'), [a.command]);
}

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

async function runAction(a) {
  switch (a.type) {
    case 'media':
      return media(a);
    case 'volume':
      return osa(`set volume output volume ((output volume of (get volume settings)) + ${Number(a.delta)})`);
    case 'mute':
      return osa('set volume output muted (not (output muted of (get volume settings)))');
    case 'keystroke': {
      const mods = (a.modifiers || []).map((m) => `${m} down`).join(', ');
      return osa(`tell application "System Events" to keystroke "${esc(a.key)}"${mods ? ` using {${mods}}` : ''}`);
    }
    case 'keycode': {
      const mods = (a.modifiers || []).map((m) => `${m} down`).join(', ');
      return osa(`tell application "System Events" to key code ${Number(a.code)}${mods ? ` using {${mods}}` : ''}`);
    }
    case 'app':
      return run('open', ['-a', a.name]);
    case 'url':
      return run('open', [a.url]);
    case 'shell':
      return run('/bin/zsh', ['-lc', a.command]);
    case 'page':
      // Cambiar de pantalla lo hace el Hub (o el editor) por su cuenta; en la Mac no hay nada que ejecutar.
      return;
    default:
      throw new Error(`Tipo de acción desconocido: ${a.type}`);
  }
}

// --- Emojis como imagen ---
// La fuente de emojis del Hub es vieja y muestra cuadros rotos, así que la Mac los dibuja con los de Apple
// (emoji2png, compilado de emoji2png.swift) y los guarda en emoji-cache/.

const EMOJI_CACHE = path.join(__dirname, 'emoji-cache');

async function sendEmoji(res, emoji) {
  if (!emoji || [...emoji].length > 12) {
    res.writeHead(400);
    return res.end();
  }
  const name = [...emoji].map((c) => c.codePointAt(0).toString(16)).join('-') + '.png';
  const file = path.join(EMOJI_CACHE, name);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(EMOJI_CACHE, { recursive: true });
    await run(path.join(__dirname, 'emoji2png'), [emoji, file, '160']);
  }
  res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
  res.end(fs.readFileSync(file));
}

// --- Íconos subidos ---
// El editor recorta la imagen y la convierte a PNG cuadrado; aquí solo se guarda en icons/ con un nombre
// derivado de su contenido (la misma imagen subida dos veces no se duplica).

const ICONS_DIR = path.join(__dirname, 'icons');
const ICON_NAME = /^[a-f0-9]{16}\.png$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function saveIcon(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('La imagen debe llegar como PNG');
  const name = require('crypto').createHash('sha256').update(buf).digest('hex').slice(0, 16) + '.png';
  fs.mkdirSync(ICONS_DIR, { recursive: true });
  fs.writeFileSync(path.join(ICONS_DIR, name), buf);
  return name;
}

function sendIcon(res, name) {
  const file = path.join(ICONS_DIR, name);
  if (!ICON_NAME.test(name) || !fs.existsSync(file)) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' });
  res.end(fs.readFileSync(file));
}

// --- Editor (solo desde esta Mac) ---

const ACTION_TYPES = ['app', 'url', 'keystroke', 'keycode', 'media', 'volume', 'mute', 'shell', 'page'];

// El editor puede crear botones que ejecutan comandos, así que solo se acepta desde esta Mac,
// con Host local (evita DNS rebinding) y con una cabecera propia que otras webs no pueden enviar sin permiso.
function isLocalEditor(req, write) {
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  const host = (req.headers.host || '').replace(/:\d+$/, '');
  const okHost = ['localhost', '127.0.0.1', '[::1]'].includes(host);
  return local && okHost && (!write || req.headers['x-nest-deck'] === '1');
}

function readBuffer(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) reject(new Error('Demasiado grande'));
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const readBody = async (req) => (await readBuffer(req)).toString('utf8');

const PAGE_ID = /^[a-z0-9-]{1,32}$/;
const PAGE_TARGETS = ['home', 'next', 'prev'];

// Degradado de fondo: { type: 'linear' | 'radial', angle: 0–360, stops: [{ pos: 0–100, color: '#rrggbb' }] } (2 a 5).
// El Hub lo convierte en CSS, así que solo se aceptan números y colores hexadecimales.
function validGradient(g) {
  return g && ['linear', 'radial'].includes(g.type) && Number.isFinite(g.angle) && g.angle >= 0 && g.angle <= 360 &&
    Array.isArray(g.stops) && g.stops.length >= 2 && g.stops.length <= 5 &&
    g.stops.every((s) => Number.isFinite(s.pos) && s.pos >= 0 && s.pos <= 100 && /^#[0-9a-f]{6}$/i.test(s.color));
}

function validateButton(b, where, pageIds) {
  if (typeof b.label !== 'string') throw new Error(`${where}: falta el nombre`);
  if (!b.action || !ACTION_TYPES.includes(b.action.type)) throw new Error(`${where}: acción no válida`);
  if (b.action.type === 'page' && !PAGE_TARGETS.includes(b.action.to) && !pageIds.includes(b.action.to)) {
    throw new Error(`${where}: la pantalla de destino no existe`);
  }
  if (b.image !== undefined && (!ICON_NAME.test(b.image) || !fs.existsSync(path.join(ICONS_DIR, b.image)))) {
    throw new Error(`${where}: la imagen no existe`);
  }
  if (b.style !== undefined && !['icon', 'full'].includes(b.style)) throw new Error(`${where}: estilo no válido`);
  if (b.gradient !== undefined && !validGradient(b.gradient)) throw new Error(`${where}: degradado no válido`);
  // Parámetros del Key Creator, para poder volver a editar el diseño (el Hub nunca los recibe).
  if (b.design !== undefined) {
    if (typeof b.design !== 'object' || JSON.stringify(b.design).length > 5000) throw new Error(`${where}: diseño no válido`);
    const img = b.design.image;
    if (img && (!ICON_NAME.test(img) || !fs.existsSync(path.join(ICONS_DIR, img)))) throw new Error(`${where}: la imagen del diseño no existe`);
  }
}

function validateDeck(d) {
  if (!d || !Array.isArray(d.pages) || !d.pages.length) throw new Error('Falta la lista de pantallas');
  if (d.pages.length > 20) throw new Error('Máximo 20 pantallas');
  const pageIds = d.pages.map((p) => p.id);
  if (new Set(pageIds).size !== pageIds.length || !pageIds.every((id) => PAGE_ID.test(id))) throw new Error('Identificadores de pantalla no válidos');
  const pages = d.pages.map((p, pi) => {
    const name = String(p.name || '').trim().slice(0, 30) || `Pantalla ${pi + 1}`;
    const columns = Math.round(Number(p.columns));
    if (!(columns >= 1 && columns <= 8)) throw new Error(`${name}: las columnas deben ser entre 1 y 8`);
    if (!Array.isArray(p.buttons)) throw new Error(`${name}: falta la lista de botones`);
    p.buttons.forEach((b, i) => validateButton(b, `${name}, botón ${i + 1}`, pageIds));
    return { id: p.id, name, columns, buttons: p.buttons };
  });
  const current = loadDeck();
  const autoReopen = d.autoReopen === undefined ? current.autoReopen !== false : Boolean(d.autoReopen);
  // Pantalla de bienvenida: { enabled, text }. Si el editor no la envía, se conserva la que había.
  const w = d.welcome === undefined ? current.welcome : d.welcome;
  const welcome = w && typeof w === 'object' ? { enabled: w.enabled !== false, text: String(w.text || '').slice(0, 60) } : undefined;
  return { port: current.port, nestHubIp: current.nestHubIp, autoReopen, welcome, pages };
}

function listApps() {
  const dirs = ['/Applications', '/Applications/Utilities', '/System/Applications', '/System/Applications/Utilities',
    path.join(require('os').homedir(), 'Applications')];
  const names = new Set();
  for (const dir of dirs) {
    try {
      for (const f of fs.readdirSync(dir)) if (f.endsWith('.app')) names.add(f.slice(0, -4));
    } catch {}
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

const sendJson = (res, data) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
};

async function handleEditor(req, res, pathname) {
  const write = req.method !== 'GET';
  if (!isLocalEditor(req, write)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('El editor solo se puede usar desde esta Mac: http://localhost:' + loadDeck().port + '/editor');
  }
  if (req.method === 'GET' && pathname === '/editor') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(__dirname, 'public', 'editor.html')));
  }
  if (req.method === 'GET' && pathname === '/editor/deck') return sendJson(res, loadDeck());
  if (req.method === 'GET' && pathname === '/editor/apps') return sendJson(res, listApps());
  if (req.method === 'GET' && pathname === '/editor/status') return sendJson(res, { ...hub, autoReopen: loadDeck().autoReopen !== false });
  if (req.method === 'POST' && pathname === '/editor/cast') {
    await openDeckOnHub('abierta desde el editor');
    return sendJson(res, { ok: true });
  }
  if (req.method === 'PUT' && pathname === '/editor/deck') {
    const deck = validateDeck(JSON.parse(await readBody(req)));
    fs.writeFileSync(DECK_PATH, JSON.stringify(deck, null, 2) + '\n');
    const total = deck.pages.reduce((n, p) => n + p.buttons.length, 0);
    console.log(`✎ deck guardado (${deck.pages.length} pantallas, ${total} botones)`);
    return sendJson(res, { ok: true });
  }
  if (req.method === 'POST' && pathname === '/editor/icon') {
    const name = saveIcon(await readBuffer(req, 4e6));
    console.log(`🖼 ícono guardado (${name})`);
    return sendJson(res, { ok: true, image: name });
  }
  if (req.method === 'POST' && pathname === '/editor/test') {
    const action = JSON.parse(await readBody(req));
    if (!ACTION_TYPES.includes(action.type)) throw new Error('Acción no válida');
    await runAction(action);
    return sendJson(res, { ok: true });
  }
  res.writeHead(404);
  res.end();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET') console.log(`· ${req.socket.remoteAddress} pidió ${url.pathname}`);
  try {
    if (url.pathname === '/editor' || url.pathname.startsWith('/editor/')) return await handleEditor(req, res, url.pathname);
    // El navegador del Hub no debe guardar copias: siempre tiene que ver el deck actual.
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html')));
    }
    if (req.method === 'GET' && url.pathname === '/deck') {
      // Solo se envía lo que la pantalla necesita, nunca los comandos.
      const deck = loadDeck();
      // De los botones de navegación sí se envía el destino, porque el cambio de pantalla lo hace el Hub.
      const pages = deck.pages.map(({ id, name, columns, buttons }) => ({
        id, name, columns,
        buttons: buttons.map(({ label, icon, color, gradient, image, style, action }) =>
          ({ label, icon, color, gradient, image, style, nav: action.type === 'page' ? action.to : undefined })),
      }));
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ welcome: deck.welcome, pages }));
    }
    if (req.method === 'GET' && url.pathname === '/emoji') return await sendEmoji(res, url.searchParams.get('e') || '');
    if (req.method === 'GET' && url.pathname.startsWith('/icons/')) return sendIcon(res, url.pathname.slice(7));
    if (req.method === 'POST' && url.pathname === '/log') {
      // Mensajes de la pantalla del Hub (errores, recargas) para poder diagnosticar.
      console.log(`📟 Hub: ${(await readBody(req)).slice(0, 300)}`);
      res.writeHead(204);
      return res.end();
    }
    const m = url.pathname.match(/^\/press\/([a-z0-9-]+)\/(\d+)$/);
    if (req.method === 'POST' && m) {
      const page = loadDeck().pages.find((p) => p.id === m[1]);
      const btn = page && page.buttons[Number(m[2])];
      if (!btn) throw new Error('Botón inexistente');
      console.log(`▶ ${btn.label}`);
      await runAction(btn.action);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{"ok":true}');
    }
    res.writeHead(404);
    res.end();
  } catch (e) {
    console.error(`✖ ${e.message}`);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
});

// --- Vigilante: reabre la botonera si el Hub la cierra ---
// Cada 20 s pregunta al Hub qué muestra. Si volvió al reloj o a las fotos, reabre la botonera; si hay otra app
// (Spotify, YouTube, una llamada…) no la interrumpe. Tras un intento espera 1 minuto antes de otro.

const WATCH_EVERY_MS = 20000;
const RETRY_AFTER_MS = 60000;
const STATE_TEXT = { deck: 'muestra la botonera', idle: 'está en reposo (reloj o fotos)', offline: 'no responde' };
let hub = { state: 'unknown' };
let lastCastAt = 0;
let casting = false;

async function openDeckOnHub(reason) {
  if (casting) throw new Error('Ya se está abriendo la botonera');
  casting = true;
  lastCastAt = Date.now();
  const deck = loadDeck();
  console.log(`↻ Abriendo la botonera en el Hub (${reason})`);
  try {
    await castDeck(deck.nestHubIp, `http://${localIp()}:${deck.port}/`, (m) => console.log('  ' + m));
    hub = { state: 'deck', checkedAt: Date.now() };
  } finally {
    casting = false;
  }
}

// Si no hay IP guardada o el Hub no responde, se busca en la red (como mucho cada 2 minutos) y se guarda la IP nueva.
const DISCOVER_EVERY_MS = 120000;
let lastDiscoverAt = 0;

async function findHub(current) {
  if (Date.now() - lastDiscoverAt < DISCOVER_EVERY_MS) return null;
  lastDiscoverAt = Date.now();
  const hubs = await discoverHubs();
  if (!hubs.length) { console.log('🔎 No encontré ningún Nest Hub en la red'); return null; }
  const found = hubs.find((h) => h.ip === current) || hubs[0];
  if (found.ip !== current) {
    const raw = JSON.parse(fs.readFileSync(DECK_PATH, 'utf8'));
    raw.nestHubIp = found.ip;
    fs.writeFileSync(DECK_PATH, JSON.stringify(raw, null, 2) + '\n');
    console.log(`🔎 Nest Hub encontrado: ${found.model} en ${found.ip}${hubs.length > 1 ? ` (hay ${hubs.length}; se usa el primero)` : ''}`);
  }
  return found.ip;
}

async function watchHub() {
  if (casting) return;
  let deck = loadDeck();
  const before = hub.state + (hub.app || '');
  if (!deck.nestHubIp) await findHub('');
  deck = loadDeck();
  try {
    if (!deck.nestHubIp) throw new Error('Sin Nest Hub');
    hub = { ...(await hubStatus(deck.nestHubIp)), checkedAt: Date.now() };
  } catch (e) {
    hub = { state: 'offline', error: e.message, checkedAt: Date.now() };
    const ip = await findHub(deck.nestHubIp);
    if (ip && ip !== deck.nestHubIp) { setTimeout(watchHub, 1000); return; }
  }
  if (hub.state + (hub.app || '') !== before) {
    console.log(`📺 El Hub ${hub.state === 'other' ? `está usando otra app (${hub.app})` : STATE_TEXT[hub.state]}`);
  }
  if (deck.autoReopen === false || hub.state !== 'idle' || Date.now() - lastCastAt < RETRY_AFTER_MS) return;
  openDeckOnHub('el Hub estaba en reposo').catch((e) => console.error(`✖ No se pudo reabrir: ${e.message}`));
}

const { port } = loadDeck();
server.listen(port, '0.0.0.0', () => {
  console.log(`Nest Deck escuchando en el puerto ${port}`);
  setTimeout(watchHub, 2000);
  setInterval(watchHub, WATCH_EVERY_MS);
});
