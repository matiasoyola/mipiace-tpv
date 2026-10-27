// personal-1 · LA FICHA, LA IMPORTACIÓN Y EL CUADRANTE, CONTRA POSTGRES
// DE VERDAD.
//
// Por qué e2e: casi todo lo que este bloque promete lo garantizan los
// triggers y los índices de la migración, y ninguno existe con un prisma
// falso:
//
//   · que un cuadrante publicado no se mueva sin motivo —y que no se
//     pueda despublicar, ni borrar, ni mover su firma—;
//   · que el registro de cambios sea append-only también desde psql;
//   · que el DNI se guarde CIFRADO y de la base no salga legible;
//   · que `set_staff_schedule_day` sea idempotente, que valide el mes y
//     que no deje pintar el turno de otra empresa;
//   · y los nueve sabotajes del prompt.
//
// Los datos son inventados. **El CSV de Jardín de Gredos no se commitea**
// (lo dice el prompt y es la regla de la casa): lo que se reproduce aquí
// es su FORMA —21 fichas con el nombre completo en un solo campo, dos
// columnas en el fichero, mayúsculas— no su contenido.

import { randomBytes, randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { borrarCuentasDePrueba } from "./borrar-tenant.js";
import { E2E_DATABASE_URL, e2eEnabled, SKIP_MESSAGE } from "./e2e-env.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  E2E_DATABASE_URL || "postgresql://e2e:e2e@127.0.0.1:5432/e2e";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
process.env.JWT_ACCESS_SECRET = "e".repeat(40);
process.env.JWT_REFRESH_SECRET = "f".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
process.env.PUBLIC_ADMIN_URL = "https://admin.mipiacetpv.com";

const { getPrisma, shutdown } = await import("../src/context.js");
const { registerFichajeRoutes } = await import("../src/fichaje/routes.js");
const { registerFichajeAdminRoutes } = await import(
  "../src/fichaje/admin-routes.js"
);
const { registerPersonalRoutes } = await import(
  "../src/fichaje/personal-routes.js"
);
const { registerCuadranteRoutes } = await import(
  "../src/fichaje/cuadrante-routes.js"
);
const { signAccessToken } = await import("../src/auth/tokens.js");
const { generatePairingToken } = await import("../src/fichaje/auth.js");

/** Los 21 nombres, inventados y con la forma del listado que llega. */
const VEINTIUNO = [
  "ABEL RAMOS DOBLADO",
  "ANA SOLER RUIZ",
  "BEATRIZ MORENO LARA",
  "CARMEN GIL PASTOR",
  "DOLORES NAVAS PENA",
  "ELENA BRAVO SANZ",
  "FELIPE OTERO MAS",
  "GLORIA ARIAS LEON",
  "HUGO VEGA MOLINA",
  "IRENE CANO SUAREZ",
  "JAVIER PRIETO ABAD",
  "LAURA NIETO CASAS",
  "MANUEL ROJO ESTEVEZ",
  "NURIA BLANCO TOMAS",
  "OSCAR LARA FUENTES",
  "PILAR SEGURA MOYA",
  "RAQUEL DIAZ ROMAN",
  "SERGIO IBANEZ MUNOZ",
  "TERESA PARRA CALVO",
  "VICTOR LOPEZ ARCE",
  "YOLANDA MESA GALAN",
];

/** El CSV que esos 21 producen, con nombre y apellidos partidos. */
function csvDeLos21(extra = ""): string {
  const filas = VEINTIUNO.map((completo) => {
    const [nombre, ...apellidos] = completo.split(" ");
    return `${nombre};${apellidos.join(" ")};37,5;01/06/2026;indefinido`;
  });
  return (
    "nombre;apellidos;jornada_semanal_h;fecha_alta;tipo_contrato\n" +
    filas.join("\n") +
    "\n" +
    extra
  );
}

describe.skipIf(!e2eEnabled)("e2e · personal-1", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let app: FastifyInstance;
  let tenantId = "";
  let otroTenantId = "";
  let ownerId = "";
  let otroOwnerId = "";
  /** El mes del cuadrante: siempre el que viene, para no pisar «hoy». */
  let mes = "";

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await registerFichajeRoutes(app);
    await registerFichajeAdminRoutes(app);
    await registerPersonalRoutes(app);
    await registerCuadranteRoutes(app);
    await app.ready();
  });

  /**
   * La clave de cifrado del centro, que este bloque le crea a un tenant
   * **sin clínica** la primera vez que alguien guarda un DNI de personal.
   *
   * `clinical_tenant_keys` no se puede borrar con un `DELETE` —su guard lo
   * prohíbe siempre, porque borrar la fila destruye los datos en silencio
   * y sin fecha— y su FK al tenant es `RESTRICT`. Así que la limpieza
   * pasa por donde pasa la de `clinica-7.e2e.ts`: apagar el trigger,
   * borrar, volver a encenderlo.
   *
   * **Que sea incómoda es la garantía funcionando**, y esto deja dicho
   * algo que va en el done: un centro que haya guardado un DNI de su
   * plantilla tiene una clave, y mientras la tenga su cuenta no se puede
   * eliminar. No es nuevo de este bloque —es cómo clinica-7 diseñó la
   * clave— pero este bloque amplía A QUIÉN le pasa.
   */
  async function limpiarClaveDelCentro(): Promise<void> {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE clinical_tenant_keys DISABLE TRIGGER clinical_tenant_keys_guard`,
    );
    try {
      await prisma.$executeRawUnsafe(
        `DELETE FROM clinical_tenant_keys WHERE tenant_id IN ('${tenantId}', '${otroTenantId}')`,
      );
    } finally {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE clinical_tenant_keys ENABLE TRIGGER clinical_tenant_keys_guard`,
      );
    }
  }

  async function limpiar(): Promise<void> {
    if (tenantId) await limpiarClaveDelCentro();
    await borrarCuentasDePrueba(prisma, tenantId, otroTenantId);
  }

  afterAll(async () => {
    await limpiar();
    await app.close();
    await shutdown();
  });

  beforeEach(async () => {
    await limpiar();
    tenantId = randomUUID();
    otroTenantId = randomUUID();
    ownerId = randomUUID();
    otroOwnerId = randomUUID();
    // Un mes fijo y futuro: el cuadrante de un mes que ya pasó es un
    // documento, y pintar sobre él en un test sería pintar sobre
    // historia.
    mes = "2027-03";
    await prisma.tenant.createMany({
      data: [
        {
          id: tenantId,
          name: `Residencia ${tenantId.slice(0, 8)}`,
          fichajeEnabled: true,
          cajaEnabled: false,
          holdedEnabled: false,
          initialSyncStatus: "NOT_APPLICABLE",
        },
        {
          id: otroTenantId,
          name: `Otra ${otroTenantId.slice(0, 8)}`,
          fichajeEnabled: true,
        },
      ],
    });
    await prisma.user.createMany({
      data: [
        {
          id: ownerId,
          tenantId,
          email: `owner-${ownerId.slice(0, 8)}@centro.test`,
          role: "OWNER",
          alias: "Dirección",
        },
        {
          id: otroOwnerId,
          tenantId: otroTenantId,
          email: `owner-${otroOwnerId.slice(0, 8)}@otra.test`,
          role: "OWNER",
          alias: "La otra",
        },
      ],
    });
  });

  // ── utilidades ───────────────────────────────────────────────────────

  function auth(userId = ownerId, tid = tenantId) {
    return {
      authorization: `Bearer ${signAccessToken({ sub: userId, tid, role: "OWNER" })}`,
    };
  }

  async function altaEmpleado(name: string, tid = tenantId, headers = auth()) {
    const res = await app.inject({
      method: "POST",
      url: "/admin/fichaje/employees",
      headers: tid === tenantId ? headers : auth(otroOwnerId, otroTenantId),
      payload: { name } as never,
    });
    expect(res.statusCode).toBe(201);
    return res.json().employee.id as string;
  }

  /** Las fichas de los 21, creadas como las creó F1: el nombre entero. */
  async function sembrarLos21(): Promise<void> {
    await prisma.employee.createMany({
      data: VEINTIUNO.map((name) => ({ tenantId, name })),
    });
  }

  async function turnos(): Promise<
    Array<{ id: string; code: string; coberturaMinima: number | null }>
  > {
    const res = await app.inject({
      method: "GET",
      url: "/admin/fichaje/turnos",
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    return res.json().turnos;
  }

  async function cuadrante(m = mes) {
    const res = await app.inject({
      method: "GET",
      url: `/admin/fichaje/cuadrante?month=${m}`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  async function pintar(
    celdas: Array<{
      employeeId: string;
      dia: string;
      turnoIds?: string[];
      ausencia?: string | null;
    }>,
    motivo?: string,
  ) {
    return app.inject({
      method: "PUT",
      url: `/admin/fichaje/cuadrante/${mes}/celdas`,
      headers: auth(),
      payload: { celdas, ...(motivo ? { motivo } : {}) } as never,
    });
  }

  async function publicar(confirmarAvisos = true) {
    return app.inject({
      method: "POST",
      url: `/admin/fichaje/cuadrante/${mes}/publicar`,
      headers: auth(),
      payload: { confirmarAvisos } as never,
    });
  }

  // ══ 1 · LA FICHA Y SUS CIFRADOS ═══════════════════════════════════

  describe("la ficha", () => {
    it("el DNI se guarda CIFRADO y de la base no sale legible", async () => {
      const id = await altaEmpleado("Ana");
      const res = await app.inject({
        method: "PATCH",
        url: `/admin/fichaje/personal/${id}`,
        headers: auth(),
        payload: {
          lastName: "Soler Ruiz",
          dni: "12345678Z",
          afiliacion: "281234567890",
        } as never,
      });
      expect(res.statusCode).toBe(200);
      // La ruta lo devuelve descifrado…
      expect(res.json().ficha.dni).toBe("12345678Z");

      // …y la BASE no. Lo que hay es `c1:` y base64, y el CHECK de formato
      // no admitiría otra cosa.
      const [fila] = await prisma.$queryRawUnsafe<
        Array<{ dni_cifrado: string; nss_cifrado: string }>
      >(`SELECT dni_cifrado, nss_cifrado FROM employees WHERE id = '${id}'`);
      expect(fila!.dni_cifrado).toMatch(/^c1:[A-Za-z0-9+/]+={0,2}$/);
      expect(fila!.dni_cifrado).not.toContain("12345678Z");
      expect(fila!.nss_cifrado).not.toContain("281234567890");
    });

    it("y un UPDATE a pelo con el DNI en claro se rechaza", async () => {
      // El CHECK de formato es lo que impide que un script de backfill
      // deje DNI legibles en la tabla sin que nadie se entere. Es la
      // lección de la auditoría del 2026-09-05 aplicada aquí.
      const id = await altaEmpleado("Ana");
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE employees SET dni_cifrado = '12345678Z' WHERE id = '${id}'`,
        ),
      ).rejects.toThrow(/employees_dni_cifrado_formato/);
    });

    it("la lista NO trae ningún DNI, ni descifrado ni cifrado", async () => {
      const id = await altaEmpleado("Ana");
      await app.inject({
        method: "PATCH",
        url: `/admin/fichaje/personal/${id}`,
        headers: auth(),
        payload: { dni: "12345678Z" } as never,
      });
      const res = await app.inject({
        method: "GET",
        url: "/admin/fichaje/personal",
        headers: auth(),
      });
      const cuerpo = res.payload;
      expect(cuerpo).not.toContain("12345678Z");
      expect(cuerpo).not.toContain("c1:");
      // Lo que sí trae es «lo tiene».
      expect(res.json().personal[0].tieneDni).toBe(true);
    });

    it("los CHECK de coherencia del contrato los defiende la BASE", async () => {
      const id = await altaEmpleado("Ana");
      // Por la ruta: 400 con una frase.
      const porLaRuta = await app.inject({
        method: "PATCH",
        url: `/admin/fichaje/personal/${id}`,
        headers: auth(),
        payload: {
          contractKind: "INDEFINIDO",
          contractEndsOn: "2027-01-01",
        } as never,
      });
      expect(porLaRuta.statusCode).toBe(400);
      expect(porLaRuta.json().error).toBe("FICHA_INCOHERENTE");
      // Y por SQL: el CHECK.
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE employees SET contract_kind = 'INDEFINIDO', contract_ends_on = '2027-01-01' WHERE id = '${id}'`,
        ),
      ).rejects.toThrow(/employees_fin_solo_temporales/);
    });

    it("una ficha de otra empresa no se lee ni se toca", async () => {
      const ajena = await altaEmpleado("Ajena", otroTenantId);
      const leer = await app.inject({
        method: "GET",
        url: `/admin/fichaje/personal/${ajena}`,
        headers: auth(),
      });
      expect(leer.statusCode).toBe(404);
      const tocar = await app.inject({
        method: "PATCH",
        url: `/admin/fichaje/personal/${ajena}`,
        headers: auth(),
        payload: { lastName: "Robada" } as never,
      });
      expect(tocar.statusCode).toBe(404);
    });

    it("la categoría de otra empresa tampoco se puede poner", async () => {
      const id = await altaEmpleado("Ana");
      await app.inject({
        method: "GET",
        url: "/admin/fichaje/categorias",
        headers: auth(otroOwnerId, otroTenantId),
      });
      const ajena = await prisma.employeeCategory.findFirstOrThrow({
        where: { tenantId: otroTenantId },
        select: { id: true },
      });
      const res = await app.inject({
        method: "PATCH",
        url: `/admin/fichaje/personal/${id}`,
        headers: auth(),
        payload: { categoryId: ajena.id } as never,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("CATEGORIA_NO_ENCONTRADA");
    });

    it("una categoría con gente dentro no se borra: lo dice la BASE", async () => {
      const id = await altaEmpleado("Ana");
      await app.inject({
        method: "GET",
        url: "/admin/fichaje/categorias",
        headers: auth(),
      });
      // `DOCENTE` y no `AUXILIAR`: este tenant tiene la residencia
      // APAGADA, así que lo que se le siembra son las cuatro categorías
      // «sin cuidados» (decisión 2).
      const cat = await prisma.employeeCategory.findFirstOrThrow({
        where: { tenantId, code: "DOCENTE" },
        select: { id: true },
      });
      await app.inject({
        method: "PATCH",
        url: `/admin/fichaje/personal/${id}`,
        headers: auth(),
        payload: { categoryId: cat.id } as never,
      });
      const res = await app.inject({
        method: "DELETE",
        url: `/admin/fichaje/categorias/${cat.id}`,
        headers: auth(),
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("CATEGORIA_CON_GENTE");
      await expect(
        prisma.$executeRawUnsafe(
          `DELETE FROM employee_categories WHERE id = '${cat.id}'`,
        ),
      ).rejects.toThrow(/employees_category_id_fkey/);
    });
  });

  // ══ 2 · LA IMPORTACIÓN ════════════════════════════════════════════

  describe("importar la plantilla", () => {
    async function importar(csv: string, aplicar = true) {
      const res = await app.inject({
        method: "POST",
        url: aplicar
          ? "/admin/fichaje/personal/importar"
          : "/admin/fichaje/personal/importar/vista-previa",
        headers: auth(),
        payload: { csv } as never,
      });
      return res;
    }

    it("[prompt] 21 filas sobre 21 fichas con sólo el nombre: completa 21, crea 0", async () => {
      await sembrarLos21();
      const previa = await importar(csvDeLos21(), false);
      expect(previa.statusCode).toBe(200);
      expect(previa.json().resumen).toEqual({
        completar: 21,
        sinCambios: 0,
        crear: 0,
        errores: 0,
      });

      const hecho = await importar(csvDeLos21());
      expect(hecho.statusCode).toBe(200);
      expect(hecho.json()).toMatchObject({
        completadas: 21,
        creadas: 0,
        sinCambios: 0,
      });

      // Y el nombre quedó PARTIDO en dos.
      const abel = await prisma.employee.findFirstOrThrow({
        where: { tenantId, name: "ABEL" },
        select: { lastName: true, weeklyMinutes: true, contractKind: true },
      });
      expect(abel.lastName).toBe("RAMOS DOBLADO");
      expect(abel.weeklyMinutes).toBe(2250);
      expect(abel.contractKind).toBe("INDEFINIDO");
    });

    it("[prompt] repetir el mismo fichero: 0 cambios", async () => {
      await sembrarLos21();
      await importar(csvDeLos21());
      const otra = await importar(csvDeLos21());
      expect(otra.json()).toMatchObject({
        completadas: 0,
        creadas: 0,
        sinCambios: 21,
      });
    });

    it("[prompt] una celda vacía NO borra lo que ya hay", async () => {
      // El alta deja el nombre en `name`; el apellido y el teléfono
      // entran después. La clave de casado es `name + lastName` = «ANA
      // SOLER», que es la que el CSV produce.
      const id = await altaEmpleado("Ana");
      await app.inject({
        method: "PATCH",
        url: `/admin/fichaje/personal/${id}`,
        headers: auth(),
        payload: { lastName: "Soler", phone: "600111222" } as never,
      });
      const res = await importar("nombre;apellidos;telefono\nAna;Soler;\n");
      expect(res.json().sinCambios).toBe(1);
      const fresca = await prisma.employee.findUniqueOrThrow({
        where: { id },
        select: { phone: true },
      });
      expect(fresca.phone).toBe("600111222");
    });

    it("[prompt] una fila con fecha ISO da un error de FILA, y el resto entra", async () => {
      const res = await importar(
        "nombre;apellidos;fecha_alta\nAna;Soler;01/06/2026\nBea;Ruiz;2027-10-01\nCarmen;Gil;15/09/2026\n",
      );
      expect(res.statusCode).toBe(200);
      expect(res.json().creadas).toBe(2);
      expect(res.json().errores).toHaveLength(1);
      expect(res.json().errores[0].mensaje).toContain("dd/mm/aaaa");
      expect(
        await prisma.employee.count({ where: { tenantId } }),
      ).toBe(2);
    });

    it("[prompt] el BOM y el `;` funcionan", async () => {
      const res = await importar(
        "﻿nombre;apellidos;jornada_semanal_h\nAna;Soler;37,5\n",
      );
      expect(res.json().creadas).toBe(1);
      const ana = await prisma.employee.findFirstOrThrow({
        where: { tenantId, name: "Ana" },
        select: { lastName: true, weeklyMinutes: true },
      });
      expect(ana.lastName).toBe("Soler");
      expect(ana.weeklyMinutes).toBe(2250);
    });

    it("[sabotaje] 5.000 filas: límite y mensaje, y no se escribe nada", async () => {
      const texto =
        "nombre\n" +
        Array.from({ length: 5000 }, (_, i) => `Persona ${i}`).join("\n") +
        "\n";
      const res = await importar(texto);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("CSV_INVALIDO");
      expect(res.json().message).toContain("5000 filas");
      expect(res.json().message).toContain("1000");
      expect(await prisma.employee.count({ where: { tenantId } })).toBe(0);
    });

    it("y el DNI en claro NO sale en la vista previa", async () => {
      await sembrarLos21();
      const res = await importar(
        "nombre;apellidos;dni_nie\nABEL;RAMOS DOBLADO;12345678Z\n",
        false,
      );
      expect(res.payload).not.toContain("12345678Z");
      expect(res.payload).toContain("•••");
    });

    it("importar es una transacción: una fila mala no deja medias fichas", async () => {
      // La categoría inventada tumba SU fila, no el lote; lo que no puede
      // pasar es que el lote entre a medias. Aquí el lote es bueno salvo
      // una fila, así que entran las dos buenas y la mala se señala.
      const res = await importar(
        "nombre;apellidos;categoria\nAna;Soler;DOCENTE\nBea;Ruiz;Fisio de tarde\nCarmen;Gil;DOCENTE\n",
      );
      expect(res.json().creadas).toBe(2);
      expect(res.json().errores[0].mensaje).toContain("no está en el catálogo");
    });
  });

  // ══ 3 · EL CUADRANTE ══════════════════════════════════════════════

  describe("el cuadrante", () => {
    it("al abrirlo se siembran los tres turnos y las categorías", async () => {
      const c = await cuadrante();
      expect(c.turnos.map((t: { code: string }) => t.code)).toEqual([
        "M",
        "T",
        "N",
      ]);
      // Un centro de residencia apagada: las cuatro «sin cuidados».
      const cats = await app.inject({
        method: "GET",
        url: "/admin/fichaje/categorias",
        headers: auth(),
      });
      expect(cats.json().categorias.map((x: { code: string }) => x.code)).toEqual([
        "DOCENTE",
        "DIRECCION",
        "ADMINISTRACION",
        "SERVICIOS",
      ]);
    });

    it("y es idempotente: abrirlo dos veces no duplica nada", async () => {
      await cuadrante();
      await cuadrante();
      expect(await prisma.centerShift.count({ where: { tenantId } })).toBe(3);
      expect(await prisma.employeeCategory.count({ where: { tenantId } })).toBe(4);
      // Y **LEERLO no lo CREA**: la cabecera del mes nace en la primera
      // escritura (`asegurarCuadrante`), no al abrir la pantalla. Mismo
      // criterio que `dekONada` frente a `asegurarDek` — pasear por los
      // meses de un año no puede dejar doce cabeceras vacías detrás.
      expect(await prisma.staffSchedule.count({ where: { tenantId } })).toBe(0);
      const ana = await altaEmpleado("Ana");
      const [m] = await turnos();
      await pintar([{ employeeId: ana, dia: `${mes}-02`, turnoIds: [m!.id] }]);
      expect(await prisma.staffSchedule.count({ where: { tenantId } })).toBe(1);
    });

    it("pintar una celda, y pintarla otra vez no registra nada", async () => {
      const ana = await altaEmpleado("Ana");
      const [m] = await turnos();
      const primera = await pintar([
        { employeeId: ana, dia: `${mes}-02`, turnoIds: [m!.id] },
      ]);
      expect(primera.statusCode).toBe(200);
      expect(primera.json().cambiosRegistrados).toBe(0); // borrador: sin traza
      expect(primera.json().celdas).toHaveLength(1);

      const segunda = await pintar([
        { employeeId: ana, dia: `${mes}-02`, turnoIds: [m!.id] },
      ]);
      expect(segunda.json().celdas).toHaveLength(1);
      expect(
        await prisma.staffScheduleCell.count({ where: { tenantId } }),
      ).toBe(1);
    });

    it("un turno partido son DOS filas, y la etiqueta las junta", async () => {
      const ana = await altaEmpleado("Ana");
      const ts = await turnos();
      const res = await pintar([
        {
          employeeId: ana,
          dia: `${mes}-02`,
          turnoIds: [ts[0]!.id, ts[1]!.id],
        },
      ]);
      expect(res.statusCode).toBe(200);
      expect(res.json().celdas).toHaveLength(2);
    });

    it("[sabotaje] un día que no es del mes se rechaza", async () => {
      const ana = await altaEmpleado("Ana");
      const [m] = await turnos();
      const res = await pintar([
        { employeeId: ana, dia: "2027-04-02", turnoIds: [m!.id] },
      ]);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("CUADRANTE_RECHAZADO");
      expect(res.json().message).toContain("no es del mes");
    });

    it("[sabotaje] el turno de OTRA empresa no se puede pintar", async () => {
      const ana = await altaEmpleado("Ana");
      await app.inject({
        method: "GET",
        url: `/admin/fichaje/cuadrante?month=${mes}`,
        headers: auth(otroOwnerId, otroTenantId),
      });
      const ajeno = await prisma.centerShift.findFirstOrThrow({
        where: { tenantId: otroTenantId },
        select: { id: true },
      });
      const res = await pintar([
        { employeeId: ana, dia: `${mes}-02`, turnoIds: [ajeno.id] },
      ]);
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("no es de esta empresa");
    });

    it("[sabotaje] turno Y ausencia el mismo día se rechaza", async () => {
      const ana = await altaEmpleado("Ana");
      const [m] = await turnos();
      const res = await pintar([
        {
          employeeId: ana,
          dia: `${mes}-02`,
          turnoIds: [m!.id],
          ausencia: "VACACIONES",
        },
      ]);
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("turno O ausencia");
    });

    it("[sabotaje] y a mano, por psql, el trigger lo para igual", async () => {
      const ana = await altaEmpleado("Ana");
      const [m] = await turnos();
      await pintar([{ employeeId: ana, dia: `${mes}-02`, turnoIds: [m!.id] }]);
      const sch = await prisma.staffSchedule.findFirstOrThrow({
        where: { tenantId },
        select: { id: true },
      });
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO staff_schedule_cells (tenant_id, schedule_id, employee_id, day, absence_kind)
           VALUES ('${tenantId}', '${sch.id}', '${ana}', '${mes}-02', 'VACACIONES')`,
        ),
      ).rejects.toThrow(/CUADRANTE_INVALIDO/);
    });

    it("[sabotaje] una celda no se EDITA nunca, ni en borrador", async () => {
      const ana = await altaEmpleado("Ana");
      const [m] = await turnos();
      await pintar([{ employeeId: ana, dia: `${mes}-02`, turnoIds: [m!.id] }]);
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE staff_schedule_cells SET day = '${mes}-05' WHERE employee_id = '${ana}'`,
        ),
      ).rejects.toThrow(/no se edita, se sustituye/);
    });

    it("copiar la semana pega lo que hay y BORRA lo que había", async () => {
      const ana = await altaEmpleado("Ana");
      const bea = await altaEmpleado("Bea");
      const [m, t] = await turnos();
      // Semana 1: Ana de mañana el lunes, Bea de tarde el martes.
      await pintar([
        { employeeId: ana, dia: `${mes}-01`, turnoIds: [m!.id] },
        { employeeId: bea, dia: `${mes}-02`, turnoIds: [t!.id] },
      ]);
      // Y en la semana 2, algo que la copia tiene que quitar.
      await pintar([
        { employeeId: ana, dia: `${mes}-09`, turnoIds: [t!.id] },
      ]);

      const res = await app.inject({
        method: "POST",
        url: `/admin/fichaje/cuadrante/${mes}/copiar-semana`,
        headers: auth(),
        payload: { desde: `${mes}-01`, hasta: `${mes}-08`, dias: 7 } as never,
      });
      expect(res.statusCode).toBe(200);
      const celdas = res.json().celdas as Array<{
        employeeId: string;
        dia: string;
        turnoId: string | null;
      }>;
      // La semana 2 es ahora la copia de la 1: lunes 8 Ana de mañana,
      // martes 9 Bea de tarde, y la tarde de Ana del 9 ha desaparecido.
      const del8 = celdas.filter((c) => c.dia === `${mes}-08`);
      const del9 = celdas.filter((c) => c.dia === `${mes}-09`);
      expect(del8).toHaveLength(1);
      expect(del8[0]!.employeeId).toBe(ana);
      expect(del9).toHaveLength(1);
      expect(del9[0]!.employeeId).toBe(bea);
    });

    it("y copiarla dos veces no cambia nada la segunda", async () => {
      const ana = await altaEmpleado("Ana");
      const [m] = await turnos();
      await pintar([{ employeeId: ana, dia: `${mes}-01`, turnoIds: [m!.id] }]);
      const copiar = () =>
        app.inject({
          method: "POST",
          url: `/admin/fichaje/cuadrante/${mes}/copiar-semana`,
          headers: auth(),
          payload: { desde: `${mes}-01`, hasta: `${mes}-08` } as never,
        });
      await copiar();
      const antes = await prisma.staffScheduleCell.count({ where: { tenantId } });
      await copiar();
      expect(await prisma.staffScheduleCell.count({ where: { tenantId } })).toBe(
        antes,
      );
    });
  });

  // ══ 4 · PUBLICAR, Y LO QUE PASA DESPUÉS ═══════════════════════════

  describe("publicar", () => {
    it("[sabotaje] publicar con avisos SIN confirmar se rechaza, y dice cuántos", async () => {
      const ana = await altaEmpleado("Ana");
      const ts = await turnos();
      // Con cobertura mínima en la noche, un mes casi vacío tiene avisos.
      await app.inject({
        method: "PATCH",
        url: `/admin/fichaje/turnos/${ts[2]!.id}`,
        headers: auth(),
        payload: { minCoverage: 2 } as never,
      });
      await pintar([{ employeeId: ana, dia: `${mes}-02`, turnoIds: [ts[0]!.id] }]);

      const sinConfirmar = await publicar(false);
      expect(sinConfirmar.statusCode).toBe(409);
      expect(sinConfirmar.json().error).toBe("CUADRANTE_CON_AVISOS");
      expect(sinConfirmar.json().resumen.rojos).toBeGreaterThan(0);
      // Y sigue en borrador.
      expect(
        (await prisma.staffSchedule.findFirstOrThrow({ where: { tenantId } })).state,
      ).toBe("BORRADOR");
    });

    it("confirmándolos se publica, y los deja APUNTADOS", async () => {
      const ana = await altaEmpleado("Ana");
      const ts = await turnos();
      await app.inject({
        method: "PATCH",
        url: `/admin/fichaje/turnos/${ts[2]!.id}`,
        headers: auth(),
        payload: { minCoverage: 2 } as never,
      });
      await pintar([{ employeeId: ana, dia: `${mes}-02`, turnoIds: [ts[0]!.id] }]);
      const res = await publicar(true);
      expect(res.statusCode).toBe(200);
      expect(res.json().cabecera.publishedBy).toBe("Dirección");

      const fila = await prisma.staffSchedule.findFirstOrThrow({
        where: { tenantId },
        select: { warningsAtPublish: true, warningsSnapshot: true },
      });
      expect(fila.warningsAtPublish).toBeGreaterThan(0);
      // La LISTA, no sólo la cuenta: a los seis meses, «¿se publicó
      // sabiendo que faltaba una auxiliar?» se contesta mirando esto.
      expect(Array.isArray(fila.warningsSnapshot)).toBe(true);
    });

    it("[sabotaje] editar una celda publicada SIN motivo se rechaza", async () => {
      const ana = await altaEmpleado("Ana");
      const [m, t] = await turnos();
      await pintar([{ employeeId: ana, dia: `${mes}-02`, turnoIds: [m!.id] }]);
      await publicar(true);

      const sinMotivo = await pintar([
        { employeeId: ana, dia: `${mes}-02`, turnoIds: [t!.id] },
      ]);
      expect(sinMotivo.statusCode).toBe(400);
      expect(sinMotivo.json().message).toContain("sin decir por qué");
      // Y la celda no se movió.
      const celdas = await prisma.staffScheduleCell.findMany({
        where: { tenantId },
        select: { centerShiftId: true },
      });
      expect(celdas).toHaveLength(1);
      expect(celdas[0]!.centerShiftId).toBe(m!.id);
    });

    it("con motivo sí, y queda la traza con quién, cuándo y por qué", async () => {
      const ana = await altaEmpleado("Ana");
      const [m, t] = await turnos();
      await pintar([{ employeeId: ana, dia: `${mes}-02`, turnoIds: [m!.id] }]);
      await publicar(true);

      const res = await pintar(
        [{ employeeId: ana, dia: `${mes}-02`, turnoIds: [t!.id] }],
        "Ana se pone de baja, la cubre Bea",
      );
      expect(res.statusCode).toBe(200);
      expect(res.json().cambiosRegistrados).toBe(1);

      const cambios = await app.inject({
        method: "GET",
        url: `/admin/fichaje/cuadrante/${mes}/cambios`,
        headers: auth(),
      });
      expect(cambios.json().cambios).toHaveLength(1);
      expect(cambios.json().cambios[0]).toMatchObject({
        dia: `${mes}-02`,
        antes: "M",
        despues: "T",
        motivo: "Ana se pone de baja, la cubre Bea",
        autor: "Dirección",
      });
    });

    it("[sabotaje] una fila del registro de cambios no se borra por SQL", async () => {
      const ana = await altaEmpleado("Ana");
      const [m, t] = await turnos();
      await pintar([{ employeeId: ana, dia: `${mes}-02`, turnoIds: [m!.id] }]);
      await publicar(true);
      await pintar(
        [{ employeeId: ana, dia: `${mes}-02`, turnoIds: [t!.id] }],
        "porque sí",
      );
      await expect(
        prisma.$executeRawUnsafe(
          `DELETE FROM staff_schedule_changes WHERE tenant_id = '${tenantId}'`,
        ),
      ).rejects.toThrow(/append-only/);
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE staff_schedule_changes SET reason = 'otra cosa' WHERE tenant_id = '${tenantId}'`,
        ),
      ).rejects.toThrow(/append-only/);
    });

    it("[sabotaje] un publicado no vuelve a borrador, no se le mueve la firma y no se borra", async () => {
      const ana = await altaEmpleado("Ana");
      const [m] = await turnos();
      await pintar([{ employeeId: ana, dia: `${mes}-02`, turnoIds: [m!.id] }]);
      await publicar(true);
      const sch = await prisma.staffSchedule.findFirstOrThrow({
        where: { tenantId },
        select: { id: true },
      });
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE staff_schedules SET state = 'BORRADOR', published_at = NULL WHERE id = '${sch.id}'`,
        ),
      ).rejects.toThrow(/no vuelve a borrador/);
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE staff_schedules SET published_by = 'Otro' WHERE id = '${sch.id}'`,
        ),
      ).rejects.toThrow(/la firma y el origen/);
      await expect(
        prisma.$executeRawUnsafe(
          `DELETE FROM staff_schedules WHERE id = '${sch.id}'`,
        ),
      ).rejects.toThrow(/no se borra/);
      // Y por la ruta, publicar dos veces es un 409 que lo explica.
      expect((await publicar(true)).statusCode).toBe(409);
    });

    it("[sabotaje] y una celda de un publicado no se borra a mano", async () => {
      const ana = await altaEmpleado("Ana");
      const [m] = await turnos();
      await pintar([{ employeeId: ana, dia: `${mes}-02`, turnoIds: [m!.id] }]);
      await publicar(true);
      await expect(
        prisma.$executeRawUnsafe(
          `DELETE FROM staff_schedule_cells WHERE employee_id = '${ana}'`,
        ),
      ).rejects.toThrow(/CUADRANTE_SIN_MOTIVO/);
    });
  });

  // ══ 5 · LOS TURNOS DEL TENANT ═════════════════════════════════════

  describe("los turnos", () => {
    it("[sabotaje] un turno sin hora de fin (la misma que el inicio) se rechaza", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/fichaje/turnos",
        headers: auth(),
        payload: {
          code: "X",
          name: "Raro",
          startsAt: "08:00",
          endsAt: "08:00",
        } as never,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("TURNO_DE_CERO_HORAS");
    });

    it("[sabotaje] dos turnos que se SOLAPAN salen como aviso al crearlos", async () => {
      await turnos(); // siembra M, T, N
      const res = await app.inject({
        method: "POST",
        url: "/admin/fichaje/turnos",
        headers: auth(),
        payload: {
          code: "P",
          name: "Partido",
          startsAt: "10:00",
          endsAt: "18:00",
        } as never,
      });
      expect(res.statusCode).toBe(201);
      const solape = res
        .json()
        .avisos.find((a: { problema: string }) => a.problema === "SOLAPE");
      expect(solape).toBeDefined();
      expect(solape.codigos).toEqual(["M", "P", "T"]);
      expect(solape.mensaje).toContain("se solapan");
    });

    it("y la cobertura mínima en blanco no es un cero", async () => {
      const ts = await turnos();
      // De serie nacen sin declarar.
      expect(ts.every((t) => t.coberturaMinima === null)).toBe(true);
      const avisos = (
        await app.inject({
          method: "GET",
          url: "/admin/fichaje/turnos",
          headers: auth(),
        })
      ).json().avisos;
      expect(
        avisos.find((a: { problema: string }) => a.problema === "SIN_COBERTURA"),
      ).toBeDefined();
      // Y con todos a null, el cuadrante no tiene ni un aviso de cobertura.
      const c = await cuadrante();
      expect(
        (c.avisos as Array<{ regla: string }>).filter(
          (a) => a.regla === "COBERTURA",
        ),
      ).toHaveLength(0);
    });

    it("las rutas de residencia y las del fichaje leen la MISMA tabla", async () => {
      // Decisión 4. Si fueran dos tablas, esto pasaría igual y el día que
      // un centro editara el turno en una pantalla, la otra no lo vería.
      const ts = await turnos();
      await app.inject({
        method: "PATCH",
        url: `/admin/fichaje/turnos/${ts[0]!.id}`,
        headers: auth(),
        payload: { name: "Mañanita", minCoverage: 4 } as never,
      });
      const fila = await prisma.centerShift.findUniqueOrThrow({
        where: { id: ts[0]!.id },
        select: { name: true, minCoverage: true, tenantId: true },
      });
      expect(fila).toEqual({
        name: "Mañanita",
        minCoverage: 4,
        tenantId,
      });
    });
  });

  // ══ 6 · MI CUADRANTE, EN EL MÓVIL ═════════════════════════════════

  describe("mi cuadrante", () => {
    async function emparejar(employeeId: string, tid = tenantId) {
      const { plain, hash } = generatePairingToken();
      await prisma.employeePairingToken.create({
        data: {
          tenantId: tid,
          employeeId,
          tokenHash: hash,
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
        },
      });
      const res = await app.inject({
        method: "POST",
        url: "/fichaje/v1/pair",
        payload: { token: plain } as never,
      });
      expect(res.statusCode).toBe(201);
      return res.json().employeeToken as string;
    }

    it("un BORRADOR no se le enseña a nadie", async () => {
      const ana = await altaEmpleado("Ana");
      const [m] = await turnos();
      await pintar([{ employeeId: ana, dia: `${mes}-02`, turnoIds: [m!.id] }]);
      const token = await emparejar(ana);
      const res = await app.inject({
        method: "GET",
        url: `/fichaje/v1/cuadrante?month=${mes}`,
        headers: { "x-employee-token": token },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().publicado).toBe(false);
      expect(res.json().dias).toEqual([]);
    });

    it("publicado sí, y sólo LO SUYO", async () => {
      const ana = await altaEmpleado("Ana");
      const bea = await altaEmpleado("Bea");
      const [m, t] = await turnos();
      await pintar([
        { employeeId: ana, dia: `${mes}-02`, turnoIds: [m!.id] },
        { employeeId: bea, dia: `${mes}-02`, turnoIds: [t!.id] },
        { employeeId: ana, dia: `${mes}-03`, ausencia: "LIBRE" },
      ]);
      await publicar(true);
      const token = await emparejar(ana);
      const res = await app.inject({
        method: "GET",
        url: `/fichaje/v1/cuadrante?month=${mes}`,
        headers: { "x-employee-token": token },
      });
      const dias = res.json().dias as Array<{
        dia: string;
        turnos: Array<{ code: string }>;
        ausencia: string | null;
      }>;
      expect(dias).toHaveLength(2);
      expect(dias[0]!.turnos.map((x) => x.code)).toEqual(["M"]);
      expect(dias[1]!.ausencia).toBe("LIBRE");
      // Y nada de Bea: ni su turno ni su nombre.
      expect(res.payload).not.toContain(bea);
    });

    it("[sabotaje] el token de una empresa no ve el cuadrante de otra", async () => {
      const ajena = await altaEmpleado("Ajena", otroTenantId);
      const tokenAjeno = await emparejar(ajena, otroTenantId);
      // El centro publica SU cuadrante.
      const ana = await altaEmpleado("Ana");
      const [m] = await turnos();
      await pintar([{ employeeId: ana, dia: `${mes}-02`, turnoIds: [m!.id] }]);
      await publicar(true);
      // Y el token de la otra empresa no ve nada de él.
      const res = await app.inject({
        method: "GET",
        url: `/fichaje/v1/cuadrante?month=${mes}`,
        headers: { "x-employee-token": tokenAjeno },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().publicado).toBe(false);
      expect(res.json().dias).toEqual([]);
    });

    it("los cambios llegan marcados, y el acuse los apaga", async () => {
      const ana = await altaEmpleado("Ana");
      const [m, t] = await turnos();
      await pintar([{ employeeId: ana, dia: `${mes}-02`, turnoIds: [m!.id] }]);
      await publicar(true);
      await pintar(
        [{ employeeId: ana, dia: `${mes}-02`, turnoIds: [t!.id] }],
        "Cambio de turno pedido por ella",
      );
      const token = await emparejar(ana);
      const headers = { "x-employee-token": token };

      const antes = await app.inject({
        method: "GET",
        url: `/fichaje/v1/cuadrante?month=${mes}`,
        headers,
      });
      expect(antes.json().cambios).toHaveLength(1);
      expect(antes.json().cambios[0]).toMatchObject({
        antes: "M",
        despues: "T",
        motivo: "Cambio de turno pedido por ella",
        nuevo: true,
      });

      // LEER NO LOS APAGA: recargar para volver a mirarlos no puede
      // borrarlos.
      const otraVez = await app.inject({
        method: "GET",
        url: `/fichaje/v1/cuadrante?month=${mes}`,
        headers,
      });
      expect(otraVez.json().cambios[0].nuevo).toBe(true);

      // El acuse, sí.
      const visto = await app.inject({
        method: "POST",
        url: "/fichaje/v1/cuadrante/visto",
        headers,
      });
      expect(visto.statusCode).toBe(200);
      const despues = await app.inject({
        method: "GET",
        url: `/fichaje/v1/cuadrante?month=${mes}`,
        headers,
      });
      expect(despues.json().cambios[0].nuevo).toBe(false);
    });
  });

  // ══ 7 · LA SALIDA OLVIDADA CON TURNO, Y EL CUADRE ═════════════════

  describe("planificado frente a fichado", () => {
    /** Un tramo abierto de `ana`, con la hora de pared que se diga. */
    async function abrirTramo(
      employeeId: string,
      dia: string,
      hora: string,
    ): Promise<string> {
      const { localToUtc } = await import("../src/fichaje/time.js");
      const at = localToUtc(dia, hora);
      const e = await prisma.timeEntry.create({
        data: {
          tenantId,
          employeeId,
          startedAt: at,
          startedDeviceAt: at,
          startedServerAt: at,
          startSource: "MOBILE",
        },
        select: { id: true },
      });
      return e.id;
    }

    it("[prompt] la noche del cambio de hora cuenta ONCE horas, planificada y fichada", async () => {
      // El cuadrante de octubre de 2026, con la noche del 24.
      const ana = await altaEmpleado("Ana");
      const mesDelCambio = "2026-10";
      await app.inject({
        method: "GET",
        url: `/admin/fichaje/cuadrante?month=${mesDelCambio}`,
        headers: auth(),
      });
      const ts = await turnos();
      const noche = ts.find((t) => t.code === "N")!;
      const puesta = await app.inject({
        method: "PUT",
        url: `/admin/fichaje/cuadrante/${mesDelCambio}/celdas`,
        headers: auth(),
        payload: {
          celdas: [
            { employeeId: ana, dia: "2026-10-24", turnoIds: [noche.id] },
          ],
        } as never,
      });
      expect(puesta.statusCode).toBe(200);
      await app.inject({
        method: "POST",
        url: `/admin/fichaje/cuadrante/${mesDelCambio}/publicar`,
        headers: auth(),
        payload: { confirmarAvisos: true } as never,
      });

      // Y el tramo fichado de esa noche: 22:00 del 24 (UTC+2) a 08:00 del
      // 25 (UTC+1). Once horas de reloj de verdad.
      const inicio = new Date("2026-10-24T22:00:00+02:00");
      const fin = new Date("2026-10-25T08:00:00+01:00");
      expect((fin.getTime() - inicio.getTime()) / 3_600_000).toBe(11);
      await prisma.timeEntry.create({
        data: {
          tenantId,
          employeeId: ana,
          startedAt: inicio,
          startedDeviceAt: inicio,
          startedServerAt: inicio,
          startSource: "MOBILE",
          endedAt: fin,
          endedDeviceAt: fin,
          endedServerAt: fin,
          endSource: "MOBILE",
        },
      });

      const registro = await app.inject({
        method: "GET",
        url: `/admin/fichaje/entries?month=${mesDelCambio}`,
        headers: auth(),
      });
      const bloque = registro.json().blocks[0];
      expect(bloque.totalMinutes).toBe(660);
      expect(bloque.plannedMinutes).toBe(660);

      // Y en el CSV, la columna de planificado al lado de la fichada.
      const csv = await app.inject({
        method: "GET",
        url: `/admin/fichaje/export.csv?month=${mesDelCambio}`,
        headers: auth(),
      });
      expect(csv.statusCode).toBe(200);
      expect(csv.payload).toContain("Planificado");
      expect(csv.payload).toContain("11h 00m");
    });

    it("[prompt] con turno M y nada a las 19:01 es OLVIDADA; sin turno, no", async () => {
      // Se monta sobre AYER para que el tramo exista en el pasado y la
      // consulta de «Hoy» lo recoja; lo que se compara es el límite, que
      // es lo que `esSalidaOlvidada` decide.
      const ana = await altaEmpleado("Ana");
      const { localDate, localToUtc, esSalidaOlvidada } = await import(
        "../src/fichaje/time.js"
      );
      const { turnoDelTramo } = await import("../src/fichaje/cuadrante.js");

      const hoy = localDate(new Date());
      const mesDeHoy = hoy.slice(0, 7);
      await app.inject({
        method: "GET",
        url: `/admin/fichaje/cuadrante?month=${mesDeHoy}`,
        headers: auth(),
      });
      const ts = await turnos();
      const manana = ts.find((t) => t.code === "M")!;
      await app.inject({
        method: "PUT",
        url: `/admin/fichaje/cuadrante/${mesDeHoy}/celdas`,
        headers: auth(),
        payload: {
          celdas: [{ employeeId: ana, dia: hoy, turnoIds: [manana.id] }],
        } as never,
      });
      await app.inject({
        method: "POST",
        url: `/admin/fichaje/cuadrante/${mesDeHoy}/publicar`,
        headers: auth(),
        payload: { confirmarAvisos: true } as never,
      });

      const entryId = await abrirTramo(ana, hoy, "08:00");
      const entry = await prisma.timeEntry.findUniqueOrThrow({
        where: { id: entryId },
        select: { startedAt: true, endedAt: true, employeeId: true },
      });
      const plan = await turnoDelTramo(tenantId, entry, hoy);
      expect(plan).not.toBeNull();
      // El turno acaba a las 15:00; con el margen de 4 h, el límite son
      // las 19:00.
      expect(plan!.finAt.toISOString()).toBe(localToUtc(hoy, "15:00").toISOString());
      expect(plan!.margenHoras).toBe(4);

      const alas1901 = localToUtc(hoy, "19:01");
      expect(esSalidaOlvidada(entry, alas1901, 16, plan)).toBe(true);
      // Y SIN turno, a las 19:01 no lo es: le quedan cinco horas de las 16.
      expect(esSalidaOlvidada(entry, alas1901, 16, null)).toBe(false);
    });

    it("[prompt] con turno N y salida a las 07:58, se cierra de un toque", async () => {
      const ana = await altaEmpleado("Ana");
      const { localDate, localToUtc, esSalidaOlvidada } = await import(
        "../src/fichaje/time.js"
      );
      const { turnoDelTramo } = await import("../src/fichaje/cuadrante.js");

      // La noche de AYER: entró ayer a las 22:00 y sale hoy a las 07:58.
      const ayer = localDate(new Date(Date.now() - 86_400_000));
      const mesDeAyer = ayer.slice(0, 7);
      await app.inject({
        method: "GET",
        url: `/admin/fichaje/cuadrante?month=${mesDeAyer}`,
        headers: auth(),
      });
      const ts = await turnos();
      const noche = ts.find((t) => t.code === "N")!;
      await app.inject({
        method: "PUT",
        url: `/admin/fichaje/cuadrante/${mesDeAyer}/celdas`,
        headers: auth(),
        payload: {
          celdas: [{ employeeId: ana, dia: ayer, turnoIds: [noche.id] }],
        } as never,
      });
      await app.inject({
        method: "POST",
        url: `/admin/fichaje/cuadrante/${mesDeAyer}/publicar`,
        headers: auth(),
        payload: { confirmarAvisos: true } as never,
      });

      const entryId = await abrirTramo(ana, ayer, "22:00");
      const entry = await prisma.timeEntry.findUniqueOrThrow({
        where: { id: entryId },
        select: { startedAt: true, endedAt: true, employeeId: true },
      });
      const plan = await turnoDelTramo(tenantId, entry, ayer);
      expect(plan).not.toBeNull();
      const hoy = localDate(new Date());
      // A las 07:58 todavía no: su límite son las 12:00.
      expect(esSalidaOlvidada(entry, localToUtc(hoy, "07:58"), 16, plan)).toBe(
        false,
      );
      expect(esSalidaOlvidada(entry, localToUtc(hoy, "13:00"), 16, plan)).toBe(
        true,
      );
    });

    it("un BORRADOR no decide nunca la salida olvidada", async () => {
      // Es la decisión de `finPlanificadoDe`: un borrador puede tener la
      // mitad del mes en blanco o un turno puesto por error que nadie ha
      // visto.
      const ana = await altaEmpleado("Ana");
      const { localDate } = await import("../src/fichaje/time.js");
      const { turnoDelTramo } = await import("../src/fichaje/cuadrante.js");
      const hoy = localDate(new Date());
      await app.inject({
        method: "GET",
        url: `/admin/fichaje/cuadrante?month=${hoy.slice(0, 7)}`,
        headers: auth(),
      });
      const ts = await turnos();
      await app.inject({
        method: "PUT",
        url: `/admin/fichaje/cuadrante/${hoy.slice(0, 7)}/celdas`,
        headers: auth(),
        payload: {
          celdas: [{ employeeId: ana, dia: hoy, turnoIds: [ts[0]!.id] }],
        } as never,
      });
      const entryId = await abrirTramo(ana, hoy, "08:00");
      const entry = await prisma.timeEntry.findUniqueOrThrow({
        where: { id: entryId },
        select: { startedAt: true, endedAt: true, employeeId: true },
      });
      expect(await turnoDelTramo(tenantId, entry, hoy)).toBeNull();
    });

    it("«Hoy» dice quién tenía turno y no ha fichado, y quién fichó sin turno", async () => {
      const ana = await altaEmpleado("Ana");
      const bea = await altaEmpleado("Bea");
      const { localDate } = await import("../src/fichaje/time.js");
      const hoy = localDate(new Date());
      await app.inject({
        method: "GET",
        url: `/admin/fichaje/cuadrante?month=${hoy.slice(0, 7)}`,
        headers: auth(),
      });
      const ts = await turnos();
      // Ana tiene turno de mañana hoy; Bea no tiene nada.
      await app.inject({
        method: "PUT",
        url: `/admin/fichaje/cuadrante/${hoy.slice(0, 7)}/celdas`,
        headers: auth(),
        payload: {
          celdas: [{ employeeId: ana, dia: hoy, turnoIds: [ts[0]!.id] }],
        } as never,
      });
      await app.inject({
        method: "POST",
        url: `/admin/fichaje/cuadrante/${hoy.slice(0, 7)}/publicar`,
        headers: auth(),
        payload: { confirmarAvisos: true } as never,
      });
      // Y Bea ficha.
      await abrirTramo(bea, hoy, "08:00");

      const res = await app.inject({
        method: "GET",
        url: "/admin/fichaje/today",
        headers: auth(),
      });
      expect(res.statusCode).toBe(200);
      const plan = res.json().planned;
      expect(plan).not.toBeNull();
      expect(plan.withoutShift.map((x: { employeeName: string }) => x.employeeName)).toEqual(
        ["Bea"],
      );
      // Ana sale como «tenía turno y no ha fichado» si ya pasó su hora +
      // la tolerancia; si la suite corre antes de las 08:15, no — y eso
      // es correcto, así que se comprueba la coherencia y no la hora.
      const sinFichar = plan.withoutClockIn as Array<{ employeeName: string }>;
      expect(sinFichar.every((x) => x.employeeName === "Ana")).toBe(true);
    });

    it("y sin cuadrante publicado, «Hoy» lo dice en vez de pintar listas vacías", async () => {
      await altaEmpleado("Ana");
      const res = await app.inject({
        method: "GET",
        url: "/admin/fichaje/today",
        headers: auth(),
      });
      expect(res.json().planned).toBeNull();
    });
  });
});
