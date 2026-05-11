# 01 · Especificación funcional

## 1. Visión

TPV web multi-tenant para comercios que ya gestionan su catálogo y su
contabilidad en **Holded**. El comercio no tiene que mantener catálogos
duplicados: el TPV es la "boca de venta" rápida y Holded sigue siendo la
fuente de verdad del catálogo y el destino fiscal de cada ticket.

## 2. Roles

| Rol | Permisos |
|---|---|
| **Propietario** (titular de la cuenta Holded) | Conecta su Holded. Crea tiendas y cajas. Da de alta cajeros. Ve cierres y arqueos. |
| **Encargado** | Abre/cierra caja, hace devoluciones, aplica descuentos por encima de un umbral, ve cierres del día. |
| **Cajero** | Vende, cobra, imprime ticket. Aplica descuentos por debajo del umbral. No ve márgenes ni informes. |

## 3. Flujos principales

> **Importante:** distinguimos **tres tipos de autenticación / vinculación**
> distintos que se confunden con facilidad. Léelos antes de seguir:
>
> - **OAuth Holded** — sólo el propietario, una vez en la vida de su
>   tenant. Luego el backend refresca el token en segundo plano.
> - **Emparejamiento de dispositivo** — una vez por cada caja física,
>   antes del primer uso.
> - **Login de cajero (PIN)** — cada turno.

### 3.1 Onboarding del propietario (una sola vez)

1. El propietario entra a `https://mipiacetpv.tech` y pulsa
   **"Crear cuenta"**.
2. Da de alta su tenant con email + contraseña + nombre del negocio.
3. Pantalla siguiente: **"Conecta tu Holded"** → click → flujo OAuth (o,
   en modo simple, pegar su API Key). Autoriza scopes:
   `read:products read:services read:contacts write:documents read:warehouses`.
4. **Sync inicial** (puede tardar minutos según catálogo). Descargamos
   de Holded:
   - **Datos fiscales del negocio** (NIF, razón social, dirección) → van
     impresos al pie de cada ticket.
   - **Tipos de IVA** en uso por el cliente.
   - **Almacenes**.
   - **Series de facturación** (`numSerie`) existentes.
   - **Productos** + variantes + precios + stock por almacén (filtrando
     `forSale != 0`).
   - **Servicios**.
   - **Contactos** (clientes). *Opcional, on-demand.*
5. El propietario crea **al menos una tienda** dentro del tenant y le
   asigna un **almacén Holded** (el stock se descuenta de ese almacén).
   *Una cuenta de Holded puede tener varias tiendas dentro del tenant; no
   hace falta una cuenta Holded por tienda.*
6. Dentro de cada tienda, da de alta las **cajas (registers) lógicas**
   que va a tener — sin emparejar todavía a dispositivos físicos. A cada
   caja se le puede asignar una `numSerie` Holded distinta para que la
   numeración fiscal salga separada por caja.
7. Crea cuentas de **cajero** (email + PIN de 4 dígitos) y los asigna a
   las tiendas donde pueden trabajar.

### 3.2 Emparejamiento de un dispositivo (una vez por caja física)

La primera vez que un equipo físico abre `mipiacetpv.tech`, no sabe a
qué caja del propietario representa. Hay que emparejarlo:

1. **Propietario o encargado**, desde su navegador admin: selecciona la
   caja a emparejar → "Generar código de emparejamiento". Sale un código
   numérico de 6 dígitos válido durante 1 hora.
2. **En el dispositivo de la caja:** abre `mipiacetpv.tech`, ve la
   pantalla "Empareja este dispositivo". Mete el código.
3. El backend valida, marca el dispositivo como emparejado a esa caja y
   le emite un **device token** de larga duración que la PWA guarda en
   `localStorage`.
4. A partir de aquí, cada vez que ese navegador entre a la URL va
   directo a la pantalla de PIN de cajero — sin volver a pedir
   emparejamiento.
5. **El propietario puede revocar** el emparejamiento de cualquier
   dispositivo desde el admin (caja robada, dispositivo perdido, etc.).
   La PWA detecta el rechazo en el siguiente refresh y vuelve a la
   pantalla de emparejamiento.

> El emparejamiento es **por navegador / perfil de navegador**. Si el
> cajero borra la caché, hay que re-emparejar. Para cajas productivas,
> instalar la PWA como app (en Chrome: Instalar) hace el storage más
> estable.

### 3.3 Apertura de turno del cajero

1. Cajero entra con su email (autocompletado de los últimos cajeros que
   usaron ese dispositivo) + PIN.
2. **El dispositivo ya sabe qué caja es** (gracias al emparejamiento),
   así que el cajero **no elige caja** — entra directo a la caja física
   que está tocando.
3. Introduce **fondo de caja inicial** (efectivo).
4. El sistema crea un **turno** abierto.

### 3.4 Venta

1. Añadir líneas:
   - Por código de barras (lector USB-HID → enfoca input, busca por
     `barcode` en catálogo local).
   - Por búsqueda manual (nombre, SKU).
   - Por botones rápidos configurables (top vendidos / favoritos).
2. Modificar cantidad, aplicar descuento por línea o global.
3. Asignar cliente (opcional, sólo si quieren ticket nominal o crédito).
4. Cobrar:
   - Efectivo (con cálculo de cambio).
   - Tarjeta (registro manual en MVP; integración con datáfono en v2).
   - Bizum (registro manual).
   - Vale / crédito interno.
   - Mixto (ej. 30 € tarjeta + 5 € efectivo).
5. Al confirmar cobro:
   - Se cierra el ticket en la base local con estado `PENDING_SYNC`.
   - Se abre el cajón si el método incluye efectivo.
   - Se imprime ticket por ESC/POS.
   - Se encola para volcar a Holded como `salesreceipt`.
