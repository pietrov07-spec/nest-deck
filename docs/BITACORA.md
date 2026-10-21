# Bitácora — Nest Deck para Mac

> Diario de construcción del proyecto, tal como ocurrió: qué se probó, qué falló y cómo se resolvió.
> Útil si quieres entender por qué el código es como es.

Registro de cómo se construyó el proyecto: qué se hizo en cada etapa, qué falló y cómo se resolvió.
Todo ocurrió el **21 de octubre de 2026**.

---

## Etapa 0 — Investigación de NestDeck original

- Se revisaron https://nestdeck.base64.pt/ y https://github.com/achinita/NestDeck.
- **Hallazgo:** NestDeck es una app **solo para Windows** (.NET 7 WinForms, `net7.0-windows`) y depende de:
  - una app de Cast propia del autor (receptor registrado en Google),
  - un servidor del autor en la nube (OutSystems) para emparejar y enviar mensajes (SSE).
- **Decisión:** no se puede usar en Mac. Se construye una versión propia con la misma idea:
  servidor en la Mac + página web táctil enviada al Nest Hub.

## Etapa 1 — Requisitos de la Mac y red

- Mac con macOS 26 y Apple Silicon, con Node.js 22. El Python que trae el sistema es viejo, así que no se usa.
- Con `dns-sd` se encontró el **Google Nest Hub** en la red, junto con otros dispositivos Cast (altavoces y TV).
- Nest Hub con Fuchsia OS, puerto Cast `8009`, en la misma red que la Mac.

## Etapa 2 — Servidor y botonera

- `server.js`: servidor HTTP (puerto `8765`) que sirve la botonera y ejecuta acciones (apps, URL, atajos, volumen, comandos).
- `public/index.html`: pantalla táctil para 1024×600.
- `deck.json`: definición de botones. El Hub **solo recibe nombre, emoji y color**; los comandos nunca salen de la Mac.
- Dependencia: `castv2-client` (protocolo Cast).

## Etapa 3 — Enviar la botonera al Nest Hub

- `cast.js` abre **DashCast** (app pública de Cast, ID `84912283`) y le manda la URL de la botonera.
- **Problema 1:** `EHOSTUNREACH` al conectar desde el entorno de Claude, aunque `nc` sí llegaba.
  **Causa:** permiso de *Red local* de macOS. **Solución:** ejecutarlo desde Terminal.
- **Problema 2:** DashCast abría, pero nunca pedía la página.
  **Causa:** DashCast cambió su canal de `urn:x-cast:es.offd.dashcast` a `urn:x-cast:com.madmod.dashcast`
  (se descubrió con `DEBUG=castv2`). **Solución:** usar el canal nuevo, con reenvíos a los 3, 6 y 10 s.
- `force: true` hace que DashCast navegue a la página completa (evita bloqueos http dentro de https).
- ✅ La botonera apareció y los toques llegaban a la Mac.

## Etapa 4 — Permisos y teclas

- **Problema:** atajos de teclado fallaban: *"osascript no tiene permitido enviar presiones de tecla"*.
  **Solución:** dar **Accesibilidad** a Terminal y correr el servidor desde Terminal con `iniciar.sh`.
- **Problema:** teclas multimedia (Play/Anterior/Siguiente) no hacían nada; el puente JXA no entrega el evento.
  Se compiló `mediakey.swift`, pero tampoco controló la música.
  **Solución:** controlar **Spotify** directamente por AppleScript (`tell application "Spotify" to playpause`).
  `mediakey` queda como alternativa para "tecla multimedia del sistema".
- **Problema:** Captura (⌘⇧4) no funciona simulada. **Solución:** abrir la app *Captura de pantalla*.
- Mission Control: se abre como app en vez de `key code 160`.
- Nota: el compilador Swift instalado (6.3.3) no coincide con el SDK por defecto (macOS 27);
  se compila con `-sdk .../MacOSX26.sdk` (ver `compilar.sh`).
- Los botones de navegador y de música se pueden apuntar a cualquier app (por ejemplo, otro navegador o Spotify).

## Etapa 5 — Pantalla principal (3 filas × 6)

- Fila 1 (audio): Música, Play/Pausa, Anterior, Siguiente, Vol −, Vol +
- Fila 2 (sistema): Captura, Mission Control, Bloquear, Spotlight, Terminal, Mute
- Fila 3 (apps): navegador, buscador, apps de uso diario y un botón de saludo
- **Problema:** al reenviar la URL el Hub no cambiaba.
  **Causa:** la página de la botonera reemplaza a DashCast, así que nadie escucha el nuevo mensaje.
  **Solución:** `cast.js` cierra la sesión anterior antes de abrir una nueva.

## Etapa 6 — Editor (modo personalización)

- `public/editor.html` en `http://localhost:8765/editor`: nombre, emoji, color, acción, grabar atajo,
  probar, reordenar (arrastrar), duplicar, eliminar, añadir y columnas.
- **Seguridad:** el editor solo responde desde la propia Mac (IP local + Host `localhost` + cabecera `X-Nest-Deck`).
  Verificado: desde la IP de red → 403; sin cabecera → 403; Host falso → 403; acciones inválidas → rechazadas.

