# Libro de pruebas · v1.3-SuperAdmin-Hub + v1.4-Bar-Operativa-MVP

Fecha: 2026-06-01
Master tras deploy: `ccb8818` (Merge Bar) + `aeb75bc` (Lote 2 Hub)
Bundles vivos: api Healthy · worker Started · TPV `index-C2EiuwWZ.js` · admin nuevo tras static-publish

Si algún paso falla, anótalo con número de prueba y captura. Esos son los próximos prompts para Code.

---

## Bloque A · Sole (cierre v1.3)

### A.1 · Catálogo completo
1. Abre `tpv.mipiacetpv.com` o `mipiacetpv.com/login-cajero` en Chrome del Mac.
2. Loguea con `solepelos@gmail.com` + PIN `8980`.
3. Hard refresh (Cmd+Shift+R).
4. Cuenta categorías (chips horizontales): **deben ser 9** — Cortesypeinados, Depilc, Tintecolor, Tratamientos, Unas, Urizos, Varios, Zeventos, Zzotros.
5. Pulsa "Tintecolor" → **10 servicios** (BALAYAGE, MECHAS GORRO/PLATA, SOLO 4 MECHAS, TINTE, TINTE PELO LARGO, TINTE Y 4 MECHAS, TINTE Y CORTAR, TINTE Y MECHAS PLATA CORTO/LARGO).

### A.2 · Bug-WS arreglado
1. DevTools → **Console**.
2. Recarga el TPV.
3. **No debe aparecer** el error `wss://mipiacetpv.com/ws/store/...`. Debería verse un log tipo "WebSocket conectado" o silencio.

### A.3 · Cobro completo
1. Añade 2-3 servicios al ticket (mezcla precios).
2. Pulsa Cobrar → pestaña Efectivo.
3. Pulsa atajo "50€" → el campo dice `50.00`, **no se suma** a lo anterior.
4. Pulsa atajo "100€" → el campo dice `100.00`, **no `150.00`**.
5. Cobra → debe ir a Holded y aparecer en historial con `docNumber=T26XXXX`.

### A.4 · Pairing one-shot
1. En admin → Dispositivos → genera código de pairing.
2. Empareja un dispositivo (puede ser otra pestaña del Mac simulando).
3. Intenta empareja UN SEGUNDO dispositivo con el mismo código → **debe rechazar** con "Código inválido o caducado".

---

## Bloque B · Hub super-admin (v1.3 Lote 2)

### B.1 · Landing redirige al Hub
1. Abre `admin.mipiacetpv.com` y loguea como super-admin (tu cuenta).
2. La URL debe acabar en `/super-admin/hub` (antes era `/super-admin/cuentas` o similar).
3. Verás StatusTiles arriba (redis, tenants, sync errors, last sync) y tarjetas por tenant abajo.

### B.2 · Tarjeta por tenant
1. Localiza la tarjeta de "Peluquería Sole".
2. Debe mostrar: businessType (SERVICES), estado (activo), tickets últimos 7 días, errores sync.
3. Si Sole NO tiene `holdedAccountId`, el botón "Holded" debe estar deshabilitado con tooltip.

### B.3 · Configurar holdedAccountId
1. Click en la tarjeta de Sole → Editar.
2. En el panel "Holded Account ID", pega el accountId real de Holded (o pega la URL completa del cliente, el campo debería extraer el id).
3. Guarda. Vuelve al Hub → el botón "Holded" ya debe estar habilitado.
4. Pulsa "Holded" → abre `app.holded.com/accounts/<id>` en pestaña nueva.

### B.4 · Impersonate full (configurar como OWNER)
1. En la tarjeta de Sole, pulsa **"Configurar"** (botón ámbar, distinto del "Ver sólo lectura").
2. Modal de confirmación → "Vas a entrar con permisos de escritura. Todo queda registrado". Confirma.
3. Te redirige al admin como si fueras Sole. Banner ámbar arriba: "Modo super-admin · configurando como solepelos@gmail.com · modo escritura".
4. Comprueba que puedes navegar Productos, Cajeros, Dispositivos.
5. Toca algo que escriba (ej. cambia un nombre de cajero y guarda) → debe permitirlo.
6. Pulsa "Salir" del banner → vuelve al Hub super-admin.
7. En AuditLog del super-admin → debe aparecer evento `impersonate` con tu superAdminId, tenant Sole, mode=full.

