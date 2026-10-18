// residencia-3 (D-64) · **LA FOTO Y SU CONSENTIMIENTO**, en la ficha.
//
// La pidió Matías para el mockup de la puerta: ayuda a la suplente y a
// quien no conoce a cada residente. Y en un pasillo la ve cualquiera que
// pase, de ahí el consentimiento.
//
// ── LAS DOS COSAS JUNTAS, porque la combinación es lo que importa ────
//
// Hay cuatro estados y los cuatro se dicen con una frase:
//
//   1. **sin foto y sin consentimiento** — lo normal el primer día.
//   2. **sin foto y con consentimiento** — se puede subir ya.
//   3. **con foto y con consentimiento** — la puerta la pinta.
//   4. **con foto y SIN consentimiento** — la puerta pinta las iniciales,
//      y eso es lo que hay que ver de un vistazo. Es el estado que un
//      interruptor de «mostrar sí/no» habría escondido.
//
// Y el aviso del 4 va en ámbar y arriba, porque es el único que pide algo
// de alguien.
//
// ── SE RETIRA, NO SE DESMARCA ───────────────────────────────────────
//
// Retirar el consentimiento escribe **una fila nueva que revoca**, como en
// toda la casa desde clinica-4. Una familia que llama para decir «quiten
// la foto de mi madre» tiene que dejar rastro: quién lo pidió, cuándo y
// por qué. Un booleano que se pone a `false` no contesta nada de eso.
//
// ── Y la foto se SUBE DESDE UN FICHERO, no desde la cámara ──────────
//
// Esta pantalla la usa la dirección en su despacho, con un portátil. La
// foto sale del móvil de la familia o del expediente, y pedir «hacer una
// foto» aquí obligaría a ir a la habitación con el portátil. La cámara es
// de la tablet, y la tablet no sube fotos de nadie.

import { useEffect, useRef, useState } from "react";
import { Camera, ShieldCheck, Trash2 } from "lucide-react";

import { api, apiBlob, ApiError } from "../../api.js";
import { FieldError, OutlineButton, PrimaryButton } from "../../ui.js";
import type { ResidenteFicha } from "./lib.js";

/** El mismo tope que `CLINICAL_PHOTO_MAX_BYTES` por defecto. Se comprueba
 *  aquí para decirlo antes de subir cuatro megas por una red lenta; quien
 *  lo garantiza es el servidor. */
const MAX_BYTES = 4 * 1024 * 1024;

