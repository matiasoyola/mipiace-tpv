// kds-2-wifi · «PROBAR CONEXIÓN DIRECTA CON COCINA».
//
// Un botón en el TPV que manda un mensaje firmado por la wifi y dice, **en
// palabras**, si llega, cuánto tarda y, si no llega, la causa probable.
//
// Va al guion de implantación como puerta: sin esa prueba en verde, el bar
// depende del papel cuando se va internet. Y el implantador que la pulsa
// está de pie en la barra con el móvil del dueño en la otra mano, así que
// lo que tiene que leer no es un código: es qué hacer.
//
// ── POR QUÉ LAS CAUSAS SE ESCRIBEN AQUÍ Y NO EN LA PANTALLA ───────────
//
// Porque son reglas, y una regla se prueba. Este fichero no pinta nada: le
// entra lo que contestaron las pantallas y le sale un diagnóstico. Así el
// caso que de verdad importa —el router con «aislamiento de clientes», que
// es lo que bloquea esto en una red de invitados— tiene su test, y el
// texto que lee el implantador no depende de que alguien se acuerde de
// repetirlo en el JSX.

import type { RespuestaDePantalla } from "./envioLan.js";

export type Veredicto = "VERDE" | "AMBAR" | "ROJO";

export interface DiagnosticoPantalla {
  pantallaId: string;
  nombre: string | null;
  veredicto: Veredicto;
  /** Milisegundos de ida y vuelta. `null` si no llegó. */
  ms: number | null;
  /** Lo que el implantador tiene que leer. */
  mensaje: string;
  /** Lo que tiene que HACER, si hay algo que hacer. */
  queHacer: string | null;
}

export interface Diagnostico {
  veredicto: Veredicto;
  titulo: string;
  pantallas: DiagnosticoPantalla[];
}

/**
 * El diagnóstico de una prueba.
 *
 * `porQueNoHayWifi` es lo que faltaba ANTES de intentarlo (no es la APK, no
 * hay pantalla emparejada, la tablet no ha dicho su IP). Si viene relleno,
 * la prueba no se ha podido ni hacer y eso es lo que hay que decir: un
 * «no llega» cuando lo que falta es emparejar la tablet manda a mirar el
 * router media hora para nada.
 */
export function diagnosticar(opts: {
  porQueNoHayWifi: string | null;
  respuestas: RespuestaDePantalla[];
}): Diagnostico {
  if (opts.porQueNoHayWifi) {
    return {
      veredicto: "ROJO",
      titulo: "No se puede probar todavía",
      pantallas: [],
    };
  }
  if (opts.respuestas.length === 0) {
    return {
      veredicto: "ROJO",
      titulo: "No hay ninguna pantalla de cocina a la que llamar",
      pantallas: [],
    };
  }

  const pantallas = opts.respuestas.map(diagnosticarUna);
  const verdes = pantallas.filter((p) => p.veredicto === "VERDE").length;
  const veredicto: Veredicto =
    verdes === pantallas.length
      ? "VERDE"
      : verdes > 0
      ? "AMBAR"
      : "ROJO";
  const titulo =
    veredicto === "VERDE"
      ? pantallas.length === 1
        ? `La cocina recibe por la wifi (${pantallas[0]!.ms} ms)`
        : `Las ${pantallas.length} pantallas reciben por la wifi`
      : veredicto === "AMBAR"
      ? `Sólo ${verdes} de ${pantallas.length} pantallas reciben por la wifi`
      : "La cocina NO recibe por la wifi";
  return { veredicto, titulo, pantallas };
}

