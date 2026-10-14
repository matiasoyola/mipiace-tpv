// clinica-7 · EL CIFRADO, EL AAD Y LAS CLAVES.
//
// Lo que este fichero prueba es la mitad que no necesita HTTP: las
// primitivas, el llavero, el AAD y el arranque. Las rutas van en
// `clinica-7-contrato.test.ts` y el enlace del informe en
// `clinica-7-informe-enlace.test.ts`.
//
// Los que importan de verdad, y por qué:
//
//   · **el AAD**: un valor cifrado movido a otra fila, a otra columna o a
//     otro tenant NO SE DESCIFRA. Es la decisión 15, y es lo que impide
//     que un `UPDATE` a mano meta el cuerpo de una paciente en la historia
//     de otra;
//   · **la API no arranca sin la KEK** teniendo clínicas (decisión 17);
//   · **borrar la DEK deja ilegible ese tenant y no otro**, que es la
//     promesa entera del crypto-shredding.

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import { beforeEach, describe, expect, it, vi } from "vitest";

import { kekDePrueba, llaveroFake } from "./clinica-7-claves-fake.js";

const KEK = kekDePrueba();

const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const FILA_1 = "11111111-1111-1111-1111-111111111111";
const FILA_2 = "22222222-2222-2222-2222-222222222222";

const llavero = llaveroFake();
let clinicosEncendidos = [TENANT_A, TENANT_B];
let entradasPorTenant: Record<string, number> = {};

const fakePrisma = {
  clinicalTenantKey: llavero.modelo,
  tenant: {
    count: vi.fn(async () => clinicosEncendidos.length),
    findUnique: vi.fn(async ({ where }: any) => ({
      clinicalRecordsEnabled: clinicosEncendidos.includes(where.id),
    })),
  },
  clinicalEntry: {
    findMany: vi.fn(async () =>
      Object.keys(entradasPorTenant).map((t) => ({ tenantId: t })),
    ),
  },
};

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }),
  shutdown: async () => undefined,
}));

const {
  TEXTO_DEL_CANARIO,
  aadDe,
  canarioCuadra,
  cifrarFichero,
  cifrarValor,
  descifrarFichero,
  descifrarValor,
  desenvolverDek,
  envolverDek,
  esCifrado,
  esFicheroCifrado,
  NoSeDescifra,
  nuevaDek,
  nuevoCanario,
  sitioDelFichero,
} = await import("../src/clinica/cripto.js");

const {
  ClaveDestruida,
  SinClaveTodavia,
  asegurarDek,
  dekDe,
  destruirDek,
  olvidarClaves,
  revisarCanarios,
  rotarKek,
} = await import("../src/clinica/claves.js");

const { revisarArranqueClinico } = await import("../src/clinica/arranque.js");
const { notaParaGuardar, leerNota, olvidarSiEsClinico } = await import(
  "../src/clinica/notas.js"
);
const { olvidarEnv } = await import("../src/env.js");

/** Cambia la KEK del entorno DE VERDAD. `loadEnv` cachea, así que sin
 *  olvidarla el caso siguiente corre con el entorno del anterior — y pasa
 *  sin probar nada. Cuatro tests de este fichero salieron verdes por eso
 *  antes de que existiera `olvidarEnv`. */
function conKek(kek: string | null): void {
  if (kek == null) delete process.env.CLINICAL_KEK;
  else process.env.CLINICAL_KEK = kek;
  olvidarEnv();
  olvidarClaves();
}

const sitio = (tenantId: string, tabla: string, columna: string, filaId: string) => ({
  tenantId,
  tabla,
  columna,
  filaId,
});

beforeEach(() => {
  llavero.reset();
  olvidarClaves();
  clinicosEncendidos = [TENANT_A, TENANT_B];
  entradasPorTenant = {};
  process.env.CLINICAL_KEK_ID = "test";
  conKek(KEK);
});

// ── 1 · EL AAD, que es la decisión 15 ────────────────────────────────