export function BloqueDeFoto({
  residente,
  onCambio,
}: {
  residente: ResidenteFicha;
  onCambio: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const tieneFoto = residente.foto != null;
  const consentimiento = residente.consentimientoDeImagen ?? null;

  useEffect(() => {
    if (!tieneFoto) {
      setUrl(null);
      return;
    }
    let vivo = true;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const blob = await apiBlob(
          `/residencia/residentes/${residente.clientId}/foto`,
        );
        objectUrl = URL.createObjectURL(blob);
        if (vivo) setUrl(objectUrl);
      } catch {
        /* la ficha dice que hay foto y el volumen no la da: se pinta el
           hueco, que es lo que hay. El aviso de abajo lo cuenta. */
      }
    })();
    return () => {
      vivo = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [residente.clientId, tieneFoto]);

  async function subir(file: File) {
    setError(null);
    if (file.size > MAX_BYTES) {
      setError("La foto pesa demasiado. Usa una más pequeña.");
      return;
    }
    setTrabajando(true);
    try {
      const base64 = await aBase64(file);
      await api(`/residencia/residentes/${residente.clientId}/foto`, {
        method: "PUT",
        body: { jpegBase64: base64 },
      });
      onCambio();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "No se pudo subir la foto.",
      );
    } finally {
      setTrabajando(false);
    }
  }

  async function hacer(accion: () => Promise<unknown>) {
    setError(null);
    setTrabajando(true);
    try {
      await accion();
      onCambio();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("No se pudo guardar.");
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-slate-200 p-4">
      <h4 className="mb-3 text-[14px] font-semibold text-mipiace-ink">
        Foto y consentimiento de imagen
      </h4>

      {tieneFoto && !consentimiento && (
        // EL estado que hay que ver. Y dice qué pasa en la puerta, no una
        // regla abstracta.
        <p className="mb-3 rounded-xl bg-amber-50 px-4 py-3 text-[13.5px] text-amber-900">
          Hay foto y no hay consentimiento de imagen: la puerta pinta sus
          iniciales y no la foto. Anota el consentimiento, o quita la foto.
        </p>
      )}

      <div className="flex flex-wrap items-start gap-4">
        <div className="shrink-0">
          {url ? (
            <img
              src={url}
              alt=""
              className="h-24 w-24 rounded-xl bg-slate-100 object-cover"
            />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-xl bg-slate-200 text-[26px] font-semibold text-slate-500">
              {inicialesDe(residente.nombre)}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2 text-[13.5px]">
          <p className="text-slate-600">
            {tieneFoto
              ? consentimiento
                ? "La puerta de su habitación pinta esta foto."
                : "Subida, sin consentimiento: la puerta pinta las iniciales."
              : "Sin foto: la puerta pinta las iniciales."}
          </p>
          {consentimiento && (
            <p className="flex flex-wrap items-center gap-1.5 text-slate-600">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              Consentimiento anotado el{" "}
              {new Date(consentimiento.anotadoEn).toLocaleDateString("es-ES")}
              {consentimiento.loDio === "REPRESENTANTE"
                ? ` · lo dio ${consentimiento.nombre}${
                    consentimiento.parentesco
                      ? ` (${consentimiento.parentesco})`
                      : ""
                  }`
                : " · lo dio el residente"}
            </p>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <input
              ref={input}
              type="file"
              accept="image/jpeg"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void subir(f);
                e.target.value = "";
              }}
            />
            <OutlineButton
              onClick={() => input.current?.click()}
              disabled={trabajando}
            >
              <Camera className="h-4 w-4" />{" "}
              {tieneFoto ? "Cambiar la foto" : "Subir una foto"}
            </OutlineButton>
            {tieneFoto && (
              <OutlineButton
                disabled={trabajando}
                onClick={() =>
                  void hacer(() =>
                    api(`/residencia/residentes/${residente.clientId}/foto`, {
                      method: "DELETE",
                    }),
                  )
                }
              >
                <Trash2 className="h-4 w-4" /> Quitar la foto
              </OutlineButton>
            )}
          </div>

          {consentimiento ? (
            <OutlineButton
              disabled={trabajando}
              onClick={() =>
                void hacer(() =>
                  api(
                    `/residencia/residentes/${residente.clientId}/consentimiento-imagen/retirar`,
                    { method: "POST", body: {} },
                  ),
                )
              }
            >
              Retirar el consentimiento
            </OutlineButton>
          ) : (
            <AnotarConsentimiento
              clientId={residente.clientId}
              trabajando={trabajando}
              onHecho={onCambio}
              onError={setError}
            />
          )}

          {error && <FieldError message={error} />}
        </div>
      </div>
    </section>
  );
}

/** Quién lo dio: el residente o su familiar responsable. Los dos valores
 *  son los que el CHECK `client_consents_firmante_valido` admite, y el
 *  nombre y el parentesco sólo hacen falta en el segundo. */
function AnotarConsentimiento({
  clientId,
  trabajando,
  onHecho,
  onError,
}: {
  clientId: string;
  trabajando: boolean;
  onHecho: () => void;
  onError: (m: string | null) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [quien, setQuien] = useState<"PACIENTE" | "REPRESENTANTE">("PACIENTE");
  const [nombre, setNombre] = useState("");
  const [parentesco, setParentesco] = useState("");

  if (!abierto) {
    return (
      <PrimaryButton onClick={() => setAbierto(true)} disabled={trabajando}>
        Anotar el consentimiento de imagen
      </PrimaryButton>
    );
  }

  return (
    <div className="space-y-2 rounded-xl bg-slate-50 p-3">
      <p className="text-[13px] text-slate-600">
        ¿Quién dio el consentimiento?
      </p>
      <div className="flex gap-2">
        {(["PACIENTE", "REPRESENTANTE"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setQuien(v)}
            className={`min-h-[44px] rounded-xl border px-3 text-[13.5px] ${
              quien === v
                ? "border-mipiace-coral bg-mipiace-coral-soft"
                : "border-slate-200"
            }`}
          >
            {v === "PACIENTE" ? "El residente" : "Un familiar"}
          </button>
        ))}
      </div>
      {quien === "REPRESENTANTE" && (
        <div className="space-y-2">
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Nombre de quien lo dio"
            className="min-h-[44px] w-full rounded-xl border border-slate-200 px-3 text-[13.5px]"
          />
          <input
            value={parentesco}
            onChange={(e) => setParentesco(e.target.value)}
            placeholder="Parentesco (hija, sobrino…)"
            className="min-h-[44px] w-full rounded-xl border border-slate-200 px-3 text-[13.5px]"
          />
        </div>
      )}
      <div className="flex gap-2">
        <OutlineButton onClick={() => setAbierto(false)}>Cancelar</OutlineButton>
        <PrimaryButton
          disabled={trabajando}
          onClick={() => {
            void (async () => {
              onError(null);
              try {
                await api(
                  `/residencia/residentes/${clientId}/consentimiento-imagen`,
                  {
                    method: "POST",
                    body:
                      quien === "REPRESENTANTE"
                        ? {
                            signer: quien,
                            signerName: nombre,
                            signerRelation: parentesco,
                          }
                        : { signer: quien },
                  },
                );
                setAbierto(false);
                onHecho();
              } catch (err) {
                onError(
                  err instanceof ApiError
                    ? err.message
                    : "No se pudo anotar el consentimiento.",
                );
              }
            })();
          }}
        >
          Guardar
        </PrimaryButton>
      </div>
    </div>
  );
}

export function inicialesDe(nombre: string): string {
  const p = nombre.trim().split(/\s+/).filter(Boolean);
  if (p.length === 0) return "·";
  return ((p[0]![0] ?? "") + (p.length > 1 ? (p[1]![0] ?? "") : "")).toUpperCase();
}

/** El fichero a base64 sin la cabecera `data:`. */
function aBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = String(fr.result);
      resolve(s.slice(s.indexOf(",") + 1));
    };
    fr.onerror = () => reject(fr.error ?? new Error("no se pudo leer la foto"));
    fr.readAsDataURL(file);
  });
}
