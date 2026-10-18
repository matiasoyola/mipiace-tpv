# Lo nuevo de Raquel Torres del 7 al 18-oct · qué se trae al TPV (decidido)

> **Qué es esto.** La tercera entrega desde Raquel Torres. Continúa a `05` (lo aprendido hasta el
> 6-oct) y a `06` (dónde aterriza cada pieza). Fuente: `raqueltorres/MIPIACETPV_NOVEDADES_CHEQUES_Y_RESERVAS_2026-10-18.md`
> (commit RT `3681405`), contrastado con `mipiacetpv@3c1c8b9`.
>
> **Cómo se ha decidido.** Matías delegó la validación pieza a pieza (18-oct): «validalo tú». Cada
> línea lleva el veredicto y el bloque destino. Las dos que pueden abrir debate están en §4.
>
> **Regla de fondo, la misma de `06`:** del spa se trae el contrato, los casos medidos y las
> pantallas como diseño. El código se reescribe. Lo que solo existe por Koibox, WordPress o Stripe se tira.
>
> **Estado del TPV a 18-oct:** no hay tablas de bonos, cheques, ofertas ni libro de movimientos.
> Sí hay `discountPct` + `discountThresholdPct` con PIN de encargado, PIN de cajero, auto-logout por
> inactividad y `Tenant.esDePruebas` (a nivel de cuenta).

Leyenda: ✅ se trae · 🔁 se trae adaptado · 🗑️ se tira · ⏸️ se trae pero espera.

---

## 1 · Cheques regalo

`06` §2.2 dejó la venta de cheques regalo «fuera de este plan». **Se revierte:** ya está madura en
producción y cualquier negocio con servicios la vende (spa, peluquería, clínica, incluso un bar). Se
construye **sobre el libro de B-8**, no al lado: un cheque y un bono son la misma deuda del centro
con distinta unidad (sesiones o euros).

| # | Pieza | Veredicto | Destino |
|---|---|---|---|
| 1 | **Dinero y deuda separados.** Cada venta deja dos líneas: la deuda (valor de carta del bono/cheque) y el cobro (lo que entró, con forma de pago). Un bono vendido con descuento o regalado vale lo de carta al canjearse | ✅ Regla base del libro | B-8 |
| 2 | **Venta en el mostrador**: servicio elegido a la vista y **sin preselección** (un desplegable preseleccionado ya emitió cheques equivocados); botón que dice qué se cobra; extras recalculados en servidor; lo vendido se congela en la fila; mixto con reparto obligatorio; «se lo lleva ahora»; anular solo sin nada gastado y **devolver en la misma forma de pago** | ✅ | Bloque nuevo **B-cheques** (tras B-8) |
| 3 | **Venta web en una pantalla**, cheque por importe libre con mínimo y máximo, el cheque **nace en el webhook** (quien abandona no gasta número) | 🔁 Contrato de estados; pasarela por decidir | B-13 |
| 4 | **Envío programado** al destinatario: página privada del comprador (token distinto del enlace del destinatario), caducidad que no se mueve, envío a hora fija del centro | 🔁 | B-cheques |
| 4b | **Anti doble envío**: el candado es un campo sello (`sent_at`), no el estado; bloqueo de fila al abrir; el correo sale **después del COMMIT**; si falla, vuelve a programado | ✅ Patrón común | B-cheques, B-12 recordatorios |
| 5 | **Descuentos e invitaciones**: % calculado en servidor sobre el total; motivo de **lista cerrada** (`donativo / fidelizacion / otro`), nota obligatoria solo con `otro`; **ningún mínimo de caracteres oculto** (bloqueó una invitación real); línea informativa «Descuentos» en el cierre, que no resta | 🔁 Se añade a lo que ya hay (`discountPct` + PIN de encargado) | B-cheques; la línea del cierre, al bloque de cierre de caja |
| 6 | **Editar un cheque**: motivo obligatorio, evento con antes/después, línea `diferencia_cobrada/devuelta`; a uno más barato, el resto va a saldo `S-` con la caducidad del original; saldos, señales y cheques importados no se editan. Una sola función `por_que_no_editable()` para botón y servidor | ✅ | B-8 |
| 7 | Preparación de cajas y cofres (`por_preparar → listo → entregado / enviado`, correo al **comprador**, no al destinatario) | ⏸️ Opción del bloque, apagada por defecto. Solo la usa el spa | B-cheques (fase 2) |
| 8 | **Numeración**: manda el número (se acepta `23690` suelto), contador atómico que **se salta números ya existentes**, y **candado de primer uso** (no se emite nada hasta confirmar por qué número va el talonario) | ✅ | B-8 |
| 9 | Justificante de 80 mm «no es factura» | 🔁 Ver §4.1 | B-cheques |

**Nombre.** En el código y el modelo, `Voucher` / «bono». La palabra de cara al centro es
**configurable por cuenta** (el spa dice «programa», la clínica y la peluquería «bono»). No se discute
más.

