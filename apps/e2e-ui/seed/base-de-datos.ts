// De dónde saca el banco la conexión a Postgres.
//
// El banco corre contra la MISMA base que la API local, porque comprueba en
// la BD lo que acaba de hacer por la pantalla: si mirara otra base, no
// probaría nada. Y la API local lee su `DATABASE_URL` de `apps/api/.env`
// (`server.ts` hace `import "dotenv/config"` con el cwd del paquete), así
// que el banco mira ahí en vez de obligar a exportar la variable a mano.
//
// Orden: `DATABASE_URL` del entorno manda (para apuntar a otra base a
// propósito); si no está, `apps/api/.env`. Sin dependencia de dotenv: son
// cuatro líneas y este paquete no entra en producción.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const ENV_DE_LA_API = path.resolve(AQUI, "..", "..", "api", ".env");

function leerDelEnvDeLaApi(): string | null {
  let texto: string;
  try {
    texto = readFileSync(ENV_DE_LA_API, "utf8");
  } catch {
    return null;
  }
  for (const linea of texto.split("\n")) {
    const m = /^\s*DATABASE_URL\s*=\s*(.*)\s*$/.exec(linea);
    if (!m) continue;
    // Quita comillas y comentario de final de línea.
    return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL || leerDelEnvDeLaApi();
  if (!url) {
    throw new Error(
      [
        "No hay DATABASE_URL y no se pudo leer de " + ENV_DE_LA_API + ".",
        "El banco corre contra la misma base que la API local. Ver",
        "apps/e2e-ui/README.md para levantar la stack.",
      ].join("\n"),
    );
  }
  return url;
}
