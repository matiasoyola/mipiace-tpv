// Tipos de los endpoints super-admin. Compartidos entre páginas.

export interface TenantMetrics {
  ticketsLast7d: number;
  ticketsSyncFailed: number;
  ticketsEmailFailed: number;
  degraded: { state: "ok" | "warning" | "blocked"; lastIncrementalSyncAt: string | null };
  storesCount: number;
  activeShifts: number;
}

export type OnboardingState = "DRAFT" | "ACTIVE";

// B-Multi-Vertical: tipo de negocio del tenant. Define comportamientos
// del TPV (mapa de mesas, placeholder, modificadores).
export type BusinessType = "HOSPITALITY" | "RETAIL" | "SERVICES";

export const BUSINESS_TYPE_LABEL: Record<BusinessType, string> = {
  HOSPITALITY: "Hostelería",
  RETAIL: "Retail",
  SERVICES: "Servicios",
};

export const BUSINESS_TYPE_DESCRIPTION: Record<BusinessType, string> = {
  HOSPITALITY: "Bar, restaurante, cafetería. Mapa de mesas y modificadores.",
  RETAIL: "Comercio, librería, tienda. Venta directa sin mesas.",
  SERVICES: "Servicios profesionales, talleres. Lista de servicios.",
};

// v1.9.1 · estado real de la conexión Holded, derivado del último sync
// incremental en el backend (caso Thalia: key válida pero suscripción
// suspendida por impago → HTTP 402 y el sync parado).
export type HoldedConnectionStatus =
  | "NOT_CONNECTED"
  | "CONNECTED"
  | "SUSPENDED"
  | "ERROR";

export interface TenantListItem {
  id: string;
  name: string;
  fiscalNif: string | null;
  ownerEmail: string | null;
  ownerLastLoginAt: string | null;
  holdedConnected: boolean;
  holdedStatus: HoldedConnectionStatus;
  createdAt: string;
  blockedAt: string | null;
  blockedReason: string | null;
  plan: string | null;
  onboardingState: OnboardingState;
  // null cuando el tenant está ACTIVE (no aplica). En DRAFT, true si la
  // heurística onboardingHealth.ready es verde.
  onboardingReady: boolean | null;
  businessType: BusinessType;
  // v1.3-SuperAdmin-Hub Lote 3: id Holded para enlazar al panel.
  holdedAccountId: string | null;
  metrics: TenantMetrics;
}

