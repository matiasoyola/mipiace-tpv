// clinica-5 · LAS CINCO TARJETAS, una por tipo de visita.
//
// Cada tipo marcado añade su tarjeta a la columna de la derecha, apiladas
// en el orden de la lista. Es el mockup validado
// (`docs/mockups/clinica-sesion-v2.html`) con sus textos y sus estados.
//
// ── Por qué un fichero propio y no cinco ─────────────────────────────
//
// Porque las cinco son LA MISMA pieza con distinto contenido: una tarjeta
// con botones que suben estado al padre. Ninguna tiene estado propio,
// ninguna llama a la API y ninguna calcula nada que la otra no calcule —
// el nivel, el riesgo y los avisos los calculan las funciones puras del
// paquete, las mismas que el servidor.
//
// Cinco ficheros habrían sido cinco cabeceras explicando lo mismo. Y el
// día que la biomecánica se diseñe de verdad (decisión 8 la deja como
// «una tarjeta de botones sencilla»), se saca ésa y no se reorganizan las
// otras cuatro.
//
// ── Lo que NO hacen: decidir ─────────────────────────────────────────
//
// `nivelPropuesto`, `riesgoDelPie` y `avisosCruzados` se llaman AQUÍ para
// pintar, y el servidor los vuelve a llamar al cerrar con los mismos
// datos. No hay dos cálculos: hay una función llamada desde dos sitios.
// Con una copia por lado, la podóloga vería «riesgo moderado» en pantalla
// y la historia guardaría «bajo».

import { AlertTriangle } from "lucide-react";

import {
  FUENTE_DEL_RIESGO,
  NOMBRE_DE_NIVEL,
  NOMBRE_DE_PULSO_PEDIO,
  NOMBRE_DE_SENSIBILIDAD,
  NOMBRE_DE_SI_NO,
  NIVELES_DE_QUIROPODIA,
  PULSOS_PEDIOS,
  SENSIBILIDADES,
  SI_NO,
  faltaPorComprobar,
  nivelPropuesto,
  riesgoDelPie,
  textoDelCambioDeNivel,
  type ComprobacionesDelPie,
  type ListaDeActos,
  type ListaDeOpciones,
  type NivelDeQuiropodia,
  type Pie,
  type PulsoPedio,
  type Sensibilidad,
  type ServicioDeSesion,
  type SiNo,
} from "@mipiacetpv/clinica-sesion";

import {
  BotonDeActo,
  Chip,
  Seccion,
  Segmentos,
  Tarjeta,
  diaCorto,
  euros,
} from "./piezas.js";

/** Lo que todas las tarjetas necesitan para pintar sus servicios. */
export interface ServiciosDelTipo {
  /** Los del catálogo que son de este tipo (sin los tres niveles). */
  disponibles: readonly ServicioDeSesion[];
  /** Los tocados. */
  elegidos: readonly string[];
  onServicio: (serviceId: string) => void;
  verImportes: boolean;
}

/**
 * Los chips de servicio de un tipo. Es la parte de «se cobra» de cada
 * tarjeta y es idéntica en las cinco, así que está una vez.
 *
 * El precio sólo si viene: `precio` es `undefined` cuando la respuesta no
 * trae importes, y no hay ningún `?? 0` que pueda convertirlo en un cero
 * (regla 8 de clinica-3).
 */
function Servicios(props: { titulo?: string; servicios: ServiciosDelTipo }) {
  const s = props.servicios;
  if (s.disponibles.length === 0) {
    return (
      <Seccion titulo={props.titulo ?? "Qué se cobra"}>
        <p className="text-[13px] text-slate-500 leading-relaxed">
          Este tipo no tiene ningún servicio en su categoría: la visita
          queda anotada y <b className="font-medium">sin cobro</b>. Asígnale
          uno en Catálogo de agenda si quieres cobrarla.
        </p>
      </Seccion>
    );
  }
  return (
    <Seccion titulo={props.titulo ?? "Qué se cobra"}>
      <div className="flex flex-wrap gap-2">
        {s.disponibles.map((x) => (
          <Chip
            key={x.serviceId}
            on={s.elegidos.includes(x.serviceId)}
            onClick={() => s.onServicio(x.serviceId)}
          >
            {x.nombre}
            {s.verImportes && x.precio != null && (
              <span className="font-normal opacity-80"> · {euros(x.precio)}</span>
            )}
          </Chip>
        ))}
      </div>
    </Seccion>
  );
}

