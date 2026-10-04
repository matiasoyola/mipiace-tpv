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

// ── Los puertos, y por qué son configurables ──────────────────────────
//
// agenda-lista · hasta aquí el banco iba clavado a 3001/5173/5174 con
// `reuseExistingServer: true`. Con varios worktrees abiertos eso es una
// trampa: si otra sesión ya tiene su API en :3001, Playwright la REUSA y
// el banco acaba probando el código de otro árbol contra la base de otro
// árbol — y el seed hace TRUNCATE. Pasó: los puertos estaban ocupados por
// `mipiacetpv-catalogo-en-alta`.
//
// Así que el banco puede levantar la suya aparte:
//
//   BANCO_API_PORT=3101 BANCO_ADMIN_PORT=5273 BANCO_TPV_PORT=5274 \
//   DATABASE_URL=postgresql://…/mipiacetpv_agenda_banco_e2e pnpm e2e:agenda
//
// Y con puertos propios NO se reutiliza nada: ver `PUERTOS_PROPIOS`.
const PUERTO_API = process.env.BANCO_API_PORT ?? "3001";
const PUERTO_ADMIN = process.env.BANCO_ADMIN_PORT ?? "5173";
const PUERTO_TPV = process.env.BANCO_TPV_PORT ?? "5174";

export const TPV = process.env.BANCO_TPV_URL ?? `http://localhost:${PUERTO_TPV}`;
export const ADMIN =
  process.env.BANCO_ADMIN_URL ?? `http://localhost:${PUERTO_ADMIN}`;
export const API = process.env.BANCO_API_URL ?? `http://127.0.0.1:${PUERTO_API}`;

/**
 * ¿Ha pedido alguien puertos propios?
 *
 * Si sí, `reuseExistingServer` pasa a `false` en los tres: el banco
 * levanta los suyos y, si el puerto está cogido, se cae con el conflicto
 * en la cara en vez de hablar con un servidor que no es el suyo. Un banco
 * que prueba en silencio el código de otra rama es peor que un banco que
 * no arranca.
 *
 * En los puertos por defecto se sigue reutilizando —es lo cómodo cuando
 * ya tienes tu `pnpm dev` abierto— pero no a ciegas: `seed/comprobar-
 * stack.ts` comprueba antes de empezar que la API que hay al otro lado es
 * la del banco y está mirando SU base.
 */
export const PUERTOS_PROPIOS = Boolean(
  process.env.BANCO_API_PORT ??
    process.env.BANCO_ADMIN_PORT ??
    process.env.BANCO_TPV_PORT ??
    process.env.BANCO_API_URL ??
    process.env.BANCO_ADMIN_URL ??
    process.env.BANCO_TPV_URL,
);

// Lo que necesitan el admin y el TPV para que su proxy `/api` apunte a LA
// API DEL BANCO y no a la de :3001 de otra sesión. Es el otro lado de la
// misma trampa: mover la API sin mover el proxy deja las pantallas
// hablando con la stack equivocada.
const ENV_DE_LAS_PANTALLAS = { MIPIACETPV_API_PROXY: API };

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
  // llegar aquí: el `webServer` de Playwright arranca antes del global
  // setup, y la API no puede arrancar contra una base que no existe.
  //
  // El global setup hace lo otro, que sólo se puede hacer DESPUÉS de que
  // los servidores estén en pie: comprobar a quién se le ha acabado
  // hablando —se haya levantado o reutilizado— y que es la stack del
  // banco.
  globalSetup: "./seed/comprobar-stack.ts",
  webServer: [
    {
      command: "pnpm --filter @mipiacetpv/api dev",
      cwd: "../..",
      url: `${API}/health`,
      reuseExistingServer: !PUERTOS_PROPIOS,
      env: { PORT: PUERTO_API },
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      // `--strictPort`: sin esto Vite se desliza al siguiente puerto libre
      // y el banco se queda esperando en una URL donde no hay nadie.
      command: `pnpm --filter @mipiacetpv/admin dev -- --port ${PUERTO_ADMIN} --strictPort`,
      cwd: "../..",
      url: ADMIN,
      reuseExistingServer: !PUERTOS_PROPIOS,
      env: ENV_DE_LAS_PANTALLAS,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `pnpm --filter @mipiacetpv/tpv-web dev -- --port ${PUERTO_TPV} --strictPort`,
      cwd: "../..",
      url: TPV,
      reuseExistingServer: !PUERTOS_PROPIOS,
      env: ENV_DE_LAS_PANTALLAS,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
