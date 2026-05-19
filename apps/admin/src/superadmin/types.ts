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

export interface TenantListItem {
  id: string;
  name: string;
  fiscalNif: string | null;
  ownerEmail: string | null;
  ownerLastLoginAt: string | null;
  holdedConnected: boolean;
  createdAt: string;
  blockedAt: string | null;
  blockedReason: string | null;
  plan: string | null;
  onboardingState: OnboardingState;
  // null cuando el tenant está ACTIVE (no aplica). En DRAFT, true si la
  // heurística onboardingHealth.ready es verde.
  onboardingReady: boolean | null;
  businessType: BusinessType;
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
  holdedConnected: boolean;
  holdedAuthMode: string;
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
  purge: {
    ticketsTestPurged: number;
    emailJobsPurged: number;
    cashierDeleted: boolean;
    deviceRevoked: boolean;
  };
}

export interface ImpersonateResponse {
  impersonationToken: string;
  expiresAt: string;
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
}
