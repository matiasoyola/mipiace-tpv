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
    video: MODO_VIDEO
      ? { mode: "on", size: { width: 1920, height: 1200 } }
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
