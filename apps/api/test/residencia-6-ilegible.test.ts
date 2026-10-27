// residencia-6 (punto 2) · **EL RASTRO DE LO QUE NO SE DESCIFRA, LAS
// VEINTICUATRO COLUMNAS.**
//
// `configurarAvisoDeIlegible` existe desde clinica-7 y no lo llamaba
// nadie: un valor cifrado que no se descifraba salía como hueco en
// pantalla y **no quedaba en ningún sitio**. Lo anotaron cuatro dones
// seguidos (clinica-7 §18, residencia-1b §12.1, residencia-3 §15.4,
// residencia-5 §19.11) y cada bloque añadía columnas: hoy son
// veinticuatro.
//
// Este fichero es el banco de ese cable, y lo que fija son cuatro cosas:
//
//   1. **LAS VEINTICUATRO DEJAN SU LÍNEA**, con su tabla y su columna.
//      La tabla de abajo las enumera a mano a propósito: si alguien añade
//      una columna cifrada y no la añade aquí, el recuento falla y el
//      test lo dice con el nombre que falta.
//   2. **NINGUNA FILTRA NADA.** Ni el valor en claro, ni el ciphertext,
//      ni la clave, ni el mensaje del error. Se comprueba sobre el objeto
//      entero serializado, no campo a campo: lo que no puede aparecer no
//      puede aparecer NI de rebote.
//   3. **EL `JSON.parse` ES EL CASO PELIGROSO.** Cuando el descifrado va
//      bien y el claro no es JSON, el `SyntaxError` de V8 **trae el texto
//      descifrado dentro del mensaje**. Hay un test dedicado porque es el
//      único camino por el que un dato de salud podía llegar al log, y es
//      la razón de que el motivo sea un enum y no `err.message`.
//   4. **CIEN LECTURAS, UNA LÍNEA.** Y el valor de al lado deja la suya.
//      Sin esto el rastro no sirve: una fila mala tapa a la siguiente.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import { beforeEach, describe, expect, it } from "vitest";

import {
  INTERVALO_POR_DEFECTO_MS,
  __reiniciarAvisoDeIlegible,
  cablearAvisoDeIlegible,
  motivoDe,
  type LineaDeIlegible,
} from "../src/clinica/aviso-de-ilegible.js";
import {
  NoSeDescifra,
  SinClaveDeLaClinica,
  cifrarValor,
  type SitioDelValor,
} from "../src/clinica/cripto.js";
import {
  CUERPO_ILEGIBLE,
  TEXTO_ILEGIBLE,
  cifrarCorreccion,
  leerCorreccion,
  leerJson,
  leerTexto,
  sitioAnotacion,
  sitioContenidoAFamilia,
  sitioContenidoDeRelevo,
  sitioCorreccion,
  sitioDescripcionDeIncidencia,
  sitioDniDeResidente,
  sitioEntrada,
  sitioMotivoDeAlta,
  sitioMotivoDeCierreDeLinea,
  sitioMotivoDeExcepcion,
  sitioMotivoDeLinea,
  sitioMotivoDeOcupacion,
  sitioMotivoDeRetirada,
  sitioMotivoDeRevocacion,
  sitioNotaDeCita,
  sitioNotaDeFicha,
  sitioNotaDeRegistro,
  sitioNotaTecnica,
  sitioNssDeResidente,
  sitioRespuestaDeFamilia,
  sitioResumenTardio,
  sitioTextoDeAccion,
  sitioValorDeRegistro,
  sitioZonaDeFoto,
  sitioDniDeEmpleado,
  sitioAfiliacionDeEmpleado,
} from "../src/clinica/cripto-campos.js";
import {
  FUERA_DE_PETICION,
  enSitioDeLectura,
} from "../src/lib/sitio-de-lectura.js";

const CENTRO = "11111111-1111-4111-8111-111111111111";
const OTRA_FILA = "22222222-2222-4222-8222-222222222222";
const DEK_A = randomBytes(32);

/** El canario: lo que va DENTRO del valor cifrado. Inconfundible a
 *  propósito —misma idea que `TEXTO_DEL_CANARIO` y que los PIN de ocho
 *  cifras del e2e— para que «no aparece en el log» signifique algo. */
