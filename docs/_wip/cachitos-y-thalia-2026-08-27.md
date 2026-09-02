# Cachitos y Thalía · preparación de las dos conversaciones

Datos sacados de producción el 2026-08-27 (imagen `4be2f67`). No son estimaciones: son las filas
de la base de datos.

---

# 1 · Frutos Secos Cachitos

## Lo que dice la base de datos

| Dato | Valor |
|---|---|
| Estado | ACTIVE desde 2026-06-02 |
| Catálogo sincronizado | **176 productos** |
| Ventas reales | **3**, las tres el **2026-06-24** |
| Importes de esas 3 ventas | 2,10 € · 2,10 € · 0,50 € |
| Usuarios del TPV | **uno solo**: Virginia (OWNER, con PIN) |
| Último login | **2026-06-26** |
| Turno abierto | desde el 2026-06-26, fondo 82 €, **0 tickets** |

## La lectura, que cambia la conversación entera

Esas tres ventas de 2,10 €, 2,10 € y 0,50 € **no son ventas: son la formación del día de la
implantación**. Y después pasó esto: el 26 de junio Virginia volvió a entrar, **abrió la caja con
82 € de fondo, no vendió nada, y no ha vuelto a entrar desde entonces**. Ese turno sigue abierto
62 días después.

Así que la frase "lleva 8 semanas parado con 3 ventas" es generosa. La verdad es más incómoda y
más útil: **el TPV nunca llegó a entrar en servicio.** No es un cliente que se cansó a mitad de
camino, es uno que abrió la caja una mañana, se encontró con algo, y volvió al método de antes.

Lo segundo que cuenta: **es ella sola.** No hay ningún cajero más dado de alta. Si Virginia está
sola en el mostrador con gente esperando, cualquier fricción del TPV se paga en cola, y la caja
de siempre nunca falla.

## Lo que sí puedes llevarle, y ella no sabe

Las tres cosas que pidió en junio **están construidas y en producción**:

1. **Fiado** — venta a crédito, apuntar la deuda y cobrarla otro día (v1.8). Era su petición.
2. **Precio sobre el total** — al editar una línea se teclea el precio final con IVA, no la base
   (v1.6). Justo como piensa un tendero.
3. **Alias de cajeros** — nombres en vez de emails en pantalla y en el ticket (v1.7).

Pidió tres cosas, se hicieron las tres, y lleva dos meses sin saberlo. Eso es lo que abre la
llamada; no el reproche.

## La pregunta que hay que hacerle (y sólo esa)

> "Virginia, el 26 de junio abriste la caja y no llegaste a vender con el TPV. ¿Qué pasó esa
> mañana?"

No adelantes hipótesis. Lo que responda decide todo: si fue la impresora, si fue el precio con
IVA, si fue que iba con prisa, o si fue que sola no le da la vida para aprender una herramienta
nueva en hora punta. Cada una de esas cuatro tiene un arreglo distinto y tres de ellas ya están
hechas.

## La decisión que te toca a ti, antes de llamar

**Cachitos no se recupera por teléfono.** Un negocio que volvió a su método de siempre hace dos
meses no cambia con una llamada de quince minutos, por bien que vaya. O vas una mañana a su
tienda y vendes con ella durante dos horas, o lo aparcas de forma honesta y liberas la cabeza.

Mi recomendación: **una mañana presencial, con fecha cerrada en la propia llamada**. Con 176
productos ya sincronizados, el trabajo caro está hecho; lo que falta es acompañamiento. Y si al
proponerlo hay evasivas, ya tienes tu respuesta y es información buena, no un fracaso.

## Borrador de mensaje (para abrir, si prefieres no llamar en frío)

> Virginia, buenos días. Te escribo por dos cosas.
>
> La primera: las tres cosas que me pediste cuando montamos el TPV ya están hechas y funcionando
> — el fiado para cuando alguien se lleva el género y paga otro día, poder teclear el precio final
> con el IVA ya incluido, y que salga tu nombre en vez del correo. Me quedé con ganas de
> enseñártelas.
>
> La segunda, y te lo pregunto sin rodeos: sé que después de montarlo no llegaste a usarlo. Me
> interesa mucho más saber qué te frenó que insistir. Si me dices una mañana de esta semana o la
> que viene, me acerco y vendemos juntos un par de horas, y así lo vemos con clientes de verdad
> delante y no en una demo.

## Y un detalle técnico que no afecta a la conversación

