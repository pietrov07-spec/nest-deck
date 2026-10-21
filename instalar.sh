#!/bin/zsh
# Instalador de Nest Deck: dependencias, ayudantes nativos, botonera de ejemplo y búsqueda del Nest Hub.
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/node/bin:$HOME/.volta/bin:$PATH"

echo "🎛  Instalando Nest Deck"
[[ $(uname) == Darwin ]] || { echo "Nest Deck funciona solo en macOS."; exit 1; }
command -v node >/dev/null || { echo "Falta Node.js: instálalo desde https://nodejs.org (versión 18 o más nueva) y vuelve a ejecutar."; exit 1; }

echo "\n1/4 Instalando dependencias…"
npm install --omit=dev --no-audit --no-fund || exit 1

echo "\n2/4 Compilando ayudantes nativos…"
if xcrun --find swiftc >/dev/null 2>&1; then
  ./compilar.sh
else
  echo "Faltan las herramientas de Xcode. Ejecuta: xcode-select --install  (sin ellas, los emojis se verán como texto)."
fi

echo "\n3/4 Preparando tu botonera…"
if [ -f deck.json ]; then echo "Ya tienes deck.json; no lo toco."; else cp deck.example.json deck.json && echo "Creado deck.json."; fi

echo "\n4/4 Buscando tu Nest Hub en la red… (si macOS pide permiso de Red local, acéptalo)"
node -e 'require("./castlib").discoverHubs().then((h) => {
  if (!h.length) return console.log("No encontré ningún Nest Hub. Revisa que esté en la misma red Wi-Fi que la Mac.");
  h.forEach((x) => console.log(`✓ ${x.model} en ${x.ip}`));
})'

echo
read "ans?¿Abrir Nest Deck solo al iniciar sesión en la Mac? [s/N] "
if [[ $ans == [sS]* ]]; then
  osascript -e "tell application \"System Events\" to make login item at end with properties {path:\"$PWD/Nest Deck.command\", hidden:false}" >/dev/null \
    && echo "✓ Agregado a los ítems de inicio de sesión."
fi

echo "\n✅ Listo. Doble clic en «Nest Deck.command» para arrancar."
echo "   Editor: http://localhost:8765/editor"
echo "   La primera vez, da a Terminal el permiso de Accesibilidad (Ajustes → Privacidad y seguridad) para los atajos de teclado."
