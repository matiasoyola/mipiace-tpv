// historia-1 (D-90, D-91, D-97) · **LA FICHA CLÍNICA DEL RESIDENTE.**
//
// Lo que hoy está repartido entre una ficha en papel, el PAI en Word y la
// cabeza de la DUE: la franja de alertas arriba y cuatro secciones
// debajo — diagnósticos, alergias, dispositivos y dieta.
//
// Pantalla **de despacho** (D-97, sin mockup previo por D-76): se mira
// sentado, con tiempo, y se itera con la dirección delante.
//
// ── LA FRANJA VA ARRIBA Y LLEVA LOS DOS TEXTOS (D-91) ───────────────
//
// En el admin se enseña la frase accionable **y el detalle**: quien está
// aquí es el médico o la DUE, y lo que necesita ver es por qué alerta.
// En la puerta sólo va la frase, y eso no lo decide esta pantalla: lo
// decide el servidor, que a la tablet le manda `string[]`.
//
// ── NADA SE EDITA, Y LA PANTALLA LO DICE ───────────────────────────
//
// No hay un solo botón de «editar» en este fichero:
//
//   · un diagnóstico se **resuelve** (se curó) o se **retira** (estaba
//     mal escrito), las dos con firma;
//   · una alergia se **retira** y se escribe la buena;
//   · un dispositivo se **cierra**;
//   · la dieta se cambia escribiendo **la versión siguiente**, y las
//     anteriores se quedan a la vista.
//
// Y las dos cosas se distinguen a propósito: «se curó» y «estaba mal
// escrito» son dos hechos distintos, y un solo botón de borrar los
// confundiría para siempre.

import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, Plus, X } from "lucide-react";

import { AdminShell } from "../../AdminShell.js";
import { api, ApiError } from "../../api.js";
import {
  CenteredLoader,
  FieldError,
  OutlineButton,
  PrimaryButton,
  TextField,
} from "../../ui.js";
import {
  fechaCorta,
  fechaLarga,
  NOMBRE_DE_LA_CLASE_DE_ALERGIA,
  NOMBRE_DE_LA_CLASE_DE_ALERTA,
  NOMBRE_DE_LA_GRAVEDAD,
  NOMBRE_DE_LA_TEXTURA,
  type CatalogoDeLaFicha,
  type FichaClinica,
} from "./ficha-lib.js";

/** Qué sección está abierta para escribir. `null` = ninguna. */
type Formulario = "DIAGNOSTICO" | "ALERGIA" | "DISPOSITIVO" | "DIETA" | null;