Su turno del 26 de junio se cerrará solo la primera madrugada después del Despliegue 2, con el
informe Z generado por el servidor. Como no está usando el TPV, no lo notará. No hace falta
mencionarlo.

---

# 2 · Librería Thalía

## Lo que dice la base de datos

| Dato | Valor |
|---|---|
| Estado | **DRAFT** desde 2026-05-19 — **100 días** |
| Catálogo sincronizado | **974 productos** |
| Ventas reales | 0 |
| Tickets de prueba | 20 |
| Usuarios | **ninguno real**: sólo el cajero técnico `mipiacetpv-test-4bbb539c` |

## La lectura

Thalía no está parada por falta de trabajo nuestro: **974 productos cargados, EAN y pistola
validados, PDF fiscal, cierre de turno e informe Z probados** en la validación remota del 3 de
julio. Está todo hecho menos apretar el botón.

Lo que falta es una sola cosa, y no es técnica: **su suscripción de Holded está suspendida.** Y
aquí no hay margen de interpretación — mipiacetpv **no es el sistema fiscal**, Holded lo es. Sin
Holded activo no hay facturación legal, y activarla sería ponerle un TPV que no puede emitir. No
es una excusa nuestra: es la razón por la que no se ha activado.

Que lleve **un año esperando** es el otro dato de la conversación, y el que fija el tono.

## La decisión que te toca a ti, y es la de verdad

Sandra te pasa cada mes las cuentas de Holded que paga Mi Piace por sus clientes — Cafetería
Sirope, Fouzia y varias más, a unos 35 € cada una. Es decir: **ya estás pagando el Holded de
clientes que hoy venden menos que lo que va a vender Thalía.**

Si el cliente más antiguo en cola, con 974 productos ya cargados y todo validado, lleva 100 días
bloqueado por una cuota de ~35 €/mes, la pregunta no es si Thalía debería pagarla. La pregunta es
**por qué llevas tres meses esperando a que se desbloquee sola** algo que cuesta 70 € desbloquear
por tu cuenta.

Tres caminos:

1. **Lo cubre Mi Piace durante el piloto** (recomendado). Dos o tres meses, ~70-105 €. La llamada
   pasa de "te falta pagar Holded" a "está resuelto, empezamos el lunes". Y el piloto de 6 meses
   gratis empieza a contar cuando de verdad empieza.
2. **Lo reactiva ella.** Es lo correcto en el papel, y es lo que lleva 100 días sin pasar.
3. **Revisar su plan de Holded** por si hay uno más barato que le sirva. Alarga la conversación y
   no desbloquea nada esta semana.

**Decide esto antes de llamarla.** Es la diferencia entre una llamada que termina con fecha y una
que termina con otra espera.

## Borrador de mensaje (asumiendo la opción 1)

> Thalía, buenos días. Te llamo con una fecha, no con otra actualización.
>
> Tu tienda está lista por nuestra parte: los 974 artículos cargados, la pistola de códigos
> probada, los tickets y el cierre de caja validados. Lo único que faltaba era que tu cuenta de
> Holded volviera a estar activa, porque es la que emite la factura legal — el TPV se apoya en
> ella.
>
> Eso lo asumimos nosotros durante el piloto, así que ya no es un obstáculo. Lo que necesito de ti
> es una mañana: la activamos, hago el traspaso a tu nombre y te dejo vendiendo. ¿Te viene bien
> esta semana o prefieres la que viene?

## Si eliges la opción 2, cambia el último párrafo

> Para poder activarla necesito que tu cuenta de Holded vuelva a estar al día — es la que emite la
> factura legal y el TPV se apoya en ella. En cuanto esté, en la misma mañana la dejamos
> funcionando. Si quieres, lo miro contigo por teléfono y lo resolvemos en diez minutos.

No dejes ese mensaje sin la segunda frase. Después de un año esperando, "te falta pagar" a secas
suena a que la culpa se ha movido de sitio.

---

# Lo que las dos conversaciones tienen en común

Ninguna de las dos se desbloquea con producto. Cachitos necesita **una mañana contigo en el
mostrador**; Thalía necesita **una decisión de 70 €**. Las dos llevan meses paradas por algo que
no es código.

Y las dos tienen fecha límite natural: cuando A3 esté listo podrás entregar terminales con la APK
instalada y sin depender del Chrome de fábrica, que es lo que hoy hace cara cada implantación. Si
vas a volver a pisar esas dos tiendas, mejor hacerlo con eso ya en la mano.
