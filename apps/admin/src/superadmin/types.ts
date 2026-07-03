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
  role: "OWNER" | "MANAGER" | "CASHIER";
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

export interface ReadinessCheck {
  id: string;
  label: string;
  ok: boolean;
  value?: string;
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
  holdedStatus: HoldedConnectionStatus;
  holdedAuthMode: string;
  // v1.3-SuperAdmin-Hub Lote 3: id del panel Holded del cliente. NULL
  // en tenants pre-existentes hasta que el implantador los repase
  // desde el detalle. Sirve para construir el deep-link
  // `https://app.holded.com/accounts/<id>` del hub.
  holdedAccountId: string | null;
  initialSyncStatus: string;
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
  };
  syncJobId: string;
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
  ownerPin: string;
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
