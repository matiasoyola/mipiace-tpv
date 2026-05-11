# 06 · Modelo de datos (boceto)

Esquema lógico para la base de datos del backend (PostgreSQL).
Es un **boceto inicial**: Claude Code lo refinará al implementar Prisma.

```
─── multi-tenant raíz ───────────────────────────────────────────

tenant
  id (uuid, pk)
  name
  holded_account_id          -- ID de la cuenta Holded
  holded_oauth_access        -- token cifrado (AES-GCM)
  holded_oauth_refresh       -- token cifrado
  holded_oauth_expires_at
  created_at, updated_at

user
  id (uuid, pk)
  tenant_id (fk → tenant.id)
  email
  password_hash              -- argon2id
  pin_hash                   -- argon2id (4 dígitos para cajeros)
  role                       -- OWNER | MANAGER | CASHIER
  created_at, last_login_at

store
  id (uuid, pk)
  tenant_id (fk)
  name
  fiscal_address             -- jsonb (cacheado de Holded)
  warehouse_holded_id        -- al qué almacén Holded descuenta stock
  created_at

register                     -- caja LÓGICA (un punto de venta dentro de una tienda)
  id (uuid, pk)
  store_id (fk)
  name                       -- "Caja 1"
  num_serie_holded           -- serie Holded para los salesreceipt de esta caja
  ticket_counter             -- correlativo interno del TPV
  printer_config             -- jsonb (modelo de impresora esperado)

device                       -- navegador físico emparejado a una caja
  id (uuid, pk)
  tenant_id (fk)
  register_id (fk)
  name                       -- opcional ("Mostrador-frontal")
  paired_at
  last_seen_at
  user_agent
  device_token_hash          -- token largo que vive en localStorage del navegador
  revoked_at                 -- nullable; si se revoca, la PWA se desempareja

pairing_code                 -- código efímero para emparejar un dispositivo
  id (uuid, pk)
  tenant_id (fk)
  register_id (fk)
  code                       -- 6 dígitos (indexed dentro del tenant)
  created_by_user_id (fk)
  expires_at                 -- normalmente 1h
  consumed_at                -- nullable
  consumed_by_device_id (fk) -- nullable


─── catálogo (cache local de Holded) ────────────────────────────

product
  id (uuid, pk)
  tenant_id (fk)
  holded_product_id          -- id en Holded
  name
  sku
  barcode (index)
  base_price                 -- sin IVA
  tax_rate                   -- 21, 10, 4, 0...
  kind                       -- PRODUCT | SERVICE
  active
  last_synced_at
  raw                        -- jsonb (respuesta cruda de Holded)

product_variant
  id (uuid, pk)
  product_id (fk)
  holded_variant_id
  name                       -- "Talla XL azul"
  sku
  barcode (index)
  price_override             -- nullable
  stock                      -- informativo

warehouse
  id (uuid, pk)
  tenant_id (fk)
  holded_warehouse_id
  name


─── operativa de ventas ─────────────────────────────────────────

shift                        -- turno de caja
  id (uuid, pk)
  register_id (fk)
  user_id (fk)               -- cajero que abre
  opened_at
  closed_at                  -- null si abierto
  cash_opening               -- fondo inicial
  cash_counted               -- recuento real al cierre
  z_report_pdf_path

ticket
  id (uuid, pk)
  tenant_id (fk)
  register_id (fk)
  shift_id (fk)
  user_id (fk)               -- cajero
  internal_number            -- correlativo del TPV (ej. 000245)
  external_id (uuid, uniq)   -- idempotency key para Holded
  contact_holded_id          -- nullable (anónimo)
  status                     -- DRAFT | PAID | PENDING_SYNC | SYNCED | SYNC_FAILED | VOIDED
  total
  total_tax
  total_discount
  holded_document_id         -- nullable hasta sync
  holded_pdf_url             -- nullable
  created_at
  paid_at
  synced_at
  sync_error                 -- jsonb, último error

ticket_line
  id (uuid, pk)
  ticket_id (fk)
  product_id (fk)            -- nullable si línea libre
  variant_id (fk)            -- nullable
  name_snapshot              -- copia del nombre en el momento
  units
  unit_price
  discount_pct
  tax_rate
  subtotal
  total

ticket_payment
  id (uuid, pk)
  ticket_id (fk)
  method                     -- CASH | CARD | BIZUM | VOUCHER | OTHER
  amount
  meta                       -- jsonb (referencia tarjeta, último4, etc.)

refund
  id (uuid, pk)
  original_ticket_id (fk)
  internal_number
  external_id (uuid, uniq)
  status                     -- igual que ticket
  reason
  holded_document_id

refund_line
  id (uuid, pk)
  refund_id (fk)
  ticket_line_id (fk)
  units                      -- cantidad devuelta (<= original)
  total


─── cola de sync (espejo en BD por si Redis se cae) ────────────

sync_outbox
  id (bigserial, pk)
  tenant_id (fk)
  kind                       -- UPLOAD_TICKET | UPLOAD_REFUND | CATALOG_SYNC
  payload (jsonb)
  attempts
  next_attempt_at
  last_error
  status                     -- PENDING | DONE | DEAD
  created_at, updated_at
```

## Notas

- Todas las tablas operativas llevan `tenant_id` con índice combinado para
  aislamiento.
- `ticket.external_id` es UUID v4 generado en el front en el momento del
  cobro. Nunca se regenera; es la llave de idempotencia hacia Holded.
- `name_snapshot` en `ticket_line` evita que cambiar el nombre del producto
  en Holded altere el histórico del ticket.
- `sync_outbox` duplica el estado que vive en Redis/BullMQ. Si Redis se
  reinicia y pierde la cola, podemos rehidratarla desde aquí.
