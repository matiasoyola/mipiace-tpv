// V1-verifactu · el espejo del servidor.
//
// Lo que este banco fija:
//
//   1. Quién emite: `holdedEnabled === false` y nada más. Un tenant de hoy
//      no cambia de comportamiento.
//   2. El gate es ASIMÉTRICO: un comercio con Holded que manda registro se
//      rechaza; un comercio que emite y no lo manda cobra igual.
//   3. Las columnas se DERIVAN del payload. El servidor no se cree unas
//      copias sueltas ni recompone el registro.
//   4. Las cuatro comprobaciones de la cadena, cada una en rojo por su
//      cuenta.
//   5. Un registro que no encadena se GUARDA marcado. Nunca se descarta.
//
// Sabotajes que este fichero pone en rojo (§ tabla del done):
//   · cambiar un carácter del algoritmo de huella
//   · saltarse un número de la serie
//   · encadenar con la huella de otra caja
//   · aceptar en el servidor un registro que no encadena
//   · emitir registro en un comercio con Holded

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.SUPER_ADMIN_JWT_SECRET = "s".repeat(48);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import {
  buildRegistroAlta,
  buildRegistroAnulacion,
  type RegistroGenerado,
  type RegistroAlta,
} from "@mipiacetpv/verifactu";
import { beforeEach, describe, expect, it } from "vitest";

import {
  derivarColumnas,
  ingestFiscalRecord,
  PayloadFiscalIlegibleError,
  verificarRegistro,
} from "../src/fiscal/ingest.js";
import { comprobarGateFiscal, emiteMipiacetpv, leerIdentidadFiscal } from "../src/fiscal/mode.js";
import { entornoAeat } from "../src/fiscal/entorno.js";
import type { FiscalRecordBody } from "../src/fiscal/payload.js";

const REGISTER_ID = "33333333-3333-3333-3333-333333333333";
const TENANT_ID = "11111111-1111-1111-1111-111111111111";

const BASE_ALTA = {
  version: "1.16.0",
  numeroInstalacion: "inst-1",
  idEmisorFactura: "B45902186",
  nombreRazonEmisor: "PELUQUERÍA SOLE SL",
  fechaExpedicion: "2026-09-24",
  descripcionOperacion: "Prestación de servicios",
  desglose: [{ tipoImpositivo: 21, baseImponible: 10, cuotaRepercutida: 2.1 }],
  cuotaTotal: 2.1,
  importeTotal: 12.1,
};

// ── Una base en memoria con lo justo: la tabla de registros de una caja ──
interface FilaGuardada {
  id: string;
  externalId: string;
  tenantId: string;
  registerId: string;
  kind: "ALTA" | "ANULACION";
  chainIndex: number;
  serie: string;
  numero: number;
  huella: string;
  chainStatus: "OK" | "BROKEN";
  chainError: string | null;
}

function fakeTx(filas: FilaGuardada[]) {
  return {
    fiscalRecord: {
      findUnique: async ({ where }: any) => {
        if (where.externalId) {
          return filas.find((f) => f.externalId === where.externalId) ?? null;
        }
        const { registerId, chainIndex } = where.registerId_chainIndex;
        return (
          filas.find(
            (f) => f.registerId === registerId && f.chainIndex === chainIndex,
          ) ?? null
        );
      },
      findFirst: async ({ where, orderBy }: any) => {
        let cands = filas.filter((f) => f.registerId === where.registerId);
        if (where.kind) cands = cands.filter((f) => f.kind === where.kind);
        const key = orderBy?.numero ? "numero" : "chainIndex";
        cands = [...cands].sort((a, b) => (b as any)[key] - (a as any)[key]);
        return cands[0] ?? null;
      },
      create: async ({ data }: any) => {
        const fila: FilaGuardada = {
          id: randomUUID(),
          externalId: data.externalId,
          tenantId: data.tenantId,
          registerId: data.registerId,
          kind: data.kind,
          chainIndex: data.chainIndex,
          serie: data.serie,
          numero: data.numero,
          huella: data.huella,
          chainStatus: data.chainStatus,
          chainError: data.chainError,
        };
        filas.push(fila);
        return {
          id: fila.id,
          chainStatus: fila.chainStatus,
          chainError: fila.chainError,
        };
      },
    },
  } as any;
}