export function FichaClinicaPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const [ficha, setFicha] = useState<FichaClinica | null>(null);
  const [catalogo, setCatalogo] = useState<CatalogoDeLaFicha | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<Formulario>(null);

  const recargar = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([
        api<{ ficha: FichaClinica }>(`/residencia/residentes/${clientId}/ficha`),
        api<CatalogoDeLaFicha>("/residencia/ficha/catalogo"),
      ]);
      setFicha(r.ficha);
      setCatalogo(c);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }, [clientId]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  if (!ficha || !catalogo) {
    return <CenteredLoader label="Cargando la ficha clínica…" />;
  }

  async function enviar(ruta: string, body: unknown) {
    try {
      await api(`/residencia/residentes/${clientId}${ruta}`, {
        method: "POST",
        body,
      });
      setAbierto(null);
      setError(null);
      await recargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  /** Lo que se pide antes de retirar o resolver: un motivo o una fecha.
   *  Con `prompt` y no con un modal propio, y es deliberado — es una
   *  acción de despacho que se hace dos veces al mes, y un modal con su
   *  estado sería cincuenta líneas para ahorrar un clic que nadie da. */
  async function pedirYEnviar(ruta: string, pregunta: string, campo: string) {
    const valor = window.prompt(pregunta);
    if (valor == null || valor.trim() === "") return;
    await enviar(ruta, { [campo]: valor.trim() });
  }

  return (
    <AdminShell title="Ficha clínica">
      <Link
        to="/admin/residencia/residentes"
        className="mb-4 inline-block text-[13.5px] text-slate-500 hover:underline"
      >
        ← Volver a Residentes
      </Link>

      <div className="mb-5 flex flex-wrap gap-4 text-[13.5px]">
        <Link
          to={`/admin/residencia/residentes/${clientId}/ausencias`}
          className="text-slate-600 underline"
        >
          Ausencias y días del mes
        </Link>
        <Link
          to={`/admin/residencia/residentes/${clientId}/ingreso`}
          className="text-slate-600 underline"
        >
          Ingreso guiado
        </Link>
        <Link
          to={`/admin/residencia/residentes/${clientId}/plan`}
          className="text-slate-600 underline"
        >
          Plan de cuidados
        </Link>
      </div>

      {error && <FieldError message={error} />}

      {/* ── LA FRANJA DE ALERTAS (D-91) ───────────────────────────── */}
      <FranjaDeAlertas alertas={ficha.alertas} />

      {/* ── ALERGIAS · primero, porque es lo que bloquea ─────────── */}
      <Seccion
        titulo="Alergias e intolerancias"
        pie="Las GRAVES salen en la franja y en la puerta. Las demás están aquí, donde las mira quien prescribe y quien cocina."
        onAnadir={() => setAbierto(abierto === "ALERGIA" ? null : "ALERGIA")}
      >
        {/* **«Sin alergias conocidas» es un dato** (D-90): sin esta
            línea, «nadie le ha preguntado» y «se le preguntó y no tiene»
            serían la misma lista vacía. Medicación va a bloquear sobre
            esa diferencia. */}
        <RevisionDeAlergias
          revision={ficha.revisionDeAlergias}
          hayVigentes={ficha.alergias.some((a) => !a.retirada)}
          onRegistrar={(sinAlergias, fuente) =>
            void enviar("/alergias/revision", {
              sinAlergiasConocidas: sinAlergias,
              ...(fuente ? { fuente } : {}),
            })
          }
        />
        {abierto === "ALERGIA" && (
          <FormularioDeAlergia
            catalogo={catalogo}
            onGuardar={(body) => void enviar("/alergias", body)}
            onCerrar={() => setAbierto(null)}
          />
        )}
        {ficha.alergias.length === 0 ? (
          <Vacio>Sin alergias apuntadas.</Vacio>
        ) : (
          <ul className="space-y-2">
            {ficha.alergias.map((a) => (
              <li
                key={a.id}
                className={`rounded-xl border px-4 py-3 text-[13.5px] ${
                  a.retirada
                    ? "border-slate-200 bg-slate-50 text-slate-500"
                    : a.gravedad === "GRAVE"
                      ? "border-rose-200 bg-rose-50"
                      : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium">{a.agente ?? "—"}</span>
                  <Etiqueta>{NOMBRE_DE_LA_CLASE_DE_ALERGIA[a.clase]}</Etiqueta>
                  <Etiqueta tono={a.gravedad === "GRAVE" ? "rojo" : "gris"}>
                    {NOMBRE_DE_LA_GRAVEDAD[a.gravedad]}
                  </Etiqueta>
                  {a.retirada && <Etiqueta>retirada</Etiqueta>}
                  {!a.retirada && (
                    <button
                      type="button"
                      onClick={() =>
                        void pedirYEnviar(
                          `/alergias/${a.id}/retirar`,
                          "¿Por qué se retira? Queda escrito con tu nombre: la alergia no se borra.",
                          "motivo",
                        )
                      }
                      className="ml-auto text-[13px] text-slate-500 underline"
                    >
                      Retirar
                    </button>
                  )}
                </div>
                {a.reaccion && (
                  <p className="mt-1 text-slate-600">{a.reaccion}</p>
                )}
                <Firma quien={a.firmadoPor} como={a.firmadoComo} cuando={a.escritoEn} />
                {a.retirada && a.motivoDeRetirada && (
                  <p className="mt-1 text-[13px] text-slate-500">
                    Retirada: {a.motivoDeRetirada}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Seccion>

      {/* ── DIAGNÓSTICOS ─────────────────────────────────────────── */}
      <Seccion
        titulo="Diagnósticos y antecedentes"
        pie="Corregir un diagnóstico es escribir otro y retirar éste: lo escrito no se edita."
        onAnadir={() =>
          setAbierto(abierto === "DIAGNOSTICO" ? null : "DIAGNOSTICO")
        }
      >
        {abierto === "DIAGNOSTICO" && (
          <FormularioDeDiagnostico
            onGuardar={(body) => void enviar("/diagnosticos", body)}
            onCerrar={() => setAbierto(null)}
          />
        )}
        {ficha.diagnosticos.length === 0 ? (
          <Vacio>Sin diagnósticos apuntados.</Vacio>
        ) : (
          <ul className="space-y-2">
            {ficha.diagnosticos.map((d) => (
              <li
                key={d.id}
                className={`rounded-xl border px-4 py-3 text-[13.5px] ${
                  d.retirado || d.resueltoEn
                    ? "border-slate-200 bg-slate-50 text-slate-500"
                    : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium">{d.texto ?? "—"}</span>
                  {d.icd10 && <Etiqueta>CIE-10 {d.icd10}</Etiqueta>}
                  {d.quirurgico && <Etiqueta>quirúrgico</Etiqueta>}
                  {d.alerta && <Etiqueta tono="rojo">alerta</Etiqueta>}
                  {d.resueltoEn && (
                    <Etiqueta>resuelto el {fechaCorta(d.resueltoEn)}</Etiqueta>
                  )}
                  {d.retirado && <Etiqueta>retirado</Etiqueta>}
                  {!d.retirado && !d.resueltoEn && (
                    <span className="ml-auto flex gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          void pedirYEnviar(
                            `/diagnosticos/${d.id}/resolver`,
                            "¿Qué día se resolvió? (AAAA-MM-DD)",
                            "resolvedOn",
                          )
                        }
                        className="text-[13px] text-slate-500 underline"
                      >
                        Resolver
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void pedirYEnviar(
                            `/diagnosticos/${d.id}/retirar`,
                            "¿Por qué se retira? Es para lo que se escribió mal, no para lo que se curó.",
                            "motivo",
                          )
                        }
                        className="text-[13px] text-slate-500 underline"
                      >
                        Retirar
                      </button>
                    </span>
                  )}
                </div>
                {d.alerta && d.fraseDeAlerta && (
                  <p className="mt-1 rounded-md bg-rose-100 px-2 py-1 text-[13px] text-rose-900">
                    En la puerta se lee: «{d.fraseDeAlerta}»
                  </p>
                )}
                <p className="mt-1 text-[13px] text-slate-500">
                  Desde el {fechaLarga(d.desde)}
                </p>
                <Firma quien={d.firmadoPor} como={d.firmadoComo} cuando={d.escritoEn} />
                {d.retirado && d.motivoDeRetirada && (
                  <p className="mt-1 text-[13px] text-slate-500">
                    Retirado: {d.motivoDeRetirada}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Seccion>

      {/* ── DIETA · versionada ───────────────────────────────────── */}
      <Seccion
        titulo="Dieta y textura"
        pie="Cada cambio es una versión nueva. La anterior se queda: «¿qué textura tenía el día que se atragantó?» es una pregunta que se hace después."
        onAnadir={() => setAbierto(abierto === "DIETA" ? null : "DIETA")}
        etiquetaDelBoton="Cambiar la dieta"
      >
        {abierto === "DIETA" && (
          <FormularioDeDieta
            catalogo={catalogo}
            onGuardar={(body) => void enviar("/dieta", body)}
            onCerrar={() => setAbierto(null)}
          />
        )}
        {ficha.dietas.length === 0 ? (
          <Vacio>
            Sin dieta registrada. **No es «normal»**: la puerta no pinta
            nada, y el ingreso guiado lo tiene como pendiente.
          </Vacio>
        ) : (
          <ul className="space-y-2">
            {ficha.dietas.map((d) => (
              <li
                key={d.id}
                className={`rounded-xl border px-4 py-3 text-[13.5px] ${
                  d.vigente
                    ? "border-slate-200 bg-white"
                    : "border-slate-200 bg-slate-50 text-slate-500"
                }`}
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium">
                    {NOMBRE_DE_LA_TEXTURA[d.textura]}
                  </span>
                  {d.espesante && (
                    <Etiqueta tono="rojo">
                      espesante nivel {d.nivelDeEspesante}
                    </Etiqueta>
                  )}
                  {d.restricciones.map((r) => (
                    <Etiqueta key={r}>
                      {catalogo.restricciones.find((x) => x.code === r)?.nombre ?? r}
                    </Etiqueta>
                  ))}
                  <Etiqueta tono={d.vigente ? "verde" : "gris"}>
                    v{d.version}
                    {d.vigente ? " · vigente" : ""}
                  </Etiqueta>
                </div>
                {d.notas && <p className="mt-1 text-slate-600">{d.notas}</p>}
                <Firma quien={d.firmadoPor} como={d.firmadoComo} cuando={d.escritoEn} />
              </li>
            ))}
          </ul>
        )}
      </Seccion>

      {/* ── DISPOSITIVOS ─────────────────────────────────────────── */}
      <Seccion
        titulo="Dispositivos y ayudas"
        pie="La grúa, la sonda y el oxígeno salen en la franja y en la puerta: cambian lo que alguien hace al entrar en la habitación."
        onAnadir={() =>
          setAbierto(abierto === "DISPOSITIVO" ? null : "DISPOSITIVO")
        }
      >
        {abierto === "DISPOSITIVO" && (
          <FormularioDeDispositivo
            catalogo={catalogo}
            onGuardar={(body) => void enviar("/dispositivos", body)}
            onCerrar={() => setAbierto(null)}
          />
        )}
        {ficha.dispositivos.length === 0 ? (
          <Vacio>Sin dispositivos apuntados.</Vacio>
        ) : (
          <ul className="space-y-2">
            {ficha.dispositivos.map((p) => (
              <li
                key={p.id}
                className={`rounded-xl border px-4 py-3 text-[13.5px] ${
                  p.hasta
                    ? "border-slate-200 bg-slate-50 text-slate-500"
                    : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium">{p.nombre}</span>
                  {p.deRiesgo && !p.hasta && (
                    <Etiqueta tono="rojo">sale en la puerta</Etiqueta>
                  )}
                  {p.hasta && (
                    <Etiqueta>retirado el {fechaCorta(p.hasta)}</Etiqueta>
                  )}
                  {!p.hasta && (
                    <button
                      type="button"
                      onClick={() =>
                        void pedirYEnviar(
                          `/dispositivos/${p.id}/cerrar`,
                          "¿Qué día lo dejó? (AAAA-MM-DD)",
                          "hasta",
                        )
                      }
                      className="ml-auto text-[13px] text-slate-500 underline"
                    >
                      Ya no lo lleva
                    </button>
                  )}
                </div>
                {p.detalle && <p className="mt-1 text-slate-600">{p.detalle}</p>}
                <p className="mt-1 text-[13px] text-slate-500">
                  Desde el {fechaLarga(p.desde)} · lo puso {p.firmadoPor} ({p.firmadoComo})
                </p>
              </li>
            ))}
          </ul>
        )}
      </Seccion>
    </AdminShell>
  );
}

// ── LA FRANJA ───────────────────────────────────────────────────────

function FranjaDeAlertas({ alertas }: { alertas: FichaClinica["alertas"] }) {
  if (alertas.length === 0) {
    // Y se dice, en gris: una ficha sin alertas y una ficha vacía se
    // parecen demasiado, y aquí es importante distinguirlas — la segunda
    // significa que nadie ha escrito nada todavía.
    return (
      <p className="mb-6 rounded-2xl border border-slate-200 bg-white px-5 py-4 text-[13.5px] text-slate-500">
        Sin alertas. La puerta no pinta ninguna banda para esta persona.
      </p>
    );
  }
  return (
    <section className="mb-6 rounded-2xl border-2 border-rose-300 bg-rose-50 px-5 py-4">
      <h2 className="mb-2 flex items-center gap-2 text-[14px] font-semibold uppercase tracking-[0.1em] text-rose-900">
        <AlertTriangle className="h-4 w-4" /> Lo que hay que saber
      </h2>
      <ul className="space-y-1.5">
        {alertas.map((a, i) => (
          <li key={`${a.clase}-${a.origenId ?? i}`} className="text-[15px]">
            <span className="font-semibold text-rose-900">{a.frase}</span>
            <span className="ml-2 rounded-md bg-white/70 px-1.5 py-0.5 text-[12px] uppercase tracking-wide text-rose-800">
              {NOMBRE_DE_LA_CLASE_DE_ALERTA[a.clase]}
            </span>
            {/* El detalle **sólo aquí**: la puerta recibe `string[]` con
                las frases y nada más. Ver `frasesDeLaPuerta`. */}
            {a.detalle && (
              <span className="block text-[13.5px] text-rose-800">{a.detalle}</span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[13px] text-rose-800">
        En la tablet de la puerta se lee <strong>sólo la frase en negrita</strong>:
        nunca el diagnóstico. Un pasillo lo cruza cualquiera.
      </p>
    </section>
  );
}

// ── «SIN ALERGIAS CONOCIDAS» (D-90) ────────────────────────────────

function RevisionDeAlergias({
  revision,
  hayVigentes,
  onRegistrar,
}: {
  revision: FichaClinica["revisionDeAlergias"];
  hayVigentes: boolean;
  onRegistrar: (sinAlergias: boolean, fuente: string) => void;
}) {
  const [fuente, setFuente] = useState("");
  return (
    <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[13.5px]">
      {revision == null ? (
        <p className="text-slate-700">
          <strong>Nadie ha revisado las alergias de esta persona.</strong> No
          tener alergias apuntadas no es lo mismo que no tener alergias, y la
          medicación va a distinguirlo.
        </p>
      ) : (
        <p className="text-slate-700">
          {revision.sinAlergiasConocidas
            ? "Sin alergias conocidas"
            : "Alergias revisadas"}{" "}
          · lo revisó {revision.revisadoPor} ({revision.revisadoComo}) el{" "}
          {fechaLarga(revision.revisadoEn)}
          {revision.fuente ? ` · ${revision.fuente}` : ""}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <TextField
          id="de-d-nde-sale-el-dato-opcional"
          label="De dónde sale el dato (opcional)"
          value={fuente}
          onChange={setFuente}
          placeholder="lo dice la hija, informe del alta…"
        />
        <OutlineButton
          onClick={() => {
            onRegistrar(false, fuente);
            setFuente("");
          }}
        >
          Revisadas
        </OutlineButton>
        <OutlineButton
          disabled={hayVigentes}
          onClick={() => {
            onRegistrar(true, fuente);
            setFuente("");
          }}
        >
          Sin alergias conocidas
        </OutlineButton>
      </div>
      {hayVigentes && (
        <p className="mt-1 text-[13px] text-slate-500">
          Para registrar «sin alergias conocidas» hay que retirar antes las
          que están apuntadas, con su motivo.
        </p>
      )}
    </div>
  );
}

// ── LOS CUATRO FORMULARIOS ─────────────────────────────────────────

function FormularioDeDiagnostico({
  onGuardar,
  onCerrar,
}: {
  onGuardar: (body: Record<string, unknown>) => void;
  onCerrar: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [icd10, setIcd10] = useState("");
  const [desde, setDesde] = useState(new Date().toISOString().slice(0, 10));
  const [quirurgico, setQuirurgico] = useState(false);
  const [alerta, setAlerta] = useState(false);
  const [frase, setFrase] = useState("");
  return (
    <Caja onCerrar={onCerrar}>
      <TextField
          id="diagn-stico" label="Diagnóstico" value={texto} onChange={setTexto} />
      <div className="flex flex-wrap gap-4">
        <TextField
          id="cie-10-es-opcional"
          label="CIE-10-ES (opcional)"
          value={icd10}
          onChange={setIcd10}
          placeholder="E11.9"
        />
        <TextField
          id="desde" label="Desde" type="date" value={desde} onChange={setDesde} />
      </div>
      <Casilla
        marcado={quirurgico}
        onCambiar={setQuirurgico}
        etiqueta="Es un antecedente quirúrgico"
      />
      <Casilla
        marcado={alerta}
        onCambiar={setAlerta}
        etiqueta="Marcar como alerta (sale en la franja y en la puerta)"
      />
      {/* **La frase es obligatoria con la marca puesta** (D-91), y la
          pantalla explica por qué: lo que llega a la tablet del pasillo es
          esto y nada más. Sin la frase, quien escribiera la pantalla
          mañana tendría que elegir entre una banda vacía o el
          diagnóstico. */}
      {alerta && (
        <div>
          <TextField
          id="lo-que-leer-la-auxiliar-en-la-puerta"
            label="Lo que leerá la auxiliar en la puerta"
            value={frase}
            onChange={setFrase}
            placeholder="Toma anticoagulantes: cualquier golpe, avisa"
          />
          <p className="mt-1 text-[13px] text-slate-500">
            Qué hay que <strong>hacer</strong>, no de qué está enferma. El
            diagnóstico no sale de esta pantalla.
          </p>
        </div>
      )}
      <PrimaryButton
        onClick={() =>
          onGuardar({
            texto,
            ...(icd10.trim() ? { icd10: icd10.trim() } : {}),
            quirurgico,
            diagnosedOn: desde,
            alerta,
            ...(alerta ? { fraseDeAlerta: frase } : {}),
          })
        }
      >
        Guardar
      </PrimaryButton>
    </Caja>
  );
}

function FormularioDeAlergia({
  catalogo,
  onGuardar,
  onCerrar,
}: {
  catalogo: CatalogoDeLaFicha;
  onGuardar: (body: Record<string, unknown>) => void;
  onCerrar: () => void;
}) {
  const [clase, setClase] = useState(catalogo.clasesDeAlergia[0] ?? "MEDICAMENTO");
  const [gravedad, setGravedad] = useState("GRAVE");
  const [agente, setAgente] = useState("");
  const [reaccion, setReaccion] = useState("");
  return (
    <Caja onCerrar={onCerrar}>
      <div className="flex flex-wrap gap-4">
        <Selector
          label="Clase"
          value={clase}
          onChange={setClase}
          opciones={catalogo.clasesDeAlergia.map((c) => ({
            value: c,
            label: NOMBRE_DE_LA_CLASE_DE_ALERGIA[c] ?? c,
          }))}
        />
        <Selector
          label="Gravedad"
          value={gravedad}
          onChange={setGravedad}
          opciones={catalogo.gravedades.map((g) => ({
            value: g,
            label: NOMBRE_DE_LA_GRAVEDAD[g] ?? g,
          }))}
        />
      </div>
      <TextField
          id="a-qu" label="A qué" value={agente} onChange={setAgente} />
      <TextField
          id="qu-le-pasa-opcional"
        label="Qué le pasa (opcional)"
        value={reaccion}
        onChange={setReaccion}
      />
      {gravedad === "GRAVE" && (
        <p className="text-[13px] text-rose-800">
          En la puerta se leerá «Alergia: {agente || "…"}». La reacción no sale.
        </p>
      )}
      <PrimaryButton
        onClick={() =>
          onGuardar({
            clase,
            gravedad,
            agente,
            ...(reaccion.trim() ? { reaccion: reaccion.trim() } : {}),
          })
        }
      >
        Guardar
      </PrimaryButton>
    </Caja>
  );
}

function FormularioDeDispositivo({
  catalogo,
  onGuardar,
  onCerrar,
}: {
  catalogo: CatalogoDeLaFicha;
  onGuardar: (body: Record<string, unknown>) => void;
  onCerrar: () => void;
}) {
  const [code, setCode] = useState(catalogo.dispositivos[0]?.code ?? "ANDADOR");
  const [detalle, setDetalle] = useState("");
  const [desde, setDesde] = useState(new Date().toISOString().slice(0, 10));
  const elegido = catalogo.dispositivos.find((d) => d.code === code);
  return (
    <Caja onCerrar={onCerrar}>
      <div className="flex flex-wrap gap-4">
        <Selector
          label="Dispositivo"
          value={code}
          onChange={setCode}
          opciones={catalogo.dispositivos.map((d) => ({
            value: d.code,
            label: d.deRiesgo ? `${d.nombre} · sale en la puerta` : d.nombre,
          }))}
        />
        <TextField
          id="desde" label="Desde" type="date" value={desde} onChange={setDesde} />
      </div>
      <TextField
        id="detalle-del-dispositivo"
        label={code === "OTRO" ? "Cuál (obligatorio)" : "Detalle (opcional)"}
        value={detalle}
        onChange={setDetalle}
      />
      {elegido?.deRiesgo && (
        <p className="text-[13px] text-rose-800">
          En la puerta se leerá «Lleva {elegido.nombre.toLowerCase()}». El
          detalle no sale.
        </p>
      )}
      <PrimaryButton
        onClick={() =>
          onGuardar({
            code,
            ...(detalle.trim() ? { detalle: detalle.trim() } : {}),
            desde,
          })
        }
      >
        Guardar
      </PrimaryButton>
    </Caja>
  );
}

function FormularioDeDieta({
  catalogo,
  onGuardar,
  onCerrar,
}: {
  catalogo: CatalogoDeLaFicha;
  onGuardar: (body: Record<string, unknown>) => void;
  onCerrar: () => void;
}) {
  const [textura, setTextura] = useState(catalogo.texturas[0] ?? "NORMAL");
  const [espesante, setEspesante] = useState(false);
  const [nivel, setNivel] = useState("2");
  const [restricciones, setRestricciones] = useState<string[]>([]);
  const [notas, setNotas] = useState("");
  return (
    <Caja onCerrar={onCerrar}>
      <div className="flex flex-wrap gap-4">
        <Selector
          label="Textura"
          value={textura}
          onChange={setTextura}
          opciones={catalogo.texturas.map((t) => ({
            value: t,
            label: NOMBRE_DE_LA_TEXTURA[t] ?? t,
          }))}
        />
        {espesante && (
          <Selector
            label="Nivel del espesante"
            value={nivel}
            onChange={setNivel}
            opciones={["1", "2", "3"].map((n) => ({ value: n, label: n }))}
          />
        )}
      </div>
      <Casilla
        marcado={espesante}
        onCambiar={setEspesante}
        etiqueta="Lleva espesante"
      />
      <div>
        <p className="mb-1 text-[13px] font-medium text-slate-600">
          Restricciones
        </p>
        <div className="flex flex-wrap gap-3">
          {catalogo.restricciones.map((r) => (
            <Casilla
              key={r.code}
              marcado={restricciones.includes(r.code)}
              onCambiar={(v) =>
                setRestricciones((xs) =>
                  v ? [...xs, r.code] : xs.filter((x) => x !== r.code),
                )
              }
              etiqueta={r.nombre}
            />
          ))}
        </div>
      </div>
      <TextField
          id="notas-opcional" label="Notas (opcional)" value={notas} onChange={setNotas} />
      <p className="text-[13px] text-slate-500">
        Esto escribe <strong>una versión nueva</strong>. La anterior se queda
        a la vista.
      </p>
      <PrimaryButton
        onClick={() =>
          onGuardar({
            textura,
            espesante,
            ...(espesante ? { nivelDeEspesante: Number(nivel) } : {}),
            restricciones,
            ...(notas.trim() ? { notas: notas.trim() } : {}),
          })
        }
      >
        Guardar la versión nueva
      </PrimaryButton>
    </Caja>
  );
}

// ── LAS PIEZAS DE SIEMPRE ──────────────────────────────────────────

function Seccion({
  titulo,
  pie,
  onAnadir,
  etiquetaDelBoton,
  children,
}: {
  titulo: string;
  pie: string;
  onAnadir: () => void;
  etiquetaDelBoton?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-7">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-[16px] font-semibold">{titulo}</h2>
        <OutlineButton onClick={onAnadir}>
          <span className="flex items-center gap-1">
            <Plus className="h-3.5 w-3.5" />
            {etiquetaDelBoton ?? "Añadir"}
          </span>
        </OutlineButton>
      </div>
      <p className="mb-3 text-[13px] text-slate-500">{pie}</p>
      {children}
    </section>
  );
}

function Caja({
  children,
  onCerrar,
}: {
  children: React.ReactNode;
  onCerrar: () => void;
}) {
  return (
    <div className="mb-3 flex flex-col gap-3 rounded-xl border border-slate-300 bg-white px-4 py-4">
      <button
        type="button"
        onClick={onCerrar}
        className="self-end text-slate-400 hover:text-slate-600"
        aria-label="Cerrar"
      >
        <X className="h-4 w-4" />
      </button>
      {children}
    </div>
  );
}

function Vacio({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-[13.5px] text-slate-500">
      {children}
    </p>
  );
}

function Etiqueta({
  children,
  tono = "gris",
}: {
  children: React.ReactNode;
  tono?: "gris" | "rojo" | "verde";
}) {
  const colores =
    tono === "rojo"
      ? "bg-rose-100 text-rose-900"
      : tono === "verde"
        ? "bg-emerald-50 text-emerald-800"
        : "bg-slate-100 text-slate-700";
  return (
    <span className={`rounded-md px-2 py-0.5 text-[12.5px] ${colores}`}>
      {children}
    </span>
  );
}

function Firma({
  quien,
  como,
  cuando,
}: {
  quien: string;
  como: string;
  cuando: string;
}) {
  return (
    <p className="mt-1 text-[13px] text-slate-500">
      Lo escribió {quien} ({como}) el {fechaLarga(cuando)}
    </p>
  );
}

function Casilla({
  marcado,
  onCambiar,
  etiqueta,
}: {
  marcado: boolean;
  onCambiar: (v: boolean) => void;
  etiqueta: string;
}) {
  return (
    <label className="flex items-center gap-2 text-[13.5px] text-slate-700">
      <input
        type="checkbox"
        checked={marcado}
        onChange={(e) => onCambiar(e.target.checked)}
        className="h-4 w-4"
      />
      {etiqueta}
    </label>
  );
}

function Selector({
  label,
  value,
  onChange,
  opciones,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  opciones: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="flex flex-col gap-1 text-[13px] font-medium text-slate-600">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-slate-300 px-3 py-2 text-[14px] text-slate-900"
      >
        {opciones.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