## Etapa 7 — Actualización en el Hub e íconos

- **Problema:** el editor guardaba, pero el Hub no mostraba los cambios.
  **Solución:** el Hub revisa `/deck` cada 3 s y **recarga la página completa** si cambió;
  el servidor envía `Cache-Control: no-store`; el Hub reporta su estado en Terminal (📟).
- **Problema:** emojis rotos en el Hub (⏯️ ⏮️ ⏭️ 📸 🪟 ⌨️ 🦁 🎙️) porque su fuente de emojis es vieja.
  **Solución:** `emoji2png.swift` dibuja cada emoji con la fuente de Apple; el Hub los recibe como imagen
  (`/emoji?e=…`) y se guardan en `emoji-cache/`.
- ✅ Confirmado con foto: colores actualizados e íconos correctos.

## Etapa 8 — Íconos propios (fase 1)

- En el editor, cada botón tiene **Imagen propia**: "Subir imagen…" o soltar un archivo sobre un botón de la vista previa.
- Formatos: PNG, JPG, SVG, GIF, BMP y WEBP (todo lo que abre el navegador).
- **Recorte 1:1** con zoom (rueda o barra), arrastre, "Ajustar (ver toda)" y "Rellenar cuadro";
  avisa si la imagen mide menos de 144 × 144 px, si no es cuadrada o si es un GIF (se usa el primer cuadro).
- El editor exporta un **PNG de 256 × 256** y lo sube a `/editor/icon`; se guarda en `icons/` con un nombre
  derivado de su contenido. El Hub solo recibe PNG (un SVG con código incrustado queda inofensivo al convertirlo).
- Dos estilos: **Ícono + nombre** o **Imagen completa** (ocupa todo el botón, sin texto, como Stream Deck).
- El servidor rechaza lo que no sea PNG real, subidas sin la cabecera del editor o desde la red, nombres de
  archivo extraños y botones que apunten a imágenes inexistentes.
- Probado: SVG rectangular → recorte → imagen completa en la vista previa y en el Nest Hub.

## Etapa 9 — Key Creator (fase 2)

- En el panel, **🎨 Diseñar ícono…** abre un diseñador dentro del editor, sin cuentas ni servicios externos.
- **Fondo:** color sólido, degradado vertical, horizontal, diagonal o radial, o transparente (color del botón).
- **Ícono:** emoji (con los de Apple), imagen propia (se guarda aparte hasta 512 px, sin recortar) o nada;
  con tamaño y posición vertical.
- **Texto:** hasta 2 líneas, 6 fuentes, tamaño, color, posición (arriba/centro/abajo), negrita y sombra;
  la letra se achica sola si no cabe.
- **Atajos:** Clásico, Ícono grande, Letras (iniciales del nombre) y Degradado.
- Arranca con el color, emoji y nombre del botón.
- Se exporta como PNG con la **forma real del botón en el Hub** (calculada según columnas y filas, p. ej.
  247 × 288 en la cuadrícula de 6 × 3), y se usa como "Imagen completa", así no se corta nada en los bordes.
- Los parámetros quedan en el botón (`design` en `deck.json`) para **reeditar** con "🎨 Editar diseño…";
  el Hub nunca los recibe. Subir una imagen normal o "Quitar" borra el diseño.
- Probado: atajos, diseño con imagen, reabrir con todo conservado, guardado y vista en el Nest Hub
  (confirmado en la pantalla real). Luego se restauró la botonera original.

## Etapa 10 — Varias pantallas

- `deck.json` pasa de una lista de botones a **pantallas** (`pages`): cada una con `id`, `name`, `columns`
  y `buttons`. El formato anterior se convierte solo en la pantalla "Principal"; al guardar desde el editor
  queda en el nuevo.
- Nueva acción **Ir a otra pantalla**: a una pantalla concreta, a la principal, a la siguiente o a la anterior.
  El cambio lo hace el Hub al instante (sin pasar por la Mac) y muestra el nombre de la pantalla un momento.
- El Hub recuerda en qué pantalla estás (`#p=…` en la dirección), así que sigue ahí aunque se recargue por un cambio.
- Toques: `/press/<pantalla>/<botón>`.
- Editor: pestañas de pantallas, **＋ Nueva pantalla** (empieza con un botón "Inicio"), renombrar, mover ← →,
  eliminar (los botones que llevaban a ella pasan a ir a la principal), columnas por pantalla, y soltar un botón
  sobre una pestaña para moverlo a esa pantalla. "Probar" en un botón de pantalla cambia de pestaña en el editor.
- **Problema:** una pantalla con pocos botones los estiraba hasta llenar la altura.
  **Solución:** cada pantalla usa como mínimo las mismas filas que la principal (en el Hub, el editor y el Key Creator).
- El servidor valida destinos existentes, identificadores únicos, máximo 20 pantallas y columnas 1–8.
- Probado: validaciones, crear/renombrar/mover/eliminar en el editor y, en el Nest Hub, ir a una pantalla,
  usar un botón ahí y volver con "Inicio" (confirmado en la pantalla real). Luego se restauró la botonera.

