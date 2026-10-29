// cogecop-1 · la tabla «sabotaje → test rojo» de la importación, contra
// Postgres de verdad.
//
// Por qué tiene que ser e2e: lo que se prueba aquí no es que el
// importador se porte bien, es que **correrlo dos veces no duplica**, que
// **lo que escribe no se puede editar** aunque alguien entre por SQL, y
// que **la historia lo enseña**. Las tres necesitan el motor: la
// idempotencia pasa por un `external_id` único de verdad, la
// inmutabilidad por el trigger de clinica-1 y la historia por una
// consulta con su `ORDER BY`.
//
// Las garantías, una por bloque:
//
//   1. **EL SECO NO ESCRIBE.** Ni una ficha, ni una entrada.
//   2. **CORRER DOS VECES NO DUPLICA.** Ni pacientes ni visitas, y la
//      segunda pasada los cuenta como «ya estaban».
//   3. **LO IMPORTADO ES HISTORIA, NO SESIÓN.** No se edita (el trigger
//      lo rechaza), no cuenta como `TREATMENT_SESSION` y por eso no entra
//      en ningún cobro pendiente.
//   4. **LA TRADUCCIÓN LLEGA ENTERA AL CUERPO CIFRADO**: la marca del
//      centro de un grupo cae en su dedo, y la patología sin traducir
//      guarda su nombre de COGECOP.
//   5. **LA HISTORIA VIVA PARTE DE LA ÚLTIMA IMPORTADA**, y lo dice.
//   6. **SE NIEGA** con una cuenta que no es clínica, sin clave, con una
//      autora que no es de la cuenta — y, por línea de órdenes, sin
//      `--lateralidad`.
//
// NI UN DATO REAL: todo sale del generador de `src/cogecop/generador.ts`.

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { E2E_DATABASE_URL, e2eEnabled, SKIP_MESSAGE } from "./e2e-env.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  E2E_DATABASE_URL || "postgresql://e2e:e2e@127.0.0.1:5432/e2e";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
process.env.JWT_ACCESS_SECRET = "e".repeat(40);
process.env.JWT_REFRESH_SECRET = "f".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = "0".repeat(43) + "=";

const { getPrisma, shutdown } = await import("../src/context.js");
const { esCuerpoImportado, ETIQUETA_DE_IMPORTADA } = await import(
  "@mipiacetpv/clinica-sesion"
);
const { cuerpoDeEntrada } = await import("../src/clinica/cripto-campos.js");
const { dekDe, olvidarClaves, asegurarDek } = await import(
  "../src/clinica/claves.js"
);
const { olvidarSiEsClinico } = await import("../src/clinica/notas.js");
const { importarCogecop, idExternoDePaciente } = await import(
  "../src/cogecop/importar.js"
);
const { generarExport } = await import("../src/cogecop/generador.js");
const { vistaDeLaHistoria } = await import("../src/clinica/historia.js");
const { FICHEROS_DEL_EXPORT } = await import(
  "../src/cogecop/export-esquema.js"
);

const ejecutar = promisify(execFile);
const AQUI = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(AQUI, "..", "src", "scripts", "importar-cogecop.ts");

const HOY = new Date(Date.UTC(2026, 9, 29));