### B.5 · Tareas comunes
1. En el Hub, sección "Tareas comunes" — si hay tickets en SYNC_FAILED, debe aparecer atajo "Revisar N SYNC_FAILED".
2. Atajos "Activar cuenta", "Crear super-admin" funcionan.

---

## Bloque C · Bar-Operativa-MVP (v1.4)

> ⚠️ Para probar este bloque te recomendaría una cuenta HOSPITALITY de prueba. Si no tienes una activa, créate `Bar-Pruebas` y úsala. Sole no tiene mesas (es vertical SERVICES).

### C.1 · Configurar secciones de tag (admin)
1. En el admin del tenant HOSPITALITY (impersonando si hace falta), busca en el menú lateral **"Comanderas"** (o `/admin/tag-sections`).
2. Lista de tags del tenant. Por cada tag, dropdown para asignar: SALON / BARRA / COCINA.
3. Asigna "bebidas" o similar → BARRA, "tapas" o "platos" → COCINA. Guarda.

### C.2 · Enviar comanda al guardar mesa
1. Loguea cajero del bar en el TPV.
2. En TableMap, abre una mesa.
3. Añade líneas mezclando tags BARRA y COCINA (ej. 2 cañas + 1 tostada).
4. Pulsa **"Enviar comanda"** (botón nuevo en panel de mesa, junto a "Cobrar").
5. Resultado esperado:
   - Se abren 2 PDFs (uno BARRA, uno COCINA).
   - Cada uno con solo sus líneas.
   - Toast verde: "Enviado a BARRA: N líneas · COCINA: M líneas".
6. Pulsa "Reenviar comanda" → debe permitirte (texto cambia a "Reenviar" cuando ya hay envío previo).

### C.3 · Mover ticket entre mesas
1. Con la mesa abierta del C.2, en el aside busca chip **"Mover mesa"** (o 3 puntos → "Mover").
2. Modal con TableMap → mesas libres en color, ocupadas en gris.
3. Pulsa una mesa libre → ticket cambia de mesa, redirige al panel de la nueva.
4. Si pulsas una mesa ocupada → error visible con info del ticket que la ocupa.

### C.4 · Split bill (cobrar parcial)
1. Con la mesa abierta y total 80€ por ejemplo:
2. En cobro → botón **"Partir cuenta"** o **"Cobro parcial"** (nuevo).
3. Modal con resumen Total / Cobrado / Resta + atajos ½ ⅓ ¼.
4. Pulsa ½ → input pone `40.00`. Pulsa Efectivo → cobra esos 40€.
5. Vuelve al panel mesa: el ticket sigue ABIERTO con "40 € pagados, 40 € pendientes".
6. Cobra los 40€ restantes por flujo normal → ticket cierra, sube a Holded como UN solo salesreceipt con 2 payments.

> ⚠️ El SplitBillSheet **NO** está integrado en CheckoutOverlay (Code lo dejó como evolutivo). Probablemente lo encuentras como botón secundario en SalePage / panel de mesa, no dentro del modal estándar de cobro.

---

## Bloque D · Realtime (v1.1 Lote 4 que ahora SÍ funciona)

### D.1 · Sincronización entre 2 pestañas
1. En Chrome del Mac, abre el TPV en 2 ventanas (mismo cajero, mismo register).
2. En la ventana 1, abre la mesa 3 y añade una línea.
3. En la ventana 2 (que NO ha tocado mesa 3) → la mesa 3 debe aparecer como "ocupada" instantáneamente (sin recargar).

---

## Qué reportar

Por cada prueba que falle:
- Número (A.1, B.4, etc.).
- Captura.
- Mensaje de consola si lo hay.
- Reproducible o no.

Pruebas que pasan → solo dilo "A.1 OK, A.2 OK" sin captura.

Cuando termines, los fallos se convierten en el prompt del siguiente sprint para Code, priorizados por dolor real.