/** El aviso cruzado, en rojo y dentro de la tarjeta que lo dispara. */
export function AvisoCruzado(props: { avisos: readonly string[] }) {
  if (props.avisos.length === 0) return null;
  return (
    <div className="mt-3 space-y-2">
      {props.avisos.map((a) => (
        <div
          key={a}
          role="alert"
          data-test="aviso-cruzado"
          className="flex gap-2.5 items-center bg-red-50 text-red-700 rounded-2xl px-3.5 py-3 text-[14px] font-medium"
        >
          <AlertTriangle className="w-5 h-5 shrink-0" strokeWidth={2.25} />
          {a}
        </div>
      ))}
    </div>
  );
}

// ── 1 · QUIROPODIA ────────────────────────────────────────────────────

export function TarjetaQuiropodia(props: {
  lista: ListaDeActos;
  actos: readonly string[];
  /** `null` = se queda con el propuesto. Guardar el «elegido a mano» como
   *  `null` y no como una copia del propuesto es lo que deja que el nivel
   *  SIGA moviéndose al tocar más actos: con una copia, el primer toque
   *  congelaría el nivel para siempre. */
  nivelAMano: NivelDeQuiropodia | null;
  niveles: readonly ServicioDeSesion[];
  servicios: ServiciosDelTipo;
  avisos: readonly string[];
  verImportes: boolean;
  onActo: (id: string) => void;
  onNivel: (n: NivelDeQuiropodia) => void;
}) {
  const propuesta = nivelPropuesto(props.actos);
  const elegido = props.nivelAMano ?? propuesta.nivel;
  const cambiado = textoDelCambioDeNivel(propuesta.nivel, elegido);
  const precioDe = (n: NivelDeQuiropodia) =>
    props.niveles.find((s) => s.nivelQuiropodia === n)?.precio;

  return (
    <Tarjeta
      titulo="Qué haces hoy"
      sub="Toca lo que haces. El nivel sale solo."
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {props.lista.actos.map((a) => (
          <BotonDeActo
            key={a.id}
            on={props.actos.includes(a.id)}
            titulo={a.label}
            sub={a.sub}
            onClick={() => props.onActo(a.id)}
          />
        ))}
      </div>

      <AvisoCruzado avisos={props.avisos} />

      {/* EL NIVEL, en oscuro: es lo que se cobra y el mockup lo separa del
          resto a propósito. Se cambia con un toque y la frase de debajo
          deja constancia de que se cambió. */}
      <div
        data-test="nivel-de-quiropodia"
        className="mt-4 rounded-[18px] bg-mipiace-ink text-white px-4 py-3.5"
      >
        <div className="text-[12px] font-semibold tracking-[0.03em] text-slate-300">
          NIVEL DE QUIROPODIA
        </div>
        <div className="grid grid-cols-3 gap-1.5 mt-2.5">
          {NIVELES_DE_QUIROPODIA.map((n) => {
            const precio = precioDe(n);
            return (
              <button
                key={n}
                type="button"
                aria-pressed={elegido === n}
                onClick={() => props.onNivel(n)}
                className={`h-[62px] rounded-[14px] flex flex-col items-center justify-center font-semibold text-[15px] ${
                  elegido === n
                    ? "bg-white text-mipiace-ink ring-[3px] ring-mipiace-coral"
                    : "bg-slate-700 text-white"
                }`}
              >
                {NOMBRE_DE_NIVEL[n]}
                <span className="font-normal text-[12px] opacity-80">
                  {props.verImportes && precio != null
                    ? euros(precio)
                    : "sin servicio"}
                </span>
              </button>
            );
          })}
        </div>
        <div className="text-[13px] text-slate-200 mt-2">
          {cambiado ?? propuesta.motivo}
        </div>
      </div>

      <Servicios titulo="Y además" servicios={props.servicios} />
    </Tarjeta>
  );
}

// ── 2 · PIE DE RIESGO ─────────────────────────────────────────────────

const COLOR_DEL_RIESGO: Record<number, string> = {
  0: "bg-emerald-50 text-emerald-800",
  1: "bg-emerald-50 text-emerald-800",
  2: "bg-orange-50 text-orange-800",
  3: "bg-red-50 text-red-800",
};

