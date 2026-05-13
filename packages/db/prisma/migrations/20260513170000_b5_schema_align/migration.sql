-- B5 §1.4 · Drift Prisma migrate dev: schema.prisma declaraba el índice
-- `refunds_tenant_id_status_idx` (model Refund: `@@index([tenantId,
-- status])`) pero ninguna migración lo creaba. `prisma migrate dev`
-- detectaba el desfase y pedía nombre para una correctiva. Esta
-- migración añade el índice y deja schema y BD alineados.

CREATE INDEX "refunds_tenant_id_status_idx" ON "refunds"("tenant_id", "status");
