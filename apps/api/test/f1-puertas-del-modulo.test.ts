// F1 · las puertas del módulo, contadas por fichero (ADR-018).
//
// Mismo instrumento que H1 usó para sus 92 rutas: un test que LEE el
// código fuente. No prueba comportamiento —eso lo hacen los e2e— sino que
// las puertas siguen puestas y que no se ha colado la que no toca.
//
// Existe por un hallazgo concreto de la tabla de sabotaje del bloque:
// poner `ensureCajaEnabled` en la ruta del EMPLEADO no rompe ningún test
// de comportamiento, porque `caja-gate.ts` resuelve el tenant desde
// `auth`, `cashier` y `device` — y el empleado viaja en `request.employee`,
// que no mira. O sea: sería inerte hoy y una bomba el día que alguien
// añada `employee` a `resolveTenantId` de la caja. Aquí se pone rojo YA.
//
// Sabotajes que este fichero pone en rojo (§3 del done):
//   · poner `ensureCajaEnabled` en cualquier ruta del módulo (nº 10)
//   · olvidar `ensureFichajeEnabled` en una ruta del panel (nº 9)

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/** El fichero SIN comentarios: aquí se mira lo que se ejecuta, no lo que
 *  se explica. Los propios comentarios de estos ficheros nombran
 *  `ensureCajaEnabled` para decir que NO va, y harían fallar el test por
 *  lo que cuentan en vez de por lo que hacen. Mismo criterio que los
 *  bancos de contrato sobre el SQL. */
function leer(rel: string): string {
  const src = readFileSync(new URL(`../src/${rel}`, import.meta.url), "utf8");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n");
}

const EMPLEADO = leer("fichaje/routes.ts");
const PANEL = leer("fichaje/admin-routes.ts");

/** Las declaraciones de ruta de un fichero: `app.get("…"`, `app.post("…"`. */
function rutas(src: string): string[] {
  return [...src.matchAll(/\bapp\.(get|post|patch|put|delete)\(\s*\n?\s*"([^"]+)"/g)].map(
    (m) => `${m[1]!.toUpperCase()} ${m[2]}`,
  );
}

/** El fragmento de código de cada declaración de ruta, hasta el handler.
 *  Basta para ver qué `preHandler` lleva. */
function cabecerasDeRuta(src: string): Array<{ ruta: string; cabecera: string }> {
  const out: Array<{ ruta: string; cabecera: string }> = [];
  const re = /\bapp\.(get|post|patch|put|delete)\(\s*\n?\s*"([^"]+)"([\s\S]{0,700}?)async \(/g;
  for (const m of src.matchAll(re)) {
    out.push({
      ruta: `${m[1]!.toUpperCase()} ${m[2]}`,
      cabecera: m[3]!,
    });
  }
  return out;
}

describe("F1 · ninguna ruta del módulo pasa por la puerta de la CAJA", () => {
  // El cliente 0 es un colegio con `caja_enabled = false`. Ponerle la
  // puerta de la caja al control horario lo deja fuera de lo único que ha
  // comprado — y en el panel lo hace de verdad, con un 403 en cada
  // pantalla (lo comprueba `f4-panel.e2e.ts`).
  it("la API del empleado no la menciona siquiera", () => {
    expect(EMPLEADO).not.toMatch(/ensureCajaEnabled|caja-gate/);
  });

  it("la API del panel, tampoco", () => {
    expect(PANEL).not.toMatch(/ensureCajaEnabled|caja-gate/);
  });
});

describe("F1 · todas las rutas del panel llevan su puerta", () => {
  const cabeceras = cabecerasDeRuta(PANEL);

  it("hay rutas que contar (si esto falla, el regex dejó de encontrarlas)", () => {
    expect(cabeceras.length).toBeGreaterThanOrEqual(10);
    expect(rutas(PANEL)).toEqual(expect.arrayContaining([
      "GET /admin/fichaje/employees",
      "POST /admin/fichaje/employees",
      "GET /admin/fichaje/today",
      "GET /admin/fichaje/entries",
      "POST /admin/fichaje/entries",
      "GET /admin/fichaje/export.csv",
      "GET /admin/fichaje/export.pdf",
    ]));
  });

  // Todas van con `...guard`, que es
  // `[requireOwnerOrManager, ensureFichajeEnabled]`. Una ruta nueva que se
  // lo salte es un agujero silencioso — el mismo que H1 documentó para sus
  // 92.
  for (const { ruta, cabecera } of cabeceras) {
    it(`${ruta} lleva el gate`, () => {
      // `...guard` (con schema), `guard` a secas (sin schema) o el gate
      // nombrado a mano: las tres valen. Lo que no vale es ninguna.
      expect(cabecera).toMatch(/(\.\.\.)?guard\b|ensureFichajeEnabled/);
    });
  }
});

describe("F1 · la API del empleado", () => {
  const cabeceras = cabecerasDeRuta(EMPLEADO);

  it("todas sus rutas van con `requireEmployeeDevice` y el gate…", () => {
    const conAuth = cabeceras.filter((c) =>
      /requireEmployeeDevice/.test(c.cabecera),
    );
    expect(conAuth.length).toBe(cabeceras.length - 1); // todas menos /pair
    for (const c of conAuth) {
      expect(c.cabecera).toMatch(/ensureFichajeEnabled/);
    }
  });

  // …menos `/pair`, que NO puede llevar preHandler porque todavía no hay
  // identidad: el token del enlace ES la credencial y el tenant sale de
  // él. La comprobación del módulo va DENTRO del handler, y eso también
  // hay que fijarlo o nadie se enteraría de que desapareció.
  it("…menos /pair, que comprueba el módulo dentro del handler", () => {
    const pair = cabeceras.find((c) => c.ruta === "POST /fichaje/v1/pair");
    expect(pair).toBeTruthy();
    expect(pair!.cabecera).not.toMatch(/preHandler/);
    const cuerpo = EMPLEADO.slice(EMPLEADO.indexOf("/fichaje/v1/pair"));
    expect(cuerpo).toMatch(/fichajeEnabled !== true/);
    expect(cuerpo).toMatch(/FICHAJE_DISABLED/);
  });

  it("y ninguna es un DELETE: un fichaje no se borra, se corrige", () => {
    expect(rutas(EMPLEADO).filter((r) => r.startsWith("DELETE"))).toEqual([]);
    expect(rutas(PANEL).filter((r) => r.startsWith("DELETE"))).toEqual([]);
  });
});
