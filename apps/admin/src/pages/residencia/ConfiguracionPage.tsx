// cuadro-de-control (decisión 2) · **«CONFIGURACIÓN»: TODO LO QUE SE
// CONFIGURA UNA VEZ, DETRÁS DE UNA SOLA ENTRADA.**
//
// Carmen veía unas dieciocho entradas en el menú —Tiendas, Agenda ·
// Catálogo, Agenda · Horario, Edificio, Turnos, Controles, Plantillas,
// Guardia, Personal, Indicadores, Contrato de datos, Mi cuenta,
// Seguridad, Ajustes…— y quince de ellas se tocan el día del alta y el día
// que cambia algo. «Hay demasiadas opciones, no parece un cuadro de
// control.»
//
// Esto es la otra mitad de la respuesta: el menú se queda con las cinco
// cosas del día a día y lo demás vive aquí.
//
// ── LAS RUTAS NO CAMBIAN ────────────────────────────────────────────
//
// Ni una. Cada tarjeta es un `Link` al mismo `to` que tenía su entrada del
// menú, y la lista sale de `NAV_ITEMS` pasada por el MISMO filtro de
// capabilities y de rol que la barra lateral (`entradasDeConfiguracion`).
// Es otra forma de llegar, no otro sitio:
//
//   · un marcador de `/admin/residencia/turnos` sigue funcionando;
//   · una cuenta sin la clínica no ve «Contrato de datos» aquí tampoco,
//     porque la bandera `capability` la sigue filtrando antes;
//   · un MANAGER no ve lo que es `ownerOnly`, igual que en el menú.
//
// ── Y NO SE ESCRIBE LA LISTA A MANO ─────────────────────────────────
//
// Lo único que este fichero añade es la FRASE de cada tarjeta. La lista y
// su orden salen de `AdminShell`, que es donde está el registro: una
// sección nueva con `enConfiguracion: true` aparece aquí sola, y el banco
// comprueba que ninguna entrada se quede sin forma de llegar.

import { Link } from "react-router-dom";

import { AdminShell } from "../../AdminShell.js";
import { entradasDeConfiguracion, etiquetaDeLaEntrada } from "../../AdminShell.js";
import { readCurrentRole, readImpersonationState } from "../../api.js";
import { useTenantCapabilities } from "../../capabilities.js";
import { CenteredLoader } from "../../ui.js";

/**
 * Qué hay dentro de cada una, en una línea.
 *
 * Está aquí y no en `NAV_ITEMS` a propósito: en la barra lateral una
 * entrada es una palabra, y el registro no tiene por qué cargar con el
 * texto de una pantalla. Lo que falte se pinta sin frase, no en blanco.
 */
const QUE_HAY_DENTRO: Record<string, string> = {
  "/admin/stores": "El nombre, la dirección y los datos fiscales del centro.",
  "/admin/residencia/edificio": "Plantas, habitaciones y camas. Quién ocupa cada plaza.",
  "/admin/residencia/turnos": "Los turnos del centro y a qué hora empieza y acaba cada uno.",
  "/admin/residencia/controles":
    "El catálogo de cuidados: qué se registra, cómo se mide y quién puede.",
  "/admin/residencia/plantillas":
    "Los planes de cuidados que se precargan al dar de alta a alguien.",
  "/admin/residencia/guardia":
    "A qué móvil sube cada nivel, cuánto tarda en escalar y el servicio de guardia.",
  "/admin/staff": "El personal, sus roles de cuidado y sus PIN.",
  "/admin/residencia/indicadores":
    "Los indicadores del mes y el objetivo de cada uno.",
  // calidad-1 · el mapa y el registro de no conformidades.
  "/admin/residencia/procesos":
    "El mapa de procesos del centro, sus riesgos y sus objetivos de calidad.",
  "/admin/residencia/no-conformidades":
    "Los hallazgos de auditorías e inspecciones, sus acciones y el PAC.",
  "/admin/contrato-tratamiento":
    "El contrato de encargado del tratamiento. Lo acepta la dirección.",
  "/admin/account": "Tu nombre, tu correo y tu contraseña.",
  "/admin/security": "La verificación en dos pasos y tus sesiones abiertas.",
  "/admin/settings": "Los módulos del negocio y los ajustes generales.",
};

export function ConfiguracionPage() {
  const caps = useTenantCapabilities();
  const role = readCurrentRole();
  const impersonating = readImpersonationState() != null;
  // Mientras las capacidades no han llegado no se pinta la lista: con
  // `caps === null` el filtro esconde todo lo gateado, así que lo que se
  // vería es media página — y media página de secciones que aparecen una
  // a una se lee como un error.
  if (caps == null) return <CenteredLoader label="Cargando…" />;
  const secciones = entradasDeConfiguracion(caps, role, impersonating);
  return (
    // `ancho="completo"`, igual que el panel: son doce tarjetas, y en la
    // columna estrecha de un formulario (`max-w-3xl`) dejaban media
    // pantalla en blanco a la derecha y seis filas de alto. A todo el
    // ancho son tres columnas y cuatro filas, y se leen de un vistazo —
    // que es lo que tiene que hacer un índice.
    <AdminShell title="Configuración" ancho="completo">
      <p className="-mt-2 mb-4 text-[13.5px] text-slate-500">
        Lo que se configura una vez. El día a día está en el menú: el panel,
        los residentes, las incidencias, los relevos y las obligaciones.
      </p>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {secciones.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className="flex min-h-[66px] items-start gap-3 rounded-2xl border border-slate-200 bg-white px-3.5 py-3 hover:border-slate-300 hover:bg-slate-50"
            >
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-mipiace-stone">
                <Icon className="h-[18px] w-[18px] text-slate-500" strokeWidth={2.1} />
              </span>
              <span className="min-w-0">
                <span className="block text-[14.5px] font-medium text-mipiace-ink">
                  {etiquetaDeLaEntrada(item, caps.residencia === true)}
                </span>
                {QUE_HAY_DENTRO[item.to] && (
                  <span className="mt-0.5 block text-[12.5px] leading-snug text-slate-500">
                    {QUE_HAY_DENTRO[item.to]}
                  </span>
                )}
              </span>
            </Link>
          );
        })}
      </div>
      {secciones.length === 0 && (
        <p className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-[13.5px] text-slate-500">
          No hay nada que puedas configurar con tu rol. Pídeselo a la
          dirección.
        </p>
      )}
    </AdminShell>
  );
}
