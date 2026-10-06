// clinica-2 · las alertas de salud salen de UNA función pura.
//
// Entra el estado de la valoración (lo que contestó el paciente + las
// correcciones del sanitario), sale la lista de alertas. Sin base de
// datos, sin reloj, sin HTTP. Misma razón que `clinica/acceso.ts`: la
// pantalla del sanitario, la franja de la ficha y lo que mañana lea la
// sesión (`clinica-3`) tienen que decir LO MISMO, y la única forma de que
// lo digan es que no haya dos cálculos.
//
// ── Qué es una alerta y qué no ────────────────────────────────────────
//
// Una alerta es un «Sí» que cambia lo que la podóloga hace HOY con un
// bisturí en la mano: diabetes, anticoagulación, circulación, alergias,
// marcapasos, defensas bajas, sensibilidad. Un «Sí» a artrosis, a
// operaciones previas o al tabaco **no es una alerta**: está en la
// historia, se lee, y no va en la franja roja. Si todo fuera alerta, la
// franja dejaría de leerse — que es el único modo de fallo que importa en
// una señal de seguridad.
//
// `alerta: null` en el cuestionario es esa distinción, y está en el dato y
// no en un `if` de esta función a propósito: añadir una pregunta nueva no
// obliga a tocar este fichero.
//
// ── Las alertas VIVEN SÓLO DENTRO DE LA HISTORIA ──────────────────────
//
// Decisión de producto (Matías, 05-10): la agenda y la caja sólo enseñan
// contacto. Esta función se llama desde rutas que pasan por
// `conHistoria`, nunca desde la agenda. Lo que la agenda puede decir es
// «valoración pendiente», que no es un dato de salud.
//
// ── Y se calculan igual sin validar ───────────────────────────────────
//
// Mientras la valoración está sin validar, las alertas se enseñan IGUAL,
// marcadas como «por validar». No esconderlas es la decisión segura: una
// podóloga que ve «Anticoagulación · por validar» sabe lo que tiene
// delante; una que no ve nada porque falta un visto bueno, no.

import {
  preguntasEnJuego,
  type Cuestionario,
  type Respuesta,
} from "./cuestionario.js";
import {
  correccionesVigentes,
  resolverVigente,
  type EstadoRespuestas,
} from "./vigente.js";

export interface Alerta {
  /** La pregunta de la que sale. Para que la pantalla pueda llevar de la
   *  alerta a su fila. */
  preguntaId: string;
  /** Lo que se pinta en la franja. */
  texto: string;
  /** `true` si el valor que la dispara es una CORRECCIÓN del sanitario y
   *  no lo que dijo el paciente. La pantalla no lo distingue hoy; el dato
   *  está porque una alerta que la clínica añadió y una que el paciente
   *  declaró no son la misma cosa cuando alguien revisa la historia. */
  deCorreccion: boolean;
}

export interface Alertas {
  alertas: Alerta[];
  /** Las preguntas en juego que siguen en «No lo sé». Son lo que la
   *  podóloga tiene que resolver con el paciente delante, y lo que
   *  bloquea la validación. */
  sinResolver: string[];
  /** Las opciones marcadas en la pregunta con detalle (a qué es alérgico).
   *  Van dentro del texto de la alerta de alergias. */
  detalles: Readonly<Record<string, readonly string[]>>;
}

export interface EntradaAlertas extends EstadoRespuestas {
  cuestionario: Cuestionario;
  /** Las opciones marcadas por el paciente, por pregunta
   *  (`{aler: ["Látex"]}`). Las contesta el paciente y no se corrigen
   *  desde esta pantalla: el sanitario corrige el Sí/No, y el detalle lo
   *  repasa en voz alta. */
  detalles?: Readonly<Record<string, readonly string[]>>;
}

/**
 * Las alertas vigentes de una valoración.
 *
 * El orden es el del cuestionario, no el de «gravedad»: un orden por
 * gravedad obligaría a inventar una escala clínica que nadie ha validado,
 * y el orden del cuestionario ya pone delante lo que cambia el
 * tratamiento de hoy.
 */
export function alertasDe(entrada: EntradaAlertas): Alertas {
  const vigentes = correccionesVigentes(entrada.correcciones);
  const valorDe = (id: string): Respuesta | undefined =>
    vigentes.get(id)?.valor ?? entrada.respuestasPaciente[id];

  const enJuego = preguntasEnJuego(entrada.cuestionario, valorDe);
  const alertas: Alerta[] = [];
  const sinResolver: string[] = [];

  for (const p of enJuego) {
    const v = resolverVigente(entrada, vigentes, p.id);
    if (v.valor === "NO_SE") {
      sinResolver.push(p.id);
      // Un «No lo sé» NO produce alerta, y es deliberado: una franja con
      // «Alergias» sobre un «no lo sé» le diría a la podóloga que el
      // paciente declaró alergias. Lo que tiene que decirle la pantalla es
      // que falta resolverlo, y eso lo dice `sinResolver` — que además
      // bloquea la validación.
      continue;
    }
    if (v.valor !== "SI") continue;
    if (p.alerta == null) continue;

    const detalle = entrada.detalles?.[p.id];
    const texto =
      detalle && detalle.length > 0
        ? `${p.alertaConDetalle ?? p.alerta}: ${detalle
            .join(", ")
            .toLowerCase()}`
        : p.alerta;
    alertas.push({
      preguntaId: p.id,
      texto,
      deCorreccion: v.correccion != null,
    });
  }

  return { alertas, sinResolver, detalles: entrada.detalles ?? {} };
}