describe("clinica-7 · el AAD ata cada valor a dónde vive", () => {
  const dek = nuevaDek();
  const SECRETO = "Diabetes tipo 2 mal controlada, pie derecho con úlcera.";

  it("un valor cifrado se descifra en SU sitio", () => {
    const s = sitio(TENANT_A, "clinical_entries", "body", FILA_1);
    const c = cifrarValor(SECRETO, dek, s);
    expect(c.startsWith("c1:")).toBe(true);
    expect(esCifrado(c)).toBe(true);
    expect(descifrarValor(c, dek, s)).toBe(SECRETO);
  });

  it("MOVIDO A OTRA FILA del mismo paciente, NO se descifra", () => {
    // Es el sabotaje del prompt. Un `UPDATE … SET body_cifrado = (SELECT
    // body_cifrado FROM … WHERE id = 'otra')` no mueve una anotación: deja
    // una fila que no abre.
    const c = cifrarValor(
      SECRETO,
      dek,
      sitio(TENANT_A, "clinical_entries", "body", FILA_1),
    );
    expect(() =>
      descifrarValor(
        c,
        dek,
        sitio(TENANT_A, "clinical_entries", "body", FILA_2),
      ),
    ).toThrow(NoSeDescifra);
  });

  it("MOVIDO A OTRO TENANT, NO se descifra (ni con la misma DEK)", () => {
    const c = cifrarValor(
      SECRETO,
      dek,
      sitio(TENANT_A, "clinical_entries", "body", FILA_1),
    );
    expect(() =>
      descifrarValor(
        c,
        dek,
        sitio(TENANT_B, "clinical_entries", "body", FILA_1),
      ),
    ).toThrow(NoSeDescifra);
  });

  it("MOVIDO A OTRA COLUMNA, NO se descifra", () => {
    // El motivo de una retirada en el sitio de la zona, por ejemplo.
    const c = cifrarValor(
      SECRETO,
      dek,
      sitio(TENANT_A, "clinical_photos", "zona", FILA_1),
    );
    expect(() =>
      descifrarValor(
        c,
        dek,
        sitio(TENANT_A, "clinical_photos", "withdraw_reason", FILA_1),
      ),
    ).toThrow(NoSeDescifra);
  });

  it("MOVIDO A OTRA TABLA, NO se descifra", () => {
    const c = cifrarValor(
      SECRETO,
      dek,
      sitio(TENANT_A, "clinical_entries", "body", FILA_1),
    );
    expect(() =>
      descifrarValor(
        c,
        dek,
        sitio(TENANT_A, "clinical_addenda", "body", FILA_1),
      ),
    ).toThrow(NoSeDescifra);
  });

  it("con OTRA DEK, NO se descifra", () => {
    const c = cifrarValor(
      SECRETO,
      dek,
      sitio(TENANT_A, "clinical_entries", "body", FILA_1),
    );
    expect(() =>
      descifrarValor(
        c,
        nuevaDek(),
        sitio(TENANT_A, "clinical_entries", "body", FILA_1),
      ),
    ).toThrow(NoSeDescifra);
  });

  it("un byte cambiado en el ciphertext NO se descifra (es GCM)", () => {
    const s = sitio(TENANT_A, "clinical_entries", "body", FILA_1);
    const c = cifrarValor(SECRETO, dek, s);
    const bytes = Buffer.from(c.slice(3), "base64");
    bytes[bytes.length - 1] = (bytes[bytes.length - 1]! ^ 1) & 0xff;
    const tocado = `c1:${bytes.toString("base64")}`;
    expect(() => descifrarValor(tocado, dek, s)).toThrow(NoSeDescifra);
  });

  it("el AAD es los cuatro campos, en orden y con `|`", () => {
    // Es parte del contrato del ciphertext: cambiarlo deja ilegible todo lo
    // cifrado antes. El test lo FIJA, igual que la huella del contrato.
    expect(aadDe(sitio(TENANT_A, "clinical_entries", "body", FILA_1))).toBe(
      `${TENANT_A}|clinical_entries|body|${FILA_1}`,
    );
  });

  it("el mismo texto cifrado dos veces da DOS ciphertext distintos", () => {
    // IV aleatorio. Si fueran iguales, dos pacientes con la misma anotación
    // se podrían emparejar mirando la base sin descifrar nada.
    const s = sitio(TENANT_A, "clinical_entries", "body", FILA_1);
    expect(cifrarValor(SECRETO, dek, s)).not.toBe(cifrarValor(SECRETO, dek, s));
  });

  it("el error NO lleva el ciphertext ni la clave, solo dónde estaba", () => {
    const c = cifrarValor(
      SECRETO,
      dek,
      sitio(TENANT_A, "clinical_entries", "body", FILA_1),
    );
    try {
      descifrarValor(
        c,
        dek,
        sitio(TENANT_A, "clinical_entries", "body", FILA_2),
      );
      expect.unreachable();
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain("clinical_entries");
      expect(msg).toContain(FILA_2);
      // Y nada del contenido ni de la clave.
      expect(msg).not.toContain(c.slice(3, 20));
      expect(msg).not.toContain(dek.toString("base64").slice(0, 10));
      expect(msg).not.toContain("Diabetes");
    }
  });
});

