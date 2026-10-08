// clinica-5 · las dos copias de la lista de tipos, atadas.
//
// `apps/admin` NO depende de ningún paquete del monorepo, y es deliberado:
// la misma razón que `TAX_RATES` y la etiqueta de la exención, duplicadas
// en `CatalogoPage.tsx` porque sacar unos códigos y unos nombres a un
// paquete nuevo pesa más que la duplicación.
//
// Lo que NO se puede es que las dos copias se separen, porque una es lo
// que la dueña ELIGE en el panel y la otra lo que la sesión ABRE: un tipo
// que el panel ofrece y la sesión no conoce es una categoría configurada
// que no hace nada, y un tipo que la sesión tiene y el panel no ofrece es
// una tarjeta a la que no se puede llegar.
//
// Desde el banco del admin no se puede comparar —no ve el paquete—, así
// que se comprueba aquí, leyendo su fuente. Misma mecánica con la que los
// bancos de migración leen el SQL y con la que
// `iva-exento-sanitario.test.ts` ata la etiqueta del chip.

import { readFileSync } from "node:fs";

import {
  NIVELES_DE_QUIROPODIA,
  NOMBRE_DE_NIVEL,
  NOMBRE_DE_TIPO_DE_VISITA,
  TIPOS_DE_VISITA,
} from "@mipiacetpv/clinica-sesion";
import { describe, expect, it } from "vitest";

const fuente = readFileSync(
  new URL("../../admin/src/pages/AgendaCatalogPage.tsx", import.meta.url),
  "utf8",
);

describe("clinica-5 · el panel ofrece los MISMOS cinco tipos que la sesión", () => {
  it("la lista del panel es la del paquete, en el mismo orden", () => {
    const m = /const TIPOS_DE_VISITA: TipoDeVisita\[\] = \[([\s\S]*?)\];/.exec(
      fuente,
    );
    expect(m).not.toBeNull();
    const delPanel = [...m![1]!.matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]);
    expect(delPanel).toEqual([...TIPOS_DE_VISITA]);
  });

  it("y el nombre de cada uno es el mismo", () => {
    for (const t of TIPOS_DE_VISITA) {
      expect(fuente, t).toContain(`${t}: "${NOMBRE_DE_TIPO_DE_VISITA[t]}"`);
    }
  });

  it("el tipo del panel no admite ninguno de más", () => {
    // El `type` del panel es la otra mitad: si alguien añadiera
    // «ORTOPEDIA» a la lista sin añadirlo al paquete, el test de arriba lo
    // caza; si lo añadiera al `type` y no a la lista, este lo caza.
    const m = /type TipoDeVisita =([\s\S]*?);/.exec(fuente);
    expect(m).not.toBeNull();
    const enElTipo = [...m![1]!.matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]);
    expect(enElTipo.sort()).toEqual([...TIPOS_DE_VISITA].sort());
  });
});

describe("clinica-5 · y los MISMOS tres niveles", () => {
  it("los números son 1, 2 y 3", () => {
    const m = /const NIVELES_DE_QUIROPODIA: NivelDeQuiropodia\[\] = \[([^\]]*)\];/.exec(
      fuente,
    );
    expect(m).not.toBeNull();
    const delPanel = m![1]!
      .split(",")
      .map((x) => Number(x.trim()))
      .filter((x) => Number.isFinite(x));
    expect(delPanel).toEqual([...NIVELES_DE_QUIROPODIA]);
  });

  it("y su nombre es el que se cobra", () => {
    // «Quiropodia completa» es lo que la paciente lee en el ticket, así
    // que el panel y la sesión tienen que llamarlo igual.
    for (const n of NIVELES_DE_QUIROPODIA) {
      expect(fuente, String(n)).toContain(`${n}: "${NOMBRE_DE_NIVEL[n]}"`);
    }
  });
});

describe("clinica-5 · el panel manda lo que la ruta espera", () => {
  it("manda `nivelQuiropodia` en el PUT del servicio", () => {
    expect(fuente).toContain("nivelQuiropodia: form.nivelQuiropodia");
  });

  it("y habla con `/admin/tag-visit-types`, no con otra ruta inventada", () => {
    expect(fuente).toContain('"/admin/tag-visit-types"');
    expect(fuente).toContain("`/admin/tag-visit-types/${id}`");
  });

  it("el editor de categorías sólo sale con la historia clínica encendida", () => {
    // Una sección que habla de tipos de visita clínicos en el panel de un
    // bar le cuenta a ese cliente que el sistema guarda datos de salud de
    // otros — la misma razón por la que las rutas clínicas contestan 404
    // y no 403 (clinica-1 §1).
    expect(fuente).toMatch(
      /\{clinicaEnabled && \(\s*<TiposDeVisitaSection/,
    );
  });
});