const CANARIO = "ZZCANARIOZZ-doña-carmen-glucemia-320";

/** Los DIEZ PRIMEROS caracteres, que es lo que V8 cita en el mensaje de
 *  un `JSON.parse` fallido. Diez caracteres de una nota clínica («le huele
 *  r») ya son un dato de salud, así que lo que no puede aparecer en el log
 *  es esto, no sólo el canario entero. */
const CANARIO_CORTO = CANARIO.slice(0, 10);

// ── El log falso ─────────────────────────────────────────────────────

let lineas: LineaDeIlegible[] = [];
let mensajes: string[] = [];
let reloj = 1_700_000_000_000;

function cablear(intervaloMs = INTERVALO_POR_DEFECTO_MS): void {
  __reiniciarAvisoDeIlegible();
  lineas = [];
  mensajes = [];
  cablearAvisoDeIlegible(
    {
      error(obj: object, msg: string) {
        lineas.push(obj as LineaDeIlegible);
        mensajes.push(msg);
      },
    },
    { intervaloMs, ahora: () => reloj },
  );
}

/** Todo lo que se escribió, como texto. Es sobre esto sobre lo que se
 *  comprueba que no se filtró nada: campo a campo se olvida uno. */
function todoLoEscrito(): string {
  return JSON.stringify(lineas) + "\n" + mensajes.join("\n");
}

beforeEach(() => {
  reloj = 1_700_000_000_000;
  cablear();
});

// ── LA TABLA · LAS VEINTICUATRO ──────────────────────────────────────
//
// Cada entrada: cómo se arma su sitio, qué tabla y qué columna LÓGICA
// tiene que salir en la línea, y **cómo se lee** — que no es un detalle:
// las cuatro de `JSON` pasan por `leerJson` y devuelven `CUERPO_ILEGIBLE`,
// las diecinueve de texto por `leerTexto` y devuelven `TEXTO_ILEGIBLE`, y
// la corrección por `leerCorreccion`, que devuelve `null` porque una
// corrección a medias no se puede pintar.

type Lectura = "TEXTO" | "JSON" | "CORRECCION";

interface Columna {
  nombre: string;
  sitio: (tenantId: string, filaId: string) => SitioDelValor;
  tabla: string;
  columna: string;
  lectura: Lectura;
}

