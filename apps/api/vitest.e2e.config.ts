// v1.13-e2e-ciclo-de-caja · config de la suite e2e. SEPARADA a propósito.
//
// Los archivos se llaman `*.e2e.ts`, no `*.test.ts`: así el `include` por
// defecto de vitest —el que usa `pnpm vitest run` en el portátil de
// cualquiera— NO los recoge ni por accidente. Nadie debe quedarse sin
// poder correr la suite de siempre por culpa de esto.
//
// `fileParallelism: false`: la suite comparte una base de datos y un
// ciclo con estado (turno abierto → ventas → corte → turno nuevo).

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "api-e2e",
    include: ["test-e2e/**/*.e2e.ts"],
    globalSetup: ["test-e2e/global-setup.ts"],
    fileParallelism: false,
    sequence: { concurrent: false },
    // Migrar de cero y generar PDFs contra Postgres real no es instantáneo.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