function cuerpo(
  generado: RegistroGenerado<RegistroAlta | Record<string, unknown>>,
  extra: Partial<FiscalRecordBody> = {},
): FiscalRecordBody {
  return {
    externalId: randomUUID(),
    kind: "ALTA",
    chainIndex: 1,
    serie: "C1",
    numero: 1,
    generatedAt: "2026-09-24T08:00:00.000Z",
    huellaInput: generado.huellaInput,
    payload: generado.registro as unknown as Record<string, unknown>,
    ...extra,
  };
}

describe("quién emite", () => {
  it("emite mipiacetpv SÓLO con holdedEnabled === false", () => {
    expect(emiteMipiacetpv({ holdedEnabled: false })).toBe(true);
    expect(emiteMipiacetpv({ holdedEnabled: true })).toBe(false);
  });

  it("un tenant de hoy (holdedEnabled true) no emite nada", () => {
    // El default de la columna es `true`. Si este test se pusiera rojo,
    // todos los comercios con Holded empezarían a generar registros.
    expect(emiteMipiacetpv({ holdedEnabled: true })).toBe(false);
  });
});

describe("el gate de la venta", () => {
  it("rechaza un registro de un comercio que factura con Holded", () => {
    const gate = comprobarGateFiscal({ holdedEnabled: true }, { algo: 1 });
    expect(gate.rechazo?.error).toBe("FISCAL_MODE_OFF");
  });

  it("deja pasar la venta de un comercio que emite aunque no traiga registro", () => {
    // APK vieja. Cobrar siempre se puede: se anota y se sigue.
    const gate = comprobarGateFiscal({ holdedEnabled: false }, undefined);
    expect(gate.rechazo).toBeNull();
    expect(gate.faltaRegistro).toBe(true);
  });

  it("no dice nada del comercio con Holded que no manda registro", () => {
    const gate = comprobarGateFiscal({ holdedEnabled: true }, undefined);
    // `descartarRegistro` lo añade verifactu-1b: sin sesión de prueba
    // delante, el gate se comporta exactamente igual que en verifactu-1.
    expect(gate).toEqual({
      rechazo: null,
      faltaRegistro: false,
      descartarRegistro: false,
    });
  });
});

describe("la identidad fiscal del comercio", () => {
  it("lee los alias históricos del fiscalProfile", () => {
    expect(
      leerIdentidadFiscal({
        name: "Sole",
        fiscalProfile: { nif: "b45902186", businessName: "SOLE SL" },
      }),
    ).toEqual({ nif: "B45902186", razonSocial: "SOLE SL" });
  });

  it("cae al nombre del tenant si no hay razón social", () => {
    expect(
      leerIdentidadFiscal({ name: "Sole", fiscalProfile: { taxId: "B45902186" } }),
    ).toEqual({ nif: "B45902186", razonSocial: "Sole" });
  });

  it("sin NIF no hay identidad", () => {
    expect(leerIdentidadFiscal({ name: "Sole", fiscalProfile: {} })).toBeNull();
    expect(leerIdentidadFiscal({ name: "Sole", fiscalProfile: null })).toBeNull();
  });
});

describe("el entorno del QR", () => {
  beforeEach(() => {
    delete process.env.VERIFACTU_ENTORNO;
  });

  it("por defecto es PRUEBAS", () => {
    expect(entornoAeat()).toBe("PRUEBAS");
  });

  it("un valor que no se reconoce cae a PRUEBAS, no revienta", () => {
    process.env.VERIFACTU_ENTORNO = "produccion-de-verdad";
    expect(entornoAeat()).toBe("PRUEBAS");
  });

  it("PRODUCCION sólo con el valor exacto", () => {
    process.env.VERIFACTU_ENTORNO = "produccion";
    expect(entornoAeat()).toBe("PRODUCCION");
  });
});