6. El worker de sync envía el ticket a Holded.
   - **Éxito** → el ticket pasa a `SYNCED` y guardamos el ID de Holded y la
     URL del PDF fiscal.
   - **Error transitorio** (red, 5xx) → reintento exponencial.
   - **Error permanente** (4xx de validación) → marcado `SYNC_FAILED`, el
     encargado lo ve en una bandeja de errores y decide.

### 3.5 Devolución

1. Buscar ticket original (por nº, fecha, importe, últimos 50).
2. Seleccionar líneas a devolver (cantidad parcial permitida).
3. Elegir método de reembolso (mismo método del cobro original por defecto).
4. Genera **ticket de abono** en Holded (`salesreceipt` con importes en
   negativo, referenciando el original).
5. Stock se repone en el almacén configurado.

### 3.6 Cierre de caja

1. Cajero/encargado pulsa **"Cerrar turno"**.
2. El TPV muestra el **arqueo teórico** por método de pago.
3. El usuario introduce el **conteo real** de efectivo.
4. Se calcula **descuadre** = real − teórico.
5. Se genera un **informe de cierre Z** (PDF + impresión opcional).
6. El cierre **no se manda a Holded**. Vive sólo en el TPV.
7. Se hace un *health-check* de la cola de sync: si hay tickets en
   `PENDING_SYNC` o `SYNC_FAILED`, se advierte y se exige decisión antes de
   cerrar.

### 3.7 Modo offline

- Si el navegador pierde conexión durante la venta:
  - El catálogo y los precios siguen disponibles (ya están en IndexedDB).
  - El ticket se cobra e imprime con normalidad.
  - Se guarda en cola local. Se sube en cuanto vuelva la red.
- **Aviso visual permanente** en la cabecera mientras esté offline.
- **Stock:** en offline asumimos optimismo (no rechazamos venta por stock 0).
  Cualquier corrección la hará Holded al recibir el documento.

### 3.8 Sincronización del catálogo (independiente del login)

Es un proceso **aparte** del login del cajero. El catálogo en IndexedDB
se mantiene fresco así:

1. **Sync inicial** en el onboarding del propietario (paso 3.1.4).
2. **Sync incremental** cada 15 min mientras haya un dispositivo activo
   del tenant: el backend pregunta a Holded por cambios y empuja el diff
   a los navegadores conectados, o los navegadores hacen polling al
   backend.
3. **Sync manual** ("Actualizar catálogo ahora") desde el admin y desde
   el propio TPV (botón en la pantalla de venta — para casos como
   "acabamos de cambiar el precio en Holded").
4. **Webhook de Holded** si la API lo ofrece: empuje en vivo de cambios.

**El login del cajero NUNCA dispara una sync.** Sólo lee lo que ya hay
en IndexedDB. Esto es lo que permite que el cajero abra sesión y
empiece a vender en 2 segundos.

## 4. Reglas de negocio críticas

- **El ticket impreso para el cliente** debe llevar la información mínima
  legal: NIF del comercio, dirección, nº de ticket, fecha y hora, desglose
  IVA, total. Estos datos vienen de la cuenta Holded del cliente y se
  cachean al loguear.
- **Numeración de tickets:** numeración interna del TPV correlativa por caja.
  La numeración fiscal definitiva la asigna Holded al recibir el documento;
  guardamos ambas.
- **Idempotencia:** cada envío a Holded debe llevar un `externalId` o
  `idempotency-key` único (UUID v4 generado en el TPV) para que si el
  worker reintenta, no duplique el documento.
- **Precios:** se respetan los de Holded en el momento del sync inicial. Si
  el catálogo cambia, hay un botón **"Sincronizar catálogo ahora"** y un
  cron de sync incremental cada N minutos por tenant.
- **IVA:** se toma del producto en Holded. El TPV no decide tipos.
- **Stock:** mostramos el stock conocido localmente, sólo informativo. La
  realidad la dicta Holded al procesar la venta.

## 5. Fuera de alcance del MVP

- Datáfono integrado.
- Fidelización / puntos.
- E-commerce / catálogo web público.
- Multi-moneda.
- Reservas / citas.
- Facturación completa con datos del cliente (en MVP sólo *ticket de venta*
  sin razón social; si lo piden, se hace en Holded a posteriori a partir del
  `salesreceipt`).

## 6. Entorno de pruebas y multi-tenant

- **Veri*factu DESACTIVADO** en las cuentas Holded usadas para pruebas
  durante todo el desarrollo y el spike (Fase 0 del roadmap). Verificarlo
  manualmente en cada cuenta en `Configuración → Facturación → Veri*factu`
  antes de conectarla al TPV.
- Mientras Veri*factu siga desactivado, los `salesreceipt` de prueba
  pueden borrarse libremente desde Holded sin consecuencias fiscales.
- **El paso a Veri*factu activo en una cuenta operativa** requiere haber
  validado primero el spike de idempotencia (`docs/spike-holded.md`).
  Con Veri*factu activo, un duplicado por reintento del worker es un
  problema fiscal real, no un detalle de implementación.
- **Modelo de tenant confirmado para MVP:**
  - 1 propietario → 1 tenant → 1 conexión Holded → N tiendas → N cajas
    por tienda → N dispositivos emparejados por caja.
  - No se contempla en MVP que un propietario tenga **varias cuentas
    Holded distintas**. Si aparece ese caso (cliente con varios NIF en
    cuentas separadas), se le da un usuario propietario por cuenta y se
    decide más adelante si unificar.
- **Dominio de producción:** `mipiacetpv.tech` ya está apuntado al VPS
  de Hostinger. Caddy se configura en el despliegue para emitir SSL
  Let's Encrypt automáticamente.
