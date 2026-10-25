// Layout reutilizable de las pantallas autenticadas del admin (B2 §4,
// ampliado en B3 con drawer móvil + activación de Dispositivos /
// Cajeros / Seguridad + modal de confirmación al cerrar sesión en
// todos los dispositivos).

import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  BellRing,
  Building2,
  Calculator,
  CalendarCheck,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  Clock,
  FileText,
  FileWarning,
  Gauge,
  Network,
  ClipboardX,
  Gift,
  KeyRound,
  LayoutDashboard,
  Layers,
  Menu,
  Package,
  Printer,
  RefreshCw,
  ScanBarcode,
  Settings,
  Shield,
  ShieldCheck,
  Tag,
  Ticket,
  User,
  UserPlus,
  Users,
  X,
} from "lucide-react";

import { api, ApiError, readCurrentRole, readImpersonationState } from "./api.js";
import {
  useTenantCapabilities,
  type TenantCapabilities,
} from "./capabilities.js";
// cuadro-de-control · el panel, compartido con `PanelPage`: de ahí salen
// los contadores del menú. Una sola petición para los dos.
import {
  contadorDelMenu,
  usePanelDeResidencia,
  type ClaveDeContador,
} from "./residencia-panel.js";
import type { Panel } from "./pages/residencia/relevo-lib.js";

import { ImpersonationBanner } from "./components/ImpersonationBanner.js";
import { LogoutEverywhereModal } from "./components/LogoutEverywhereModal.js";
import { Logo } from "./Logo.js";
import { PRODUCT_VERSION, readBuildHash } from "./version.js";
import { clearTokens } from "./api.js";

interface NavItem {
  to: string;
  label: string;
  icon: typeof User;
  disabled?: boolean;
  // Si está presente, se pinta un punto rojo en la nav cuando el badge
  // sea > 0. Se usa en B5 para la bandeja de tickets `SYNC_FAILED`.
  badge?: "syncErrors";
  // B6 §1: si está restringido a OWNER, el MANAGER no ve el ítem en su
  // sidebar. Las páginas restringidas también validan el rol en cliente,
  // pero ocultarlo del sidebar evita confusión.
  ownerOnly?: boolean;
  // B-OnboardingV2 (Frente 7): secciones que dejaron de pertenecer al
  // propietario y pasaron al equipo mipiacetpv (super-admin). Se ocultan
  // del sidebar para OWNER/MANAGER. Las rutas backend siguen activas
  // para impersonation read-only del super-admin; ningún usuario
  // per-tenant las verá en su admin.
  superAdminOnly?: boolean;
  // B-reservas-2 (ADR-R6): la entrada sólo se muestra si el tenant tiene la
  // capability activada. H1 añade "caja" (`Tenant.cajaEnabled`) junto a la
  // "agenda" que traía B-reservas-2. Los flags se leen una vez desde
  // /admin/tenant/settings; mientras cargan, las entradas con capability
  // permanecen ocultas para no parpadear.
  //
  // Esconder NO es gatear: cada una de estas secciones tiene además su
  // puerta de servidor (`lib/caja-gate.ts`). Esto es sólo para que el
  // propietario de un colegio no vea "Comanderas" en su barra lateral.
  // holded-desconectar (ADR-020) · `holdedDejado` es la única que se
  // enciende al APAGAR Holded, no al encenderlo: la pantalla que gatea
  // existe SÓLO en el comercio que lo dejó.
  // residencia-1 · `residencia` es la sexta, y la primera que se enciende
  // SOBRE otra: un tenant de residencia tiene además la clínica y el CRM.
  // Lo que gatea son las tres pantallas del centro; la sección de
  // residencia de Personal se esconde DENTRO de esa pantalla, que ya
  // existía para la agenda.
  capability?:
    | "agenda"
    | "caja"
    | "holded"
    | "fichaje"
    | "holdedDejado"
    | "residencia"
    // B-reservas-8 · los bonos de sesiones. Una entrada y nada más: los
    // ajustes, la numeración, las plantillas y el alta inicial caben en
    // una pantalla.
    | "bonos"
    // clinica-7 · la sección del contrato de encargado. La capability ya
    // existía (`clinica-1` la trajo para la sección clínica de Personal);
    // lo que es nuevo es que una entrada del menú la use.
    | "clinica"
    // clinica-8 (fase B, 18) · no es una capability del tenant: es su
    // VERTICAL. Lo usa «Comanderas», que sólo existe en hostelería.
    | "hosteleria";
  // F1 · el activo se calcula por prefijo, y "Control horario"
  // (`/admin/fichaje`) es prefijo de sus dos hermanas. Sin esto, las tres
  // entradas se pintarían activas a la vez en cualquiera de ellas.
  exact?: boolean;
  // ── cuadro-de-control · LOS DOS CAMPOS DEL MENÚ DE UNA RESIDENCIA ──
  //
  // «Hay demasiadas opciones, no parece un cuadro de control» (Matías,
  // 23-10, mirando el panel de Carmen). Una peluquería entra en el panel
  // una vez al mes; la dirección de una residencia vive en él, y veía
  // unas dieciocho entradas de las que quince se configuran una vez.
  //
  // **En una residencia el menú es otro**, y no se construye con una
  // segunda lista: se construye proyectando ESTA. Que `NAV_ITEMS` siga
  // siendo el único registro es lo que mantiene la garantía de
  // hotfix-menu-capabilities (una entrada gateada no se puede colar) y lo
  // que hace que las rutas no cambien — «Configuración» es otra forma de
  // llegar a las mismas pantallas.
  //
  // `etiquetaEnResidencia` · el mismo destino con otro nombre. Hoy sólo
  // «Tiendas» → «Centro»: una residencia tiene UN centro, y «Tiendas» en
  // plural delante de quien dirige uno es una palabra de otro negocio.
  etiquetaEnResidencia?: string;
  // `contador` · de qué cifra del panel sale el número de la entrada. El
  // mismo número y de la misma petición (decisión 1): ver
  // `contadorDelMenu` en `residencia-panel.ts`.
  contador?: ClaveDeContador;
}

/** Las capabilities que gatean una entrada del menú. Sale del tipo de
 *  `NavItem` a propósito: añadir una allí obliga a darle su rama en
 *  `capabilidadActiva`, y eso es lo que impide que vuelva a pasar lo de
 *  `bonos` y `clinica`. */
type CapabilidadDeMenu = NonNullable<NavItem["capability"]>;

/**
 * ¿Se pinta una entrada gateada por esta capability?
 *
 * hotfix-menu-capabilities · esto era una escalera de `if` dentro del
 * filtro que acababa en `return true`, y el `return true` se comió las dos
 * últimas capabilities que se añadieron al tipo: «Bonos» (`bonos`) se
 * pintaba en TODAS las cuentas y «Contrato de datos» (`clinica`) en todo
 * OWNER aunque su cuenta no tuviera la clínica. Se vio en producción, en
 * Jardín de Gredos.
 *
 * Ahora es un `switch` exhaustivo: el `default` asigna el valor a un
 * `never`, así que **declarar una capability en `NavItem` y no darle su
 * rama aquí no compila**. No hay rama muda para una capability
 * desconocida, que es lo que había antes.
 *
 * Y todas `=== true`, no `!== false`: mientras `caps` es `null` no se sabe
 * nada, y la entrada no se pinta para no parpadear.
 */