---

## 2 · Reserva online

| # | Pieza | Veredicto | Destino |
|---|---|---|---|
| 10 | Reglas de venta nuevas: **franjas de valor** (no entran servicios cortos salvo a <48 h), **no fragmentar** (los cortos solo en los extremos de un bloque libre), **«sin migas»** (no ofrecer una hora que deje un hueco <30 min, y nunca vaciar un día que tenía horas; solo web, no mostrador), y **cada rechazo anotado por regla, sin datos personales** para medir demanda | ✅ | B-6b |
| 11 | **Ofertas**: las crea el centro con fechas; alcance carta / categoría / servicio; canal web o web+mostrador; varias a la vez **no se suman, gana la mayor**; nunca con código ni sobre extras; se congela en el pago; «temporada» que se apaga sola | ✅ | Bloque nuevo **B-ofertas**, en la capa de catálogo (sirve también a hostelería) |
| 12 | **Anular desde el mostrador** con una pregunta de tres respuestas: devolver (a su origen), dejar saldo `S-`, pérdida. El panel sugiere según el plazo y la persona decide; el centro se salta el plazo pero no la regla de cita futura y pagada; mixtos, cada parte a su origen; `anulada_por` + `anulada_origen`; la clienta recibe siempre correo | ✅ | B-11 / B-recepción |
| 13 | Informe de lo cobrado online con **etiqueta de estado** (Activa, Hecha, Anulada, Prueba) y filtro | ✅ | B-11 |
| 14 | Caché de huecos en tabla propia, precarga por anillos | 🗑️ Solo existe por el tope de 30 consultas/min de Koibox. Con agenda propia no hace falta. Se queda la regla general: **una caché dura más que su vuelta de recarga, o se apaga sola** | — |

---

## 3 · Transversal

| # | Pieza | Veredicto | Destino |
|---|---|---|---|
| 15 | PIN de 4 cifras solo en un aparato que ya entró con contraseña; 3 fallos bloquean el PIN; bloqueo a los 5 min **comprobado en servidor** | 🔁 El TPV ya tiene PIN de cajero, emparejamiento de aparato y auto-logout. Solo se comprueba que el bloqueo por fallos y la inactividad vivan en servidor; lo que falte, se añade | Revisión dentro de B-recepción |
| 16 | Cambios de carta sin código; **ocultar un servicio no invalida lo ya vendido** | ✅ Ya es principio. Se exige un test en B-8: ocultar un servicio con bonos vivos los deja canjeables | B-8 |
| 17 | **`es_prueba` por fila**: lo de prueba se marca, nunca se borra; sale de fichas y totales de gestión, pero **sigue en la caja si el dinero se movió de verdad** | 🔁 Complementa, no sustituye, a `Tenant.esDePruebas` (cuenta entera). Hace falta para probar en la cuenta real de un cliente | B-8, B-11 |
| 18 | Trampas: una **lista blanca de columnas** descarta en silencio las columnas nuevas (cada campo nuevo, su test); **«filas afectadas = 0» no sirve de candado** (no distingue «no me tocaba» de «ya estaba»): candado de fila + campo sello; **6 meses son de calendario**, no 183 días; «hasta el día X» incluye el día entero en hora local | ✅ A los prompts de Code como criterio de review | Todos |

---

## 4 · Las dos que pueden abrir debate

### 4.1 El justificante del cheque (pieza 9)

En el spa, la venta de un cheque saca un justificante propio, sin serie y sin Verifactu. **En el TPV
no se hace un papel paralelo:** la venta de un bono o cheque es un ticket más y sigue el mismo camino
fiscal que cualquier otra venta de esa cuenta. El IVA del bono univalente (al vender o al canjear) es
el frente P5 / ADR-K3 de la asesoría y **no se decide aquí**. Hasta que P5 esté cerrado, B-cheques no
se despliega a un cliente.

### 4.2 Bloques nuevos frente al tablero

B-cheques y B-ofertas son «lo nuevo vendible» (escalón 4 de la escalera). **No abren frente:** entran
a la cola detrás de B-8. Ninguno se adelanta a un cliente que espera.

---

## 5 · Qué se toca en otros documentos

- `06` §2.2: la fila «Compra pública de cheques regalo» pasa de «fuera de este plan» a **B-cheques**.
- `02-roadmap-agenda.md`: B-8 recibe 1, 6, 8, 16, 17; B-6b recibe 10; B-11 recibe 12, 13, 17; B-12 recibe 4b. Nuevos: B-cheques, B-ofertas.
- En el repo del spa, `rt-gift-cards/docs/11-FUTURE-MIGRATION-MIPIACETPV.md` está desfasado. **No se
  rehace allí:** el mapa de migración vive aquí (`06` + este `07`).

*Mi Piace Internet Solutions · tercera entrega desde Raquel Torres · 18-oct-2026.*
