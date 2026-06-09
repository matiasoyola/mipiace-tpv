# Prompt para Claude Code — Bloque A3 (Android · identidad + publicación)

Último bloque. Foco: identidad visual de la app y build firmado listo
para Play Store en canal interno/cerrado para los pilotos.

Pega esto en una sesión NUEVA de Claude Code, tras A1 y A2 revisados.

Parte de A3 es trámite humano (cuenta Google Play, ficha, revisión) que
Code NO puede hacer. Code prepara los artefactos; Matías ejecuta los
pasos de la consola de Play.

---

Hola Code. A3 deja la app lista para publicar a los pilotos.

## Contexto — leer antes de tocar nada

- `docs/android/README.md` §2.6 (firma y Play Store).
- `apps/tpv-android/capacitor.config.ts` y el proyecto `android/`.
- `apps/tpv-web/vite.config.ts` — manifest PWA (theme/background color,
  TODO de iconos 192/512 maskable).
- `docs/design/` — tokens e identidad visual existente para derivar
  icono/splash coherentes.

## Alcance A3

### Frente 1 · Identidad de app
- Icono de app (adaptive icon Android: foreground + background) y splash
  screen, derivados de la identidad de `docs/design/`.
- Completar el TODO de iconos del manifest PWA (192, 512, maskable) — el
  mismo set sirve para web y para la app.
- `appName` visible, colores de status bar / splash coherentes con
  `theme_color` (#0f172a).

### Frente 2 · Configuración de release
- Orientación landscape forzada y modo inmersivo (si quedó pendiente de
  A0).
- `versionCode`/`versionName` derivados de la versión del proyecto.
- Revisar `AndroidManifest`: solo los permisos realmente usados (cámara,
  BT/USB según A1), nada de más.
- `minSdkVersion` razonable (Android 9 / API 28 salvo que el hardware de
  los pilotos exija otra cosa) y `targetSdkVersion` al nivel que Play
  exija en la fecha de publicación.

### Frente 3 · Build firmado
- Generar la config de firma leyendo el keystore de un
  `keystore.properties` **fuera del repo** (ya en `.gitignore`). NO
  generar ni commitear keystore; documentar para Matías el comando para
  crearlo y guardarlo en 1Password.
- Script para producir el `.aab` firmado.
- Documentar en `A3-done.md` el comando exacto y dónde queda el `.aab`.

### Frente 4 · Checklist de publicación para Matías
- Redactar en `A3-done.md` los pasos humanos: crear cuenta Google Play
  Developer, crear la app, subir el `.aab` a canal **interno/cerrado**,
  ficha mínima (descripción, capturas, política de privacidad), y a qué
  emails invitar (Thalía + pilotos). Code no ejecuta esto.

## Restricciones
- TypeScript estricto donde aplique.
- Keystore y `.aab` NUNCA al repo.
- Iconos coherentes con la identidad existente; no inventar marca nueva.
- Regresión cero en web.

## Entregables
1. PR único con A3 (iconos, splash, config de release, scripts de build).
2. `.aab` firmado generado localmente (no al repo) + instrucciones.
3. `docs/blocks/A3-done.md`: estructura, decisiones, comando de build
   firmado, checklist humano de Play Store, dudas.

## Lo que NO entra en A3
- Publicación a producción abierta (primero canal interno con pilotos).
- Integración de datáfono, mDNS, auto-update OTA → v2.

Con A3 cerrado y el `.aab` en canal interno, los pilotos (Thalía la
primera) instalan la app y empieza la validación en campo.
