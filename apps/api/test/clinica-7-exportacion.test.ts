// clinica-7 · LA DEVOLUCIÓN DE DATOS DEL ART. 28.3.g.
//
// Lo que se prueba, y por qué cada cosa:
//
//   1. **Una línea de registro POR PACIENTE**, con `action = EXPORT`. No
//      una línea «se exportó el centro»: la pregunta que alguien hará es
//      «¿quién se llevó la historia de mi madre?», y eso se contesta con
//      una línea en la historia de su madre.
//   2. **El paquete lleva las cuatro cosas**: la historia en PDF, las
//      fotos descifradas, los consentimientos descifrados y el JSON.
//   3. **Las fotos salen EN CLARO del paquete**: es una devolución de
//      datos, así que lo que se entrega tiene que poder abrirse sin
//      nuestro programa. Un ZIP con ficheros cifrados con una clave que
//      solo tenemos nosotros no devuelve nada.
//   4. **Y lo que falta se DICE**, en un `FALTAN.txt` que se lee sin abrir
//      el JSON: un paquete incompleto en silencio es peor que uno que lo
//      dice, porque quien lo recibe firma que lo recibió.

import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const DIRECTORIO = mkdtempSync(join(tmpdir(), "clinica7-export-"));

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
process.env.CLINICAL_FILES_DIR = DIRECTORIO;

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PACIENTE_ID,
  SANITARIA_ID,
  TENANT_ID,
  crearMundo,
  sembrarSesion,
  sembrarValoracion,
} from "./support/fake-clinica-4.js";

const mundo = crearMundo();

vi.mock("../src/context.js", () => ({
  initContext: vi.fn(),
  getPrisma: () => mundo.prisma,
  getRedis: () => ({}),
  closeContext: vi.fn(),
  shutdown: vi.fn(),
}));

const { exportarElCentro } = await import("../src/clinica/exportacion.js");
const { asegurarDek, olvidarClaves } = await import(
  "../src/clinica/claves.js"
);
const { guardarFichero } = await import("../src/clinica/ficheros.js");

const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff]),
  Buffer.alloc(512, 3),
]);

/** Siembra una foto con su fichero CIFRADO en el volumen. */
async function sembrarFotoConFichero(): Promise<void> {
  const dek = await asegurarDek(TENANT_ID, mundo.prisma);
  const guardado = await guardarFichero("FOTO", JPEG, {
    tenantId: TENANT_ID,
    dek,
  });
  mundo.photos.push({
    id: "foto-1",
    tenantId: TENANT_ID,
    clientId: PACIENTE_ID,
    appointmentId: null,
    zona: "",
    zonaCifrada: null,
    mapaVersion: 1,
    fileName: guardado.fileName,
    sha256: guardado.sha256,
    bytes: guardado.bytes,
    mimeType: "image/jpeg",
    authorUserId: SANITARIA_ID,
    createdAt: new Date("2026-09-07T09:00:00.000Z"),
    withdrawnAt: null,
    withdrawnByUserId: null,
    withdrawReason: null,
    withdrawReasonCifrado: null,
  });
}

async function exportar(): Promise<{
  zip: Buffer;
  resumen: Awaited<ReturnType<typeof exportarElCentro>>;
}> {
  const trozos: Buffer[] = [];
  const resumen = await exportarElCentro(
    mundo.prisma,
    {
      tenantId: TENANT_ID,
      userId: SANITARIA_ID,
      deviceId: null,
      ahora: new Date("2026-10-14T10:00:00.000Z"),
    },
    (t) => {
      trozos.push(t);
    },
  );
  return { zip: Buffer.concat(trozos), resumen };
}

function abrir(zip: Buffer): { dir: string; lista: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "clinica7-abrir-"));
  const ruta = join(dir, "p.zip");
  writeFileSync(ruta, zip);
  execFileSync("unzip", ["-t", ruta]);
  const fuera = join(dir, "fuera");
  execFileSync("unzip", ["-q", "-o", ruta, "-d", fuera]);
  const lista = execFileSync("unzip", ["-Z", "-1", ruta], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  return { dir: fuera, lista };
}

beforeEach(() => {
  mundo.reset();
  olvidarClaves();
  sembrarValoracion(mundo);
  sembrarSesion(mundo, 1);
});