function capabilidadActiva(
  capability: CapabilidadDeMenu,
  caps: TenantCapabilities | null,
): boolean {
  switch (capability) {
    case "agenda":
      return caps?.agenda === true;
    case "caja":
      return caps?.caja === true;
    case "holded":
      return caps?.holded === true;
    case "fichaje":
      return caps?.fichaje === true;
    // holded-desconectar (ADR-020) · la única que se enciende al APAGAR
    // Holded. Se evalúa igual que las demás.
    case "holdedDejado":
      return caps?.holdedDejado === true;
    case "residencia":
      return caps?.residencia === true;
    case "bonos":
      return caps?.bonos === true;
    case "clinica":
      return caps?.clinica === true;
    // clinica-8 (fase B, 18) · NO es una capability del tenant: es su
    // VERTICAL. La usa «Comanderas», que reparte las etiquetas del
    // catálogo entre las impresoras de barra y de cocina — en una
    // clínica no hay barra, no hay cocina y no hay comanda.
    //
    // `=== "HOSPITALITY"` y no `!== null`: mientras no se sabe el
    // vertical no se pinta, que es la salida segura de este dato.
    //
    // Y mira SÓLO el vertical, aunque una comandera se imprima desde el
    // TPV: una capability de este `switch` es UN flag —lo recorre el
    // banco de hotfix-menu-capabilities encendiéndolas de una en una— y
    // la caja ya la exige la PÁGINA, que vive dentro de un `CajaGate`.
    // La frontera está en la ruta; esto decide qué se ofrece.
    case "hosteleria":
      return caps?.businessType === "HOSPITALITY";
    default: {
      // Si esto no compila, falta un `case` para la capability que acabas
      // de añadir al tipo de `NavItem`. Añádelo: no hay default silencioso.
      const nunca: never = capability;
      return nunca;
    }
  }
}