describe("derivarColumnas", () => {
  it("saca del payload todo lo que indexa el registro", async () => {
    const alta = await buildRegistroAlta({
      ...BASE_ALTA,
      numSerieFactura: "C1/000001",
      cabeza: null,
      fechaHoraHusoGenRegistro: "2026-09-24T10:00:00+02:00",
    });
    const cols = derivarColumnas("ALTA", alta.registro as never);
    expect(cols.numSerieFactura).toBe("C1/000001");
    expect(cols.fechaExpedicionIso).toBe("2026-09-24");
    expect(cols.tipoFactura).toBe("F2");
    expect(cols.cuotaTotal).toBe("2.10");
    expect(cols.importeTotal).toBe("12.10");
    expect(cols.primerRegistro).toBe(true);
    expect(cols.huellaAnterior).toBeNull();
    expect(cols.huella).toBe(alta.huella);
    // Y reconstruye la cadena de entrada sin fiarse de la que le manden.
    expect(cols.huellaInputEsperada).toBe(alta.huellaInput);
  });

  it("lee el registro de anulación con sus campos «Anulada»", async () => {
    const anul = await buildRegistroAnulacion({
      version: "1.16.0",
      numeroInstalacion: "inst-1",
      idEmisorFacturaAnulada: "B45902186",
      nombreRazonEmisor: "SOLE SL",
      numSerieFacturaAnulada: "C1/000001",
      fechaExpedicionFacturaAnulada: "2026-09-24",
      cabeza: null,
      fechaHoraHusoGenRegistro: "2026-09-24T11:00:00+02:00",
    });
    const cols = derivarColumnas("ANULACION", anul.registro as never);
    expect(cols.numSerieFactura).toBe("C1/000001");
    expect(cols.huellaInputEsperada).toBe(anul.huellaInput);
  });

  it("revienta con un payload al que le falta lo esencial", () => {
    expect(() => derivarColumnas("ALTA", { Huella: "x" })).toThrow(
      PayloadFiscalIlegibleError,
    );
  });

  it("revienta si el encadenamiento se contradice", async () => {
    const alta = await buildRegistroAlta({
      ...BASE_ALTA,
      numSerieFactura: "C1/000001",
      cabeza: null,
      fechaHoraHusoGenRegistro: "2026-09-24T10:00:00+02:00",
    });
    const roto = {
      ...(alta.registro as unknown as Record<string, unknown>),
      Encadenamiento: {
        PrimerRegistro: "S",
        RegistroAnterior: { Huella: "A".repeat(64) },
      },
    };
    expect(() => derivarColumnas("ALTA", roto)).toThrow(
      PayloadFiscalIlegibleError,
    );
  });
});