describe.skipIf(!e2eEnabled)("e2e · la historia de COGECOP entra entera", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let tenantId = randomUUID();
  let noClinico = randomUUID();
  let autora1 = randomUUID();
  let autora2 = randomUUID();
  let deOtraCuenta = randomUUID();

  const falso = generarExport({ pacientes: 8, semilla: 11 });

  const opciones = () => ({
    tenantId,
    lateralidad: "izquierdo-a-la-izquierda" as const,
    autora1,
    autora2,
    ejecutar: true,
    hoy: HOY,
  });

  beforeAll(async () => {
    tenantId = randomUUID();
    noClinico = randomUUID();
    autora1 = randomUUID();
    autora2 = randomUUID();
    deOtraCuenta = randomUUID();
    olvidarClaves();
    olvidarSiEsClinico();

    for (const [id, clinica] of [
      [tenantId, true],
      [noClinico, false],
    ] as const) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO tenants (id, name, clinical_records_enabled, crm_enabled, agenda_enabled, updated_at)
         VALUES ('${id}', 'Clínica ${id.slice(0, 8)}', ${clinica}, true, true, now())`,
      );
    }
    for (const [id, alias, tid] of [
      [autora1, "Rosario", tenantId],
      [autora2, "Marta", tenantId],
      [deOtraCuenta, "Ajena", noClinico],
    ] as const) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO users (id, tenant_id, email, alias, role, is_clinician, clinician_license, clinical_scope)
         VALUES ('${id}', '${tid}', '${alias.toLowerCase()}-${id.slice(0, 8)}@c.es',
                 '${alias}', 'CLINICIAN', true, '45/${id.slice(0, 4)}', 'ALL')`,
      );
    }
    // La clínica necesita su DEK antes de que se le escriba nada cifrado.
    await asegurarDek(tenantId, prisma);
  });

  afterAll(async () => {
    const triggers: Array<[string, string]> = [
      ["clinical_entries", "clinical_entries_inmutable"],
      ["clinical_addenda", "clinical_addenda_inmutable"],
      ["clinical_access_log", "clinical_access_log_append_only"],
      ["clinical_access", "clinical_access_guard"],
      // La clave de una clínica tampoco se borra con un DELETE
      // (clinica-7). Aquí hay que quitarla igual: si se queda, el
      // `DELETE FROM tenants` choca con su FK en RESTRICT y el fichero
      // deja basura en la base de la siguiente pasada.
      ["clinical_tenant_keys", "clinical_tenant_keys_guard"],
    ];
    for (const [tabla, trg] of triggers) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE ${tabla} DISABLE TRIGGER ${trg}`,
      );
    }
    for (const t of [
      "clinical_addenda",
      "clinical_entries",
      "clinical_access_log",
      "clinical_access",
      "clinical_tenant_keys",
    ]) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM ${t} WHERE tenant_id IN ('${tenantId}', '${noClinico}')`,
      );
    }
    for (const [tabla, trg] of triggers) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE ${tabla} ENABLE TRIGGER ${trg}`,
      );
    }
    for (const t of ["clients", "users"]) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM ${t} WHERE tenant_id IN ('${tenantId}', '${noClinico}')`,
      );
    }
    await prisma.$executeRawUnsafe(
      `DELETE FROM tenants WHERE id IN ('${tenantId}', '${noClinico}')`,
    );
    await shutdown();
  });

  const cuantasFichas = () =>
    prisma.client.count({ where: { tenantId } });
  const cuantasImportadas = () =>
    prisma.clinicalEntry.count({ where: { tenantId, kind: "IMPORTED_VISIT" } });

  // ── 1 · EL SECO NO ESCRIBE ────────────────────────────────────────

  it("el --dry-run no escribe NI UNA fila, y cuenta igual", async () => {
    const antesFichas = await cuantasFichas();
    const antesEntradas = await cuantasImportadas();

    const r = await importarCogecop(prisma, falso.export, {
      ...opciones(),
      ejecutar: false,
    });

    expect(await cuantasFichas()).toBe(antesFichas);
    expect(await cuantasImportadas()).toBe(antesEntradas);
    // Y aun así ha contado TODO: lo que hace útil el seco es que traduce
    // de verdad y después tira lo traducido.
    expect(r.pacientes.nuevos).toBe(falso.export.pacientes.length);
    expect(r.visitas.nuevas).toBe(falso.export.visitas.length);
    expect(r.marcas.total).toBe(falso.export.marcas_pie.length);
    expect(r.marcas.sinZona).toBeGreaterThan(0);
    expect(Object.keys(r.sinTraducir).length).toBeGreaterThan(0);
    expect(r.difuntos).toBe(1);
  });

  // ── 2 · CORRER DOS VECES NO DUPLICA ───────────────────────────────

  it("la primera pasada escribe la clínica entera", async () => {
    const r = await importarCogecop(prisma, falso.export, opciones());
    expect(r.pacientes.nuevos).toBe(falso.export.pacientes.length);
    expect(r.visitas.nuevas).toBe(falso.export.visitas.length);
    expect(await cuantasFichas()).toBe(falso.export.pacientes.length);
    expect(await cuantasImportadas()).toBe(falso.export.visitas.length);
  });

  it("CORRERLO OTRA VEZ no duplica nada y lo dice", async () => {
    const fichasAntes = await cuantasFichas();
    const entradasAntes = await cuantasImportadas();

    const r = await importarCogecop(prisma, falso.export, opciones());

    expect(r.pacientes.nuevos).toBe(0);
    expect(r.pacientes.yaEstaban).toBe(falso.export.pacientes.length);
    expect(r.visitas.nuevas).toBe(0);
    expect(r.visitas.yaEstaban).toBe(falso.export.visitas.length);
    expect(await cuantasFichas()).toBe(fichasAntes);
    expect(await cuantasImportadas()).toBe(entradasAntes);
  });

  it("el `external_id` es el determinista, y el teléfono está en E.164", async () => {
    const p = falso.export.pacientes[0]!;
    const ficha = await prisma.client.findFirstOrThrow({
      where: { tenantId, externalId: idExternoDePaciente(tenantId, p.id) },
      select: {
        id: true,
        phone: true,
        notes: true,
        notesCifradas: true,
        marketingOptIn: true,
        birthdate: true,
      },
    });
    expect(ficha.phone).toMatch(/^\+34\d{9}$/);
    expect(ficha.marketingOptIn).toBe(false);
    // La nota va CIFRADA y el claro vacío: es un tenant clínico.
    expect(ficha.notes).toBeNull();
    expect(ficha.notesCifradas).toMatch(/^c\d+:/);
  });

  it("la fecha de nacimiento imposible deja `birthdate` vacío", async () => {
    const p2 = falso.export.pacientes[1]!;
    const ficha = await prisma.client.findFirstOrThrow({
      where: { tenantId, externalId: idExternoDePaciente(tenantId, p2.id) },
      select: { birthdate: true },
    });
    expect(ficha.birthdate).toBeNull();
  });

  // ── 3 · HISTORIA, NO SESIÓN ───────────────────────────────────────

  it("no hay NI UNA `TREATMENT_SESSION`: lo importado no es una sesión", async () => {
    const sesiones = await prisma.clinicalEntry.count({
      where: { tenantId, kind: "TREATMENT_SESSION" },
    });
    expect(sesiones).toBe(0);
  });

  it("UNA ENTRADA IMPORTADA NO SE EDITA, ni por SQL directo", async () => {
    const fila = await prisma.clinicalEntry.findFirstOrThrow({
      where: { tenantId, kind: "IMPORTED_VISIT" },
      select: { id: true },
    });
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE clinical_entries SET body = '{"x":1}' WHERE id = '${fila.id}'`,
      ),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRawUnsafe(
        `DELETE FROM clinical_entries WHERE id = '${fila.id}'`,
      ),
    ).rejects.toThrow();
  });

  it("entra con la FECHA DE LA VISITA, no con la de hoy", async () => {
    const fechas = await prisma.clinicalEntry.findMany({
      where: { tenantId, kind: "IMPORTED_VISIT" },
      select: { createdAt: true },
      orderBy: { createdAt: "asc" },
      take: 1,
    });
    expect(fechas[0]!.createdAt.getUTCFullYear()).toBe(2025);
  });

  it("la firma la autora que le toca por su especialista", async () => {
    const autores = await prisma.clinicalEntry.groupBy({
      by: ["authorUserId"],
      where: { tenantId, kind: "IMPORTED_VISIT" },
      _count: true,
    });
    const ids = autores.map((a) => a.authorUserId).sort();
    expect(ids).toEqual([autora1, autora2].sort());
  });

  // ── 4 · LA TRADUCCIÓN, DENTRO DEL CUERPO CIFRADO ──────────────────

  it("el cuerpo se descifra y trae la traducción entera", async () => {
    const dek = await dekDe(tenantId, prisma);
    const filas = await prisma.clinicalEntry.findMany({
      where: { tenantId, kind: "IMPORTED_VISIT" },
      select: { id: true, tenantId: true, body: true, bodyCifrado: true },
    });
    const cuerpos = filas
      .map((f) => cuerpoDeEntrada(f, dek))
      .filter((c): c is ReturnType<typeof JSON.parse> => esCuerpoImportado(c));
    expect(cuerpos).toHaveLength(filas.length);

    const marcas = cuerpos.flatMap((c) => c.marcas as Array<Record<string, unknown>>);

    // Una marca puesta en el CENTRO de un grupo del dibujo 0 cae en su
    // dedo. El generador pone varias ahí a propósito.
    expect(
      marcas.some(
        (m) => m.dibujo === 0 && m.zona === "h" && m.pie === "L",
      ),
    ).toBe(true);

    // Una patología SIN traducir guarda su nombre de COGECOP.
    const sinTraducir = marcas.filter((m) => m.lesion === null);
    expect(sinTraducir.length).toBeGreaterThan(0);
    expect(sinTraducir.map((m) => m.lesionOriginal)).toContain(
      "Carcinoma basocelular",
    );

    // Y una marca lejos de todo centro entra con su lesión y sin sitio.
    expect(marcas.some((m) => m.zona === null && m.lesion != null)).toBe(true);
  });

  it("el claro se queda en el centinela: el cuerpo NO está en claro", async () => {
    const fila = await prisma.clinicalEntry.findFirstOrThrow({
      where: { tenantId, kind: "IMPORTED_VISIT" },
      select: { body: true, bodyCifrado: true },
    });
    expect(fila.body).toEqual({ cifrado: true });
    expect(fila.bodyCifrado).toMatch(/^c\d+:/);
  });

  // ── 5 · LA HISTORIA VIVA ──────────────────────────────────────────

  it("la historia enseña las visitas importadas y el pie parte de ahí", async () => {
    const p = falso.export.pacientes[0]!;
    const ficha = await prisma.client.findFirstOrThrow({
      where: { tenantId, externalId: idExternoDePaciente(tenantId, p.id) },
      select: { id: true },
    });
    const vista = await vistaDeLaHistoria(prisma, {
      tenantId,
      clientId: ficha.id,
      ahora: HOY,
    });

    expect(vista.visitas.length).toBeGreaterThan(0);
    expect(vista.visitas.every((v) => v.importada)).toBe(true);
    expect(vista.totalDeVisitas).toBe(vista.visitas.length);

    // El pie vivo sale de lo importado, y cada zona lo dice.
    expect(vista.zonas.length).toBeGreaterThan(0);
    expect(vista.zonas.every((z) => z.importada)).toBe(true);

    // Y la ficha enseña lo que traía, sin validar.
    expect(vista.cabecera.cogecop).not.toBeNull();
    expect(vista.cabecera.cogecop!.enfermedades).toBe(p.enfermedades);
    expect(vista.cabecera.cogecop!.alergias).toBe(p.alergias);

    // Las listas que viajan son las de HOY: la V2 de lesiones.
    expect(vista.listas.lesiones.version).toBe(2);
    expect(ETIQUETA_DE_IMPORTADA).toBe("Importada de COGECOP");
  });

  it("un paciente sin nada que escribir NO lleva nota de COGECOP", async () => {
    const p5 = falso.export.pacientes[4]!;
    const ficha = await prisma.client.findFirstOrThrow({
      where: { tenantId, externalId: idExternoDePaciente(tenantId, p5.id) },
      select: { id: true, notesCifradas: true },
    });
    const vista = await vistaDeLaHistoria(prisma, {
      tenantId,
      clientId: ficha.id,
      ahora: HOY,
    });
    expect(vista.cabecera.cogecop).toBeNull();
  });

  // ── 6 · SE NIEGA ──────────────────────────────────────────────────

  it("se niega con una cuenta que no es de vertical clínica", async () => {
    await expect(
      importarCogecop(prisma, falso.export, {
        ...opciones(),
        tenantId: noClinico,
      }),
    ).rejects.toThrow(/historia clínica encendida/);
  });

  it("se niega si una autora no es de la cuenta, ANTES de escribir nada", async () => {
    const antes = await cuantasFichas();
    await expect(
      importarCogecop(prisma, falso.export, {
        ...opciones(),
        autora2: deOtraCuenta,
      }),
    ).rejects.toThrow(/--autora-2/);
    expect(await cuantasFichas()).toBe(antes);
  });

  it("SIN --lateralidad, el script NO CORRE", async () => {
    const r = await correrScript([
      `--tenant=${tenantId}`,
      "--dir=/no/importa",
      `--autora-1=${autora1}`,
      `--autora-2=${autora2}`,
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("--lateralidad");
    // Y el mensaje DICE qué hay que mirar: un «falta un parámetro» a
    // secas haría que alguien eligiera uno a ojo.
    expect(r.stderr).toContain("pantalla de quiropodia");
    expect(r.stderr).toContain("izquierdo-a-la-izquierda");
  });

  it("y con una lateralidad inventada tampoco", async () => {
    const r = await correrScript([
      `--tenant=${tenantId}`,
      "--dir=/no/importa",
      `--autora-1=${autora1}`,
      `--autora-2=${autora2}`,
      "--lateralidad=la-de-siempre",
    ]);
    expect(r.code).toBe(2);
  });

  it("por línea de órdenes el seco imprime recuentos y NI UN dato", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cogecop-e2e-"));
    try {
      for (const f of FICHEROS_DEL_EXPORT) {
        const filas = (falso.export as unknown as Record<string, unknown[]>)[
          f.nombre
        ];
        await writeFile(join(dir, `${f.nombre}.json`), JSON.stringify(filas));
      }
      const r = await correrScript([
        `--tenant=${tenantId}`,
        `--dir=${dir}`,
        `--autora-1=${autora1}`,
        `--autora-2=${autora2}`,
        "--lateralidad=izquierdo-a-la-izquierda",
      ]);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain("EN SECO");
      const todo = `${r.stdout}\n${r.stderr}`;
      for (const centinela of falso.centinelas) {
        expect(todo, `la salida lleva «${centinela}»`).not.toContain(centinela);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

/** Corre el script EN OTRO PROCESO, que es como se corre de verdad. */
async function correrScript(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await ejecutar(
      join(AQUI, "..", "node_modules", ".bin", "tsx"),
      [SCRIPT, ...args],
      {
        env: {
          ...process.env,
          DATABASE_URL: process.env.DATABASE_URL,
        },
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof e.code === "number" ? e.code : 1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
    };
  }
}