// hotfix-menu-capabilities · exportadas para que el banco pueda recorrer
// TODAS las entradas y comprobar que cada capability esconde las suyas con
// su propio flag. Un `switch` exhaustivo garantiza que hay una rama; el
// test garantiza que la rama mira la capability que dice mirar.
export const NAV_ITEMS: NavItem[] = [
  // B5 activa Holded como sección "Sync errors". B6 añade Ajustes y
  // Tickets regalo. B-OnboardingV2 quita del OWNER las secciones
  // técnicas: la gestión de Holded, los dispositivos, los ajustes
  // técnicos y la bandeja de errores de sync ahora son responsabilidad
  // del equipo mipiacetpv (super-admin). El OWNER mantiene la operativa
  // de negocio: tiendas, cajeros, tickets regalo, su cuenta, seguridad.
  // H1 · "Tiendas" NO lleva `capability: "caja"`: la ficha fiscal del
  // local (razón social, dirección) vale para cualquier empresa. Lo que
  // cuelga de la caja dentro de la tienda —cajas registradoras, mesas,
  // entrega de ticket— se esconde dentro de la propia pantalla.
  // cuadro-de-control · en una residencia se llama «Centro» y vive en
  // «Configuración»: la ficha fiscal del local se toca el día del alta y
  // el día que cambia el IBAN.
  {
    to: "/admin/stores",
    label: "Tiendas",
    icon: Building2,
    etiquetaEnResidencia: "Centro",
  },
  // v1.3-piloto-feedback · Lote 1: Dispositivos era visible sólo a
  // super-admin por un error histórico — el backend del endpoint de
  // pairing codes ya acepta OWNER/MANAGER. Lo abrimos al OWNER y al
  // MANAGER para que generen el pairing sin escalar a soporte.
  { to: "/admin/devices", label: "Dispositivos", icon: Calculator, capability: "caja" },
  // v1.4-Impresoras-Fase-1 Lote 1: gestor de impresoras térmicas
  // (USB / WIFI) por register. OWNER + MANAGER pueden tocarlo
  // porque es operativa diaria (cambiar IP del router, etc.).
  { to: "/admin/printers", label: "Impresoras", icon: Printer, capability: "caja" },
  { to: "/admin/cashiers", label: "Cajeros", icon: Users, capability: "caja" },
  // B-reservas-3: panel de personal (profesionales + skills + turnos) de la
  // agenda. Sólo visible con la capability `agenda` activada (misma puerta
  // que el catálogo de agenda); la página además se auto-gatea.
  {
    to: "/admin/staff",
    label: "Personal",
    icon: CalendarClock,
    capability: "agenda",
  },
  // clinica-7 · EL CONTRATO DE ENCARGADO DEL TRATAMIENTO.
  //
  // `ownerOnly`, y no es cosmético: lo acepta y lo revoca la dueña, y la
  // ruta lo comprueba contra el rol de la BASE. Enseñarle la sección al
  // encargado sería ofrecerle un botón que la API le va a negar.
  //
  // Con `capability: "clinica"` no aparece en ningún comercio sin el
  // módulo. Y esconder NO es gatear: la ruta contesta la 404 de siempre.
  {
    to: "/admin/contrato-tratamiento",
    label: "Contrato de datos",
    icon: ShieldCheck,
    ownerOnly: true,
    capability: "clinica",
  },
  // v1.0-pilotos · Lote 6 (#22): importador de clientes desde Excel/CSV.
  // OWNER-only — crea contactos en Holded, que es la fuente de verdad.
  // H1 · el importador crea contactos EN HOLDED, que es la fuente de
  // verdad. Sin Holded no tiene destino: el endpoint aborta y el
  // propietario se queda mirando un error. Se esconde.
  { to: "/admin/contacts-import", label: "Importar clientes", icon: UserPlus, ownerOnly: true, capability: "holded" },
  // catalogo-local · el CRUD del catálogo propio. Es "dónde están mis
  // productos" para cualquier comercio con caja, tenga Holded o no: con
  // Holded se listan en sólo lectura, sin Holded se dan de alta aquí.
  { to: "/admin/catalog", label: "Catálogo", icon: Package, capability: "caja" },
  // catalogo-local · esta entrada se llamaba "Productos" y llevaba a la
  // bandeja de SKUs que Holded silenció. Dos cambios y ninguno toca la
  // pantalla por dentro:
  //
  //   · **El nombre.** Con "Catálogo" al lado, "Productos" era ambiguo:
  //     dos etiquetas que significan lo mismo para cualquiera que no
  //     haya escrito el código. "Revisión de SKU" dice lo que es, y
  //     coincide con el título que ya se lee al entrar ("Productos
  //     pendientes de SKU").
  //   · **La capability pasa de `caja` a `holded`.** La bandeja existe
  //     porque el auto-SKU subió un SKU a Holded y Holded lo descartó en
  //     silencio (ADR-010). Sin Holded no puede tener ni una fila, y su
  //     texto entero habla de Holded. Enseñarle al comercio de catálogo
  //     local una sección permanentemente vacía que le habla de un ERP
  //     que no usa es justo lo que H1 vino a quitar del panel.
  { to: "/admin/products", label: "Revisión de SKU", icon: ScanBarcode, capability: "holded" },
  // B-reservas-2: catálogo de agenda (duración/pausas/canales + recursos).
  // Sólo visible si el tenant tiene la capability `agenda` activada.
  {
    to: "/admin/agenda-catalog",
    label: "Agenda · Catálogo",
    icon: CalendarClock,
    capability: "agenda",
  },
  // B-reservas-7a: el horario del centro, los días especiales y la
  // retícula. Misma puerta que el resto del módulo (`agendaEnabled`); la
  // página además se auto-gatea.
  {
    to: "/admin/agenda-hours",
    label: "Agenda · Horario",
    icon: CalendarClock,
    capability: "agenda",
  },
  // v1.3-Operativa-Extra · Lote 1: editor de aliases de tags. Visible
  // a OWNER y MANAGER porque la operativa (renombrar categorías) es de
  // negocio, no técnica.
  // F1 (ADR-018) · el control horario. Tres entradas y nada más. Para el
  // colegio de Talavera ÉSTA es su barra lateral entera.
  {
    to: "/admin/fichaje",
    label: "Control horario",
    icon: Clock,
    capability: "fichaje",
    exact: true,
  },
  {
    to: "/admin/fichaje/empleados",
    label: "Empleados",
    icon: Users,
    capability: "fichaje",
  },
  {
    to: "/admin/fichaje/registro",
    label: "Registro de jornada",
    icon: ClipboardList,
    capability: "fichaje",
  },
  // residencia-5 (decisión de producto 5) · **EL PANEL VA PRIMERO.** Es
  // la pantalla de inicio de un centro de residencia y lo que la dirección
  // abre cada mañana; ponerlo detrás de «Residentes» sería ponerlo detrás
  // de una pantalla que se toca una vez al mes.
  {
    to: "/admin/residencia/panel",
    label: "Panel",
    icon: LayoutDashboard,
    capability: "residencia",
  },
  // residencia-1 (D-48) · las tres pantallas del centro. Para Jardín de
  // Gredos ÉSTAS son su barra lateral, junto a Personal: no tiene caja, ni
  // impresoras, ni etiquetas, ni Holded.
  //
  // El orden es el del trabajo, no el alfabético: primero quién vive aquí,
  // después dónde, y al final el cuadrante.
  {
    to: "/admin/residencia/residentes",
    label: "Residentes",
    icon: Users,
    capability: "residencia",
    contador: "fichas",
  },
  {
    to: "/admin/residencia/edificio",
    label: "Edificio",
    icon: Building2,
    capability: "residencia",
  },
  {
    to: "/admin/residencia/turnos",
    label: "Turnos",
    icon: Clock,
    capability: "residencia",
  },
  // residencia-2 · el catálogo y las plantillas, DESPUÉS de los turnos y
  // antes de nada de caja. El orden sigue siendo el del trabajo: quién
  // vive aquí, dónde, el cuadrante, y luego qué se le hace y qué se le
  // precarga. El plan de un residente no está en la barra: se llega desde
  // su ficha, porque es de una persona y no del centro.
  {
    to: "/admin/residencia/controles",
    label: "Controles",
    icon: ClipboardList,
    capability: "residencia",
  },
  {
    to: "/admin/residencia/plantillas",
    label: "Plantillas",
    icon: Layers,
    capability: "residencia",
  },
  // residencia-4 · el libro y la guardia. **Incidencias va la PRIMERA de
  // las dos** y pegada a lo del día: es lo que la dirección abre cada
  // mañana («qué hay abierto hoy»), y la configuración de la guardia se
  // toca una vez al año.
  {
    to: "/admin/residencia/incidencias",
    label: "Incidencias",
    icon: AlertTriangle,
    capability: "residencia",
    contador: "incidencias",
  },
  {
    to: "/admin/residencia/guardia",
    label: "Guardia",
    icon: BellRing,
    capability: "residencia",
  },
  // residencia-5 · los relevos, las obligaciones y los indicadores.
  // **«Relevos» va pegado a «Incidencias»** y no al final: las dos son lo
  // del día, y el relevo sin confirmar de esta mañana es lo segundo que
  // la dirección mira. Los indicadores van al final de las tres porque se
  // miran una vez al mes.
  {
    to: "/admin/residencia/relevos",
    label: "Relevos",
    icon: ClipboardCheck,
    capability: "residencia",
    contador: "relevos",
  },
  {
    to: "/admin/residencia/obligaciones",
    label: "Obligaciones",
    icon: CalendarCheck,
    capability: "residencia",
    contador: "obligaciones",
  },
  {
    to: "/admin/residencia/indicadores",
    label: "Indicadores",
    icon: Gauge,
    capability: "residencia",
  },
  // calidad-1 (D-70, D-73) · el mapa y las no conformidades.
  //
  // **No están en el menú de una residencia: viven en «Configuración»**
  // (cuadro-de-control, decisión 2). Y no hace falta marcarlas: ese
  // bloque descartó a propósito una bandera `enConfiguracion` porque la
  // primera entrada a la que se le olvidara se quedaba sin forma de
  // llegar. Lo que enseña «Configuración» es **todo lo que pasa el
  // filtro y no es una de las cinco del día a día**, así que estas dos
  // caen ahí solas por estar aquí y no en `MENU_DE_RESIDENCIA`.
  //
  // Que es además lo correcto: el mapa se ajusta una vez al año y las no
  // conformidades se trabajan por semanas. Lo urgente de calidad —una
  // acción vencida, una revisión pasada de fecha, una propuesta— sí sale
  // en el panel, y sale como una banda (`CalidadQueNoEspera`).
  //
  // El mapa va antes que las NC porque una NC cuelga de un proceso: sin
  // mapa, la pantalla de no conformidades no deja hacer nada.
  {
    to: "/admin/residencia/procesos",
    label: "Procesos",
    icon: Network,
    capability: "residencia",
  },
  {
    to: "/admin/residencia/no-conformidades",
    label: "No conformidades",
    icon: ClipboardX,
    capability: "residencia",
  },
  // B-reservas-8 · los bonos de sesiones: los ajustes del centro, por qué
  // número empieza su numeración, qué productos son bonos y el alta de los
  // que venían en papel.
  {
    to: "/admin/bonos",
    label: "Bonos",
    icon: Ticket,
    capability: "bonos",
  },
  { to: "/admin/tag-aliases", label: "Etiquetas", icon: Tag, capability: "caja" },
  // v1.4-Bar-Operativa-MVP Lote 2: mapa tag → sección de cocina/barra.
  // Sólo lo usan los tenants HOSPITALITY; en otros verticales queda
  // visible pero vacío sin perjudicar la operativa.
  // clinica-8 (fase B, 18) · la capability pasa de `caja` a
  // `hosteleria`, y es la misma corrección que el addendum 3 le hizo a
  // «Sync Holded»: una sección cuyo contenido no existe en este negocio.
  //
  // «Comanderas» reparte las etiquetas del catálogo entre las impresoras
  // de barra y de cocina. En una clínica no hay barra, no hay cocina y
  // no hay comanda; lo que hay es una podóloga mirando una entrada del
  // menú que no sabe qué es (auditoría del 18-10, en los menores:
  // «"Comanderas" en el menú de una clínica»).
  //
  // El comentario de arriba decía «en otros verticales queda visible
  // pero vacío sin perjudicar la operativa». Perjudica: una pantalla
  // vacía que no se entiende es una llamada de teléfono.
  { to: "/admin/tag-sections", label: "Comanderas", icon: Printer, capability: "hosteleria" },
  // v1.3-Operativa-Extra · Lote 2: panel para que el OWNER fuerce sync
  // con Holded sin pasar por super-admin.
  //
  // catalogo-local (addendum 3) · la capability pasa de `caja` a
  // `holded`. Lo encontró el bucle visual, no un test: en la captura del
  // comercio de catálogo local, "Sync Holded" seguía en su barra lateral.
  // Es una sección cuyo único botón fuerza una sincronización que no
  // existe, en una pantalla que le habla de un ERP que no ha comprado —
  // exactamente lo que H1 vino a quitar del panel del colegio.
  { to: "/admin/holded", label: "Sync Holded", icon: RefreshCw, capability: "holded" },
  // holded-desconectar (ADR-020) · el hueco que el corte deja abierto y que
  // no se puede tapar con código: el abono de una devolución no existe en
  // ningún sitio (en Holded porque ya no escribimos allí, y como factura
  // rectificativa porque eso es V3). El dinero sale del cajón y el arqueo
  // cuadra; lo que falta es el papel, y lo hace el asesor.
  {
    to: "/admin/devoluciones-asesor",
    label: "Devoluciones · asesor",
    icon: FileWarning,
    capability: "holdedDejado",
  },
  { to: "/admin/gift-receipts", label: "Tickets regalo", icon: Gift, capability: "caja" },
  { to: "/admin/account", label: "Mi cuenta", icon: User },
  { to: "/admin/security", label: "Seguridad", icon: Shield },
  // holded-desconectar (ADR-020) · la capability pasa de `caja` a `holded`,
  // mismo cambio y misma razón que "Revisión de SKU" en catalogo-local: esta
  // bandeja lista los documentos que Holded rechazó, y sin Holded no puede
  // tener ni una fila. Peor aún, `TicketsErrorsPage` calcula su propia salud
  // en el cliente y pintaría "TPV bloqueado · Holded no responde" en rojo
  // sobre un comercio que acabó de dejarlo a propósito.
  { to: "/admin/tickets-errors", label: "Holded", icon: KeyRound, badge: "syncErrors", superAdminOnly: true, capability: "holded" },
  // agenda-lista · "Ajustes" se queda SIN flags, y las dos razones son
  // distintas. Se miró antes de tocarla: el `superAdminOnly` no lo puso H1
  // ni "Dejar Holded" —la culpa del `git blame` es que ambos reescribieron
  // la línea para añadirle la capability— sino B-OnboardingV2 (`850063e`),
  // que escondió "secciones técnicas (Holded, Dispositivos, Ajustes) a
  // OWNER/MANAGER" para que el alta supervisada dejara el panel del
  // propietario sin complejidad técnica. Nació `ownerOnly` en B6.
  //
  //   · fuera `superAdminOnly`: dentro no hay NADA técnico. Las seis
  //     secciones son decisiones de negocio y el servidor ya dice de quién
  //     son (`GET` → requireOwnerOrManager, `POST` → requireOwner). Lo
  //     único comercial, `cajaEnabled`, ya es de sólo lectura y el `POST`
  //     lo rechaza con 400 por `additionalProperties: false`: está
  //     protegido donde toca, no escondiendo una entrada del menú. Y la
  //     dueña TIENE que llegar aquí: éste es el interruptor de la agenda.
  //     Es la misma corrección que ya se le hizo a "Dispositivos" en
  //     v1.3-piloto-feedback (ver arriba, "un error histórico").
  //   · fuera `capability: "caja"`: lo dice el propio commit de H1 —
  //     "Ajustes NO va envuelto a propósito: dentro vive «Módulos del
  //     negocio» (CRM y agenda), que es justo lo que una empresa sin caja
  //     viene a tocar". La página lo cumple (esa sección y la declaración
  //     responsable quedan fuera de su gate) pero el menú la tapaba
  //     entera, así que el tenant sin caja no llegaba a su único ajuste
  //     útil. Lo de caja se sigue escondiendo DENTRO de la pantalla.
  //
  // Sin flags: OWNER ve y edita, MANAGER ve en gris con su tooltip. Es la
  // misma escalera que impone el servidor. El super-admin impersonando
  // sigue viéndola igual.
  { to: "/admin/settings", label: "Ajustes", icon: Settings },
  // ── cuadro-de-control · «CONFIGURACIÓN», LA ÚLTIMA Y SÓLO AQUÍ ──────
  //
  // Una sola entrada, abajo del todo, que abre un índice con todo lo que
  // se configura una vez (decisión 2). Lleva `capability: "residencia"`
  // porque la página que abre es la de un centro: en un comercio ese
  // índice no existe y su menú es exactamente el de antes de este bloque.
  //
  // Va en `NAV_ITEMS` y no suelta en el pie por lo mismo que las demás:
  // aquí pasa por el filtro de capabilities y por el test que recorre la
  // lista entera.
  {
    to: "/admin/residencia/configuracion",
    label: "Configuración",
    icon: Settings,
    capability: "residencia",
  },
];

