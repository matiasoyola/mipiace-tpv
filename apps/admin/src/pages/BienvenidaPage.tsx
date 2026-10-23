// primer-acceso · LA PÁGINA DE BIENVENIDA.
//
// Es la pantalla a la que lleva el botón del correo de bienvenida, y es la
// única del bloque que ve el propietario antes de estar dentro:
//
//   su nombre y su email (sin poder editarlos) · UN campo de contraseña
//   con el botón de mostrar · los requisitos marcándose en vivo · «Entrar»
//
// ── Un campo, y no dos ──────────────────────────────────────────────
//
// Ni «repite la contraseña». La contraseña se escribe una vez, con el
// botón de mostrar al lado: el segundo campo existe para cazar una errata
// que no puedes ver, y aquí SÍ puedes verla. Y si aun así se equivocara,
// el camino de vuelta es el mismo que ya hay —«¿olvidaste tu
// contraseña?»— y no un enlace quemado.
//
// ── Al pulsar queda DENTRO ──────────────────────────────────────────
//
// `/auth/invitacion/aceptar` devuelve el par access/refresh, así que esta
// pantalla guarda los tokens y navega a `/`. Volver a pasar por el login
// después de elegir la contraseña era el paso que el bloque viene a
// quitar: el filtro «¿y qué?» no lo habría dejado pasar.
//
// ── Y el enlace muerto tiene su propia cara ─────────────────────────
//
// «Este enlace ya no vale» con un botón que manda otro. Con respuesta
// neutra, como el reset: la pantalla dice lo mismo exista el correo o no,
// porque el que llega aquí con un token caducado podría ser cualquiera.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Check, MailCheck } from "lucide-react";

import {
  MENSAJE_CONTRASENA_CORTA,
  contrasenaValida,
  requisitosDeContrasena,
} from "@mipiacetpv/util-validation/contrasena";

import { api, ApiError, storeTokens } from "../api.js";
import {
  CenteredCard,
  CenteredLoader,
  FieldError,
  PasswordField,
  PrimaryButton,
  ReadOnlyField,
  SuccessBanner,
} from "../ui.js";

interface Invitado {
  nombre: string;
  email: string;
  centro: string;
}

type Estado =
  | { fase: "cargando" }
  | { fase: "lista"; invitado: Invitado }
  | { fase: "muerta" };