function diagnosticarUna(r: RespuestaDePantalla): DiagnosticoPantalla {
  const base = {
    pantallaId: r.pantalla.id,
    nombre: r.pantalla.name,
  };
  const c = r.camino;

  // Llegó y contestó bien.
  if (c.ok && r.respuesta) {
    const porSubir = r.respuesta.marcasPendientes;
    return {
      ...base,
      veredicto: "VERDE",
      ms: c.ms,
      mensaje: c.redescubierta
        ? `Llega en ${c.ms} ms. La tablet había cambiado de IP y se ha encontrado sola en la red del local.`
        : `Llega en ${c.ms} ms.`,
      queHacer:
        porSubir > 0
          ? `La tablet tiene ${porSubir} marcas sin subir a internet. Se suben solas cuando vuelva la red.`
          : null,
    };
  }

  // Llegó, pero lo que contestó no pasa la firma. Es el caso raro y hay
  // que distinguirlo: significa que hay ALGO escuchando en esa IP y ese
  // puerto que no es nuestra tablet.
  if (c.ok && !r.respuesta) {
    return {
      ...base,
      veredicto: "ROJO",
      ms: c.ms,
      mensaje:
        "Algo contesta en esa dirección, pero su respuesta no está firmada con la clave de esta tienda.",
      queHacer:
        "Comprueba que la IP de la tablet es la que dice el panel y que no hay otro aparato usando el mismo puerto.",
    };
  }

  // No se llegó: `status: 0`.
  if (c.status === 0) {
    return {
      ...base,
      veredicto: "ROJO",
      ms: null,
      mensaje: r.pantalla.lanIp
        ? `No contesta en ${r.pantalla.lanIp}, y tampoco se la encuentra buscándola en la red del local.`
        : "La tablet no ha dicho en qué IP escucha.",
      queHacer: r.pantalla.lanIp
        ? // LA CAUSA PROBABLE, y es casi siempre ésta. Un router con
          // «aislamiento de clientes» —lo normal en una red de invitados—
          // deja a cada aparato hablar con internet y con nadie más. La
          // tablet escucha, el terminal llama, y el router tira el
          // paquete sin decir nada.
          "Lo más probable: el router aísla los aparatos de la wifi (suele venir encendido en las redes de invitados). Desactiva el «aislamiento de clientes» o pon el terminal y la tablet en la wifi normal del local. Comprueba también que las dos están en la MISMA red."
        : "Enciende la tablet de cocina, espera unos segundos a que se anuncie, y vuelve a probar.",
    };
  }

  // La tablet contestó, pero rechazó el mensaje. El motivo es el del
  // protocolo y cada uno manda a un sitio distinto.
  const motivo = c.error ?? "";
  if (motivo.includes("FIRMA")) {
    return {
      ...base,
      veredicto: "ROJO",
      ms: c.ms,
      mensaje: "La tablet rechaza el mensaje: no comparte la clave de esta tienda.",
      queHacer:
        "La clave se renueva al revocar un aparato. Deja la tablet unos segundos con internet para que recoja la nueva, y vuelve a probar.",
    };
  }
  if (motivo.includes("OTRA_TIENDA")) {
    return {
      ...base,
      veredicto: "ROJO",
      ms: c.ms,
      mensaje: "Esa tablet está emparejada a OTRA tienda.",
      queHacer: "Vuelve a emparejarla con un código de esta tienda.",
    };
  }
  if (motivo.includes("VIEJO")) {
    return {
      ...base,
      veredicto: "ROJO",
      ms: c.ms,
      mensaje:
        "La tablet rechaza el mensaje por viejo: su reloj y el de este terminal no coinciden.",
      queHacer:
        "Deja los dos aparatos unos segundos con internet para que pongan la hora, y vuelve a probar.",
    };
  }
  if (motivo.includes("VERSION")) {
    return {
      ...base,
      veredicto: "ROJO",
      ms: c.ms,
      mensaje:
        "La tablet y este terminal llevan versiones distintas de la app.",
      queHacer: "Actualiza los dos a la misma versión.",
    };
  }
  if (motivo.includes("SIN_CIFRADO")) {
    return {
      ...base,
      veredicto: "ROJO",
      ms: c.ms,
      mensaje: "Esa tablet no puede descifrar los mensajes de la cocina.",
      queHacer:
        "Es un problema del aparato, no de la red. Avisa a soporte con el modelo de la tablet.",
    };
  }
  return {
    ...base,
    veredicto: "ROJO",
    ms: c.ms,
    mensaje: `La tablet rechazó el mensaje (${c.status}${
      motivo ? ` · ${motivo}` : ""
    }).`,
    queHacer: "Avisa a soporte con este mensaje.",
  };
}