// ── cuadro-de-control · LAS CINCO DEL DÍA A DÍA, EN ESTE ORDEN ───────
//
// El orden es el de la mañana de la directora, no el del modelo: el panel
// primero (qué hay), después quién vive aquí, y luego las tres cosas que
// se cierran —lo que ha pasado, la firma que falta y el papel que vence—.
// Lo escribe aquí y no se deduce de `NAV_ITEMS` porque es una decisión de
// producto y tiene que leerse como una lista de cinco cosas.
const MENU_DE_RESIDENCIA = [
  "/admin/residencia/panel",
  "/admin/residencia/residentes",
  "/admin/residencia/incidencias",
  "/admin/residencia/relevos",
  "/admin/residencia/obligaciones",
] as const;

/** La entrada que cierra el menú de una residencia. */
const CONFIGURACION = "/admin/residencia/configuracion";

/**
 * cuadro-de-control · **EL ORDEN DE «CONFIGURACIÓN»** (decisión 2).
 *
 * Primero el centro y su edificio, después cómo se trabaja en él, después
 * quién trabaja y qué se le mide, y al final lo legal y lo de la persona.
 *
 * Lo que pase el filtro y no esté en esta lista se añade al final en el
 * orden de `NAV_ITEMS`: así una residencia que además tenga caja no
 * pierde «Dispositivos» ni «Impresoras» porque este bloque no los nombró.
 * Perderlas sería dejar una pantalla sin forma de llegar, y lo que este
 * bloque mueve es por dónde se llega, no qué existe.
 */
const ORDEN_EN_CONFIGURACION = [
  "/admin/stores",
  "/admin/residencia/edificio",
  "/admin/residencia/turnos",
  "/admin/residencia/controles",
  "/admin/residencia/plantillas",
  "/admin/residencia/guardia",
  "/admin/staff",
  "/admin/residencia/indicadores",
  // calidad-1 · pegadas a los indicadores: el mapa es de dónde cuelgan y
  // las NC es a dónde van los que se salen del umbral dos meses.
  "/admin/residencia/procesos",
  "/admin/residencia/no-conformidades",
  "/admin/contrato-tratamiento",
  "/admin/account",
  "/admin/security",
  "/admin/settings",
] as const;

/**
 * cuadro-de-control · **LO QUE NO SE VE EN UNA RESIDENCIA, NI EN EL MENÚ
 * NI EN «CONFIGURACIÓN»** (decisión 3).
 *
 * Las dos pantallas de agenda. La capability `agenda` sigue ENCENDIDA en
 * un centro de residencia —la exige la clínica, y de ella cuelga
 * «Personal», que sí está en Configuración— pero el catálogo de citas y
 * el horario de atención son de un centro que da citas, y una residencia
 * no da citas: tiene residentes que viven dentro.
 *
 * Esconder no es gatear: las rutas siguen existiendo y el servidor
 * contesta lo de siempre. Lo que se quita es la oferta.
 *
 * ── Y ES LA ÚNICA FORMA DE DESAPARECER ─────────────────────────────
 *
 * Lo que hay dentro de «Configuración» NO se marca entrada por entrada:
 * es **todo lo que pasa el filtro y no es una de las cinco del menú**.
 * Al revés —una bandera `enConfiguracion` en cada línea— se probó y se
 * descartó en este mismo bloque: la primera sección a la que se le
 * olvidara la bandera se quedaba sin forma de llegar, en verde y sin que
 * nadie lo notara. Lo encontró el banco con «Bonos», que es justo una
 * entrada que nadie pensaría en marcar.
 *
 * Así que esconder una sección en una residencia cuesta escribirla aquí,
 * en una lista de dos elementos que se lee de un golpe. Y el banco
 * comprueba que ninguna entrada se cae por el hueco: toda la que pase el
 * filtro está en el menú, en «Configuración», o nombrada aquí.
 */
