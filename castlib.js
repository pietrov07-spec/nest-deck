// Comunicación con el Nest Hub por Cast: consultar qué está mostrando y abrir la botonera con DashCast
// (app de Cast pública que carga cualquier URL).
const os = require('os');
const util = require('util');
const dns = require('dns').promises;
const { spawn } = require('child_process');
const { Client, Application, RequestResponseController } = require('castv2-client');

function DashCast(client, session) {
  Application.apply(this, arguments);
  this.dash = this.createController(RequestResponseController, 'urn:x-cast:com.madmod.dashcast');
}
DashCast.APP_ID = '84912283';
util.inherits(DashCast, Application);

function localIp() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  throw new Error('No encontré la IP local de la Mac');
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function connect(ip, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const client = new Client();
    const timer = setTimeout(() => { client.close(); reject(new Error('El Nest Hub no respondió')); }, timeoutMs);
    client.on('error', (err) => { clearTimeout(timer); client.close(); reject(err); });
    client.connect(ip, () => { clearTimeout(timer); resolve(client); });
  });
}

const getSessions = (client) => new Promise((resolve, reject) => {
  client.getSessions((err, sessions) => (err ? reject(err) : resolve(sessions || [])));
});

// Qué muestra el Hub: 'deck' (la botonera), 'idle' (reloj o fotos) u 'other' (otra app, p. ej. Spotify o YouTube).
async function hubStatus(ip) {
  const client = await connect(ip);
  try {
    const sessions = await getSessions(client);
    if (sessions.some((s) => s.appId === DashCast.APP_ID)) return { state: 'deck' };
    const other = sessions.find((s) => !s.isIdleScreen);
    return other ? { state: 'other', app: other.displayName || other.appId } : { state: 'idle' };
  } finally {
    client.close();
  }
}

async function castDeck(ip, url, log = console.log) {
  const client = await connect(ip);
  try {
    log(`Conectado al Nest Hub (${ip}). Abriendo ${url}`);
    // Si DashCast ya está abierto, la página de la botonera lo reemplazó y no escucha mensajes: se cierra primero.
    const open = (await getSessions(client)).find((s) => s.appId === DashCast.APP_ID);
    if (open) {
      log('Cerrando la botonera anterior…');
      // El Hub no siempre confirma el cierre, así que no se espera la respuesta.
      client.receiver.stop(open.sessionId, () => {});
      await wait(2500);
    }
    const app = await new Promise((resolve, reject) => client.launch(DashCast, (err, a) => (err ? reject(err) : resolve(a))));
    // DashCast tarda en cargar y descarta mensajes que llegan antes, así que se reenvía varias veces.
    // force: navega la página completa (evita el bloqueo http dentro de https).
    for (const [i, ms] of [3000, 3000, 4000].entries()) {
      await wait(ms);
      log(`Enviando URL (intento ${i + 1})…`);
      app.dash.send({ url, force: true, reload: false, reload_time: 0 });
    }
    await wait(3000);
    log('Listo: la botonera debería aparecer en el Nest Hub.');
  } finally {
    client.close();
  }
}

// --- Buscar el Nest Hub en la red ---
// Usa dns-sd (viene con macOS) para listar los dispositivos Cast y se queda con los Nest Hub.

function runFor(args, ms) {
  return new Promise((resolve) => {
    let out = '';
    const p = spawn('dns-sd', args);
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => resolve(''));
    p.on('close', () => resolve(out));
    setTimeout(() => p.kill(), ms);
  });
}

const txt = (info, key) => ((info.match(new RegExp(`\\b${key}=((?:\\\\ |\\S)*)`)) || [])[1] || '').replace(/\\ /g, ' ');

async function discoverHubs() {
  const browse = await runFor(['-B', '_googlecast._tcp', 'local.'], 2500);
  const names = [...new Set([...browse.matchAll(/_googlecast\._tcp\.\s+(\S.*)$/gm)].map((m) => m[1].trim()))];
  const hubs = [];
  for (const name of names) {
    const info = await runFor(['-L', name, '_googlecast._tcp', 'local.'], 1500);
    const model = txt(info, 'md');
    const host = (info.match(/can be reached at (\S+?)\.?:\d+/) || [])[1];
    if (!host || !/nest hub/i.test(model)) continue;
    try {
      const { address } = await dns.lookup(host, { family: 4 });
      hubs.push({ name: txt(info, 'fn') || model, model, ip: address });
    } catch {}
  }
  return hubs;
}

module.exports = { localIp, hubStatus, castDeck, discoverHubs };
