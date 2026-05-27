# Banco de pruebas v1.3 (Thalía-Operativa + Servicios-Pinta)

Fecha: 2026-05-25. Deploy en producción: `master 39aea5c`.

Objetivo: validar manualmente las funcionalidades nuevas antes de avisar a clientes piloto.

---

## Setup previo

1. Tener acceso al TPV de **Thalía** (tenant RETAIL real) en `https://mipiacetpv.com`.
2. Tener invitación / credenciales de cajero de Thalía. Si no, pedirlas a Matías.
3. Navegador: Chrome o Safari actualizado en iPad o portátil. Hacer **Cmd+Shift+R** (recarga dura) la primera vez para limpiar la caché del Service Worker viejo.
4. Si hay impresora térmica conectada vía bridge: tenerla encendida. Si no, las pruebas de impresión se validan por el log del bridge o por el modal "Enviado a impresora".
5. Caja abierta (turno iniciado) antes de empezar.

---

## Bloque A · Pruebas en Thalía (RETAIL)

Tiempo estimado: 25-30 min.

### A1 · UX cobro pulido (Lote 1 · Thalía-Operativa)

| # | Paso | Resultado esperado | OK/KO |
|---|------|--------------------|-------|
| 1.1 | Añadir un producto cualquiera al ticket (ej. 5,80 €) y pulsar **Cobrar**. | Se abre la pantalla de cobro. El cursor está en el input de efectivo. El importe del input está auto-seleccionado. | |
| 1.2 | Teclear `5` y `,` y `8` y `0`. | El input muestra `5,80` sin que haya que borrar nada antes. | |
| 1.3 | Pulsar `Enter`. | Cobra el ticket y muestra la pantalla de éxito. | |
| 1.4 | Repetir 1.1, teclear sólo `3` (importe insuficiente) y pulsar `Enter`. | El input parpadea en rojo. Aparece texto **"Falta 2,80 €"** debajo. NO cobra. | |
| 1.5 | Mientras está el parpadeo rojo, pulsar `Esc`. | El input se limpia, se vuelve a auto-seleccionar el valor por defecto y desaparece el aviso rojo. | |
| 1.6 | En la pantalla de cobro, pulsar el botón **Importe exacto**. | El input se rellena automáticamente con el total exacto del ticket. Pulsando `Enter` cobra sin cambio. | |

Anotar: cualquier ticket que no se procese, capturar pantalla.

### A2 · Cobro mixto en 1 tap (Lote 2)

| # | Paso | Resultado esperado | OK/KO |
|---|------|--------------------|-------|
| 2.1 | Añadir un ticket de 30,00 €. Pulsar **Cobrar**. | Aparece pantalla de cobro. | |
| 2.2 | Pulsar el botón **Mixto** (o el icono de partir el pago). | Se muestra dentro de la misma pantalla un panel con dos campos: Efectivo y Tarjeta. NO debe abrir otra pantalla nueva. | |
| 2.3 | Introducir 10 € en efectivo y 20 € en tarjeta. | El total de los dos campos suma 30,00 € y el botón Cobrar se activa. | |
| 2.4 | Cobrar. | Ticket emitido, en el detalle aparecen los 2 métodos de pago listados. | |

### A3 · Reimprimir ticket (Lote 3)

| # | Paso | Resultado esperado | OK/KO |
|---|------|--------------------|-------|
| 3.1 | Ir al historial de tickets (Caja → Tickets). | Aparece el listado de tickets recientes. Cada fila tiene un icono de impresora a la derecha. | |
| 3.2 | Pulsar el icono de impresora de cualquier ticket cobrado. | Aparece el aviso "Enviado a impresora" debajo del número de ticket. NO se abre el detalle. | |
| 3.3 | Si hay impresora física: comprobar que el ticket impreso lleva en la cabecera **"*** COPIA — no fiscal ***"** centrado y con asteriscos. | El ticket impreso original NO tiene esa marca; sólo la copia. | |
| 3.4 | Abrir el detalle de un ticket. Pulsar el botón grande **Reimprimir ticket**. | Aparece debajo "Enviado a impresora. La copia llevará marca COPIA." | |

### A4 · Arqueo Z + X con denominaciones (Lote 4)

| # | Paso | Resultado esperado | OK/KO |
|---|------|--------------------|-------|
| 4.1 | En la barra lateral, pulsar **Cerrar turno** (icono de candado). | Se abre el modal de cierre. Junto al campo "Efectivo total" aparece un icono o link tipo **"Contar por denominaciones"**. | |
| 4.2 | Pulsar **Contar por denominaciones**. | Aparece una tabla con 15 filas: billetes 500/200/100/50/20/10/5 y monedas 2/1/0,50/0,20/0,10/0,05/0,02/0,01. | |
| 4.3 | Introducir, por ejemplo: 2 billetes de 20 €, 3 de 10 €, 5 monedas de 1 €. | El total se calcula automáticamente: 75,00 €. El campo "Efectivo total" del cierre se rellena con 75,00. | |
| 4.4 | Volver a Cerrar turno. | El cierre Z se procesa con el desglose registrado. | |
| 4.5 | **Antes** de cerrar Z, probar un **arqueo X intermedio** (revisión sin cerrar caja). | Debe funcionar el botón / acceso al X y mostrar los mismos totales sin cerrar el turno. | |

### A5 · Lector de código de barras por cámara (Lote 5)