export const FUERA_EN_RESIDENCIA: readonly string[] = [
  "/admin/agenda-catalog",
  "/admin/agenda-hours",
];

/** El rótulo de una entrada, que en una residencia puede ser otro. */
export function etiquetaDeLaEntrada(item: NavItem, esResidencia: boolean): string {
  return esResidencia ? (item.etiquetaEnResidencia ?? item.label) : item.label;
}

/**
 * Las entradas que pasan rol, impersonación y capabilities.
 *
 * Es el filtro de hotfix-menu-capabilities, movido fuera de `NavList`
 * para que lo use también la página de «Configuración» — y para que el
 * banco pueda preguntarle sin pintar.
 */
function entradasPermitidas(
  caps: TenantCapabilities | null,
  role: string | null,
  impersonating: boolean,
): NavItem[] {
  return NAV_ITEMS.filter((item) => {
    if (item.superAdminOnly && !impersonating) return false;
    if (item.ownerOnly && role !== "OWNER") return false;
    // H1 · las capabilities se evalúan DESPUÉS de rol e impersonación, y
    // se combinan en vez de excluirse: la bandeja "Holded" es a la vez
    // `superAdminOnly` y de caja, y antes el primer `return` se comía la
    // segunda condición.
    //
    // hotfix-menu-capabilities · una sola rama, y la decisión en
    // `capabilidadActiva`. El `return true` de aquí es ahora SÓLO para las
    // entradas sin capability (Resumen, Tiendas, Mi cuenta…): una entrada
    // gateada no puede caerse por este agujero sin que el compilador lo
    // diga.
    if (item.capability != null) {
      return capabilidadActiva(item.capability, caps);
    }
    return true;
  });
}

/**
 * cuadro-de-control · **LAS ENTRADAS DEL MENÚ.**
 *
 * En un comercio, en un bar, en una clínica o en un colegio: las de
 * siempre, el filtro de hotfix-menu-capabilities y nada más. Este bloque
 * no les cambia una línea.
 *
 * En una residencia: las CINCO del día a día en su orden, y
 * «Configuración» al final. Se proyecta sobre lo que el filtro ya dejó
 * pasar, así que una entrada que su cuenta no debería ver no entra por
 * aquí; y si alguna de las cinco no pasara el filtro, simplemente no está
 * (no se inventa un enlace a una pantalla que el servidor va a negar).
 */
export function entradasDelMenu(
  caps: TenantCapabilities | null,
  role: string | null,
  impersonating: boolean,
): NavItem[] {
  const permitidas = entradasPermitidas(caps, role, impersonating);
  if (caps?.residencia !== true) return permitidas;
  const porDestino = new Map(permitidas.map((i) => [i.to, i]));
  return [...MENU_DE_RESIDENCIA, CONFIGURACION]
    .map((to) => porDestino.get(to))
    .filter((i): i is NavItem => i != null);
}

/**
 * cuadro-de-control · **LO QUE ENSEÑA «CONFIGURACIÓN»** (decisión 2).
 *
 * Todo lo que su cuenta puede ver y no es una de las cinco del menú,
 * menos ella misma y menos lo nombrado en `FUERA_EN_RESIDENCIA`. En el
 * orden de `ORDEN_EN_CONFIGURACION`; lo que no esté nombrado allí, al
 * final y en el orden de `NAV_ITEMS`.
 *
 * Ese «todo» es la decisión: una residencia que además tenga caja sigue
 * llegando a «Dispositivos», a «Impresoras» y a «Tickets regalo» sin que
 * este bloque las haya nombrado una por una. Lo que este bloque cambia es
 * por dónde se llega, no qué existe.
 */
export function entradasDeConfiguracion(
  caps: TenantCapabilities | null,
  role: string | null,
  impersonating: boolean,
): NavItem[] {
  const fuera = new Set<string>([
    ...MENU_DE_RESIDENCIA,
    CONFIGURACION,
    ...FUERA_EN_RESIDENCIA,
  ]);
  const dentro = entradasPermitidas(caps, role, impersonating).filter(
    (i) => !fuera.has(i.to),
  );
  const orden = new Map<string, number>(
    ORDEN_EN_CONFIGURACION.map((to, i) => [to, i]),
  );
  // Las nombradas en su orden; las demás detrás, en el de `NAV_ITEMS`.
  return [
    ...dentro
      .filter((i) => orden.has(i.to))
      .sort((a, b) => orden.get(a.to)! - orden.get(b.to)!),
    ...dentro.filter((i) => !orden.has(i.to)),
  ];
}

// v1.5-consistencia-B §3.b: salud de la integración Holded para el
// banner grande del admin. Pollea /catalog/sync-status cada 60s; sólo
// nos interesa el caso `blocked` (sin API key o >48h sin sync) — el
// propietario tiene que enterarse aunque el TPV siga operando.
interface HoldedHealth {
  level: "ok" | "warning" | "blocked";
  reason: string;
  lastSyncAgeMs: number | null;
}