export function TarjetaPieDeRiesgo(props: {
  comprobaciones: ComprobacionesDelPie;
  servicios: ServiciosDelTipo;
  fuente: string;
  onSensibilidad: (v: Sensibilidad) => void;
  onPulso: (pie: Pie, v: PulsoPedio) => void;
  onUlcera: (v: SiNo) => void;
  onDeformidad: (v: SiNo) => void;
}) {
  const c = props.comprobaciones;
  const riesgo = riesgoDelPie(c);
  const falta = faltaPorComprobar(c);

  return (
    <Tarjeta
      titulo="Pie de riesgo"
      sub="Cuatro comprobaciones. El riesgo sale solo."
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <Comprobacion titulo="Sensibilidad (monofilamento)">
          <Segmentos
            opciones={SENSIBILIDADES.map((s) => [s, NOMBRE_DE_SENSIBILIDAD[s]])}
            valor={c.sensibilidad}
            onElegir={props.onSensibilidad}
          />
        </Comprobacion>
        <Comprobacion titulo="¿Úlcera previa o actual?">
          <Segmentos
            opciones={SI_NO.map((v) => [v, NOMBRE_DE_SI_NO[v]])}
            valor={c.ulcera}
            onElegir={props.onUlcera}
          />
        </Comprobacion>
        <Comprobacion titulo="Pulso pedio · izq. / der.">
          <div className="space-y-2">
            {(["L", "R"] as const).map((pie) => (
              <div key={pie} className="flex items-center gap-2">
                <span className="text-[13px] w-7 shrink-0 text-slate-500">
                  {pie === "L" ? "Izq" : "Der"}
                </span>
                <div className="flex-1">
                  <Segmentos
                    opciones={PULSOS_PEDIOS.map((p) => [
                      p,
                      NOMBRE_DE_PULSO_PEDIO[p],
                    ])}
                    valor={c.pulsos[pie]}
                    onElegir={(v) => props.onPulso(pie, v)}
                  />
                </div>
              </div>
            ))}
          </div>
        </Comprobacion>
        {/* LA CUARTA, la que el mockup no tenía y la guía sí pide. Sin
            ella, un diabético con pérdida de sensibilidad y un juanete que
            roza sale «bajo» cuando la IWGDF lo pone en «moderado». */}
        <Comprobacion titulo="¿Deformidad del pie?">
          <Segmentos
            opciones={SI_NO.map((v) => [v, NOMBRE_DE_SI_NO[v]])}
            valor={c.deformidad}
            onElegir={props.onDeformidad}
          />
        </Comprobacion>
      </div>

      {riesgo ? (
        <div
          data-test="riesgo-del-pie"
          className={`mt-3.5 rounded-[20px] px-4 py-3.5 ${COLOR_DEL_RIESGO[riesgo.categoria]}`}
        >
          <div className="text-[22px] font-semibold leading-tight">
            {riesgo.nombre}
          </div>
          <div className="text-[14px] mt-0.5">{riesgo.plazo}</div>
          <div className="text-[13px] opacity-80 mt-1">
            {riesgo.motivo} Se propone la próxima cita con este plazo; no se
            reserva sola.
          </div>
        </div>
      ) : (
        <div className="mt-3.5 rounded-[20px] px-4 py-3.5 bg-mipiace-stone text-slate-500 text-[14px]">
          Falta {falta.join(", ")} para ver el riesgo.
        </div>
      )}

      <p className="text-[12px] text-slate-400 mt-2 leading-relaxed">
        {props.fuente || FUENTE_DEL_RIESGO}
      </p>

      <Servicios servicios={props.servicios} />
    </Tarjeta>
  );
}

function Comprobacion(props: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-mipiace-stone rounded-[18px] p-3">
      <div className="text-[13px] text-slate-500 font-medium mb-2">
        {props.titulo}
      </div>
      {props.children}
    </div>
  );
}

// ── 3 · REVISIÓN DE CIRUGÍA ───────────────────────────────────────────

const COLOR_DE_HERIDA: Record<string, string> = {
  CICATRIZADA: "bg-emerald-50 border-emerald-500 text-emerald-800",
  BIEN: "bg-emerald-50 border-emerald-500 text-emerald-800",
  EXUDADO: "bg-amber-50 border-amber-500 text-amber-800",
  INFECCION: "bg-red-50 border-red-500 text-red-800",
};