// ── 2 · LOS FICHEROS ────────────────────────────────────────────────

describe("clinica-7 · los ficheros clínicos, cifrados en disco", () => {
  const dek = nuevaDek();
  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), randomBytes(500)]);

  it("el sobre NO empieza por la firma del JPEG", () => {
    const s = sitioDelFichero({
      tenantId: TENANT_A,
      clase: "FOTO",
      fileName: "f.jpg",
    });
    const sobre = cifrarFichero(JPEG, dek, s);
    expect(sobre.subarray(0, 4).toString("latin1")).toBe("MPC1");
    expect(sobre.subarray(0, 3).toString("hex")).not.toBe("ffd8ff");
    expect(esFicheroCifrado(sobre)).toBe(true);
    expect(descifrarFichero(sobre, dek, s).equals(JPEG)).toBe(true);
  });

  it("un JPEG en claro NO se confunde con un sobre", () => {
    // Es lo que permite que el script de cifrado sea idempotente y que la
    // lectura siga sirviendo los ficheros que todavía no pasó.
    expect(esFicheroCifrado(JPEG)).toBe(false);
    expect(esFicheroCifrado(Buffer.from("%PDF-1.4 hola"))).toBe(false);
  });

  it("RENOMBRADO, el fichero no se descifra: el nombre va en el AAD", () => {
    const sobre = cifrarFichero(
      JPEG,
      dek,
      sitioDelFichero({ tenantId: TENANT_A, clase: "FOTO", fileName: "f.jpg" }),
    );
    expect(() =>
      descifrarFichero(
        sobre,
        dek,
        sitioDelFichero({
          tenantId: TENANT_A,
          clase: "FOTO",
          fileName: "otro.jpg",
        }),
      ),
    ).toThrow(NoSeDescifra);
  });

  it("COPIADO A OTRA CLÍNICA, tampoco", () => {
    const sobre = cifrarFichero(
      JPEG,
      dek,
      sitioDelFichero({ tenantId: TENANT_A, clase: "FOTO", fileName: "f.jpg" }),
    );
    expect(() =>
      descifrarFichero(
        sobre,
        dek,
        sitioDelFichero({ tenantId: TENANT_B, clase: "FOTO", fileName: "f.jpg" }),
      ),
    ).toThrow(NoSeDescifra);
  });

  it("MANIPULADO, el GCM lo caza antes de la huella", () => {
    // Éste es el cambio que clinica-7 trae sobre clinica-4: antes el
    // fichero estaba en claro y lo único que detectaba un byte de más era
    // la huella. Ahora lo detecta el tag, y la huella sigue cubriendo el
    // caso de «bien cifrado con otro contenido».
    const s = sitioDelFichero({
      tenantId: TENANT_A,
      clase: "FOTO",
      fileName: "f.jpg",
    });
    const sobre = cifrarFichero(JPEG, dek, s);
    const tocado = Buffer.concat([sobre, Buffer.from("x")]);
    expect(() => descifrarFichero(tocado, dek, s)).toThrow(NoSeDescifra);
  });
});

// ── 3 · LA DEK ENVUELTA ─────────────────────────────────────────────

