#!/bin/zsh
# Arranca el servidor de Nest Deck. El propio servidor encuentra el Nest Hub, abre la botonera
# y la vuelve a abrir si el Hub la cierra.
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/node/bin:$HOME/.volta/bin:$PATH"

if ! command -v node >/dev/null; then
  echo "No encontré Node.js. Instálalo desde https://nodejs.org y vuelve a abrir Nest Deck."
  exit 1
fi
[ -d node_modules ] || npm install --omit=dev --no-audit --no-fund

pkill -f '^node server.js' 2>/dev/null
sleep 0.5
echo "Nest Deck activo. Deja esta ventana abierta (Ctrl-C para detenerlo)."
echo "Editor: http://localhost:8765/editor"
exec node server.js