describe("clinica-7 · el paquete de la devolución de datos", () => {
  it("deja UNA LÍNEA DE REGISTRO POR PACIENTE, con EXPORT", async () => {
    mundo.registro = [];
    const { resumen } = await exportar();
    expect(resumen.pacientes).toBeGreaterThan(0);
    expect(mundo.registro).toHaveLength(resumen.pacientes);
    for (const linea of mundo.registro) {
      expect(linea).toMatchObject({
        userId: SANITARIA_ID,
        action: "EXPORT",
        outcome: "ALLOWED",
      });
    }
  });

  it("y la línea es de CADA paciente, no una del centro", async () => {
    mundo.registro = [];
    await exportar();
    expect(mundo.registro.map((l) => l.clientId)).toContain(PACIENTE_ID);
  });

  it("el paquete lleva la historia en PDF y el JSON, y lo abre `unzip`", async () => {
    const { zip } = await exportar();
    const { dir, lista } = abrir(zip);
    expect(lista.some((n) => n.endsWith("/historia.pdf"))).toBe(true);
    expect(lista).toContain("centro.json");

    const pdf = lista.find((n) => n.endsWith("/historia.pdf"))!;
    expect(
      readFileSync(join(dir, pdf)).subarray(0, 5).toString("latin1"),
    ).toBe("%PDF-");

    const json = JSON.parse(readFileSync(join(dir, "centro.json"), "utf8"));
    expect(json.exportadoEn).toBe("2026-10-14T10:00:00.000Z");
    expect(json.pacientes.length).toBeGreaterThan(0);
    expect(json.pacientes[0].historia).toBeTruthy();
  });

  it("LAS FOTOS SALEN EN CLARO: es una devolución, no una copia nuestra", async () => {
    // Un ZIP con ficheros cifrados con una clave que solo tenemos nosotros
    // no devuelve nada.
    await sembrarFotoConFichero();
    const { zip } = await exportar();
    const { dir, lista } = abrir(zip);
    const foto = lista.find((n) => n.endsWith(".jpg"));
    expect(foto, "no hay ninguna foto en el paquete").toBeTruthy();
    const bytes = readFileSync(join(dir, foto!));
    // JPEG de verdad, no el sobre `MPC1`.
    expect(bytes.subarray(0, 3).toString("hex")).toBe("ffd8ff");
    expect(bytes.subarray(0, 4).toString("latin1")).not.toBe("MPC1");
    expect(bytes.equals(JPEG)).toBe(true);
  });

  it("si falta un fichero, el paquete lo DICE en FALTAN.txt", async () => {
    // Una fila que apunta a un fichero que no está en el volumen. El
    // paquete sale igual —lo demás vale— y dice qué falta.
    mundo.photos.push({
      id: "foto-fantasma",
      tenantId: TENANT_ID,
      clientId: PACIENTE_ID,
      appointmentId: null,
      zona: "L:h",
      zonaCifrada: null,
      mapaVersion: 1,
      fileName: `${"0".repeat(8)}-0000-0000-0000-000000000000-aaaaaaaaaaaa.jpg`,
      sha256: "f".repeat(64),
      bytes: 10,
      mimeType: "image/jpeg",
      authorUserId: SANITARIA_ID,
      createdAt: new Date("2026-09-07T09:00:00.000Z"),
      withdrawnAt: null,
      withdrawnByUserId: null,
      withdrawReason: null,
      withdrawReasonCifrado: null,
    });
    const { zip, resumen } = await exportar();
    expect(resumen.incidencias.length).toBeGreaterThan(0);
    const { dir, lista } = abrir(zip);
    expect(lista).toContain("FALTAN.txt");
    const faltan = readFileSync(join(dir, "FALTAN.txt"), "utf8");
    expect(faltan).toContain("NO está completo");
    expect(faltan).toContain("no se pudo leer del volumen");
    // Y lo dice ANTES de que nadie firme que lo recibió.
    expect(faltan).toContain("antes de dar la devolución por buena");
  });

  it("sin incidencias NO mete el FALTAN.txt: un fichero vacío es ruido", async () => {
    await sembrarFotoConFichero();
    const { zip, resumen } = await exportar();
    expect(resumen.incidencias).toEqual([]);
    const { lista } = abrir(zip);
    expect(lista).not.toContain("FALTAN.txt");
  });
});