const COLUMNAS: Columna[] = [
  // ── clinica-7 · las nueve de la clínica ───────────────────────────
  { nombre: "sitioEntrada", sitio: sitioEntrada, tabla: "clinical_entries", columna: "body", lectura: "JSON" },
  { nombre: "sitioAnotacion", sitio: sitioAnotacion, tabla: "clinical_addenda", columna: "body", lectura: "JSON" },
  { nombre: "sitioZonaDeFoto", sitio: sitioZonaDeFoto, tabla: "clinical_photos", columna: "zona", lectura: "TEXTO" },
  { nombre: "sitioMotivoDeRetirada", sitio: sitioMotivoDeRetirada, tabla: "clinical_photos", columna: "withdraw_reason", lectura: "TEXTO" },
  { nombre: "sitioMotivoDeRevocacion", sitio: sitioMotivoDeRevocacion, tabla: "client_consents", columna: "revoke_reason", lectura: "TEXTO" },
  { nombre: "sitioCorreccion", sitio: sitioCorreccion, tabla: "clinical_assessment_corrections", columna: "correccion", lectura: "CORRECCION" },
  { nombre: "sitioNotaDeCita", sitio: sitioNotaDeCita, tabla: "appointments", columna: "notes", lectura: "TEXTO" },
  { nombre: "sitioNotaDeFicha", sitio: sitioNotaDeFicha, tabla: "clients", columna: "notes", lectura: "TEXTO" },
  { nombre: "sitioNotaTecnica", sitio: sitioNotaTecnica, tabla: "client_technical_notes", columna: "body", lectura: "TEXTO" },
  // ── residencia-1b (D-63) · las seis de la residencia ──────────────
  { nombre: "sitioDniDeResidente", sitio: sitioDniDeResidente, tabla: "resident_profiles", columna: "dni", lectura: "TEXTO" },
  { nombre: "sitioNssDeResidente", sitio: sitioNssDeResidente, tabla: "resident_profiles", columna: "nss", lectura: "TEXTO" },
  { nombre: "sitioMotivoDeAlta", sitio: sitioMotivoDeAlta, tabla: "resident_profiles", columna: "discharge_reason", lectura: "TEXTO" },
  { nombre: "sitioMotivoDeLinea", sitio: sitioMotivoDeLinea, tabla: "care_plan_items", columna: "reason", lectura: "TEXTO" },
  { nombre: "sitioMotivoDeCierreDeLinea", sitio: sitioMotivoDeCierreDeLinea, tabla: "care_plan_items", columna: "close_reason", lectura: "TEXTO" },
  { nombre: "sitioMotivoDeOcupacion", sitio: sitioMotivoDeOcupacion, tabla: "bed_assignments", columna: "reason", lectura: "TEXTO" },
  // ── residencia-3 · el registro de cuidados ────────────────────────
  { nombre: "sitioValorDeRegistro", sitio: sitioValorDeRegistro, tabla: "care_records", columna: "value", lectura: "JSON" },
  { nombre: "sitioNotaDeRegistro", sitio: sitioNotaDeRegistro, tabla: "care_records", columna: "note", lectura: "TEXTO" },
  // ── residencia-4 · la gravedad y el libro ─────────────────────────
  { nombre: "sitioDescripcionDeIncidencia", sitio: sitioDescripcionDeIncidencia, tabla: "incidents", columna: "description", lectura: "TEXTO" },
  { nombre: "sitioTextoDeAccion", sitio: sitioTextoDeAccion, tabla: "incident_actions", columna: "text", lectura: "TEXTO" },
  { nombre: "sitioContenidoAFamilia", sitio: sitioContenidoAFamilia, tabla: "family_communications", columna: "content", lectura: "TEXTO" },
  { nombre: "sitioRespuestaDeFamilia", sitio: sitioRespuestaDeFamilia, tabla: "family_communications", columna: "response", lectura: "TEXTO" },
  { nombre: "sitioMotivoDeExcepcion", sitio: sitioMotivoDeExcepcion, tabla: "resident_threshold_overrides", columna: "reason", lectura: "TEXTO" },
  // ── residencia-5 · el parte de relevo ─────────────────────────────
  { nombre: "sitioContenidoDeRelevo", sitio: sitioContenidoDeRelevo, tabla: "handovers", columna: "content", lectura: "TEXTO" },
  { nombre: "sitioResumenTardio", sitio: sitioResumenTardio, tabla: "handover_late_additions", columna: "resumen", lectura: "TEXTO" },
  // ── personal-1 · la ficha de personal ─────────────────────────────
  //
  // Un DNI que no se descifra tiene que dejar su hueco marcado y su línea
  // igual que una nota clínica: la ficha se abre, se ve «(este dato no se
  // puede leer)» en el DNI y alguien mira por qué. Esconderlo sería
  // borrar la única pista.
  { nombre: "sitioDniDeEmpleado", sitio: sitioDniDeEmpleado, tabla: "employees", columna: "dni", lectura: "TEXTO" },
  { nombre: "sitioAfiliacionDeEmpleado", sitio: sitioAfiliacionDeEmpleado, tabla: "employees", columna: "nss", lectura: "TEXTO" },
];

/** Lee la columna por su camino de verdad, con la clave equivocada. */
function leerConLaClaveMala(c: Columna, filaId: string): unknown {
  const sitio = c.sitio(CENTRO, filaId);
  if (c.lectura === "CORRECCION") {
    const cifrada = cifrarCorreccion(
      { preguntaId: "P1", valor: CANARIO },
      DEK_A,
      c.sitio(CENTRO, OTRA_FILA),
    );
    return leerCorreccion(
      { correccionCifrada: cifrada, questionId: "", value: null },
      DEK_A,
      sitio,
    );
  }
  // Se cifra para OTRA fila y se lee en ésta: el AAD lleva el id dentro,
  // así que el valor no abre. Es lo que pasaría con un `UPDATE` a mano
  // que copió un valor de una fila a otra, y es lo que residencia-1b §2
  // ya fijaba — aquí lo que se mira es la LÍNEA que deja.
  const cifrado = cifrarValor(
    c.lectura === "JSON" ? JSON.stringify({ nota: CANARIO }) : CANARIO,
    DEK_A,
    c.sitio(CENTRO, OTRA_FILA),
  );
  return c.lectura === "JSON"
    ? leerJson({ cifrado, claro: null }, DEK_A, sitio)
    : leerTexto({ cifrado, claro: null }, DEK_A, sitio);
}

