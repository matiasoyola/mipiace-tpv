# La pasada en hierro de la agenda · lo que el banco NO puede probar

Lista corta para la visita a Sole, con el AP11/AP12 en la mano. El banco de
pruebas (`pnpm e2e:agenda`) recorre la agenda entera por la interfaz real
contra la stack real, pero corre en **Chromium sobre un Mac**: no hay
impresora, ni teclado de hierro, ni lector, ni dedo, ni la red del local.
Todo lo de esta lista es exactamente lo que queda fuera.

Cada punto: **qué se hace** y **qué se espera ver**. Lo que no coincida, se
apunta con la hora y se mete en el done del bloque siguiente.

## 1 · El ticket de una cita, en papel

**Qué se hace.** Cobrar una cita de la agenda (capítulo 8 del banco: la cita
→ «Cobrar en caja» → efectivo) con la impresora encendida y conectada.

**Qué se espera ver.** Un ticket que sale entero y legible, con el servicio de
la cita en la línea (no «Servicio» ni un hueco), el importe, el IVA y el pie
del centro. El corte del papel limpio. Si el centro imprime en A5 o en 80 mm,
el que esté configurado.

**Por qué no lo puede probar el banco.** No hay impresora: el TPV encola la
impresión y el banco sólo vería la cola, no el papel.

## 2 · El teclado propio en los importes

**Qué se hace.** En el cobro de una cita, teclear el efectivo que entrega la
clienta (50 € para una cita de 30) con el **pad de la app**. Y lo mismo en el
fondo de caja al abrir turno y en el recuento por denominaciones al cerrar.

**Qué se espera ver.** El pad de la app, no el teclado de Android. El importe
se escribe sin que ningún teclado del sistema tape el botón de cobrar — es el
hallazgo H2 de v1.12 y hay que verlo en el hierro. La coma decimal donde se
espera y la vuelta correcta (50 − 30 = 20,00 €).

**Por qué no lo puede probar el banco.** En Chromium no existe el teclado de
Android; el banco teclea con los atajos de la pantalla.

## 3 · El dedo, no el ratón

**Qué se hace.** Reservar una cita tocando con el dedo: pulsar la franja de la
columna de una profesional, elegir clienta, elegir servicio, reservar. Y
cancelar una cita desde su tarjeta.

**Qué se espera ver.** Que la franja que se toca es la franja que se abre. El
banco descubrió que medio píxel importa: pulsar el borde de las 10:15 abría un
alta a las 10:00, porque la rejilla redondea hacia abajo. Con el dedo, que es
mucho más gordo que un cursor, **hay que comprobar expresamente que la hora
que abre el panel es la que se quería**. Y que las tarjetas de cita se pueden
tocar sin dar a la franja de debajo.

**Por qué no lo puede probar el banco.** Un clic de Playwright es un punto
exacto; un dedo son 40 px.

## 4 · El WebView real y su rendimiento

**Qué se hace.** Abrir la agenda del día con las tres columnas llenas, pasar
cinco días adelante y atrás con las flechas, y abrir y cerrar el panel de
salud.

**Qué se espera ver.** Que la rejilla no parpadea ni se queda en blanco al
cambiar de día, y que el panel de alta entra sin tirón. El AP11 tiene un
WebView más lento que Chromium de escritorio.

**Por qué no lo puede probar el banco.** Mide corrección, no fluidez, y en
otra máquina.

## 5 · El lector de códigos

**Qué se hace.** Con el borrador de una cita abierto en caja, pasar un
producto por el lector (un champú, si lo venden).

**Qué se espera ver.** Que la línea se añade al ticket **de la cita** sin
perder el enlace con ella: al cerrar, la cita queda finalizada igual.

**Por qué no lo puede probar el banco.** No hay lector.

## 6 · La red del local

**Qué se hace.** Reproducir el capítulo 10 de verdad: dar de alta una clienta
con el WiFi del centro apagado, y volver a encenderlo.

**Qué se espera ver.** La ficha guardada con su marca «sin conexión» y, al
volver la red, la ficha en el sistema sin que nadie toque nada. **Ojo a los
dos hallazgos del banco**: la marca «sin conexión» no se va aunque la ficha ya
haya salido, y la hoja del alta se queda abierta por encima de la lista. Hay
que ver si en el hierro pasa lo mismo y si molesta.

**Por qué no lo puede probar el banco.** `setOffline` de Chromium corta la red
del navegador de golpe; el WiFi de un local se degrada, que es peor.

## 7 · La impresión de la agenda del día (si se pide)

**Qué se hace.** Preguntar a Sole si quiere la agenda del día en papel por la
mañana.

**Qué se espera ver.** Hoy **no existe**: no hay forma de imprimir la agenda.
Si lo piden, es un bloque nuevo. Se apunta en la visita, no se improvisa.

---

## Y lo que el banco sí probó, para no repetirlo a mano

No hace falta volver a comprobar en la visita (está en verde y se puede
relanzar en cualquier momento con `pnpm e2e:agenda`):

- encender la agenda y que el botón aparezca en el TPV;
- las duraciones de los servicios y que un servicio sin duración no se ofrece;
- las tres profesionales con tres colores distintos, lo que sabe cada una y
  sus turnos;
- el horario del centro, el festivo con su nombre y el día especial;
- el aviso del servicio que nadie sabe hacer, y su arreglo;
- reservar clienta nueva y clienta existente, y el corte dentro de la pausa
  del tinte;
- los cuatro «no»: solape, festivo, quien no sabe el servicio y la hora
  pasada;
- cancelar, no-show y que el hueco vuelva;
- cobrar la cita en efectivo con vuelta y mixto, y que la cita quede
  finalizada;
- el cierre del día cuadrando con lo cobrado por citas.