export function BienvenidaPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const token = useMemo(
    () => new URLSearchParams(location.search).get("token") ?? "",
    [location.search],
  );

  const [estado, setEstado] = useState<Estado>({ fase: "cargando" });
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reenviado, setReenviado] = useState(false);
  const [emailParaReenvio, setEmailParaReenvio] = useState("");

  const requisitos = requisitosDeContrasena(password);
  const vale = contrasenaValida(password);

  const consultar = useCallback(async () => {
    if (!token) {
      setEstado({ fase: "muerta" });
      return;
    }
    try {
      const r = await api<Invitado>("/auth/invitacion/consultar", {
        method: "POST",
        body: { token },
      });
      setEstado({ fase: "lista", invitado: r });
    } catch (err) {
      // 410 es la respuesta normal de un enlace caducado o ya usado, no
      // un fallo: tiene su propia pantalla. El 429 del throttle también
      // acaba aquí, y lo que se le ofrece es pedir otro enlace, que es
      // justo lo que necesita quien de verdad llegó tarde.
      if (err instanceof ApiError) {
        setEstado({ fase: "muerta" });
        return;
      }
      setError("No hemos podido abrir el enlace. Recarga la página.");
    }
  }, [token]);

  useEffect(() => {
    void consultar();
  }, [consultar]);

  async function entrar(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!vale) {
      setError(MENSAJE_CONTRASENA_CORTA);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const tokens = await api<{ accessToken: string; refreshToken: string }>(
        "/auth/invitacion/aceptar",
        { method: "POST", body: { token, password } },
      );
      storeTokens(tokens);
      // `/` decide a dónde: el contrato de datos si falta aceptarlo, y si
      // no, la pantalla de inicio que le toque por sus módulos.
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 410) {
        setEstado({ fase: "muerta" });
        return;
      }
      setError(
        err instanceof ApiError
          ? err.message
          : "No hemos podido guardar la contraseña. Reintenta.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function pedirOtro(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api("/auth/invitacion/reenviar", {
        method: "POST",
        body: { email: emailParaReenvio.trim().toLowerCase() },
      });
      setReenviado(true);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "No hemos podido pedir el enlace. Reintenta.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (estado.fase === "cargando") {
    return <CenteredLoader label="Abriendo tu invitación…" />;
  }

  if (estado.fase === "muerta") {
    return (
      <CenteredCard>
        <h1 className="text-[22px] font-semibold text-mipiace-ink tracking-tight mb-1">
          Este enlace ya no vale
        </h1>
        <p className="text-[13.5px] text-slate-500 mt-2 leading-relaxed">
          Ha caducado o ya se ha usado. Dinos tu correo y te mandamos uno
          nuevo.
        </p>
        {reenviado ? (
          <div className="mt-5">
            <SuccessBanner message="Si ese correo tiene una invitación pendiente, te hemos enviado un enlace nuevo. Revisa también la carpeta de spam." />
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div>
              <label
                htmlFor="emailReenvio"
                className="block text-[13px] font-medium text-mipiace-ink-soft mb-1.5"
              >
                Tu correo
              </label>
              <input
                id="emailReenvio"
                type="email"
                autoComplete="username"
                value={emailParaReenvio}
                onChange={(e) => setEmailParaReenvio(e.target.value)}
                className="w-full h-12 px-3.5 rounded-xl bg-mipiace-stone border border-transparent text-[14.5px] text-mipiace-ink focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none"
              />
            </div>
            <PrimaryButton
              type="button"
              busy={busy}
              disabled={emailParaReenvio.trim().length === 0}
              onClick={() => void pedirOtro()}
            >
              <MailCheck className="h-4 w-4" aria-hidden />
              Envíame uno nuevo
            </PrimaryButton>
            <FieldError message={error} />
          </div>
        )}
        <div className="mt-7">
          <a
            href="/login"
            className="text-[13.5px] text-mipiace-coral-dark hover:underline font-medium"
          >
            Ya tengo contraseña: ir al acceso
          </a>
        </div>
      </CenteredCard>
    );
  }

  const { invitado } = estado;
  return (
    <CenteredCard>
      <h1 className="text-[22px] font-semibold text-mipiace-ink tracking-tight mb-1">
        Hola {invitado.nombre}
      </h1>
      <p className="text-[13.5px] text-slate-500 mt-1 mb-6 leading-relaxed">
        Ya tienes acceso a la gestión de {invitado.centro}. Elige tu
        contraseña y entras.
      </p>
      <form onSubmit={entrar} className="space-y-4">
        {/* El email NO se edita: es la credencial con la que se te ha
            dado acceso, y un campo editable aquí invitaría a cambiarlo
            —que no es lo que esta pantalla hace— o a teclear otro y no
            poder entrar. */}
        <ReadOnlyField label="Tu usuario" value={invitado.email} />
        <PasswordField
          id="nuevaContrasena"
          label="Elige tu contraseña"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          required
        />
        <ul className="space-y-1.5" data-test="requisitos">
          {requisitos.map((r) => (
            <li
              key={r.texto}
              className={`flex items-center gap-2 text-[12.5px] ${
                r.cumple ? "text-emerald-700" : "text-slate-400"
              }`}
            >
              <Check
                className={`h-3.5 w-3.5 shrink-0 ${
                  r.cumple ? "opacity-100" : "opacity-30"
                }`}
                aria-hidden
              />
              <span>{r.texto}</span>
              {/* Lo que un lector de pantalla necesita: el tic verde no
                  se oye. */}
              <span className="sr-only">
                {r.cumple ? " (cumplido)" : " (pendiente)"}
              </span>
            </li>
          ))}
        </ul>
        <PrimaryButton busy={busy} disabled={!vale}>
          Entrar
        </PrimaryButton>
        <FieldError message={error} />
      </form>
    </CenteredCard>
  );
}
