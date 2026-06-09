# Prompt para Claude Code — Bloque A0 (Android · scaffold Capacitor)

Primer bloque de la app Android. Foco único: que `tpv-web` arranque
dentro de una app Android nativa generada con Capacitor, sin tocar la UI
ni el backend. Sin hardware todavía.

Pega esto en una sesión NUEVA de Claude Code.

Requisito previo en el Mac: Android Studio + JDK 17 + Android SDK
Platform 34+ instalados. Si falta algo, dilo en el resumen y para.

---

Hola Code. A0 arranca la app Android de mipiacetpv con Capacitor.
Empaquetamos la PWA `tpv-web` (ya React/Vite/PWA) dentro de un WebView
nativo. **No es un rewrite y no se duplica UI.**

## Contexto — leer antes de tocar nada

- `docs/android/README.md` — decisión de arquitectura, riesgos y reglas
  de trabajo de este subproyecto. **Imprescindible.**
- `docs/android-capacitor-plan.md` — plan y fases.
- `docs/04-stack-y-decisiones.md` §ADR-011 — portabilidad de hardware
  (el núcleo NUNCA depende de Android).
- `apps/tpv-android/` — scaffold ya creado por Cowork: `package.json`,
  `capacitor.config.ts`, `.gitignore`, `tsconfig.json`,
  `src/printer/PrinterTransport.ts`, `README.md`.
- `apps/tpv-web/vite.config.ts` — config PWA (SW, version-check). NO
  romperla.

## Alcance A0

### Frente 1 · Dependencias e init Capacitor
- Instalar las deps de `apps/tpv-android/package.json` vía pnpm en el
  workspace (ya están declaradas; ajustar versiones si Capacitor 6 pide
  otra menor).
- `cap init` ya está cubierto por `capacitor.config.ts` (appId
  `es.mipiace.tpv`, appName `mipiacetpv`, webDir `../tpv-web/dist`).
  Verificar que `cap` lo lee bien desde `apps/tpv-android`.
- `cap add android` → genera el proyecto nativo en
  `apps/tpv-android/android/`. Versionar el fuente Android; los
  artefactos de build ya están en `.gitignore`.

### Frente 2 · Build + sync funcionando
- `pnpm --filter @mipiacetpv/tpv-web build` debe producir `dist/`.
- `pnpm --filter @mipiacetpv/tpv-android sync` debe copiar ese `dist` al
  WebView (`cap sync android`).
- Documentar en `A0-done.md` el comando exacto de arranque.

### Frente 3 · WebView config correcta
- Esquema **https** en el WebView, `allowMixedContent:false`, para que SW
  y permisos se comporten como en producción.
- Orientación **landscape** (terminal de caja) — alinear con el manifest
  PWA que ya pide landscape.
- Modo inmersivo / ocultar barra de navegación si es trivial; si no,
  dejarlo para A3.

### Frente 4 · Adaptador de plataforma en tpv-web
Crear `apps/tpv-web/src/platform/index.ts`:
- `isCapacitor(): boolean` — detecta si corre dentro de la app nativa
  (vía `window.Capacitor?.isNativePlatform?.()` o `@capacitor/core`).
- `getPlatform(): "web" | "android"`.
- Este módulo es el ÚNICO punto donde el TPV pregunta "¿dónde corro?".
  En A1 lo usaremos para elegir transporte de impresión. En A0 solo se
  crea + un test unitario que mockee ambos casos.
- **No cambiar comportamiento de UI todavía.** Solo exponer la API.

## Restricciones
- TypeScript estricto (hereda `tsconfig.base.json`).
- NO tocar la UI de `tpv-web` ni el backend `api`.
- NO romper la PWA web: tras A0, `pnpm dev:tpv` debe seguir funcionando
  igual en navegador.
- NO meter SDKs de fabricante (ADR-011).
- NO commitear el keystore ni `.aab` (ya en `.gitignore`).
- NO commitear con `server.url` activo en `capacitor.config.ts`.

## Tests
- `apps/tpv-web/test/platform.test.ts`: `isCapacitor()` true/false según
  presencia de `window.Capacitor`.

## Entregables
1. PR único con A0.
2. Proyecto `apps/tpv-android/android/` generado y versionado.
3. `apps/tpv-web/src/platform/index.ts` + test.
4. `docs/blocks/A0-done.md`: estructura tras el bloque, comandos de
   arranque (build + sync + open + run en emulador/dispositivo),
   decisiones tomadas sin preguntar (con justificación), dudas, y en qué
   entorno se probó (emulador y/o dispositivo).

## Lo que NO entra en A0
- Impresión / hardware → A1.
- Escáner cámara nativo / permisos → A2.
- Icono, splash, firma, Play Store → A3.

Cuando termines, Matías revisa `A0-done.md` y abrimos A1 (impresión),
que es el bloque con más riesgo.