export interface TenantListResponse {
  items: TenantListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface TenantUser {
  id: string;
  email: string;
  // clinica-1 · el sanitario sin caja. Abre el TPV con su PIN como
  // cualquiera, así que el panel «¿puede entrar?» lo lista igual.
  role: "OWNER" | "MANAGER" | "CASHIER" | "CLINICIAN";
  lastLoginAt: string | null;
  twoFactorEnabled: boolean;
  mustChangePassword: boolean;
}

export interface TenantStore {
  id: string;
  name: string;
  fiscalAddress: unknown;
  ticketDelivery: unknown;
}

// H1 (ADR-016) · las tres capabilities del tenant, juntas. La caja sólo
// se mueve desde el super-admin; CRM y agenda también desde el panel del
// cliente (`/admin/tenant/settings`).
export interface TenantModules {
  caja: boolean;
  crm: boolean;
  agenda: boolean;
}

/**
 * kds-1-cocina · el módulo «Cocina» NO está en `TenantModules`, y es a
 * propósito.
 *
 * `TenantModules` es el conjunto que cuenta para el invariante «una
 * empresa conserva al menos un módulo encendido» del PATCH. La cocina no
 * sostiene a una empresa por sí sola: es un añadido a la caja que se cobra
 * por pantalla, igual que `holdedEnabled` no es un módulo. Metido ahí,
 * una empresa podría quedarse «sólo con cocina».
 *
 * Viaja plano en la respuesta (`kitchenDisplayEnabled`), como
 * `holdedEnabled`.
 */
export type KitchenDisplayEnabled = boolean;

// H1 (ADR-016) · de qué depende un check. `always` vale para cualquier
// empresa; `caja` y `holded` sólo cuando el tenant los tiene.
export type CheckRequirement = "always" | "caja" | "holded";

export interface ReadinessCheck {
  id: string;
  label: string;
  ok: boolean;
  value?: string;
  // H1 · opcionales para no romper si el backend es anterior al bloque.
  requires?: CheckRequirement;
  applies?: boolean;
}

export interface OnboardingHealth {
  initialSync: {
    status: string;
    lastRunAt: string | null;
    errorMessage: string | null;
  };
  taxes: { total: number; withValidRate: number; withoutRate: number };
  products: { total: number; sellable: number; withSku: number; withoutSku: number };
  services: { total: number; sellable: number };
  contacts: { total: number };
  ticketsTest: { total: number; lastAt: string | null };
  ticketsSyncFailed: number;
  testCashierProvisioned: boolean;
  modules: TenantModules;
  // catalogo-local (addendum 3) · las dos preguntas, separadas. Sustituye
  // al antiguo `usesHolded`, que sólo sabía contestar la segunda y se
  // leía como si contestara la primera.
  holded: {
    /** ¿Está previsto que use Holded? (`Tenant.holdedEnabled`) */
    enabled: boolean;
    /** ¿Lo tiene conectado ya? */
    connected: boolean;
  };
  /** Tickets en PAID sin fila de upload: cobros que no subirán nunca. */
  ticketsCobradosSinSubir: number;
  readinessChecks: ReadinessCheck[];
  ready: boolean;
}

export interface TenantDetail {
  id: string;
  name: string;
  fiscalProfile: unknown;
  fiscalNif: string | null;
  plan: string | null;
  onboardingState: OnboardingState;
  businessType: BusinessType;
  // v1.3-Thalia Lote 6 · texto libre del pie de ticket. NULL = sin pie
  // personalizado (default histórico).
  receiptFooter: string | null;
  // v1.3-hotfix6 · subvertical para elegir el icono placeholder del
  // TPV. NULL = icono genérico del businessType.
  tpvIconPreset: string | null;
  holdedConnected: boolean;
  // catalogo-local (addendum 3) · ¿está previsto que use Holded? Lo
  // apaga el super-admin y sólo mientras no haya clave conectada (409 si
  // la hay). Opcional para no romper si el front va por delante.
  holdedEnabled?: boolean;
  // holded-desconectar (ADR-020) · cuándo DEJÓ Holded. NULL en todos los
  // demás: el que nunca lo tuvo, el que lo tiene y el que lo tendrá. No es
  // deducible de `holdedEnabled === false`, que lo contestan igual el
  // comercio que nació sin Holded y el que lo dejó con 270 facturas detrás.
  holdedDisconnectedAt?: string | null;
  holdedStatus: HoldedConnectionStatus;
  holdedAuthMode: string;
  // v1.3-SuperAdmin-Hub Lote 3: id del panel Holded del cliente. NULL
  // en tenants pre-existentes hasta que el implantador los repase
  // desde el detalle. Sirve para construir el deep-link
  // `https://app.holded.com/accounts/<id>` del hub.
  holdedAccountId: string | null;
  initialSyncStatus: string;
  modules: TenantModules;
  /** kds-1-cocina · el módulo «Cocina». Fuera de `modules`, ver arriba. */
  kitchenDisplayEnabled?: boolean;
  lastIncrementalSyncAt: string | null;
  createdAt: string;
  blockedAt: string | null;
  blockedReason: string | null;
  ownerEmail: string | null;
  users: TenantUser[];
  stores: TenantStore[];
  metrics: TenantMetrics;
  onboardingHealth: OnboardingHealth;
}

// catalogo-en-alta · lo que contesta `POST /super-admin/tenants/:id/
// catalog/import`. La MISMA forma en la vista previa y después de
// escribir, con `escrito` diciendo cuál de las dos es: así la pantalla
// no tiene dos maneras de contar lo que ha pasado.
export interface CatalogImportFilaSaltada {
  linea: number;
  sku: string;
  nombre: string;
  motivo: string;
}

export interface CatalogImportResult {
  escrito: boolean;
  entran: Array<{
    linea: number;
    sku: string;
    nombre: string;
    /** El de la carta, con IVA. */
    precioConIva: number;
    /** El que se guarda, sin IVA y con 4 decimales. */
    precioSinIva: number;
    iva: number;
    categorias: string[];
  }>;
  saltadas: CatalogImportFilaSaltada[];
  /** Productos locales que el comercio ya tenía antes de esta carga. */
  yaTenia: number;
}

export interface CreateTenantDraftResponse {
  tenant: {
    id: string;
    name: string;
    plan: string | null;
    fiscalProfile: unknown;
    fiscalNif: string | null;
    onboardingState: OnboardingState;
    businessType: BusinessType;
    createdAt: string;
    // H1 · null cuando la empresa nace sin Holded (NOT_APPLICABLE).
    initialSyncStatus: string | null;
    modules: TenantModules;
  };
  // H1 · null cuando no hay Holded: no se encola nada.
  syncJobId: string | null;
}

export interface TestCashierTokenResponse {
  cashierSessionToken: string;
  deviceToken: string;
  expiresAt: string;
  tenant: { id: string; name: string };
  register: { id: string; name: string };
  store: { id: string; name: string };
  shiftId: string;
}

export interface ActivateTenantResponse {
  tenant: { id: string; name: string; onboardingState: OnboardingState };
  owner: { id: string; email: string; name: string };
  tempPassword: string;
  // v1.3-piloto-feedback · Lote 1: PIN del OWNER como cajero por defecto
  // en el TPV. Mostrado una sola vez para que el super-admin lo pase al
  // cliente offline como fallback si el email no llega.
  // H1 · null cuando la empresa no tiene caja: el PIN de cajero no se
  // genera ni se enseña, porque no hay TPV al que entrar.
  ownerPin: string | null;
  cashierPinIssued: boolean;
  purge: {
    ticketsTestPurged: number;
    emailJobsPurged: number;
    cashierDeleted: boolean;
    deviceRevoked: boolean;
  };
}

export type ImpersonationMode = "readonly" | "full";

export interface ImpersonateResponse {
  impersonationToken: string;
  expiresAt: string;
  // v1.3-SuperAdmin-Hub Lote 1: el backend devuelve el modo emitido para
  // que el frontend lo refleje en banner/UX sin tener que decodificar el
  // JWT por separado.
  mode: ImpersonationMode;
  tenant: { id: string; name: string };
  owner: { id: string; email: string };
}

export interface AuditLogItem {
  id: string;
  action: string;
  tenantId: string | null;
  superAdminId: string;
  superAdminEmail: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditLogResponse {
  items: AuditLogItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface SuperAdminMe {
  id: string;
  email: string;
  twoFactorEnabled: boolean;
  recoveryCodesRemaining: number;
  lastLoginAt: string | null;
  // Lote 3 v1.1 Thalia: si true, el frontend muestra el panel de
  // gestión multi super-admin. Hint UI — la autorización real la
  // verifica el backend (requireRootSuperAdmin con BD fresca).
  isRoot: boolean;
}

// B-Multi-Vertical SB4: super-admin item del listado multi-admin.
export interface SuperAdminItem {
  id: string;
  email: string;
  name: string | null;
  twoFactorEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface SuperAdminsListResponse {
  items: SuperAdminItem[];
}

export interface CreateSuperAdminResponse {
  admin: SuperAdminItem;
  tempPassword: string;
}

// v1.3-SuperAdmin-Hub · Lote 2 · payload de GET /super-admin/hub.
export interface HubTenantCard {
  id: string;
  name: string;
  plan: string | null;
  onboardingState: OnboardingState;
  businessType: BusinessType;
  blocked: boolean;
  blockedReason: string | null;
  holdedAccountId: string | null;
  holdedConnected: boolean;
  ownerEmail: string | null;
  lastIncrementalSyncAt: string | null;
  ticketsLast7d: number;
  ticketsSyncFailed: number;
  ticketsEmailFailed: number;
  activeShifts: number;
  status: "ok" | "warning" | "blocked";
  createdAt: string;
}

export interface HubSystemStatus {
  redis: { ok: boolean; latencyMs: number | null; error: string | null };
  tenants: { total: number; active: number; draft: number; blocked: number };
  globalTicketsSyncFailed: number;
  lastIncrementalSyncAt: string | null;
}

export interface HubCommonTask {
  id: string;
  label: string;
  hint: string;
  href: string;
  target?: "_blank" | "_self";
}

export interface HubResponse {
  cards: HubTenantCard[];
  system: HubSystemStatus;
  tasks: HubCommonTask[];
  generatedAt: string;
}

// Bloque soporte-cajeros-superadmin · GET /super-admin/tenants/:id/cashiers.
//
// Lista de LECTURA de quién puede entrar en las cajas de un tenant.
// El PIN no está aquí a propósito: no lo devuelve la API ni entero, ni
// parcial, ni su hash. Lo único que baja es `canOpenTpv`, el booleano
// derivado de si tiene PIN puesto.
export type CashierAccessStatus = "ACTIVE" | "NO_PIN" | "REVOKED";

// De dónde puede venir `lastLoginAt`. Un CASHIER sólo entra por el TPV
// (el login del admin le devuelve 403), así que su fecha es del TPV
// seguro. Un OWNER o un MANAGER entra por los dos sitios y el modelo
// comparte el campo — lo decimos en vez de aparentar precisión.
export type CashierLastLoginSource = "TPV" | "TPV_O_ADMIN";

export interface TenantCashier {
  id: string;
  alias: string | null;
  email: string;
  // clinica-1 · el sanitario sin caja. Abre el TPV con su PIN como
  // cualquiera, así que el panel «¿puede entrar?» lo lista igual.
  role: "OWNER" | "MANAGER" | "CASHIER" | "CLINICIAN";
  status: CashierAccessStatus;
  canOpenTpv: boolean;
  isTestCashier: boolean;
  lastLoginAt: string | null;
  lastLoginSource: CashierLastLoginSource;
  createdAt: string;
}

export interface TenantCashiersResponse {
  tenantId: string;
  tenantName: string;
  cashiers: TenantCashier[];
}

// ── holded-desconectar (ADR-020) · la previsualización de «Dejar Holded» ──
//
// Espejo de `PrevisualizacionDejarHolded` en
// `apps/api/src/holded/dejar-holded.ts`. Se escribe a mano y no se genera:
// el resto de este fichero también, y un generador para una pantalla no se
// paga. Lo que importa es que los nombres coincidan al carácter.

export interface DejarHoldedBloqueo {
  codigo: string;
  mensaje: string;
  cuantos?: number;
}

export interface DejarHoldedFila {
  id: string;
  numero: string | null;
  estado: string;
  total: string;
  fecha: string;
}

export interface DejarHoldedChoqueSku {
  codigo: string;
  sku: string | null;
  productos: Array<{ id: string; nombre: string; sku: string | null }>;
  comoSeArregla: string;
}

export interface DejarHoldedPreview {
  tenant: {
    id: string;
    nombre: string;
    holdedEnabled: boolean;
    holdedConectado: boolean;
    holdedDisconnectedAt: string | null;
    initialSyncStatus: string;
  };
  catalogo: {
    seConvierten: number;
    productos: number;
    servicios: number;
    yaLocales: number;
    conservanEnlace: number;
    archivados: number;
    ivaSinResolver: number;
    pasanAVendibles: number;
    cuelgan: {
      lineasDeTicket: number;
      conAgenda: number;
      conRecursos: number;
      enCitas: number;
      conModificadores: number;
      conHabilidades: number;
    };
  };
  sku: {
    intactos: number;
    cambios: Array<{
      productoId: string;
      nombre: string;
      skuAntes: string | null;
      skuDespues: string;
      motivo: "vacio" | "duplicado";
    }>;
    choques: DejarHoldedChoqueSku[];
  };
  ventasEnVuelo: {
    ticketsPendingSync: DejarHoldedFila[];
    ticketsSyncFailed: DejarHoldedFila[];
    abonosPendingSync: DejarHoldedFila[];
    abonosSyncFailed: DejarHoldedFila[];
    subidasVivas: Array<{ externalId: string; kind: string; creado: string }>;
    subidasHuerfanas: Array<{ externalId: string; kind: string; creado: string }>;
    subidasFallidas: number;
    fiadosVivos: DejarHoldedFila[];
    borradores: number;
    turnosAbiertos: number;
  };
  contactosYCrm: {
    contactos: number;
    contactosActivos: number;
    ticketsConContacto: number;
    clientesCrm: number;
    clientesConEnlaceHolded: number;
    fiadosVivosConDeudor: number;
    deudaVivaTotal: string;
    emailsAutomaticosHistoricos: number;
    emailsManualesHistoricos: number;
  };
  devoluciones: {
    ticketsFacturadosPorHolded: number;
    facturadosPorHoldedUltimos90d: number;
    abonosPorMes: Array<{ mes: string; cuantos: number; total: string }>;
  };
  fiscal: {
    suelo: { ok: boolean; problemas: string[] };
    cajas: Array<{
      id: string;
      nombre: string | null;
      tienda: string;
      serie: string | null;
      numeroInstalacion: string | null;
      registrosFiscales: number;
    }>;
    terminales: Array<{
      id: string;
      nombre: string | null;
      caja: string | null;
      apkVersion: string | null;
      apkCodigo: number | null;
      ultimoLatido: string | null;
    }>;
    avisoApk: string;
  };
  puedeArrancar: boolean;
  bloqueos: DejarHoldedBloqueo[];
}

export interface DejarHoldedResultado {
  ok: true;
  cortado: boolean;
  holdedDisconnectedAt: string;
  productosConvertidos: number;
  skuAcunados: DejarHoldedPreview["sku"]["cambios"];
  subidasHuerfanasCerradas: number;
  colas: {
    porCola: Record<string, number>;
    repeatableQuitado: boolean;
    errores: string[];
  };
}