describe("clinica-7 · la DEK va envuelta con la KEK", () => {
  it("se envuelve y se desenvuelve con el mismo tenant y la misma KEK", () => {
    const dek = nuevaDek();
    const envuelta = envolverDek(dek, {
      kekBase64: KEK,
      kekId: "test",
      tenantId: TENANT_A,
    });
    // Formato `v1:` de `crypto.ts`: distinto del `c1:` de los valores, así
    // que un `SELECT` dice de un vistazo qué es cada cosa.
    expect(envuelta.startsWith("v1:")).toBe(true);
    // Y la DEK EN CLARO no cabe en esa columna: no empieza por `v1:`.
    expect(dek.toString("base64").startsWith("v1:")).toBe(false);
    expect(
      desenvolverDek(envuelta, {
        kekBase64: KEK,
        kekId: "test",
        tenantId: TENANT_A,
      }).equals(dek),
    ).toBe(true);
  });

  it("COPIADA A LA FILA DE OTRO TENANT, no se desenvuelve", () => {
    const envuelta = envolverDek(nuevaDek(), {
      kekBase64: KEK,
      kekId: "test",
      tenantId: TENANT_A,
    });
    expect(() =>
      desenvolverDek(envuelta, {
        kekBase64: KEK,
        kekId: "test",
        tenantId: TENANT_B,
      }),
    ).toThrow(NoSeDescifra);
  });

  it("con OTRA KEK, no se desenvuelve", () => {
    const envuelta = envolverDek(nuevaDek(), {
      kekBase64: KEK,
      kekId: "test",
      tenantId: TENANT_A,
    });
    expect(() =>
      desenvolverDek(envuelta, {
        kekBase64: randomBytes(32).toString("base64"),
        kekId: "test",
        tenantId: TENANT_A,
      }),
    ).toThrow(NoSeDescifra);
  });

  it("y con el ID de KEK equivocado tampoco: el id va en el AAD", () => {
    // Es lo que impide que una rotación a medias mezcle las dos.
    const envuelta = envolverDek(nuevaDek(), {
      kekBase64: KEK,
      kekId: "kek-vieja",
      tenantId: TENANT_A,
    });
    expect(() =>
      desenvolverDek(envuelta, {
        kekBase64: KEK,
        kekId: "kek-nueva",
        tenantId: TENANT_A,
      }),
    ).toThrow(NoSeDescifra);
  });
});

// ── 4 · EL LLAVERO ──────────────────────────────────────────────────

describe("clinica-7 · el llavero", () => {
  it("la clave se crea en la PRIMERA escritura y después se reusa", async () => {
    expect(llavero.filas.size).toBe(0);
    const d1 = await asegurarDek(TENANT_A, fakePrisma as never);
    expect(llavero.filas.size).toBe(1);
    olvidarClaves();
    const d2 = await asegurarDek(TENANT_A, fakePrisma as never);
    expect(d2.equals(d1)).toBe(true);
    expect(llavero.filas.size).toBe(1);
  });

  it("DOS escrituras simultáneas del primer día no crean DOS claves", async () => {
    // El cierre de carrera de `asegurarDek`. Sin él, la segunda crearía una
    // DEK nueva y lo que cifró la primera quedaría ilegible — el peor fallo
    // posible de esta pieza, y el más silencioso.
    const [a, b] = await Promise.all([
      asegurarDek(TENANT_A, fakePrisma as never),
      asegurarDek(TENANT_A, fakePrisma as never),
    ]);
    expect(llavero.filas.size).toBe(1);
    expect(a.equals(b)).toBe(true);
  });

  it("cada clínica tiene SU clave, y son distintas", async () => {
    const a = await asegurarDek(TENANT_A, fakePrisma as never);
    const b = await asegurarDek(TENANT_B, fakePrisma as never);
    expect(a.equals(b)).toBe(false);
  });

  it("una clínica sin clave levanta `SinClaveTodavia`, no una clave nueva", async () => {
    await expect(dekDe(TENANT_A, fakePrisma as never)).rejects.toThrow(
      SinClaveTodavia,
    );
    expect(llavero.filas.size).toBe(0);
  });

  it("el canario de un tenant NO cuadra con la DEK de otro", async () => {
    const dekA = await asegurarDek(TENANT_A, fakePrisma as never);
    const dekB = await asegurarDek(TENANT_B, fakePrisma as never);
    const canarioA = llavero.filas.get(TENANT_A)!.canary!;
    expect(canarioCuadra(canarioA, dekA, TENANT_A)).toBe(true);
    expect(canarioCuadra(canarioA, dekB, TENANT_A)).toBe(false);
    // Y copiado a la fila del otro tampoco: su AAD lleva el tenant.
    expect(canarioCuadra(canarioA, dekA, TENANT_B)).toBe(false);
  });

  it("el canario dice el texto conocido y nada de nadie", async () => {
    const dek = await asegurarDek(TENANT_A, fakePrisma as never);
    const canario = nuevoCanario(dek, TENANT_A);
    expect(canario.startsWith("c1:")).toBe(true);
    expect(TEXTO_DEL_CANARIO).toBe("mipiace-canario-clinico-v1");
  });
});

