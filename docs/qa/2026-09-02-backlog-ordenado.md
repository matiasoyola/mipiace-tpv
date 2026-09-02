# Backlog ordenado · auditoría por procesos del 2026-09-02

Los tres cajones están cerrados en `docs/qa/2026-09-02-auditoria-por-procesos.md`. Este documento
sólo hace lo que faltaba: **ordenar dentro de cada cajón y fijar el alcance de los bloques.**

## Criterio de orden (no es la gravedad, es la fecha del primer daño)

1. **Lo que corrompe datos cada día que pasa** va primero, aunque el arreglo sea pequeño. Cuanto más
   tarde, más grande el backfill.
2. **Lo que hace daño a un cliente concreto** (un celíaco, la cocina que no recibe la comanda).
3. **Lo que sangra dinero en cada servicio.**
4. **Lo que bloquea una situación que todavía no ocurre** (vincular un terminal solo: hoy lo hacemos
   nosotros en sitio con un segundo dispositivo).
5. Estética.

Por eso B5 —siendo 🔴— cae por detrás de C2/C3: B5 muerde el día que un cliente instale un terminal
sin nosotros; C2 muerde en cada cobro mixto desde hoy.

---

## Causa raíz de B1 (encontrada en el código, no hace falta investigarla otra vez)

`CheckoutPage.tsx:201` calcula `cashAmount` como la **suma de las filas CASH**, y `:477` manda
`payments[] = filas tal cual` **y** `cashAmount` con el mismo número. Para un ticket de 3,00 € pagado
con un billete de 5:

```
payments[0] = { method: CASH, amount: 5.00 }   ← debería ser 3.00
ticket.cashAmount = 5.00                        ← correcto
```

`shift/breakdown-sums.ts` suma `ticketPayment.amount` → el turno cuenta 5,00 en lugar de 3,00. De ahí
salen los 9,70 € de ventas y los 7,00 € esperados en el cajón.

**Segunda víctima, no vista en la auditoría:** `tickets/print.ts:352` pinta el cambio sólo si
`cashAmount > amount`. Como valen lo mismo, **el ticket térmico tampoco imprime la línea CAMBIO**:
el cliente se lleva un papel que dice "Efectivo 5,00" bajo un "TOTAL 3,00" y ninguna vuelta.

**Forma del arreglo:** `payments[].amount` = importe **aplicado** (tope: lo que queda por cubrir);
el exceso vive sólo en `ticket.cashAmount`. Sin migración de esquema. Backfill de histórico:
en los tickets con `Σpayments > total` y `cashAmount != null`, restar la diferencia a la fila CASH.

---

## 🔴 Bloquea implantación · orden

| # | Hallazgo | Por qué ahí |
|---|---|---|
| 1 | **B1** cierre cuenta lo entregado | Único que corrompe datos a diario y el único problema contable del cliente |
| 2 | **B6** keystore de release | Sin código, puramente infra, y puerta dura desde A4. Va **en paralelo**, no compite por ficheros |
| 3 | **B4** dos productos iguales | Seguridad alimentaria y el arreglo es barato |
| 4 | **B3** comanda que falla sin rastro | La cocina no se entera; el camarero no tiene forma de saberlo |
| 5 | **B2** cierre con mesas abiertas | Dinero fantasma en sala + Z incompleto |
| 6 | **B5** vincular terminal | Bloquea el autoservicio, que todavía no existe: hoy instalamos nosotros |

## 🟠 Cuesta dinero · orden

| # | Hallazgo | Por qué ahí |
|---|---|---|
| 1 | **C1** la confirmación no dice la vuelta | Mismo defecto que B1, misma frase: la vuelta no existe en ninguna capa |
| 2 | **C2** el CashPad no escribe sobre pre-relleno | Vivo desde la ronda 2, en la ruta del dinero, arreglo de una tarde. Decisión (b) |
| 3 | **C3** exceso de tarjeta en verde | Dinero que sale por la puerta y el color dice "adelante" |
| 4 | **C5** "Más opciones" bajo el pie fijo | Mismo modal; se arregla copiando el layout del arqueo |
| 5 | **C4** "últ. 4" abre el QWERTY | Mismo modal, y comparte mecanismo con B5: prepara su arreglo |
| 6 | **C9 · C11 · C10** cierre y arqueo | Viajan con B2, es la misma pantalla |
| 7 | **C8** targets −/+ y papelera sin deshacer | Barato y destructivo |
| 8 | **C6 · C7** catálogo y hueco del panel | Trabajo de producto, no de bug; el rail ya está decidido |
| 9 | **C12** añadir producto a 101–117 ms | Medir antes de tocar; 2 ms sobre presupuesto no justifica riesgo antes que lo de arriba |

## 🟡 Estética · orden, con dos ascensos

**Propongo subir dos a 🟠**, porque no son "se ve mal": provocan toques:

- **E4** "Enviar comanda" es el botón más débil junto a un "Cobrar" del doble → jerarquía invertida
  para el flujo de sala. Cambia lo que pulsa el camarero.
- **E5** "Cobrar 0,00 €" deshabilitado pintado como habilitado → invita a un toque que no hace nada.

Y **E11** (el menú no enseña la versión de la APK) sube a 🔴 pegado al keystore: desde A4 son dos
entregas y el técnico en sitio necesita las dos para saber qué está mirando.

Resto: E1 mapa de sala · E2 aire de la tarjeta · E3 corte de "Café con leche" · E6 copy roto ·
E8 UUID en DRAFT · E9 barra de estado mintiendo · E7 chips sin estado accesible · E10 "Mostrar PIN" ·
E12 "Descargar PDF".

---

# Bloques propuestos

Cada bloque cierra con la **tabla sabotaje → test rojo** (qué línea rompo y qué test se pone rojo);
la suite verde no es criterio de "funciona".

### v1.15 · La vuelta existe (B1 + C1 + línea CAMBIO en el térmico)
Normalizar `payments[].amount` al importe aplicado, backfill del histórico, la línea CAMBIO en el
ticket impreso y **TOTAL / ENTREGADO / CAMBIO** en grande en "Ticket emitido".
*Se desvía de "B1 va solo": C1 y el térmico son el mismo defecto en otras dos capas y el bloque
sigue siendo pequeño. Arreglarlo tres veces por separado es peor.* **Se despliega solo y ya.**

### A3-F7 · Keystore de release (B6 + E11) — en paralelo
Sin código de producto. Firma de release + la versión de la APK visible en el menú.

### v1.16 · El producto correcto y la comanda que llega (B4 + B3 + E4 + E5)
Distinguir las variantes en tarjeta y en línea de ticket; el fallo de impresora en idioma de
camarero, con el ticket marcado "pendiente de enviar" y reintento; jerarquía de sala corregida.

### v1.17 · Cierre honesto (B2 + C9 + C11 + C10)
Aviso y lista de mesas abiertas antes de cerrar y en el Z; "Cerrar turno" fuera de la zona de tecleo;
"Cancelar" dentro del modal siempre; denominaciones en orden de recuento; descuadre en rojo.

### v1.18 · El cobro no miente (C2 + C3 + C5 + C4)
El primer dígito sustituye al pre-relleno; exceso no reembolsable en ámbar y sin "Cambio";
el modal copia el layout del arqueo (nada bajo el pie); CashPad en "últ. 4".

### v1.19 · Vincular sin segundo dispositivo (B5)
Hereda el pad numérico propio de C4. Requiere decidir de dónde sale el código sin sesión de admin.

### v1.20 · Catálogo, panel y densidad (C6 + C7 + C12 + C8 + E1 + E2 + E3)

### v1.21 · Repaso estético (resto de E)
