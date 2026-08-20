# Conclusiones del día · 2026-08-20

Un despliegue validado, una hora punta simulada sobre producción y una consola de superadmin recorrida entera.
Esto es lo que sale de todo ello.

---

## La conclusión que lo ordena todo

**El motor calcula bien. Lo que falla es lo que el producto le cuenta al usuario.**

Repasa los fallos de hoy y no hay ni uno de cálculo:

| Lo que el sistema calcula | Lo que el sistema dice |
|---|---|
| No hay impresora configurada | *"Enviado a impresora"* |
| El turno lleva 41 días abierto | *"El último turno no se cerró **ayer**"* |
| La papelera se desarmó a los 1,5 s | — nada — |
| Efectivo 10 + Tarjeta 4 = 14 | *"Falta 4,00 €"* |
| El informe Z, con su desglose y su descuadre | — no se enseña al cerrar por la mañana — |
| La mesa lleva 42 días abierta | *"1013 h 28 m"* |
| El tenant tiene 2 usuarios | *"Usuarios (1)"* |
| El ticket tiene 6 líneas | enseña 2, sin avisar |

El IVA cuadra al céntimo en dos tipos distintos. El arqueo cuadra a cero. Agrupar tres mesas suma exacto. Mover una
mesa entera a la terraza es instantáneo. **Todo lo que es aritmética está bien.** Todo lo que es una frase, miente
o calla en algún caso.

Eso es una buena noticia: la deuda no está en la arquitectura, está en la capa más barata de arreglar.

---

## Tres conclusiones que se derivan

### 1. La fricción vive en los bordes del día, no en el centro

Vender va como la seda. **Empezar** el día (turno colgado, arqueo obligatorio antes de la primera clienta) y
**terminarlo** (cobro mixto, cierre que no se enseña) es donde se atasca todo.

Y los bordes son justo lo que un dueño de bar recuerda. Nadie cuenta que "el TPV suma bien"; cuenta que "cada
mañana me hace contar el dinero antes de cobrar el primer café".

### 2. Los patrones buenos ya están escritos en casa

No hay que inventar casi nada, hay que **propagar**:

- La **comanda** falla honestamente: *"Falta configurar impresora WIFI para la sección SALON"*. El ticket, en el
  mismo escenario, dice "enviado". El patrón correcto ya existe a dos ficheros de distancia.
- El **informe Z** ya calcula método, bruto, devoluciones, neto, esperado, contado y descuadre. El rediseño del
  cierre no es construirlo: es **enseñarlo antes** en vez de después de contar 15 denominaciones.
- El modal de **impersonación** avisa con cuenta atrás y explica que todo queda auditado. Es el estándar de
  honestidad que le falta a la impresión.
- El **mapa de sala** cuadra sus totales en vivo y sin recargar.

Esto abarata mucho las tres mejoras: son propagación, no diseño desde cero.

### 3. El producto no se estaba usando, y por eso no se veía

41 días de turno colgado en Sirope. Mesas abiertas desde el 9 de julio. El CI en rojo un mes sin que nadie mirara.
Sole arqueando de pie cada mañana durante dos meses sin que apareciera en ninguna parte.

Ninguno de estos fallos necesitaba un test unitario: necesitaba **que alguien usara el producto**. Hoy, en veinte
minutos de hora punta simulada, han salido siete.

**Propuesta concreta:** el guion de hora punta pasa a ser parte del protocolo anti-sustos, al lado del CI verde.
Veinte minutos antes de cada despliegue, sobre Sirope, con cajero real. Ya está escrito en
`docs/qa/2026-08-20-simulacion-hora-punta-sirope.md`.

---

## Qué hacer, por orden

### Ahora — porque cuestan dinero o mienten

1. **v1.10.2 · La impresión deja de mentir.** Un TPV que dice haber impreso sin imprimir es peor que uno que no
   imprime: el cliente se va sin ticket y nadie se entera hasta la reclamación. El patrón correcto ya está en la
   comanda.
2. **v1.10.3 · La barra en hora punta.** Empezando por el cobro mixto: hoy una cuenta mitad efectivo mitad tarjeta
   **no se puede cobrar**. Con la papelera de 1,5 segundos y el sheet que no llega a las líneas.

Las dos son de front, tocan zonas distintas y **se pueden lanzar en paralelo**, como reservas-5 y v1.11.

### Después — porque es adopción, no urgencia

3. **v1.11 · Cierre de día automático.** Resumen con confirmación en vez de arqueo obligatorio. Es la palanca de
   adopción más clara que hemos visto: quita el peaje matinal de Sole.
4. **Reservas-5 · cita→caja.** Sigue siendo el bloqueante para encender la agenda.

### Higiene — barato y visible

5. **Barrido de zombis.** Job que cierre mesas y turnos abandonados por corte de día. Hoy se acumulan solos y
   ensucian el mapa de todos los clientes.
6. **Copys y formatos.** "Ayer" que son 41 días, "1013 h" que son 42 días, importes con punto en los modales.
   Media tarde y sube la percepción de calidad más que cualquier feature.
7. **El superadmin lista los cajeros.** Hoy no ver quién puede operar el TPV de un cliente es un agujero de
   soporte — me hizo concluir que Sirope no tenía cajeros, y era falso.

---

## Lo que sigue sin cerrar

**El papel.** Nada de lo de hoy demuestra que salga un ticket por una impresora física. Sólo lo cierra el AP12 — o,
mejor, espejarlo en el Mac con `scrcpy` y repetir esta misma hora punta con la impresora enchufada.