## Etapa 11 — Reapertura automática y arranque con la Mac

- La lógica de Cast pasó a `castlib.js` (consultar el Hub y abrir la botonera); `cast.js` lo usa a mano.
- **Vigilante** en el servidor: cada 20 s pregunta al Hub qué muestra.
  - Botonera → nada. Reposo (reloj o fotos) → la reabre (con 1 minuto de espera entre intentos).
  - Otra app en uso (Spotify, YouTube, llamadas…) → **no la interrumpe**; la reabre cuando el Hub vuelve al reposo.
  - En Terminal registra cada cambio (📺) y cada reapertura (↻).
- `iniciar.sh` ya solo arranca el servidor; el vigilante abre la botonera al empezar.
- Editor: indicador del estado del Hub, interruptor **Reabrir sola** (`autoReopen` en `deck.json`) y botón
  **📺 Abrir en el Hub** para forzarla.
- **Arranque:** `Nest Deck.command` (abre Terminal y ejecuta `iniciar.sh`, así conserva
  los permisos de Terminal) quedó en los **ítems de inicio de sesión** de macOS.
- Probado: cerrar la botonera en el Hub → el vigilante detectó el reposo y la reabrió sola (confirmado en el Hub);
  arranque con `Nest Deck.command` desde la carpeta correcta.
- Sin probar aún: el caso "otra app en uso", y un reinicio real de la Mac.

## Etapa 12 — Más colores y editor de degradados

- **Selector de color propio** (reemplaza el de macOS) en el panel y en el Key Creator: área de tono/brillo,
  barra de tono, código hexadecimal, **cuentagotas** (toma un color de cualquier parte de la pantalla),
  **Recientes** (se guardan en el navegador), **Favoritos** y una **paleta de 96 colores** (16 tonos × 5 luminosidades
  + grises). En total 109 colores a un clic.
- **Editor de degradados**: hasta 5 colores con puntos que se arrastran sobre una barra (clic en la barra agrega uno),
  lineal con ángulo libre (0–360°, con atajos ↑ → ↘ ↓ ↗) o radial, **Invertir**, **Aleatorio** y 12 degradados listos.
- **Degradados en botones normales**: en el panel, "Fondo" puede ser color sólido o degradado (`gradient` en
  `deck.json`); el Hub lo dibuja con CSS. El servidor solo acepta números y colores `#rrggbb`, así nada raro llega al Hub.
- **Key Creator**: usa el mismo editor de degradados; los diseños con el formato anterior (`linear-v/h/d`, `radial`)
  se convierten solos al abrirlos. El diseño se copia completo al abrir, así "Cancelar" no cambia nada.
- Probado: paleta, hexadecimal, recientes, degradados listos en el panel y en el Key Creator, conversión de un diseño
  antiguo y un degradado de 4 colores en el Nest Hub (confirmado en la pantalla real). Luego se restauró la botonera.

## Etapa 13 — Pantalla de bienvenida

- Al abrir la botonera (p. ej. al reiniciar), antes de los botones aparece **"Nest Deck"** durante unos
  2,6 s: degradado radial de gris grafito (#3a3a3c) a negro, letra delgada y espaciada, y una línea fina que se dibuja
  debajo. Se quita sola o al tocarla.
- No aparece cuando el Hub se recarga por un cambio del editor (esas recargas llevan `?r=1`).
- La pantalla de carga de **DashCast** (antes de la bienvenida) no se puede cambiar: es de esa app pública.
- Configuración en `deck.json`: `"welcome": { "enabled": true, "text": "Nest Deck" }`; el servidor la conserva
  al guardar desde el editor y se la envía al Hub. Si la botonera no carga, la bienvenida se quita para dejar ver el aviso.
- Probado en el Nest Hub (confirmado en la pantalla real).

## Etapa 14 — Listo para cualquier Mac (versión pública)

- **Búsqueda automática del Nest Hub** con `dns-sd` (incluido en macOS): con `nestHubIp` vacío, o si el Hub deja de
  responder, el servidor lo busca (como mucho cada 2 minutos) y guarda la IP nueva. Ignora otros dispositivos Cast
  (altavoces, TVs).
- `deck.example.json`: botonera de ejemplo con apps que trae cualquier Mac, degradados y dos pantallas. Si no existe
  `deck.json`, el servidor lo crea a partir del ejemplo.
- `instalar.sh`: comprueba macOS y Node, instala la dependencia, compila los ayudantes, crea la botonera, busca el
  Hub y ofrece arrancar al iniciar sesión. `iniciar.sh` encuentra Node en las rutas habituales (Homebrew, nodejs.org…).
- `compilar.sh` prueba el SDK por defecto y, si el compilador no coincide, los SDK anteriores.
- `Nest Deck.command` dentro del proyecto para arrancar con doble clic.
- README en inglés y español, capturas con una botonera de demo y licencia MIT.

---

## Pendiente / siguientes pasos

- Si la Mac se duerme, la botonera deja de responder hasta que despierte.
- Interfaz en inglés, botones con estado, acciones de OBS / Home Assistant, íconos GIF animados.
