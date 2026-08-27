# Checklist implantación · Cafetería Sirope (hostelería, 2 cajas)

Estado previo (validado 05-06/07): tenant DRAFT «Listo para activar», Holded Conectado, 0 errores, checks verdes (53/53 productos, 70 servicios, 98/110 taxes). Sala provisional creada: B1-B3 (barra), M1-M4 (salón), T1-T2 (terraza). En producción: v1.8 fiado + v1.9.1 + v1.9.2 verificados en vivo (+ v1.9.3/4/5 si mergean hoy).

## 1 · Antes de salir (remoto)

- [ ] Merges del día completados y desplegados; `/health` OK; api/worker healthy.
- [ ] Re-verificación en vivo post-deploy (mapa visual, desglose IVA, devolución en prueba).
- [ ] Rollback anclado: apuntar el sha del último deploy verificado (`IMAGE_TAG=<sha> bash infra/deploy.sh`).
- [ ] Tickets de prueba de hoy quedan como están (se purgan al activar).

## 2 · Primer AP12 encendido (10 min)

> **Obsoleto desde el 2026-08-27.** La preparación del terminal se hace **en el taller** y tiene su
> propio documento: `docs/implantaciones/checklist-terminal.md`. Sobre un terminal de fábrica
> (Chrome 81) la interfaz se ve rota y el cobro es impracticable. No se sale de casa sin esa
> checklist en verde.

- [ ] Terminal preparado según `checklist-terminal.md` (APK o Chrome actualizado, densidad 240).
- [ ] **OSK/autofocus**: ¿salta el teclado en pantalla al entrar en venta? Si tapa catálogo → hotfix 1 línea (quitar autofocus en HOSPITALITY).
- [ ] Viewport real: ¿caben los chips de categoría? ¿grid a gusto? (simulado OK a 1280 y 1568).
- [ ] Tacto: objetivos de mesa/producto/cobro cómodos con dedo.
- [ ] Modo avión 2 min: venta rápida offline → outbox chip → reconectar → reenvío automático.

## 3 · Segundo AP12 (2 cajas reales — lo no simulable)

- [ ] Emparejar como **Caja 2** (registro de dispositivo).
- [ ] Mesa abierta en Caja 1 se pinta ocupada en Caja 2 (ya validado entre pestañas; confirmar entre devices).
- [ ] **Expulsión pasiva**: Caja 2 dentro de una mesa; Caja 1 la cobra → Caja 2 debe salir al mapa con banner (filtra por registerId distinto: SOLO comprobable aquí).
- [ ] Doble cobro simultáneo real: uno gana, el otro recibe banner claro; caja física cuadra.
- [ ] Mover línea y partir cuenta con las dos cajas.

## 4 · Con el dueño

- [ ] **Sala real**: renombrar/ajustar mesas y zonas en admin según su local (la provisional B1-B3/M1-M4/T1-T2 es placeholder).
- [ ] **Catálogo**: limpiar duplicados en SU Holded (2× Baileys 3,19/3,00 · 2× Batido 2,30/2,50) + repaso de precios raros. Sync incremental los recoge.
- [ ] **ACTIVAR CUENTA** (super-admin → Activar): pedir email del dueño EN ESE MOMENTO; crea OWNER + envía credenciales + purga pruebas. IRREVERSIBLE.
- [ ] Owner: primer login, cambio de contraseña (toggle ojo ya desplegado), PIN.
- [ ] Datos fiscales del ticket verificados en un PDF real (cabecera: razón social, NIF, dirección, tel).

## 5 · Formación (guion camarero: «el cobro nace en la mesa»)

- [ ] Abrir turno con fondo real (presets).
- [ ] Mesa: abrir → comandar → mapa → retomar → cobrar (sale solo al mapa).
- [ ] Barra: puestos B1-B3 + venta rápida para el café al vuelo.
- [ ] Agrupar/desagrupar y mover mesa.
- [ ] Cobros: efectivo con cambio, tarjeta, y el banner «la cuenta ha cambiado» si comandan a la vez.
- [ ] Devolución (si v1.9.5 llegó: ensayable en modo prueba ANTES de activar; si no: primera venta real + su devolución).
- [ ] Arqueo X a media tarde; cierre con Z al final (recuento por denominaciones, descuadre).
- [ ] Ticket digital: QR/PDF/email desde Tickets.
- [ ] Fiado: NO se enseña (flag OFF; pendiente asesor).

## 6 · Antes de irnos

- [ ] Primera venta real del dueño sincronizada en SU Holded (doc visible en app.holded.com).
- [ ] Conciliación 07:00 mañana: avisar de que llegará email si algo descuadra.
- [ ] Teléfono de soporte apuntado en la barra; workaround universal: «sal al mapa y vuelve a entrar».
- [ ] Condiciones piloto entregadas (6 meses gratis desde activación) + contrato/privacidad/DPA firmados.