function useHoldedHealth(enabled = true): HoldedHealth | null {
  const [health, setHealth] = useState<HoldedHealth | null>(null);
  useEffect(() => {
    // H1 · ver `HoldedHealthBanner`.
    if (!enabled) return;
    let cancelled = false;
    async function tick() {
      try {
        const res = await api<{ health?: HoldedHealth }>("/catalog/sync-status");
        if (!cancelled) setHealth(res.health ?? null);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return;
        // Silencio el resto — el banner simplemente no se pinta.
      }
      if (!cancelled) setTimeout(tick, 60_000);
    }
    tick();
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return health;
}

// Banner a ancho completo, imposible de pasar por alto (§3.b: "el admin
// debe mostrarlo en grande"). Sólo nivel blocked; el warning de 24h ya
// lo cubre el TPV.
// H1 · el banner rojo "Holded está desconectado" es una ALARMA para
// quien depende de Holded. En una empresa que nunca lo tuvo no es una
// alarma, es una mentira: `getTenantHealthStatus` devuelve
// `blocked / no_api_key` en cuanto no hay clave, y el colegio lo vería
// a ancho completo, en rojo y para siempre.
//
// El gate era sólo `cajaEnabled`: sin caja no hay tickets que subir, así
// que no hay nada que Holded pueda estar dejando de recibir.
//
// catalogo-local (addendum 3) · falta la otra mitad, y es la del comercio
// de este bloque: TIENE caja, así que el gate de H1 no le valía, y no
// tiene clave, así que `getTenantHealthStatus` devuelve
// `blocked / no_api_key`. Vería la barra roja "Holded está desconectado ·
// reconecta la API Key" a ancho completo, todos los días, para siempre —
// sobre un ERP que no ha comprado. Es la misma mentira que H1 le quitó al
// colegio, servida por el otro lado.
//
// Quien SÍ usa Holded y no lo ha conectado la sigue viendo, y debe: ésa
// es exactamente la empresa que tiene un problema.
// puesta-en-marcha (ADR-021) · la banda del ensayo.
//
// Azul y no roja: no hay nada roto. Lo que hay es una cuenta que todavía no
// factura, y eso es un estado normal de una implantación — el implantador
// ensaya con el cliente, resetea y arranca cuando los dos están listos. Una
// barra roja le diría al cliente que tiene un problema.
function EnsayoAvisoBanner() {
  return (
    <div
      role="status"
      className="bg-sky-100 text-sky-950 border-b border-sky-300 px-4 md:px-8 py-4 text-[15px] md:text-[16px] flex items-start gap-3"
      data-testid="ensayo-aviso-panel"
    >
      <span aria-hidden className="text-[20px] leading-none mt-0.5">🧪</span>
      <span>
        <strong>Tu cuenta está en ensayo.</strong> El TPV funciona entero y
        puedes probarlo todo —vender, cobrar, devolver, arquear y cerrar—, pero
        nada de lo que cobra es una factura: los tickets salen marcados como de
        prueba, no se mandan por email y no cuentan para Hacienda. Cuando esté
        todo a tu gusto, lo activamos nosotros contigo delante y desde ese
        momento cada venta es una factura.
      </span>
    </div>
  );
}

function HoldedHealthBanner({
  cajaEnabled,
  holdedEnabled,
}: {
  cajaEnabled: boolean;
  holdedEnabled: boolean;
}) {
  const health = useHoldedHealth(cajaEnabled && holdedEnabled);
  if (!cajaEnabled || !holdedEnabled) return null;
  if (!health || health.level !== "blocked") return null;
  const noKey = health.reason === "no_api_key";
  const hours = health.lastSyncAgeMs
    ? Math.round(health.lastSyncAgeMs / 3_600_000)
    : null;
  return (
    <div
      role="alert"
      className="bg-red-600 text-white px-4 md:px-8 py-4 text-[15px] md:text-[16px] font-medium flex items-start gap-3"
    >
      <span aria-hidden className="text-[20px] leading-none mt-0.5">⚠</span>
      <span>
        {noKey ? (
          <>
            <strong>Holded está desconectado.</strong> El TPV sigue cobrando y
            guarda los tickets, pero NO se están subiendo a Holded. Reconecta
            la API Key (o avisa a soporte) cuanto antes: al reconectar, los
            tickets pendientes se subirán solos.
          </>
        ) : (
          <>
            <strong>
              Sin conexión con Holded desde hace {hours ?? "+48"} h.
            </strong>{" "}
            El TPV sigue operando y los tickets se guardan; se subirán solos
            al recuperar la conexión. Si persiste, contacta soporte.
          </>
        )}
      </span>
    </div>
  );
}

// Hook compartido entre desktop sidebar y mobile drawer: pollea el
// contador de tickets con error cada 60s mientras la pestaña esté
// abierta. Silencioso a errores 401 (se gestionan en api.ts).
function useSyncErrorsCount(enabled = true): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    // H1 · sin caja no hay tickets, así que no hay errores de sync que
    // contar. Además la ruta devuelve 403 CAJA_DISABLED: pollearla cada
    // 60 s sería ruido en los logs y un badge que nunca se mueve.
    if (!enabled) return;
    let cancelled = false;
    async function tick() {
      try {
        const res = await api<{ items: unknown[]; pendingCount: number }>(
          "/admin/tickets/sync-errors?limit=1",
        );
        if (!cancelled) setCount(res.pendingCount ?? 0);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return;
        // Silencio el resto: si el backend está mal, el badge no se mueve.
      }
      if (!cancelled) setTimeout(tick, 60_000);
    }
    tick();
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return count;
}

export function AdminShell({
  title,
  children,
  initials,
  ancho = "normal",
}: {
  title: string;
  children: React.ReactNode;
  initials?: string;
  /**
   * cuadro-de-control · **el ancho del contenido** (decisión 4).
   *
   * `"normal"` es la columna de siempre (`max-w-3xl`), que es la correcta
   * para un formulario: una línea de texto de 1200 px no se lee.
   *
   * `"completo"` lo pide hoy sólo el panel de la residencia, y es lo que
   * hace que quepa en una pantalla de 1366×768 sin scroll: en la columna
   * estrecha, las cuatro cifras, «Ahora», «Hoy» y el mes son siete
   * bloques uno debajo de otro y hay que bajar tres veces para ver si hay
   * algo que atender.
   */
  ancho?: "normal" | "completo";
}) {
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [logoutAllOpen, setLogoutAllOpen] = useState(false);
  // H1 · `null` mientras carga. El banner no se pinta hasta saberlo: es
  // una alarma, y una alarma que parpadea mientras carga es peor que una
  // alarma que tarda medio segundo. Ojo, aquí `=== true` y no
  // `!== false` (ver `useSyncErrorsCount`): pollear antes de saber si hay
  // caja dispara un 403 por nada.
  const shellCaps = useTenantCapabilities();

  function onLogout() {
    clearTokens();
    navigate("/login", { replace: true });
  }

  const impersonating = readImpersonationState() != null;

  return (
    <div className="min-h-screen bg-mipiace-stone flex flex-col font-sans">
      {impersonating && <ImpersonationBanner />}
      {/* puesta-en-marcha (ADR-021) · la banda del ensayo en el panel del
          PROPIETARIO. Es la tercera de las tres cosas que impiden que alguien
          crea que ha facturado: la banda del TPV, el papel marcado y ésta.

          Sin botón de arrancar, y es la decisión: arrancar es irreversible y
          lo hace el super-admin en la visita (ADR-021 §3). Un botón aquí
          sería o un botón que no hace nada, o la puerta a que un propietario
          empiece a facturar sin que nadie haya comprobado sus datos fiscales
          ni que sus cajas tienen la cadena limpia. Lo que sí dice es a quién
          llamar. */}
      {/* primer-acceso · Y SÓLO CON CAJA, que es la mitad que faltaba.
          Lo encontró el bucle visual del 23-10: la PRIMERA pantalla de la
          directora de Jardín de Gredos abría con seis líneas sobre el TPV,
          los tickets de prueba y Hacienda. Esa residencia no tiene caja:
          no vende, no cobra, no arquea y no emite una factura en su vida,
          así que «tu cuenta está en ensayo» no le avisa de nada — le
          describe un producto que no ha comprado, el día que entra.
          Mismo gate y misma razón que el banner de Holded de aquí al lado
          (H1): lo que no puede pasar en esa cuenta no se avisa. */}
      {/* cuadro-de-control (decisión 3) · Y NO EN UNA RESIDENCIA, aunque
          tenga caja. La banda habla de vender, cobrar, devolver, arquear y
          cerrar, y de que los tickets no cuentan para Hacienda: ni una de
          esas seis palabras es del trabajo de quien dirige un centro. El
          gate de caja de primer-acceso tapa a Jardín de Gredos, que no la
          tiene; esto tapa también a la residencia que sí la tenga (una
          cafetería para visitas no convierte el panel de dirección en el
          panel de un bar). */}
      {shellCaps?.enEnsayo === true &&
        shellCaps?.caja === true &&
        shellCaps?.residencia !== true && <EnsayoAvisoBanner />}
      <HoldedHealthBanner
        cajaEnabled={shellCaps?.caja === true}
        holdedEnabled={shellCaps?.holdedEnabled !== false}
      />
      <div className="flex flex-1 min-h-0">
      <DesktopSidebar onAskLogoutAll={() => setLogoutAllOpen(true)} />

      {drawerOpen && (
        <MobileDrawer
          onClose={() => setDrawerOpen(false)}
          onAskLogoutAll={() => {
            setDrawerOpen(false);
            setLogoutAllOpen(true);
          }}
        />
      )}

      <main className="flex-1 min-w-0 overflow-y-auto">
        <header className="h-[72px] border-b border-slate-200 bg-white flex items-center px-4 md:px-8 sticky top-0 z-10 gap-3">
          <button
            onClick={() => setDrawerOpen(true)}
            className="md:hidden h-10 w-10 rounded-xl hover:bg-slate-50 text-slate-600 flex items-center justify-center"
            aria-label="Abrir menú"
          >
            <Menu className="w-5 h-5" strokeWidth={2.1} />
          </button>
          <h1 className="text-[18px] md:text-[20px] font-semibold text-mipiace-ink tracking-tight">
            {title}
          </h1>
          <div className="ml-auto flex items-center gap-2.5">
            <button
              onClick={onLogout}
              className="h-9 px-3 rounded-lg hover:bg-slate-50 text-[13px] text-slate-600 font-medium"
            >
              Cerrar sesión
            </button>
            <span className="h-9 w-9 rounded-lg bg-mipiace-ink text-white text-[12.5px] font-medium flex items-center justify-center">
              {(initials ?? "MO").slice(0, 2).toUpperCase()}
            </span>
          </div>
        </header>
        <div
          className={
            ancho === "completo"
              ? "p-3.5 md:p-4 max-w-[1280px]"
              : "p-5 md:p-8 max-w-3xl"
          }
        >
          {children}
        </div>
      </main>

      <LogoutEverywhereModal
        open={logoutAllOpen}
        onClose={() => setLogoutAllOpen(false)}
      />
      </div>
    </div>
  );
}

function DesktopSidebar({ onAskLogoutAll }: { onAskLogoutAll: () => void }) {
  const location = useLocation();
  return (
    <aside className="hidden md:flex w-[240px] shrink-0 border-r border-slate-200 bg-white flex-col overflow-y-auto px-5 py-6">
      <CabeceraDeLaBarra />
      <NavList currentPath={location.pathname} />
      <PieDeLaBarra
        currentPath={location.pathname}
        onAskLogoutAll={onAskLogoutAll}
      />
    </aside>
  );
}

/**
 * cuadro-de-control (decisión 3) · **ARRIBA DE LA BARRA, EL CENTRO.**
 *
 * En un comercio, la marca del TPV, igual que siempre.
 *
 * En una residencia, el nombre del centro y «Residencia · N plazas». La
 * razón no es de marca: quien dirige un centro no necesita que le
 * recuerden de quién es el software veinte veces al día, y sí necesita
 * saber en qué centro está — el día que una gestora lleve dos, el rótulo
 * es lo único que los distingue.
 *
 * El nombre sale de las capacidades (`/auth/me`), que llegan antes que el
 * panel. Las plazas salen del panel, así que aparecen un instante
 * después: mientras no están, el subtítulo dice «Residencia» y nada más.
 * Al revés —esperar al panel para pintar el nombre— se vería como un
 * salto en la primera pantalla.
 */
function CabeceraDeLaBarra() {
  const caps = useTenantCapabilities();
  const { panel } = usePanelDeResidencia(caps?.residencia === true);
  if (caps?.residencia !== true) {
    return (
      <div className="mb-8">
        <Logo />
      </div>
    );
  }
  const plazas = panel?.centro?.plazas ?? null;
  return (
    <div className="mb-7 px-4">
      <p className="text-[15.5px] font-semibold tracking-tight text-mipiace-ink">
        {panel?.centro?.nombre ?? caps.nombreDelCentro ?? "Tu centro"}
      </p>
      <p className="text-[12px] text-slate-500 tabular-nums">
        {plazas == null
          ? "Residencia"
          : `Residencia · ${plazas} ${plazas === 1 ? "plaza" : "plazas"}`}
      </p>
    </div>
  );
}

/**
 * El pie de la barra: «Configuración» (sólo en una residencia), cerrar
 * sesión en todos los dispositivos, la declaración responsable y la
 * versión.
 *
 * `mt-auto` va aquí, en el grupo, y no en cada hijo: con dos `mt-auto`
 * hermanos el hueco libre se reparte entre los dos y el pie se queda a
 * media altura.
 */
function PieDeLaBarra({
  currentPath,
  onAskLogoutAll,
  onNavigate,
}: {
  currentPath: string;
  onAskLogoutAll: () => void;
  onNavigate?: () => void;
}) {
  const caps = useTenantCapabilities();
  const role = readCurrentRole();
  const impersonating = readImpersonationState() != null;
  const esResidencia = caps?.residencia === true;
  // cuadro-de-control · «Configuración» es la última entrada del menú de
  // una residencia (decisión 2), y se pinta aquí abajo —separada por una
  // línea— porque no es una sección del día a día: es la puerta a lo que
  // se configura una vez.
  const configuracion = esResidencia
    ? entradasDelMenu(caps, role, impersonating).find((i) => i.to === CONFIGURACION)
    : undefined;
  return (
    <div className="mt-auto pt-6">
      {configuracion && (
        <nav className="mb-2 border-t border-slate-200 pt-2.5">
          <EntradaDelMenu
            item={configuracion}
            currentPath={currentPath}
            esResidencia
            onNavigate={onNavigate}
          />
        </nav>
      )}
      <button
        onClick={onAskLogoutAll}
        className="text-[12px] text-slate-400 hover:text-mipiace-coral-dark font-medium text-left px-4 py-2"
      >
        Cerrar sesión en todos los dispositivos
      </button>
      {/* cuadro-de-control (decisión 3) · FUERA EN UNA RESIDENCIA. La
          declaración responsable es del art. 15 del reglamento de
          Verifactu: habla del sistema que emite facturas. Un centro que no
          factura no tiene nada que declarar, y la Orden pide que se llegue
          «de forma rápida, fácil e intuitiva» desde cualquier pantalla DEL
          SISTEMA DE FACTURACIÓN — no desde el panel de una residencia sin
          caja. En la residencia que sí tenga caja vuelve a salir. */}
      {!(esResidencia && caps?.caja !== true) && (
        <DeclaracionFooterLink onNavigate={onNavigate} />
      )}
      <VersionFooter />
    </div>
  );
}

// declaracion-responsable · el enlace al documento del art. 15.
//
// Va en el PIE de la barra lateral, encima de la versión, y no en la lista
// de secciones: la Orden pide que se llegue «de forma rápida, fácil e
// intuitiva» desde cualquier pantalla, y el pie está en todas. Sin
// capability ni gate de rol — la declaración es del PRODUCTOR del sistema,
// así que la ve el OWNER y el MANAGER de cualquier comercio, use Holded o
// no. Es también la razón de que NO esté en NAV_ITEMS: allí toda entrada
// pasa por el filtro de capabilities.
//
// ── residencia-6 · Y MIDE 48 px DE ALTO, NO 34 ──────────────────────
//
// `py-2` sobre un texto de 12 px daban **34 px**: por debajo del mínimo
// táctil de la casa y de los 44 px de la WCAG. Lo arrastraban tres
// bloques (lo anotaron residencia-4 y residencia-5 §19.20) porque en el
// escritorio se pulsa con el ratón y nadie lo notaba; en la tablet de
// 1280×800 con la que se configura un centro, sí.
//
// `min-h-touch` (48 px, el primer peldaño de la escala de
// `docs/design/tokens.md` §4) y no un `py-3` a ojo: el peldaño ya existe
// y un número suelto aquí sería un cuarto tamaño táctil en la casa. El
// `py-2` se queda porque con `min-h` ya no decide la altura — centra el
// contenido cuando el texto parte en dos líneas a 320 px.
function DeclaracionFooterLink({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      to="/admin/declaracion-responsable"
      onClick={onNavigate}
      className="flex min-h-touch items-center gap-2 px-4 py-2 text-[12px] text-slate-400 hover:text-mipiace-coral-dark font-medium"
    >
      <FileText className="w-3.5 h-3.5 shrink-0" strokeWidth={2.1} />
      <span>Declaración responsable</span>
    </Link>
  );
}

// v1.0-pilotos · Lote 7: versión de producto visible. Misma constante
// que /version.json (src/version.ts).
function VersionFooter() {
  const hash = readBuildHash();
  return (
    <div className="px-4 pt-2 text-[11px] text-slate-300 tabular-nums select-all">
      mipiacetpv {PRODUCT_VERSION}
      {hash ? ` · ${hash.slice(0, 7)}` : ""}
    </div>
  );
}

function MobileDrawer({
  onClose,
  onAskLogoutAll,
}: {
  onClose: () => void;
  onAskLogoutAll: () => void;
}) {
  const location = useLocation();
  return (
    <div
      className="fixed inset-0 z-40 md:hidden"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-mipiace-ink/40 animate-in fade-in"
        onClick={onClose}
      />
      {/* declaracion-responsable · `overflow-y-auto`. Lo encontró el bucle
          visual a 320 px: con la barra entera el contenido mide 848 px en
          una caja de 720 y el `overflow` era `visible`, así que el pie
          —«Cerrar sesión en todos los dispositivos», el enlace a la
          declaración responsable y la versión— quedaba fuera de la pantalla
          y SIN scroll: no se podía llegar, no es que costara. */}
      <aside className="absolute inset-y-0 left-0 w-[260px] bg-white border-r border-slate-200 flex flex-col overflow-y-auto px-5 py-6 shadow-xl animate-in slide-in-from-left">
        <div className="flex items-start justify-between mb-6 gap-2">
          <CabeceraDeLaBarra />
          <button
            onClick={onClose}
            className="h-9 w-9 shrink-0 rounded-xl hover:bg-slate-50 text-slate-500 flex items-center justify-center"
            aria-label="Cerrar menú"
          >
            <X className="w-4 h-4" strokeWidth={2.25} />
          </button>
        </div>
        <NavList currentPath={location.pathname} onNavigate={onClose} />
        <PieDeLaBarra
          currentPath={location.pathname}
          onAskLogoutAll={onAskLogoutAll}
          onNavigate={onClose}
        />
      </aside>
    </div>
  );
}

// B-reservas-2, generalizado por H1: las capabilities del tenant gatean
// las entradas del sidebar. `null` mientras carga → las entradas con
// capability quedan ocultas hasta saber el valor real.
//
// agenda-lista · el hook y sus defaults se mudan a `capabilities.ts`.
// Aquí sólo se consume. Las dos razones de la mudanza están escritas
// allí; la que importa para este bloque es que ahora la pantalla de
// Ajustes puede empujar un refresco al guardar, y el menú gana sus
// secciones sin recargar.

function NavList({
  currentPath,
  onNavigate,
}: {
  currentPath: string;
  onNavigate?: () => void;
}) {
  const caps = useTenantCapabilities();
  // H1 · `=== true`, no `!== false`: mientras `caps` es null NO sabemos si
  // hay caja, y pollear "por si acaso" dispara un 403 antes de tener la
  // respuesta. Cuando el flag llega, el efecto vuelve a correr.
  const syncErrorsCount = useSyncErrorsCount(caps?.caja === true);
  const role = readCurrentRole();
  const impersonating = readImpersonationState() != null;
  const esResidencia = caps?.residencia === true;
  // cuadro-de-control · los contadores del menú salen del panel, y el
  // panel se pide una sola vez para la barra y para la pantalla (ver
  // `residencia-panel.ts`). Mismo criterio que las capacidades para el
  // `activo`: sin residencia no se pide nada.
  const { panel } = usePanelDeResidencia(esResidencia);
  // cuadro-de-control · «Configuración» la pinta el PIE de la barra, no
  // esta lista: va abajo del todo y separada por una línea.
  const visibleItems = entradasDelMenu(caps, role, impersonating).filter(
    (item) => item.to !== CONFIGURACION,
  );
  return (
    <nav className="space-y-1.5">
      {visibleItems.map((item) => (
        <EntradaDelMenu
          key={item.label}
          item={item}
          currentPath={currentPath}
          esResidencia={esResidencia}
          onNavigate={onNavigate}
          syncErrorsCount={syncErrorsCount}
          panel={panel}
        />
      ))}
    </nav>
  );
}

/**
 * Una entrada del menú.
 *
 * Sale de dentro de `NavList` en cuadro-de-control porque ahora se pinta
 * desde dos sitios: la lista de secciones y el pie de la barra, que es
 * donde vive «Configuración» en una residencia.
 */
function EntradaDelMenu({
  item,
  currentPath,
  esResidencia,
  onNavigate,
  syncErrorsCount = 0,
  panel = null,
}: {
  item: NavItem;
  currentPath: string;
  esResidencia: boolean;
  onNavigate?: () => void;
  syncErrorsCount?: number;
  panel?: Panel | null;
}) {
  const Icon = item.icon;
  const active = item.exact
    ? currentPath === item.to
    : currentPath.startsWith(item.to);
  const base =
    "w-full h-11 flex items-center gap-3 px-4 rounded-xl text-[14px] font-medium transition-colors";
  const etiqueta = etiquetaDeLaEntrada(item, esResidencia);
  if (item.disabled) {
    return (
      <button
        disabled
        title="Disponible en bloques posteriores"
        className={`${base} text-slate-300 cursor-not-allowed`}
      >
        <Icon className="w-[17px] h-[17px] text-slate-300" strokeWidth={2.1} />
        <span>{etiqueta}</span>
      </button>
    );
  }
  const badgeCount = item.badge === "syncErrors" ? syncErrorsCount : 0;
  // cuadro-de-control · el contador de la entrada, cuando la tiene y
  // cuando hay algo que contar. `null` = sin contador: ver la nota de
  // `contadorDelMenu`.
  const contador =
    item.contador != null && esResidencia
      ? contadorDelMenu(item.contador, panel)
      : null;
  return (
    <Link
      to={item.to}
      onClick={onNavigate}
      className={
        active
          ? `${base} bg-mipiace-coral-soft text-mipiace-coral-dark`
          : `${base} text-slate-600 hover:bg-slate-50 hover:text-mipiace-ink`
      }
    >
      <Icon
        className={
          active
            ? "w-[17px] h-[17px] text-mipiace-coral"
            : "w-[17px] h-[17px] text-slate-500"
        }
        strokeWidth={2.1}
      />
      <span>{etiqueta}</span>
      {contador && (
        <span
          /* El número solo no se lee: «4» no dice de qué. El texto
             completo va en el `aria-label` y el dígito queda
             `aria-hidden` para que el lector no lo diga dos veces. */
          aria-label={contador.texto}
          data-test={`contador-${item.contador}`}
          className={`ml-auto inline-flex items-center justify-center min-w-[24px] h-[20px] px-1.5 rounded-[9px] text-[11.5px] font-medium tabular-nums ${
            contador.grave
              ? "bg-red-50 text-red-700"
              : "bg-amber-50 text-amber-700"
          }`}
        >
          <span aria-hidden>{contador.n > 99 ? "99+" : contador.n}</span>
        </span>
      )}
      {badgeCount > 0 && (
        <span
          aria-label={`${badgeCount} pendiente${badgeCount === 1 ? "" : "s"}`}
          className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[11px] font-medium tabular-nums"
        >
          {badgeCount > 99 ? "99+" : badgeCount}
        </span>
      )}
    </Link>
  );
}