export function TarjetaCirugia(props: {
  estados: ListaDeOpciones;
  puntosLista: ListaDeOpciones;
  herida: string | null;
  puntos: string | null;
  /** La cabecera: de qué cirugía se habla (decisión 7). */
  ultimaCirugia: {
    fecha: string;
    tecnica: readonly string[];
    zonas: readonly string[];
  } | null;
  servicios: ServiciosDelTipo;
  avisos: readonly string[];
  onHerida: (id: string) => void;
  onPuntos: (id: string) => void;
}) {
  const c = props.ultimaCirugia;
  const sub = c
    ? [
        c.tecnica.length > 0 ? c.tecnica.join(" + ") : "cirugía",
        ...c.zonas.slice(0, 2),
        diaCorto(c.fecha),
      ].join(" · ")
    : "No hay ninguna cirugía anotada en la historia todavía";

  return (
    <Tarjeta titulo="Revisión de la cirugía" sub={sub}>
      <Seccion titulo="Cómo está la herida">
        <div className="grid grid-cols-2 gap-2">
          {props.estados.opciones.map((o) => (
            <button
              key={o.id}
              type="button"
              aria-pressed={props.herida === o.id}
              onClick={() => props.onHerida(o.id)}
              className={`min-h-[60px] rounded-[18px] border-2 px-2 font-medium text-[15px] ${
                props.herida === o.id
                  ? COLOR_DE_HERIDA[o.id] ??
                    "bg-mipiace-coral-soft border-mipiace-coral text-mipiace-coral-dark"
                  : "bg-mipiace-stone border-transparent text-mipiace-ink"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </Seccion>

      <AvisoCruzado avisos={props.avisos} />

      <Seccion titulo="Puntos">
        <div className="flex flex-wrap gap-2">
          {props.puntosLista.opciones.map((o) => (
            <Chip
              key={o.id}
              on={props.puntos === o.id}
              onClick={() => props.onPuntos(o.id)}
            >
              {o.label}
            </Chip>
          ))}
        </div>
      </Seccion>

      <Servicios servicios={props.servicios} />
    </Tarjeta>
  );
}

// ── 4 · BIOMECÁNICA ──────────────────────────────────────────────────

export function TarjetaBiomecanica(props: {
  tiposDePie: ListaDeOpciones;
  pisadas: ListaDeOpciones;
  tipoDePie: string | null;
  pisada: string | null;
  plantillas: boolean;
  servicios: ServiciosDelTipo;
  onTipoDePie: (id: string) => void;
  onPisada: (id: string) => void;
  onPlantillas: () => void;
}) {
  return (
    <Tarjeta
      titulo="Biomecánica"
      // Decisión 8: en esta versión es una tarjeta de botones sencilla y
      // no se diseña más aquí. Lo dice la propia tarjeta para que nadie
      // crea que esto es la exploración biomecánica completa.
      sub="Tipo de pie, pisada y plantillas. Versión corta."
    >
      <Seccion titulo="Tipo de pie">
        <div className="flex flex-wrap gap-2">
          {props.tiposDePie.opciones.map((o) => (
            <Chip
              key={o.id}
              on={props.tipoDePie === o.id}
              onClick={() => props.onTipoDePie(o.id)}
            >
              {o.label}
            </Chip>
          ))}
        </div>
      </Seccion>
      <Seccion titulo="Pisada">
        <div className="flex flex-wrap gap-2">
          {props.pisadas.opciones.map((o) => (
            <Chip
              key={o.id}
              on={props.pisada === o.id}
              onClick={() => props.onPisada(o.id)}
            >
              {o.label}
            </Chip>
          ))}
        </div>
      </Seccion>
      <Seccion titulo="Plantillas">
        <div className="flex flex-wrap gap-2">
          <Chip on={props.plantillas} onClick={props.onPlantillas}>
            Plantillas a medida
          </Chip>
        </div>
      </Seccion>
      <Servicios servicios={props.servicios} />
    </Tarjeta>
  );
}

// ── 5 · GENERAL ──────────────────────────────────────────────────────

export function TarjetaGeneral(props: { servicios: ServiciosDelTipo }) {
  return (
    <Tarjeta
      titulo="Visita general"
      sub="Sólo lo que se cobra y, si hace falta, la nota de abajo."
    >
      <Servicios servicios={props.servicios} />
    </Tarjeta>
  );
}