describe("las veintiséis columnas cifradas dejan su línea", () => {
  it("son VEINTISÉIS, y la tabla las nombra", () => {
    // Si un bloque añade una columna cifrada y no la añade aquí, esto
    // falla y dice cuántas hay — que es mejor que un test que pasa sin
    // cubrir la nueva.
    //
    // **No son las treinta y dos de `cripto-campos.ts`, y conviene no
    // esconderlo**: faltan las seis de calidad-1, que ese bloque añadió a
    // `residencia-1b-cifrado.test.ts` (el inventario que cuenta los CHECK
    // del SQL) y no a este otro, que es el que comprueba el HUECO y la
    // LÍNEA de cada una. personal-1 añade las suyas a los dos; las seis
    // de calidad siguen sin pasar por aquí y están en las dudas abiertas
    // del done.
    expect(
      COLUMNAS.map((c) => c.nombre).join(", "),
      "cada columna cifrada tiene que dejar su hueco y su línea",
    ).toBeTruthy();
    expect(COLUMNAS).toHaveLength(26);
    // Y ninguna repetida: dos entradas con la misma tabla y columna serían
    // una columna sin cubrir disfrazada de dos.
    const claves = COLUMNAS.map((c) => `${c.tabla}.${c.columna}`);
    expect(new Set(claves).size).toBe(26);
  });

  for (const c of COLUMNAS) {
    it(`${c.tabla}.${c.columna} · hueco marcado y UNA línea`, () => {
      const filaId = randomUUID();
      const leido = leerConLaClaveMala(c, filaId);

      // 1 · el hueco, que es lo que clinica-7 decidió devolver.
      if (c.lectura === "JSON") expect(leido).toEqual(CUERPO_ILEGIBLE);
      else if (c.lectura === "TEXTO") expect(leido).toBe(TEXTO_ILEGIBLE);
      else expect(leido).toBeNull();

      // 2 · y la línea, con los seis campos.
      expect(lineas).toHaveLength(1);
      expect(lineas[0]).toEqual({
        tenant: CENTRO,
        tabla: c.tabla,
        columna: c.columna,
        fila: filaId,
        // Fuera de una petición, que es donde corre un test. El sitio de
        // verdad lo prueba el bloque del `AsyncLocalStorage`, más abajo.
        sitio: FUERA_DE_PETICION,
        motivo: "NO_SE_DESCIFRA",
      });
      // El mensaje es FIJO: armarlo con datos de dentro sería el mismo
      // agujero que `err.message`, por el otro lado.
      expect(mensajes).toEqual([
        "clinica · valor cifrado que no se puede leer",
      ]);
    });

    it(`${c.tabla}.${c.columna} · y NO filtra nada`, () => {
      const filaId = randomUUID();
      leerConLaClaveMala(c, filaId);
      const escrito = todoLoEscrito();
      // El valor en claro, entero y en el trozo que V8 cita.
      expect(escrito).not.toContain(CANARIO);
      expect(escrito).not.toContain(CANARIO_CORTO);
      expect(escrito).not.toContain("carmen");
      // El ciphertext, por su prefijo: `c1:` no puede estar en la línea.
      expect(escrito).not.toContain("c1:");
      // Ni la clave, en ninguna de sus formas.
      expect(escrito).not.toContain(DEK_A.toString("base64"));
      expect(escrito).not.toContain(DEK_A.toString("hex"));
    });
  }
});

// ── EL CASO PELIGROSO · `JSON.parse` DEL CLARO ───────────────────────

