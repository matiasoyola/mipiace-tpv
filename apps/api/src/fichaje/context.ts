// F1 · la identidad del empleado en el request.
//
// Vive en su propio fichero, sin tocar Prisma, porque lo necesitan dos
// piezas que no deberían depender la una de la otra: la puerta del módulo
// (`lib/fichaje-gate.ts`, frente 1) y el middleware que valida el token del
// móvil (`fichaje/auth.ts`, frente 3).
//
// Es la TERCERA identidad del sistema, junto a `request.auth` (usuario del
// panel) y `request.cashier` / `request.device` (el TPV). Deliberadamente
// separada de las dos: un token de móvil de empleado no abre nada del panel
// ni de la caja, y ninguna de las otras dos abre el fichaje de un empleado.

export interface EmployeeContext {
  /** Fila de `employees`. El aislamiento por empleado se hace con esto. */
  employeeId: string;
  /** Fila de `tenants`. El aislamiento multi-tenant se hace con esto. */
  tenantId: string;
  /** Fila de `employee_devices` — el móvil concreto que mandó la petición. */
  deviceId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    employee?: EmployeeContext;
  }
}
