// Tipos de los endpoints super-admin. Compartidos entre páginas.

export interface TenantMetrics {
  ticketsLast7d: number;
  ticketsSyncFailed: number;
  ticketsEmailFailed: number;
  degraded: { state: "ok" | "warning" | "blocked"; lastIncrementalSyncAt: string | null };
  storesCount: number;
  activeShifts: number;
}

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

export interface TenantDetail {
  id: string;
  name: string;
  fiscalProfile: unknown;
  fiscalNif: string | null;
  plan: string | null;
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
}

export interface CreateTenantResponse {
  tenant: { id: string; name: string; plan: string | null; fiscalNif: string | null };
  ownerEmail: string;
  tempPassword: string;
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
