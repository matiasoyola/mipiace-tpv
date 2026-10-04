// El banco de la agenda. Se lanza a mano (`pnpm e2e:agenda`), NO en CI.
//
// Un solo worker y sin reintentos, a propósito: los capítulos son los del
// vídeo y el estado se arrastra —el 6 reserva sobre el equipo que dio de alta
// el 3—, así que ni corren en paralelo ni se repite uno a mitad de la cadena.
// Quien quiera correr un capítulo solo: `pnpm e2e:agenda -- specs/06-*`.
//
// Dos modos, el mismo código:
//   · banco  (por defecto) → rápido, sin vídeo, sin pausas.
//   · vídeo  (`BANCO_VIDEO=1`) → graba, va despacio y respeta las pausas
//     entre pasos. Ver `lib/rotulo.ts`.

import { defineConfig } from "@playwright/test";

/** Modo vídeo: graba y va a ritmo humano. */
export const MODO_VIDEO = process.env.BANCO_VIDEO === "1";

export const TPV = process.env.BANCO_TPV_URL ?? "http://localhost:5174";
export const ADMIN = process.env.BANCO_ADMIN_URL ?? "http://localhost:5173";
export const API = process.env.BANCO_API_URL ?? "http://127.0.0.1:3001";

export default defineConfig({
  testDir: "./specs",
  outputDir: "resultados",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Grabando se va despacio a propósito: el tope sube con el modo.
  timeout: MODO_VIDEO ? 300_000 : 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: TPV,
    // El horario del centro son horas de PARED: sin fijar la zona, el banco
    // cambiaría de resultado según el reloj de la máquina.
    timezoneId: "Europe/Madrid",
    locale: "es-ES",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // EL TAMAÑO DEL VÍDEO, que tiene su historia.
    //
    // Playwright sólo escala el vídeo **hacia abajo**: pedirle 1920×1200 para
    // un viewport de 1280×800 no amplía — pinta la página en la esquina de
    // arriba a la izquierda y deja el resto en negro. Salió así una grabación
    // entera.
    //
    // Y el tamaño NO se puede poner por pantalla: `use({ video })` dentro de
    // un `describe` lo rechaza Playwright («forces a new worker»), y los
    // capítulos 1 y 7 usan dos pantallas cada uno.
    //
    // Así que uno global, el del TPV, que son 20 de los 25 trozos: ése sale
    // exacto. El panel (1280×900) y el móvil (390×844) son más grandes o más
    // estrechos y Playwright los escala hacia abajo, que es lo que sí sabe
    // hacer. De ahí a 1080p amplía `video/montar.sh`.
    video: MODO_VIDEO
      ? { mode: "on" as const, size: { width: 1280, height: 800 } }
      : "off",
    launchOptions: { slowMo: MODO_VIDEO ? 220 : 0 },
  },
  // La base, las migraciones y el seed los prepara `seed/stack.ts` ANTES de
  // llegar aquí (el `webServer` de Playwright arranca antes del global setup,
  // y la API no puede arrancar contra una base que no existe).
  webServer: [
    {
      command: "pnpm --filter @mipiacetpv/api dev",
      cwd: "../..",
      url: `${API}/health`,
      reuseExistingServer: true,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: "pnpm --filter @mipiacetpv/admin dev",
      cwd: "../..",
      url: ADMIN,
      reuseExistingServer: true,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: "pnpm --filter @mipiacetpv/tpv-web dev",
      cwd: "../..",
      url: TPV,
      reuseExistingServer: true,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