describe("la verificación de la cadena", () => {
  it("un primer registro bien formado sale OK", async () => {
    const filas: FilaGuardada[] = [];
    const alta = await buildRegistroAlta({
      ...BASE_ALTA,
      numSerieFactura: "C1/000001",
      cabeza: null,
      fechaHoraHusoGenRegistro: "2026-09-24T10:00:00+02:00",
    });
    const r = await verificarRegistro({
      tx: fakeTx(filas),
      registerId: REGISTER_ID,
      chainIndex: 1,
      numero: 1,
      serie: "C1",
      kind: "ALTA",
      huellaInputRecibida: alta.huellaInput,
      columnas: derivarColumnas("ALTA", alta.registro as never),
    });
    expect(r).toEqual({ status: "OK", error: null });
  });

  it("SABOTAJE · un carácter distinto en la huella: HUELLA_NO_CUADRA", async () => {
    const alta = await buildRegistroAlta({
      ...BASE_ALTA,
      numSerieFactura: "C1/000001",
      cabeza: null,
      fechaHoraHusoGenRegistro: "2026-09-24T10:00:00+02:00",
    });
    const cols = derivarColumnas("ALTA", alta.registro as never);
    const r = await verificarRegistro({
      tx: fakeTx([]),
      registerId: REGISTER_ID,
      chainIndex: 1,
      numero: 1,
      serie: "C1",
      kind: "ALTA",
      huellaInputRecibida: alta.huellaInput,
      columnas: { ...cols, huella: `0${cols.huella.slice(1)}` },
    });
    expect(r.status).toBe("BROKEN");
    expect(r.error).toContain("HUELLA_NO_CUADRA");
  });

  it("SABOTAJE · la cadena de entrada no deriva del registro", async () => {
    const alta = await buildRegistroAlta({
      ...BASE_ALTA,
      numSerieFactura: "C1/000001",
      cabeza: null,
      fechaHoraHusoGenRegistro: "2026-09-24T10:00:00+02:00",
    });
    const r = await verificarRegistro({
      tx: fakeTx([]),
      registerId: REGISTER_ID,
      chainIndex: 1,
      numero: 1,
      serie: "C1",
      kind: "ALTA",
      // El terminal manda una entrada con otro importe: la huella que trae
      // el registro sí cuadra con ESA entrada, pero la entrada no es la del
      // registro. Sin esta comprobación se colaría.
      huellaInputRecibida: alta.huellaInput.replace("12.10", "99.99"),
      columnas: derivarColumnas("ALTA", alta.registro as never),
    });
    expect(r.error).toContain("ENTRADA_NO_DERIVA_DEL_REGISTRO");
  });

  it("SABOTAJE · encadenar con la huella de otra caja: ENLACE_ROTO", async () => {
    const filas: FilaGuardada[] = [];
    const tx = fakeTx(filas);
    const primero = await buildRegistroAlta({
      ...BASE_ALTA,
      numSerieFactura: "C1/000001",
      cabeza: null,
      fechaHoraHusoGenRegistro: "2026-09-24T10:00:00+02:00",
    });
    await ingestFiscalRecord({
      tx,
      tenantId: TENANT_ID,
      registerId: REGISTER_ID,
      deviceId: null,
      ticketId: null,
      body: cuerpo(primero),
    });
    // El segundo encadena con una huella que no es la del primero de ESTA
    // caja (la de otra caja, o una inventada).
    const ajena = "F".repeat(64);
    const segundo = await buildRegistroAlta({
      ...BASE_ALTA,
      numSerieFactura: "C1/000002",
      cabeza: {
        chainIndex: 1,
        idEmisorFactura: "B45902186",
        numSerieFactura: "C1/000001",
        fechaExpedicion: "2026-09-24",
        huella: ajena,
        fechaHoraHusoGenRegistro: "2026-09-24T10:00:00+02:00",
        ultimoNumero: 1,
        serie: "C1",
      },
      fechaHoraHusoGenRegistro: "2026-09-24T10:05:00+02:00",
    });
    const r = await verificarRegistro({
      tx,
      registerId: REGISTER_ID,
      chainIndex: 2,
      numero: 2,
      serie: "C1",
      kind: "ALTA",
      huellaInputRecibida: segundo.huellaInput,
      columnas: derivarColumnas("ALTA", segundo.registro as never),
    });
    expect(r.error).toContain("ENLACE_ROTO");
  });

  it("SABOTAJE · saltarse un número de la serie: NUMERACION_CON_HUECO", async () => {
    const filas: FilaGuardada[] = [];
    const tx = fakeTx(filas);
    const primero = await buildRegistroAlta({
      ...BASE_ALTA,
      numSerieFactura: "C1/000001",
      cabeza: null,
      fechaHoraHusoGenRegistro: "2026-09-24T10:00:00+02:00",
    });
    await ingestFiscalRecord({
      tx,
      tenantId: TENANT_ID,
      registerId: REGISTER_ID,
      deviceId: null,
      ticketId: null,
      body: cuerpo(primero),
    });
    const tercero = await buildRegistroAlta({
      ...BASE_ALTA,
      numSerieFactura: "C1/000003",
      cabeza: {
        chainIndex: 1,
        idEmisorFactura: "B45902186",
        numSerieFactura: "C1/000001",
        fechaExpedicion: "2026-09-24",
        huella: primero.huella,
        fechaHoraHusoGenRegistro: "2026-09-24T10:00:00+02:00",
        ultimoNumero: 1,
        serie: "C1",
      },
      fechaHoraHusoGenRegistro: "2026-09-24T10:05:00+02:00",
    });
    const r = await verificarRegistro({
      tx,
      registerId: REGISTER_ID,
      chainIndex: 2,
      numero: 3,
      serie: "C1",
      kind: "ALTA",
      huellaInputRecibida: tercero.huellaInput,
      columnas: derivarColumnas("ALTA", tercero.registro as never),
    });
    expect(r.error).toContain("NUMERACION_CON_HUECO");
  });

  it("una anulación NO gasta número: la siguiente alta sigue la serie", async () => {
    const filas: FilaGuardada[] = [
      {
        id: randomUUID(),
        externalId: randomUUID(),
        tenantId: TENANT_ID,
        registerId: REGISTER_ID,
        kind: "ALTA",
        chainIndex: 1,
        serie: "C1",
        numero: 1,
        huella: "A".repeat(64),
        chainStatus: "OK",
        chainError: null,
      },
      {
        id: randomUUID(),
        externalId: randomUUID(),
        tenantId: TENANT_ID,
        registerId: REGISTER_ID,
        kind: "ANULACION",
        chainIndex: 2,
        serie: "C1",
        numero: 1,
        huella: "B".repeat(64),
        chainStatus: "OK",
        chainError: null,
      },
    ];
    const segunda = await buildRegistroAlta({
      ...BASE_ALTA,
      numSerieFactura: "C1/000002",
      cabeza: {
        chainIndex: 2,
        idEmisorFactura: "B45902186",
        numSerieFactura: "C1/000001",
        fechaExpedicion: "2026-09-24",
        huella: "B".repeat(64),
        fechaHoraHusoGenRegistro: "2026-09-24T10:00:00+02:00",
        ultimoNumero: 1,
        serie: "C1",
      },
      fechaHoraHusoGenRegistro: "2026-09-24T10:10:00+02:00",
    });
    const r = await verificarRegistro({
      tx: fakeTx(filas),
      registerId: REGISTER_ID,
      chainIndex: 3,
      numero: 2,
      serie: "C1",
      kind: "ALTA",
      huellaInputRecibida: segunda.huellaInput,
      columnas: derivarColumnas("ALTA", segunda.registro as never),
    });
    expect(r).toEqual({ status: "OK", error: null });
  });
});