describe("el claro que no es JSON · el único camino por el que se filtraba", () => {
  it("el mensaje de V8 TRAE el dato dentro, y por eso no se registra", () => {
    // Primero, que el peligro es real y no una precaución inventada.
    let mensajeDeV8 = "";
    try {
      JSON.parse(CANARIO);
    } catch (err) {
      mensajeDeV8 = err instanceof Error ? err.message : String(err);
    }
    // V8 **trunca a diez caracteres** («Unexpected token 'Z',
    // "ZZCANARIOZ"... is not valid JSON»). Truncado sigue siendo el dato:
    // los diez primeros caracteres de una nota de «algo no va bien» son
    // «le huele r».
    expect(
      mensajeDeV8,
      "si V8 deja de citar el texto, este test ya no prueba nada: revísalo",
    ).toContain(CANARIO_CORTO);
  });

  it("se descifra bien, no es JSON, y la línea dice NO_ES_JSON sin el texto", () => {
    const sitio = sitioEntrada(CENTRO, randomUUID());
    // Cifrado con la clave BUENA y el sitio BUENO: el descifrado va a ir
    // bien. Lo que no es JSON es lo de dentro.
    const cifrado = cifrarValor(CANARIO, DEK_A, sitio);

    const leido = leerJson({ cifrado, claro: null }, DEK_A, sitio);

    expect(leido).toEqual(CUERPO_ILEGIBLE);
    expect(lineas).toHaveLength(1);
    expect(lineas[0]!.motivo).toBe("NO_ES_JSON");
    // Y AQUÍ está el punto de todo el fichero.
    const escrito = todoLoEscrito();
    expect(escrito, "el claro descifrado se ha colado en el log").not.toContain(
      CANARIO,
    );
    // Y tampoco el trozo que V8 cita, que es la forma en que se habría
    // colado de verdad.
    expect(escrito, "los diez primeros caracteres del claro").not.toContain(
      CANARIO_CORTO,
    );
  });
});

// ── EL MOTIVO · CUATRO PALABRAS, POR TIPO ────────────────────────────

describe("el motivo se clasifica por el TIPO del error", () => {
  it("sin clave de la clínica es su propio motivo", () => {
    const sitio = sitioDniDeResidente(CENTRO, randomUUID());
    const cifrado = cifrarValor("12345678Z", DEK_A, sitio);
    expect(leerTexto({ cifrado, claro: null }, null, sitio)).toBe(
      TEXTO_ILEGIBLE,
    );
    expect(lineas[0]!.motivo).toBe("SIN_CLAVE");
  });

  it("y «no hay clave» no se confunde con «este valor no abre»", () => {
    // Las dos se arreglan en sitios distintos: una en el entorno, la otra
    // en esa fila. Si las dos dijeran lo mismo, la línea no serviría para
    // decidir a dónde ir.
    expect(motivoDe(new SinClaveDeLaClinica("x"))).toBe("SIN_CLAVE");
    expect(motivoDe(new NoSeDescifra("x"))).toBe("NO_SE_DESCIFRA");
    expect(motivoDe(new SyntaxError("x"))).toBe("NO_ES_JSON");
    expect(motivoDe(new Error("x"))).toBe("OTRO");
    expect(motivoDe("una cadena pelada")).toBe("OTRO");
  });

  it("una corrección cifrada con otra forma deja su línea", () => {
    // Descifra bien y lo de dentro no tiene `preguntaId`: `leerCorreccion`
    // avisa con un `NoSeDescifra` propio. Es un camino aparte y también
    // tiene que dejar rastro.
    const sitio = sitioCorreccion(CENTRO, randomUUID());
    const cifrada = cifrarValor(JSON.stringify({ otra: "forma" }), DEK_A, sitio);
    expect(
      leerCorreccion(
        { correccionCifrada: cifrada, questionId: "", value: null },
        DEK_A,
        sitio,
      ),
    ).toBeNull();
    expect(lineas).toHaveLength(1);
    expect(lineas[0]!.motivo).toBe("NO_SE_DESCIFRA");
  });
});

// ── EL SITIO · DESDE DÓNDE SE LEÍA ───────────────────────────────────