// ── 5 · ROTAR LA KEK ────────────────────────────────────────────────

describe("clinica-7 · rotar la KEK no re-cifra ni una fila", () => {
  it("re-envuelve, el canario NO cambia y la DEK sigue siendo la misma", async () => {
    const antes = await asegurarDek(TENANT_A, fakePrisma as never);
    const canarioAntes = llavero.filas.get(TENANT_A)!.canary;

    const nueva = randomBytes(32).toString("base64");
    const r = await rotarKek(
      { kekViejaBase64: KEK, kekNuevaBase64: nueva, kekNuevaId: "kek-2" },
      fakePrisma as never,
    );
    expect(r.reenvueltas).toEqual([TENANT_A]);
    expect(r.fallidas).toEqual([]);

    const fila = llavero.filas.get(TENANT_A)!;
    expect(fila.kekId).toBe("kek-2");
    // EL CANARIO NO CAMBIA. Si cambiara, la DEK sería otra y la historia
    // escrita antes habría quedado ilegible.
    expect(fila.canary).toBe(canarioAntes);

    // Y con la KEK nueva en el entorno, la DEK que sale es la MISMA.
    conKek(nueva);
    const despues = await dekDe(TENANT_A, fakePrisma as never);
    expect(despues.equals(antes)).toBe(true);
  });

  it("es idempotente: la segunda pasada no toca nada", async () => {
    await asegurarDek(TENANT_A, fakePrisma as never);
    const nueva = randomBytes(32).toString("base64");
    const args = {
      kekViejaBase64: KEK,
      kekNuevaBase64: nueva,
      kekNuevaId: "kek-2",
    };
    await rotarKek(args, fakePrisma as never);
    const segunda = await rotarKek(args, fakePrisma as never);
    expect(segunda.reenvueltas).toEqual([]);
    expect(segunda.yaEstaban).toEqual([TENANT_A]);
  });

  it("con la KEK VIEJA equivocada no re-envuelve NINGUNA, y lo dice", async () => {
    // Lo importante no es que falle: es que **no deja la fila a medias**.
    // Re-envolver con una DEK mal desenvuelta dejaría la historia ilegible
    // para siempre.
    await asegurarDek(TENANT_A, fakePrisma as never);
    const envueltaAntes = llavero.filas.get(TENANT_A)!.dekWrapped;
    const r = await rotarKek(
      {
        kekViejaBase64: randomBytes(32).toString("base64"),
        kekNuevaBase64: randomBytes(32).toString("base64"),
        kekNuevaId: "kek-2",
      },
      fakePrisma as never,
    );
    expect(r.fallidas).toEqual([TENANT_A]);
    expect(r.reenvueltas).toEqual([]);
    expect(llavero.filas.get(TENANT_A)!.dekWrapped).toBe(envueltaAntes);
    expect(llavero.filas.get(TENANT_A)!.kekId).toBe("test");
  });

  it("con el canario MANIPULADO no re-envuelve, aunque la DEK se desenvuelva", async () => {
    // El sabotaje #19 de la tabla salió VERDE, y por la forma de siempre:
    // el único caso que había («la KEK vieja no es la buena») falla al
    // DESENVOLVER, así que la comprobación del canario era código muerto.
    //
    // Éste es el caso que la ejercita, y es el peligroso de verdad: la
    // fila se desenvuelve bien —la KEK es la buena— y su canario es de
    // OTRA DEK, porque alguien lo cambió a mano. Re-envolver eso dejaría
    // la historia de esa clínica ilegible para siempre, y el único aviso
    // habría sido ninguno.
    await asegurarDek(TENANT_A, fakePrisma as never);
    const fila = llavero.filas.get(TENANT_A)!;
    const envueltaAntes = fila.dekWrapped;
    // El canario de otra DEK, con el AAD de este tenant: se descifra con
    // la otra y no con la de la fila.
    fila.canary = nuevoCanario(nuevaDek(), TENANT_A);

    const r = await rotarKek(
      {
        kekViejaBase64: KEK,
        kekNuevaBase64: randomBytes(32).toString("base64"),
        kekNuevaId: "kek-2",
      },
      fakePrisma as never,
    );
    expect(r.fallidas).toEqual([TENANT_A]);
    expect(r.reenvueltas).toEqual([]);
    // Y la fila NO se ha tocado: sigue con su KEK y su envoltura.
    expect(llavero.filas.get(TENANT_A)!.dekWrapped).toBe(envueltaAntes);
    expect(llavero.filas.get(TENANT_A)!.kekId).toBe("test");
  });

  it("una clave DESTRUIDA no se re-envuelve: no hay nada que envolver", async () => {
    await asegurarDek(TENANT_A, fakePrisma as never);
    await destruirDek(
      { tenantId: TENANT_A, motivo: "fin de contrato" },
      fakePrisma as never,
    );
    const r = await rotarKek(
      {
        kekViejaBase64: KEK,
        kekNuevaBase64: randomBytes(32).toString("base64"),
        kekNuevaId: "kek-2",
      },
      fakePrisma as never,
    );
    expect(r.destruidas).toEqual([TENANT_A]);
    expect(r.reenvueltas).toEqual([]);
  });
});