describe("la ingesta", () => {
  it("SABOTAJE · un registro que no encadena se GUARDA, marcado", async () => {
    const filas: FilaGuardada[] = [];
    const tx = fakeTx(filas);
    const alta = await buildRegistroAlta({
      ...BASE_ALTA,
      numSerieFactura: "C1/000001",
      cabeza: null,
      fechaHoraHusoGenRegistro: "2026-09-24T10:00:00+02:00",
    });
    const r = await ingestFiscalRecord({
      tx,
      tenantId: TENANT_ID,
      registerId: REGISTER_ID,
      deviceId: null,
      ticketId: null,
      // chainIndex 5 sin registros previos: no puede encadenar.
      body: cuerpo(alta, { chainIndex: 5 }),
    });
    expect(r.chainStatus).toBe("BROKEN");
    expect(r.chainError).toContain("SIN_ANTERIOR");
    // Y está guardado. Descartarlo sería perder la prueba de que pasó.
    expect(filas).toHaveLength(1);
  });

  it("la posición ocupada no pierde el registro: entra en la siguiente", async () => {
    const filas: FilaGuardada[] = [];
    const tx = fakeTx(filas);
    const primero = await buildRegistroAlta({
      ...BASE_ALTA,
      numSerieFactura: "C1/000001",
      cabeza: null,
      fechaHoraHusoGenRegistro: "2026-09-24T10:00:00+02:00",
    });
    await ingestFiscalRecord({
      tx,
      tenantId: TENANT_ID,
      registerId: REGISTER_ID,
      deviceId: null,
      ticketId: null,
      body: cuerpo(primero),
    });
    const otro = await buildRegistroAlta({
      ...BASE_ALTA,
      numSerieFactura: "C1/000009",
      cabeza: null,
      fechaHoraHusoGenRegistro: "2026-09-24T10:01:00+02:00",
    });
    const r = await ingestFiscalRecord({
      tx,
      tenantId: TENANT_ID,
      registerId: REGISTER_ID,
      deviceId: null,
      ticketId: null,
      body: cuerpo(otro, { chainIndex: 1, numero: 9 }),
    });
    expect(r.chainError).toContain("POSICION_OCUPADA");
    expect(filas).toHaveLength(2);
    expect(filas[1]!.chainIndex).toBe(2);
  });

  it("el mismo externalId dos veces no crea dos registros", async () => {
    const filas: FilaGuardada[] = [];
    const tx = fakeTx(filas);
    const alta = await buildRegistroAlta({
      ...BASE_ALTA,
      numSerieFactura: "C1/000001",
      cabeza: null,
      fechaHoraHusoGenRegistro: "2026-09-24T10:00:00+02:00",
    });
    const body = cuerpo(alta);
    const uno = await ingestFiscalRecord({
      tx,
      tenantId: TENANT_ID,
      registerId: REGISTER_ID,
      deviceId: null,
      ticketId: null,
      body,
    });
    const dos = await ingestFiscalRecord({
      tx,
      tenantId: TENANT_ID,
      registerId: REGISTER_ID,
      deviceId: null,
      ticketId: null,
      body,
    });
    expect(dos.duplicado).toBe(true);
    expect(dos.id).toBe(uno.id);
    expect(filas).toHaveLength(1);
  });
});
