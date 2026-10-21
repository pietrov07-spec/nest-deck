// Abre la botonera en el Nest Hub: node cast.js [ip-del-hub] [url]
const fs = require('fs');
const path = require('path');
const { localIp, castDeck } = require('./castlib');

const deck = JSON.parse(fs.readFileSync(path.join(__dirname, 'deck.json'), 'utf8'));
const hubIp = process.argv[2] || deck.nestHubIp;
const deckUrl = process.argv[3] || `http://${localIp()}:${deck.port}/`;

castDeck(hubIp, deckUrl).then(
  () => process.exit(0),
  (err) => { console.error('Error:', err.message || err); process.exit(1); }
);