// ── 6 · EL CRYPTO-SHREDDING ─────────────────────────────────────────

describe("clinica-7 · borrar la DEK deja ilegible ESA clínica y no otra", () => {
  it("y es el sabotaje del prompt, entero", async () => {
    const dekA = await asegurarDek(TENANT_A, fakePrisma as never);
    const dekB = await asegurarDek(TENANT_B, fakePrisma as never);

    const sA = sitio(TENANT_A, "clinical_entries", "body", FILA_1);
    const sB = sitio(TENANT_B, "clinical_entries", "body", FILA_1);
    const historiaA = cifrarValor("La historia de Carmen", dekA, sA);
    const historiaB = cifrarValor("La historia de Lucía", dekB, sB);

    // Antes: las dos se leen.
    expect(descifrarValor(historiaA, dekA, sA)).toBe("La historia de Carmen");
    expect(descifrarValor(historiaB, dekB, sB)).toBe("La historia de Lucía");

    // Se destruye la de A.
    expect(
      await destruirDek(
        { tenantId: TENANT_A, motivo: "fin de contrato con la clínica" },
        fakePrisma as never,
      ),
    ).toBe(true);

    // A: NO HAY CLAVE. Ni en la base, ni en la caché, ni forma de
    // recuperarla. Y el sistema DICE que se destruyó, con su fecha: un
    // hueco no es una respuesta cuando la pregunta la hace un abogado.
    await expect(dekDe(TENANT_A, fakePrisma as never)).rejects.toThrow(
      ClaveDestruida,
    );
    const fila = llavero.filas.get(TENANT_A)!;
    expect(fila.dekWrapped).toBeNull();
    expect(fila.canary).toBeNull();
    expect(fila.destroyedAt).not.toBeNull();
    expect(fila.destroyedReason).toBe("fin de contrato con la clínica");

    // Y el ciphertext de A sigue ahí y NO SE PUEDE ABRIR con nada. Ni con
    // la DEK de B, que es lo único que queda.
    expect(() => descifrarValor(historiaA, dekB, sA)).toThrow(NoSeDescifra);

    // B SIGUE LEYÉNDOSE. Esto es la mitad que hace que el mecanismo sirva:
    // destruir los datos de una clínica no toca a las demás.
    olvidarClaves();
    const dekBOtraVez = await dekDe(TENANT_B, fakePrisma as never);
    expect(descifrarValor(historiaB, dekBOtraVez, sB)).toBe(
      "La historia de Lucía",
    );
  });

  it("destruir dos veces no pisa la fecha del primero", async () => {
    await asegurarDek(TENANT_A, fakePrisma as never);
    expect(
      await destruirDek({ tenantId: TENANT_A, motivo: "uno" }, fakePrisma as never),
    ).toBe(true);
    const fecha = llavero.filas.get(TENANT_A)!.destroyedAt;
    // El segundo intento no es un error: es alguien asegurándose.
    expect(
      await destruirDek({ tenantId: TENANT_A, motivo: "dos" }, fakePrisma as never),
    ).toBe(false);
    expect(llavero.filas.get(TENANT_A)!.destroyedAt).toBe(fecha);
    expect(llavero.filas.get(TENANT_A)!.destroyedReason).toBe("uno");
  });
});

