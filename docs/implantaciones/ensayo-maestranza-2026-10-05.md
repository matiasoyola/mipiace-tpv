# Ensayo completo de La Maestranza · lunes 05-10-2026 · AP11

Objetivo: llegar a la visita al bar sabiendo que todo funciona, sin descubrir nada delante de
Salomé. Al terminar el día hay que tener un **go / no-go** por escrito para instalarle el AP13.

Producción = `e7f34e4` (catalogo-en-alta). Plan de implantación: `checklist-maestranza.md`.

## Por qué hay dos carriles y no uno

En el código hay dos límites que deciden cómo se ensaya:

1. **Un terminal sólo se vincula con la cuenta activada.** Los códigos de vinculación los genera el
   OWNER o un MANAGER (`/admin/registers/:id/pairing-codes`), y en DRAFT no hay OWNER. El «Probar
   TPV» del super-admin abre el TPV **en el navegador**, no en la APK.
2. **Una cuenta activada sin Holded emite facturas de verdad.** Cada venta tiene su registro
   VERI\*FACTU en la serie `C1`. Ensayar en producción con una cuenta activada sería emitir
   facturas de ventas que no existen. **No se hace.**

Por eso:

- **Carril A · producción:** la cuenta real de La Maestranza, en DRAFT, sin facturas. Cubre el
  alta, el catálogo, los precios y los datos fiscales.
- **Carril B · banco local:** el ciclo completo en el AP11, con la API del Mac en la red de la
  oficina. Cubre lo que sólo se ve en el hierro: mesas, impresora con el QR, sin red y el arqueo.
  Se pueden emitir todas las facturas que haga falta, porque viven en la base local.

---

## Carril A · producción (≈ 45 min, por la mañana)

1. [ ] `curl -s https://api.mipiacetpv.com/health` → `e7f34e4`. Anotarlo como sha de rollback.
2. [ ] Super-admin → Nueva empresa → **«No lo usa»** (sin Holded), módulo **Caja**,
       **Hostelería**.
       - Razón social: `Eguez García Pabla Salome`
       - NIE: `Y8303186Q`
       - Dirección: Calle Paseo de los Rosales, nº 6, 45542 El Casar de Escalona (Toledo)
       - Teléfono: 641 602 868
       - Nombre comercial: **Bar La Maestranza**, si el formulario lo admite. Si no, apuntarlo: es
         lo que tiene que leer el cliente en el ticket.
3. [ ] Pie de ticket e icono del catálogo desde la ficha (logo de `maestranza/`).
4. [ ] **Cargar catálogo** → `maestranza/catalogo-tpv.csv`.
       - Vista previa: **128 entran, 0 rechazadas**. Si sale alguna rechazada, se para y se mira.
       - Confirmar.
5. [ ] Salud: `products-sellable` y `fiscal-minimum` en verde. **«Activar cuenta» NO se pulsa.**
       La activación es con Salomé delante.
6. [ ] «Probar TPV» (en el navegador del Mac):
       - [ ] Chips de categoría: cafés, desayunos, raciones, bocadillos, platos, refrescos,
             cervezas, vinos y licores.
       - [ ] **Precios de carta**: café con leche 1,60 · carajillo 3,00 · torrezno especial 15,00 ·
             bocadillo especial 7,00 · Johnnie Walker Etiqueta Negra 9,00. Contrastar con
             `Cartas_La_Maestranza_ICONOS.pdf`. Un solo céntimo distinto es un no-go.
       - [ ] Venta de 3 líneas → cobro en efectivo con cambio → ticket PDF. Cabecera con los datos
             del §2, total correcto e IVA al 10 %.
       - [ ] La venta nace **TEST** y **sin registro fiscal** (sin serie ni QR).
7. [ ] Dejar la cuenta en DRAFT. Al activarla en el bar, la purga se lleva estas ventas de ensayo.

## Carril B · banco local en el AP11 (≈ 3 h, lo monta una sesión de Code)

