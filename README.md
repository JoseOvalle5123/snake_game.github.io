# Snake Infernal (PWA)

Juego de Snake con skins, tienda de almas, habilidades y peleas de boss. Se puede instalar como app
y funciona sin conexión.

## Controles

| Acción | Teclado | Móvil |
| --- | --- | --- |
| Mover | Flechas o WASD | D-pad en pantalla o deslizar sobre el tablero |
| Habilidad | Espacio | Botón ⚡ (solo durante peleas de boss) |
| Pausa | P | Botón PAUSE (el juego se pausa solo al salir de la pestaña) |
| Silencio | Botón 🔊 | Botón 🔊 |

## Jugabilidad

- Cada 5 puntos subes de nivel y la serpiente se acelera hasta el nivel 7.
- Los niveles múltiplo de 5 traen boss (uno al principio, dos desde el nivel 10).
- Los puntos se convierten en almas al morir; con ellas compras skins con habilidad.
- El récord, las almas y la skin elegida se guardan en el navegador.

## Ejecutar en local

Un service worker necesita servirse por HTTP (no abre con doble clic):

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

## Publicar en GitHub Pages

Sube estos archivos tal cual al repositorio y activa Pages (Settings → Pages). Todas las rutas son
relativas, así que funciona tanto en `usuario.github.io` como en `usuario.github.io/repo/`.

## Al cambiar assets

Los archivos de `icon/` y `sounds/` se sirven desde la caché del service worker. Si reemplazas una imagen
o un sonido **sin cambiar su nombre**, sube el número de `VERSION` en `service-worker.js` para que los
jugadores reciban la versión nueva. Si añades archivos nuevos, agrégalos también a la lista `PRECACHE`.

## Estructura

```
index.html          página y HUD
style.css           estilos
game.js             lógica del juego
service-worker.js   caché offline
manifest.json       datos de instalación
icon/               sprites (WebP) e íconos de la app (PNG 192/512/maskable/180)
sounds/             música y efectos (MP3)
```