// ── 7 · EL ARRANQUE ────────────────────────────────────────────────

describe("clinica-7 · la API no arranca si no puede leer lo que va a escribir", () => {
  it("SIN clínicas y sin KEK: arranca. Un bar no necesita una clave", async () => {
    clinicosEncendidos = [];
    conKek(null);
    const r = await revisarArranqueClinico();
    expect(r.puedeArrancar).toBe(true);
    expect(r.motivos).toEqual([]);
  });

  it("CON clínicas y SIN KEK: NO ARRANCA, y lo dice", async () => {
    conKek(null);
    const r = await revisarArranqueClinico();
    expect(r.puedeArrancar).toBe(false);
    expect(r.motivos.join(" ")).toContain("FALTA CLINICAL_KEK");
    // Y dice qué NO hacer, que es lo que importa a las tres de la mañana.
    expect(r.motivos.join(" ")).toContain("NO despliegues");
  });

  it("con el módulo apagado pero CON CLAVES en la base: tampoco arranca", async () => {
    // Es el caso que más fácil se escapa: a una clínica le apagaron el
    // módulo y sus datos cifrados siguen ahí. Sin la KEK no se pueden ni
    // exportar para devolvérselos, y la ley obliga a conservarlos.
    await asegurarDek(TENANT_A, fakePrisma as never);
    clinicosEncendidos = [];
    conKek(null);
    const r = await revisarArranqueClinico();
    expect(r.puedeArrancar).toBe(false);
  });

  it("CON la KEK buena: arranca y revisa todos los canarios", async () => {
    await asegurarDek(TENANT_A, fakePrisma as never);
    await asegurarDek(TENANT_B, fakePrisma as never);
    const r = await revisarArranqueClinico();
    expect(r.puedeArrancar).toBe(true);
    expect(r.clavesRevisadas).toBe(2);
    expect(r.clavesQueNoCuadran).toEqual([]);
  });

  it("CON OTRA KEK: NO ARRANCA, y nombra las clínicas que no cuadran", async () => {
    await asegurarDek(TENANT_A, fakePrisma as never);
    await asegurarDek(TENANT_B, fakePrisma as never);
    conKek(randomBytes(32).toString("base64"));
    const r = await revisarArranqueClinico();
    expect(r.puedeArrancar).toBe(false);
    expect(r.clavesQueNoCuadran.sort()).toEqual([TENANT_A, TENANT_B].sort());
    expect(r.motivos.join(" ")).toContain("NO se arranca");
  });

  it("una clínica DESTRUIDA no impide arrancar: su canario no tiene que cuadrar", async () => {
    await asegurarDek(TENANT_A, fakePrisma as never);
    await destruirDek({ tenantId: TENANT_A, motivo: "x" }, fakePrisma as never);
    const r = await revisarArranqueClinico();
    expect(r.puedeArrancar).toBe(true);
    const revisados = await revisarCanarios(fakePrisma as never);
    expect(revisados.find((x) => x.tenantId === TENANT_A)).toMatchObject({
      cuadra: true,
      destruida: true,
    });
  });
});

// ── 7bis · LAS TRES NOTAS COMPARTIDAS ───────────────────────────────
//
// El sabotaje #44 («las notas se guardan EN CLARO en un tenant clínico»)
// salió VERDE: lo cazaba el grep del `pg_dump` en el e2e y ni un test de
// unidad. El e2e es la garantía de verdad y tarda minutos; esto tarda
// milisegundos y dice exactamente qué se rompió.

