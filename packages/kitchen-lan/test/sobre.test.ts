// kds-2-wifi · el contrato del sobre, y el vector congelado.
//
// `vector.json` es el MISMO fichero que lee el test de Java
// (`KitchenLanProtocolTest`). Los dos lados abren ese sobre con esa clave
// y tienen que sacar el mismo cuerpo. Es la única prueba posible de que la
// cabecera canónica, el base64url y los parámetros de AES-GCM son
// idénticos en el WebView y en la pieza nativa: si alguien cambia el
// separador de la cabecera en TypeScript, el vector deja de abrirse y los
// dos tests se ponen rojos a la vez.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  aBase64Url,
  abrirSobre,
  cabeceraCanonica,
  cerrarSobre,
  deBase64Url,
  EDAD_MAXIMA_MS,
  generarClaveTienda,
  MemoriaDeOperaciones,
  PUERTO_LAN_POR_DEFECTO,
  SOBRE_VERSION,
  type SobreLan,
} from "../src/index.js";

const VECTOR = JSON.parse(
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "vector.json"),
    "utf8",
  ),
) as { clave: string; sobre: SobreLan; payload: unknown };

const AHORA = Date.parse(VECTOR.sobre.sentAt);
const TIENDA = VECTOR.sobre.storeId;

describe("kds-2 · el vector congelado", () => {
  it("se abre con la clave de la tienda y sale el cuerpo exacto", async () => {
    const r = await abrirSobre(VECTOR.sobre, {
      clave: VECTOR.clave,
      storeId: TIENDA,
      ahora: AHORA,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload).toEqual(VECTOR.payload);
  });

  it("y re-cifrarlo da el MISMO `ct` byte a byte", async () => {
    // Descifrar sólo prueba que el AAD y la etiqueta cuadran; re-cifrar
    // prueba además que el ORDEN de los campos de la cabecera es idéntico,
    // que es justo lo que alguien podría cambiar sin darse cuenta. El test
    // de Java hace esta misma comprobación sobre el mismo vector.
    const r = await abrirSobre(VECTOR.sobre, {
      clave: VECTOR.clave,
      storeId: TIENDA,
      ahora: AHORA,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { ct: _ct, ...cabecera } = VECTOR.sobre;
    const clave = await crypto.subtle.importKey(
      "raw",
      deBase64Url(VECTOR.clave),
      { name: "AES-GCM" },
      false,
      ["encrypt"],
    );
    const reCt = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: deBase64Url(VECTOR.sobre.nonce),
        additionalData: new TextEncoder().encode(cabeceraCanonica(cabecera)),
        tagLength: 128,
      },
      clave,
      new TextEncoder().encode(JSON.stringify(r.payload)),
    );
    expect(aBase64Url(new Uint8Array(reCt))).toBe(VECTOR.sobre.ct);
  });

  it("la cabecera canónica son siete campos separados por saltos de línea", () => {
    const { ct: _ct, ...cabecera } = VECTOR.sobre;
    const texto = cabeceraCanonica(cabecera);
    expect(texto.split("\n")).toEqual([
      "1",
      VECTOR.sobre.storeId,
      VECTOR.sobre.deviceId,
      "COMANDA",
      VECTOR.sobre.opId,
      VECTOR.sobre.sentAt,
      VECTOR.sobre.nonce,
    ]);
  });
});

describe("kds-2 · ida y vuelta", () => {
  it("lo que se cierra se abre", async () => {
    const clave = generarClaveTienda();
    const sobre = await cerrarSobre({
      clave,
      storeId: TIENDA,
      deviceId: VECTOR.sobre.deviceId,
      kind: "PRUEBA",
      opId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ahora: AHORA,
      payload: { hola: "cocina" },
    });
    expect(sobre.v).toBe(SOBRE_VERSION);
    const r = await abrirSobre<{ hola: string }>(sobre, {
      clave,
      storeId: TIENDA,
      ahora: AHORA,
    });
    expect(r.ok && r.payload.hola).toBe("cocina");
  });

  it("dos sobres iguales no llevan el mismo nonce", async () => {
    const clave = generarClaveTienda();
    const uno = await cerrarSobre({
      clave,
      storeId: TIENDA,
      deviceId: VECTOR.sobre.deviceId,
      kind: "SONDEO",
      opId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      ahora: AHORA,
      payload: {},
    });
    const dos = await cerrarSobre({
      clave,
      storeId: TIENDA,
      deviceId: VECTOR.sobre.deviceId,
      kind: "SONDEO",
      opId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      ahora: AHORA,
      payload: {},
    });
    expect(uno.nonce).not.toBe(dos.nonce);
    expect(uno.ct).not.toBe(dos.ct);
  });

  it("la clave de tienda son 32 bytes", () => {
    expect(generarClaveTienda()).toHaveLength(43);
  });
});

describe("kds-2 · SABOTAJE · lo que el que recibe tiene que rechazar", () => {
  it("un cuerpo sin firma (ct tocado) → FIRMA", async () => {
    const roto = {
      ...VECTOR.sobre,
      ct: `A${VECTOR.sobre.ct.slice(1)}`,
    };
    const r = await abrirSobre(roto, {
      clave: VECTOR.clave,
      storeId: TIENDA,
      ahora: AHORA,
    });
    expect(r).toEqual({ ok: false, motivo: "FIRMA" });
  });

  it("la clave de OTRA tienda → FIRMA, y no se descifra nada", async () => {
    const r = await abrirSobre(VECTOR.sobre, {
      clave: generarClaveTienda(),
      storeId: TIENDA,
      ahora: AHORA,
    });
    expect(r).toEqual({ ok: false, motivo: "FIRMA" });
  });

  it("un sobre de otra tienda → OTRA_TIENDA, antes de tocar la clave", async () => {
    const r = await abrirSobre(VECTOR.sobre, {
      clave: VECTOR.clave,
      storeId: "99999999-9999-4999-8999-999999999999",
      ahora: AHORA,
    });
    expect(r).toEqual({ ok: false, motivo: "OTRA_TIENDA" });
  });

  it("firmado hace 10 min → VIEJO", async () => {
    const r = await abrirSobre(VECTOR.sobre, {
      clave: VECTOR.clave,
      storeId: TIENDA,
      ahora: AHORA + 10 * 60_000,
    });
    expect(r).toEqual({ ok: false, motivo: "VIEJO" });
  });

  it("y el filo de la ventana es simétrico: también se rechaza el del futuro", async () => {
    const dentro = await abrirSobre(VECTOR.sobre, {
      clave: VECTOR.clave,
      storeId: TIENDA,
      ahora: AHORA + EDAD_MAXIMA_MS - 1,
    });
    expect(dentro.ok).toBe(true);
    const fuera = await abrirSobre(VECTOR.sobre, {
      clave: VECTOR.clave,
      storeId: TIENDA,
      ahora: AHORA - EDAD_MAXIMA_MS - 1,
    });
    expect(fuera).toEqual({ ok: false, motivo: "VIEJO" });
  });

  it("otra versión del sobre → VERSION, no FIRMA", async () => {
    const r = await abrirSobre(
      { ...VECTOR.sobre, v: SOBRE_VERSION + 1 },
      { clave: VECTOR.clave, storeId: TIENDA, ahora: AHORA },
    );
    expect(r).toEqual({ ok: false, motivo: "VERSION" });
  });

  it("el mismo opId dos veces → REPETIDO (es el descarte del doble camino)", async () => {
    const memoria = new MemoriaDeOperaciones();
    const abrir = () =>
      abrirSobre(VECTOR.sobre, {
        clave: VECTOR.clave,
        storeId: TIENDA,
        ahora: AHORA,
        yaVisto: memoria.yaVisto,
      });
    expect((await abrir()).ok).toBe(true);
    memoria.apuntar(VECTOR.sobre.opId);
    expect(await abrir()).toEqual({ ok: false, motivo: "REPETIDO" });
  });

  it("un JSON que no es un sobre → MALFORMADO, sin lanzar", async () => {
    for (const basura of [null, 42, "hola", {}, { v: 1 }]) {
      const r = await abrirSobre(basura, {
        clave: VECTOR.clave,
        storeId: TIENDA,
        ahora: AHORA,
      });
      expect(r).toEqual({ ok: false, motivo: "MALFORMADO" });
    }
  });
});

describe("kds-2 · la memoria de operaciones está acotada", () => {
  it("olvida la más antigua al pasar del techo", () => {
    const m = new MemoriaDeOperaciones(3);
    m.apuntar("a");
    m.apuntar("b");
    m.apuntar("c");
    m.apuntar("d");
    expect(m.tamano).toBe(3);
    expect(m.yaVisto("a")).toBe(false);
    expect(m.yaVisto("d")).toBe(true);
  });

  it("apuntar dos veces lo mismo no gasta dos huecos", () => {
    const m = new MemoriaDeOperaciones(3);
    m.apuntar("a");
    m.apuntar("a");
    expect(m.tamano).toBe(1);
  });
});

describe("kds-2 · los números decididos sin preguntar", () => {
  it("puerto 8787 y ventana de 60 s", () => {
    expect(PUERTO_LAN_POR_DEFECTO).toBe(8787);
    expect(EDAD_MAXIMA_MS).toBe(60_000);
  });
});