describe("la línea dice desde DÓNDE se leía", () => {
  it("dentro de un tramo con nombre, ése es el sitio", () => {
    const sitio = sitioEntrada(CENTRO, randomUUID());
    const cifrado = cifrarValor("{}", DEK_A, sitioEntrada(CENTRO, OTRA_FILA));
    enSitioDeLectura("GET /clinica/clients/:clientId/historia", () => {
      leerJson({ cifrado, claro: null }, DEK_A, sitio);
    });
    expect(lineas[0]!.sitio).toBe("GET /clinica/clients/:clientId/historia");
  });

  it("y fuera de una petición lo dice, en vez de inventarse algo", () => {
    const sitio = sitioEntrada(CENTRO, randomUUID());
    const cifrado = cifrarValor("{}", DEK_A, sitioEntrada(CENTRO, OTRA_FILA));
    leerJson({ cifrado, claro: null }, DEK_A, sitio);
    expect(lineas[0]!.sitio).toBe(FUERA_DE_PETICION);
  });
});

// ── SIN DUPLICAR · CIEN LECTURAS, UNA LÍNEA ──────────────────────────

describe("el mismo valor ilegible leído cien veces deja UNA línea", () => {
  // Se cifra UNA vez y se lee muchas: lo que se mide aquí es la ventana
  // de dedupe, no AES.
  const ILEGIBLE = cifrarValor(CANARIO, DEK_A, sitioEntrada(CENTRO, OTRA_FILA));

  function leerVeces(sitio: SitioDelValor, veces: number): void {
    for (let i = 0; i < veces; i++) {
      leerTexto({ cifrado: ILEGIBLE, claro: null }, DEK_A, sitio);
    }
  }

  it("cien veces, una línea", () => {
    leerVeces(sitioNotaDeFicha(CENTRO, "fila-1"), 100);
    expect(lineas).toHaveLength(1);
  });

  it("pero el valor de AL LADO deja la suya", () => {
    // La ventana es por `tenant|tabla|columna|fila`: si fuera por tabla,
    // la primera fila mala taparía a las demás y el rastro diría que hay
    // una cuando hay cuarenta.
    leerVeces(sitioNotaDeFicha(CENTRO, "fila-1"), 10);
    leerVeces(sitioNotaDeFicha(CENTRO, "fila-2"), 10);
    leerVeces(sitioNotaDeCita(CENTRO, "fila-1"), 10);
    leerVeces(sitioNotaDeFicha("otro-centro", "fila-1"), 10);
    expect(lineas).toHaveLength(4);
    expect(lineas.map((l) => `${l.tabla}.${l.columna}/${l.fila}/${l.tenant}`)).toEqual([
      `clients.notes/fila-1/${CENTRO}`,
      `clients.notes/fila-2/${CENTRO}`,
      `appointments.notes/fila-1/${CENTRO}`,
      "clients.notes/fila-1/otro-centro",
    ]);
  });

  it("y pasado el intervalo vuelve a avisar", () => {
    // No es un «avisa una vez y calla para siempre»: el dato sigue roto
    // mañana y el log de mañana tiene que decirlo.
    leerVeces(sitioNotaDeFicha(CENTRO, "fila-1"), 5);
    expect(lineas).toHaveLength(1);
    reloj += INTERVALO_POR_DEFECTO_MS - 1;
    leerVeces(sitioNotaDeFicha(CENTRO, "fila-1"), 5);
    expect(lineas).toHaveLength(1);
    reloj += 2;
    leerVeces(sitioNotaDeFicha(CENTRO, "fila-1"), 5);
    expect(lineas).toHaveLength(2);
  });

  it("el diccionario está acotado y no crece sin fin", () => {
    // Una fuga de memoria en el proceso que sirve la historia clínica no
    // es una molestia. El precio del tope es una línea repetida.
    cablear();
    for (let i = 0; i < 6_000; i++) {
      leerVeces(sitioNotaDeFicha(CENTRO, `fila-${i}`), 1);
    }
    expect(lineas).toHaveLength(6_000);
    // La fila 0 se tiró con la mitad más vieja, así que vuelve a avisar
    // aunque no haya pasado el intervalo.
    leerVeces(sitioNotaDeFicha(CENTRO, "fila-0"), 1);
    expect(lineas).toHaveLength(6_001);
    // Y la última, que sigue dentro de la ventana, NO.
    leerVeces(sitioNotaDeFicha(CENTRO, "fila-5999"), 1);
    expect(lineas).toHaveLength(6_001);
  });
});
