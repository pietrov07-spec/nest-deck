#!/bin/zsh
# Compila los ayudantes nativos (mediakey y emoji2png). Necesita las herramientas de línea de comandos
# de Xcode (xcode-select --install). Si el compilador no coincide con el SDK más nuevo, prueba con los anteriores.
cd "$(dirname "$0")"
SDKS=("" $(ls -dr /Library/Developer/CommandLineTools/SDKs/MacOSX[0-9]*.sdk 2>/dev/null))
for tool in mediakey emoji2png; do
  ok=0
  for sdk in "${SDKS[@]}"; do
    if swiftc -O ${sdk:+-sdk} ${sdk:+"$sdk"} "$tool.swift" -o "$tool" 2>/dev/null; then ok=1; break; fi
  done
  if [ $ok = 1 ]; then echo "✓ $tool"; else echo "✗ No se pudo compilar $tool"; fi
done