**Montaje** (Code, en un worktree propio desde `master`). Receta de la APK en
`project_apk_build_local`:

- [ ] Stack local (API, worker, admin, Postgres y Redis) escuchando en la IP del Mac en la LAN.
      En la base, una cuenta «Bar La Maestranza (banco)» sin Holded, con el CSV cargado y
      **activada**. Esta sí se activa: es local.
- [ ] APK debug de laboratorio, con un origen propio (`http://maestranza-lab.local` o similar).
      Así no pisa la vinculación de producción del AP11 (lección del 04-09). Se marca como
      **TEMPORAL** y no sale del banco.
- [ ] Antes de instalar: anotar `versionName`, `lastUpdateTime` y el asset que sirve hoy el AP11,
      para dejarlo igual al terminar.

**Pruebas en el AP11, con la mano** (`checklist-terminal.md` §4 y guion de Sirope §5):

- [ ] Vincular el AP11 con un código del panel del propietario (banco).
- [ ] Sala: barra (B1-B3), salón y terraza. Cajeros con PIN: dos camareros.
- [ ] **El cobro nace en la mesa**: abrir mesa → comandar → volver al mapa → retomar → cobrar.
- [ ] Venta rápida en barra (el café al vuelo).
- [ ] Efectivo con cambio, tarjeta y pago mixto.
- [ ] **Ticket impreso** en la térmica: serie `C1/n` correlativa, **QR tributario legible con el
      móvil** y leyenda VERI\*FACTU. Es la primera vez que se imprime un ticket sin Holded en el
      hierro, así que es la prueba más importante del día.
- [ ] **Sin red** 2 min (modo avión): 2 ventas → al reconectar suben, la numeración no salta ni se
      repite y el QR sale también en el ticket de una venta hecha sin red. Pendiente desde
      verifactu-1 §6 («falta la prueba en el AP11»).
- [ ] **Devolución / anulación** de una venta: ver qué hace hoy. Las rectificativas son V3 y están
      en cola (puesto 3). Si el bar no puede devolver ni anular una venta mal cobrada sin dejar mal
      la cadena fiscal, **es un no-go para el bar** o una instrucción de uso que hay que dar el
      primer día. Hay que saberlo hoy.
- [ ] Arqueo X a media prueba y Z al cierre, contando por denominaciones. Tiene que cuadrar.
- [ ] Botón Atrás del sistema con un turno abierto: no saca de la app.

**Al terminar (obligatorio):**

- [ ] Reinstalar en el AP11 la **APK de producción 1.19.0** desde `/apk`.
- [ ] Comprobar el origen: `adb logcat -d | grep "Loading app at"` → `https://mipiacetpv.com`.
- [ ] Comprobar que la vinculación de producción del AP11 sigue viva.
- [ ] Parar el stack local.

## Cierre del día · go / no-go para el AP13

Se escribe en `docs/qa/2026-10-05-ensayo-maestranza.md`:

- Cada prueba de los dos carriles, en verde o en rojo y con su evidencia (captura o foto del
  ticket).
- Cada rojo, con dueño: arreglo en Code, instrucción de uso o no-go.
- **Go** solo si: los precios cuadran, el ticket impreso lleva el QR, sin red no se pierde ni se
  repite un número, el arqueo cuadra y está decidido qué se hace con las devoluciones.

## El AP13 de Salomé

Es un modelo que no hemos tenido nunca en el banco. Antes de que salga del taller, pasa por
`checklist-terminal.md` completo:

- Modelo y pulgadas.
- Android.
- **Chrome y WebView** (el WebView ≥ 84 o no vale; ver lo que pasó con el AP12 de Sole).
- Densidad para que el lienzo quede en 1280×800.
- APK 1.19.0 por `/apk`.
- Impresora.

Hasta tenerlo en la mano no se puede dar por bueno nada de lo que se haya probado en el AP11.