describe("clinica-7 · las notas de un tenant clínico van cifradas", () => {
  beforeEach(() => {
    olvidarSiEsClinico();
  });

  it("en un tenant CLÍNICO: solo la cifrada, y el claro a null", async () => {
    const nota = await notaParaGuardar(
      {
        tenantId: TENANT_A,
        id: FILA_1,
        que: "CITA",
        texto: "viene por lo del dedo infectado",
      },
      fakePrisma as never,
    );
    expect(nota.claro).toBeNull();
    expect(nota.cifrado).toMatch(/^c1:/);

    // Y se lee de vuelta con la clave de su clínica.
    const dek = await dekDe(TENANT_A, fakePrisma as never);
    expect(
      leerNota(
        {
          tenantId: TENANT_A,
          id: FILA_1,
          que: "CITA",
          claro: nota.claro,
          cifrado: nota.cifrado,
        },
        dek,
      ),
    ).toBe("viene por lo del dedo infectado");
  });

  it("en un tenant QUE NO ES CLÍNICO: solo el claro, como siempre", async () => {
    // «No le gusta el secador» no es un dato de salud, y cifrarlo le
    // quitaría a la peluquería la búsqueda por nota sin comprar nada.
    clinicosEncendidos = [];
    olvidarSiEsClinico();
    const nota = await notaParaGuardar(
      {
        tenantId: TENANT_A,
        id: FILA_1,
        que: "FICHA",
        texto: "no le gusta el secador",
      },
      fakePrisma as never,
    );
    expect(nota.claro).toBe("no le gusta el secador");
    expect(nota.cifrado).toBeNull();
  });

  it("una nota vacía no se cifra: ciphertext que no dice nada", async () => {
    for (const texto of [null, undefined, "", "   "]) {
      const nota = await notaParaGuardar(
        { tenantId: TENANT_A, id: FILA_1, que: "FICHA", texto },
        fakePrisma as never,
      );
      expect(nota).toEqual({ claro: null, cifrado: null });
    }
  });

  it("y el AAD de cada nota es el de SU tabla: no son intercambiables", async () => {
    const dek = await asegurarDek(TENANT_A, fakePrisma as never);
    const deLaCita = await notaParaGuardar(
      { tenantId: TENANT_A, id: FILA_1, que: "CITA", texto: "secreto" },
      fakePrisma as never,
    );
    // La misma fila, la misma clínica, pero OTRA tabla: no se descifra, y
    // lo que sale es el hueco marcado.
    expect(
      leerNota(
        {
          tenantId: TENANT_A,
          id: FILA_1,
          que: "FICHA",
          claro: null,
          cifrado: deLaCita.cifrado,
        },
        dek,
      ),
    ).toBe("(este dato no se puede leer)");
  });
});

// ── 8 · NI LA KEK NI LA DEK SALEN POR NINGÚN SITIO ─────────────────

describe("clinica-7 · ni la KEK ni ninguna DEK se escriben en ningún sitio", () => {
  it("el módulo del llavero no exporta nada que devuelva la KEK", async () => {
    const claves = await import("../src/clinica/claves.js");
    // `hayKek` contesta sí o no; no hay `kekDe()` ni nada que la devuelva.
    expect(typeof claves.hayKek).toBe("function");
    expect(claves.hayKek()).toBe(true);
    for (const nombre of Object.keys(claves)) {
      expect(nombre.toLowerCase()).not.toBe("kek");
      expect(nombre.toLowerCase()).not.toBe("getkek");
    }
  });

  it("el error de «sin clave» no lleva la KEK dentro", async () => {
    conKek(null);
    try {
      await dekDe(TENANT_A, fakePrisma as never);
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain(KEK);
    }
  });

  it("el veredicto del arranque no lleva ninguna clave", async () => {
    await asegurarDek(TENANT_A, fakePrisma as never);
    conKek(randomBytes(32).toString("base64"));
    const r = await revisarArranqueClinico();
    const texto = JSON.stringify(r);
    expect(texto).not.toContain(process.env.CLINICAL_KEK);
    expect(texto).not.toContain(KEK);
    const envuelta = llavero.filas.get(TENANT_A)!.dekWrapped!;
    expect(texto).not.toContain(envuelta);
  });
});