| # | Paso | Resultado esperado | OK/KO |
|---|------|--------------------|-------|
| 5.1 | En la pantalla de venta, buscar un botón **Escanear** (icono de cámara) en la barra de búsqueda o cerca de ella. | El botón aparece visible. | |
| 5.2 | Pulsarlo en iPad o móvil. | Aparece un modal a pantalla completa con la vista de la cámara y un cuadro guía. El navegador pedirá permiso de cámara la primera vez. | |
| 5.3 | Apuntar a un libro con código de barras EAN-13 (cualquier libro estándar). | Suena un beep o el modal se cierra automáticamente y el producto se añade al ticket si está en el catálogo. | |
| 5.4 | Si el código no existe en catálogo. | Aviso "Producto no encontrado" o equivalente. NO debe crashear el TPV. | |

### A6 · Pie de ticket configurable (Lote 6)

| # | Paso | Resultado esperado | OK/KO |
|---|------|--------------------|-------|
| 6.1 | Entrar al admin (`https://admin.mipiacetpv.com`), abrir la ficha del tenant Thalía. | Aparece un campo nuevo **"Pie de ticket"** con textarea (máx 200 caracteres) y un **Preview**. | |
| 6.2 | Escribir "Gracias por su compra · Cambios hasta 15 días con ticket" y guardar. | El preview se actualiza en tiempo real. Se guarda OK. | |
| 6.3 | Volver al TPV, cobrar un ticket nuevo, imprimirlo. | El ticket impreso lleva el pie configurado justo encima del QR. | |

---

## Bloque B · Pruebas en tenant SERVICES de prueba

Tiempo estimado: 15 min. **Sólo si se tiene tenant SERVICES creado**. Si no, saltar este bloque y avisar a Matías para crear uno.

### B1 · Vocabulario adaptado (Lote 1 · Servicios-Pinta)

| # | Paso | Resultado esperado | OK/KO |
|---|------|--------------------|-------|
| 1.1 | Entrar al TPV del tenant SERVICES. | El placeholder de búsqueda dice **"Buscar servicio o cliente…"** (no "producto"). | |
| 1.2 | Mirar el botón principal de la pantalla de cobro y el historial. | El copy usa "servicio" / "comprobante" en lugar de "producto" / "ticket". El título de la pantalla de historial es distinto al de Thalía. | |

### B2 · Plantilla impresa COMPROBANTE (Lote 2)

| # | Paso | Resultado esperado | OK/KO |
|---|------|--------------------|-------|
| 2.1 | Cobrar un servicio y reimprimir. | En la cabecera del ticket impreso aparece **"COMPROBANTE"** (no "TICKET DE VENTA"). | |
| 2.2 | Hacer una devolución/anulación. | En el ticket aparece **"ANULACIÓN"** (no "DEVOLUCIÓN"). | |

### B3 · Campo "Atendido por" (Lote 3)

| # | Paso | Resultado esperado | OK/KO |
|---|------|--------------------|-------|
| 3.1 | En la pantalla de cobro de SERVICES, debe haber un campo nuevo **"Atendido por"** (texto libre, opcional, máx 60 caracteres). | El campo es visible. | |
| 3.2 | Rellenar con un nombre (ej. "Marta") y cobrar. | El ticket impreso muestra **"Atendido por: Marta"** entre cabecera y líneas. | |
| 3.3 | Abrir el historial. | En la fila del ticket aparece "· Atendido por Marta" al lado de la fecha. | |
| 3.4 | Probar dejar el campo vacío y cobrar. | No aparece la línea en el impreso ni en el historial. NO debe bloquear el cobro. | |
| 3.5 | Probar meter 80 caracteres seguidos. | Aparece error de validación (máx 60). El cobro se bloquea hasta corregir. | |

### B4 · Nudge cliente sin asignar (Lote 4)

| # | Paso | Resultado esperado | OK/KO |
|---|------|--------------------|-------|
| 4.1 | Iniciar un ticket en SERVICES sin asignar cliente. Pulsar **Cobrar**. | Aparece un aviso ámbar **"Servicio sin cliente"** con dos botones: **Continuar** y **Asignar cliente**. | |
| 4.2 | Pulsar **Continuar**. | El cobro procede normal sin cliente. | |
| 4.3 | Repetir el paso 4.1 y pulsar **Asignar cliente**. | Se abre el modal de selección de cliente existente. | |
| 4.4 | Repetir lo mismo en Thalía (RETAIL). | NO aparece el nudge — sólo se ve en SERVICES. | |

### B5 · Empty states + iconos (Lote 5)

| # | Paso | Resultado esperado | OK/KO |
|---|------|--------------------|-------|
| 5.1 | Buscar un servicio que no existe (ej. "xyzxyz"). | El placeholder del grid vacío usa copy de servicios (no "No hay productos"). | |
| 5.2 | En el historial, pulsar **Iniciar anulación**. | El icono al lado del texto es un **círculo con X** (no la flecha de devolución de RETAIL). | |
| 5.3 | Si el catálogo SERVICES sólo tiene servicios (no productos): comprobar que el toggle "Servicios / Productos" está oculto. | El toggle no aparece. | |

---

## Plantilla para reportar fallos

Por cada KO, anotar:

- **ID del paso** (ej. A1.4)
- **Qué pasó** en una frase
- **Captura de pantalla** (si es visual)
- **Nº de ticket** (si hay uno) o hora aproximada
- **Navegador y dispositivo** (Chrome iPad / Safari Mac, etc.)

Si algo crashea por completo el TPV (pantalla blanca), recargar duro y anotar.

---

## Resumen rápido

- Bloque A: 6 secciones, ~25 casos, cubre todo lo nuevo para clientes RETAIL/Hospitalidad.
- Bloque B: 5 secciones, ~15 casos, cubre lo nuevo para clientes SERVICES.
- Tiempo total estimado: 40-45 min si todo va bien.

Si una sección de A va al 100% OK, podemos avisar a Thalía y abrir su acceso ya.
