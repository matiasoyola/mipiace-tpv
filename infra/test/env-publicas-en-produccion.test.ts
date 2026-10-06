// clinica-2 · toda `PUBLIC_*` del schema llega a producción.
//
// ── De dónde sale este guardián ───────────────────────────────────────
//
// `PUBLIC_TPV_URL` entró en `env.ts` con el bloque de la valoración y NO
// se añadió a `docker-compose.prod.yml`. El compose pasa las variables una
// a una, así que la que no está en esa lista sencillamente no llega al
// contenedor — y como la del schema tiene `.default()`, **el arranque no
// falla**: cae a `http://localhost:5174` y se queda tan tranquilo.
//
// El efecto no se ve en el despliegue, se ve tres días después: el
// paciente recibe el email del test con un enlace que apunta a la máquina
// de nadie, y nadie se entera hasta que llama preguntando por qué no se
// abre. Un fallo silencioso en el camino que le lleva un formulario de
// salud a una persona mayor.
//
// Es el MISMO patrón que `dockerfile-manifiestos.test.ts`: una lista que
// hay que mantener a mano, un olvido que no rompe nada en el acto, y un
// test que lo adelanta a la suite. Aquélla se escribió después de que el
// olvido pasara dos veces (escpos-builder, verifactu); ésta, después de
// que pasara una.
//
// ── Por qué sólo las `PUBLIC_*` ───────────────────────────────────────
//
// Porque son las que tienen `.default()` apuntando a `localhost` y por eso
// fallan en silencio. Un secreto que falta (`JWT_ACCESS_SECRET`) no tiene
// default: el arranque muere con un ZodError en la cara, que es ruidoso y
// se arregla en el acto. Lo que este test vigila es la clase de variable
// que se puede olvidar sin consecuencias visibles.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const ENV_TS = readFileSync(join(RAIZ, "apps/api/src/env.ts"), "utf8");
const COMPOSE = readFileSync(
  join(RAIZ, "infra/docker-compose.prod.yml"),
  "utf8",
);
const EJEMPLO = readFileSync(
  join(RAIZ, "infra/.env.production.example"),
  "utf8",
);

/** Las `PUBLIC_*` declaradas en el schema de env del API. */
function publicasDelSchema(): string[] {
  return [...ENV_TS.matchAll(/^\s+(PUBLIC_[A-Z0-9_]+):/gm)].map((m) => m[1]!);
}

describe("infra · las PUBLIC_* del schema llegan al contenedor", () => {
  it("encuentra variables que comprobar", () => {
    // Si el regex dejara de casar, este test pasaría en verde sin
    // comprobar nada — que es justo el fallo que `clinica-1` describió en
    // su §10b sobre un `toContain` que se sentía como cobertura.
    expect(publicasDelSchema().length).toBeGreaterThanOrEqual(3);
  });

  it.each(publicasDelSchema())(
    "%s la pasan los DOS servicios (api y worker)",
    (nombre) => {
      const linea = `${nombre}: \${${nombre}}`;
      const veces = COMPOSE.split(linea).length - 1;
      expect(
        veces,
        `«${linea}» aparece ${veces} vez/veces en docker-compose.prod.yml; ` +
          "tiene que estar en el bloque `environment` del api Y en el del worker",
      ).toBe(2);
    },
  );

  it.each(publicasDelSchema())(
    "%s está en .env.production.example, con un valor de producción",
    (nombre) => {
      const m = new RegExp(`^${nombre}=(.+)$`, "m").exec(EJEMPLO);
      expect(m, `falta «${nombre}=…» en infra/.env.production.example`).not.toBeNull();
      // Y no apuntando a localhost: el ejemplo es lo que se copia a mano
      // al montar el VPS, así que un localhost ahí se despliega tal cual.
      expect(m![1]).not.toMatch(/localhost|127\.0\.0\.1/);
      expect(m![1]).toMatch(/^https:\/\//);
    },
  );
});
