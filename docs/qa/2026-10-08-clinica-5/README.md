# Bucle visual · clinica-5 · la sesión por tipo de visita

Capturas del **08-10-2026**, contra la stack de verdad (API + Postgres + la
PWA del TPV) y sobre la clínica del banco (`seed/clinica-demo.ts`), con
Carmen, su valoración validada, sus alertas (diabética y anticoagulada) y
una sesión anterior de cirugía que dejó apuntado «revisar la uña operada».
No son maquetas: es la pantalla, entrando con el PIN de la podóloga.

Los tres anchos que pide el prompt: **1366 px** (el iPad apaisado grande,
que es el que manda), **1024** y **390**.

El recorrido es el del mockup validado
(`docs/mockups/clinica-sesion-v2.html`), hecho de verdad: se marcan tipos,
se tocan actos, se cambia el nivel a mano, se completa el pie de riesgo, se
marca «Signos de infección» y se toca la zona del pie que cierra el
pendiente.

| Fichero | Qué se mira |
| ------- | ----------- |
| `sesion-al-abrir-*` | La pantalla al abrirse: los chips de tipo con **el de la cita ya marcado**, la banda de «Hoy toca» en coral con su zona y «apuntado hace 4 semanas», el mapa con lo de la visita anterior en naranja suave y la tarjeta de quiropodia con su nivel propuesto. |
| `nivel-y-aviso-cruzado-1366` | Corte + enucleación: el nivel sube a **completa** y sale el aviso de la anticoagulada **dentro de la tarjeta**, no arriba. |
| `nivel-cambiado-a-mano-1366` | Tocado «Extra»: «Cambiado a mano · lo propuesto era completa». Las dos cosas escritas, que es lo que hace auditable el cobro. |
| `dos-tipos-y-aviso-diabetica-*` | Dos tipos a la vez. La revisión de cirugía con su cabecera («Cura · Pie izq. · Dedo gordo · 8 oct»), «Signos de infección» marcado y el aviso de las 48 h de la diabética. |
| `pie-de-riesgo-sin-contestar-1366` | La tarjeta del pie de riesgo recién abierta: **dice qué falta** en vez de quedarse en blanco. |
| `pie-de-riesgo-alto-*` | Las cuatro contestadas: «Riesgo alto · Revisión cada 1–3 meses», el motivo que lo explica y la cita de la guía con su «pendiente de validar con Rosario». |
| `capa-de-sensibilidad-*` | La capa de sensibilidad del mapa, que sólo aparece con pie de riesgo marcado. Es de **lectura**: enseña la última exploración y lo dice. |
| `gravedad-desactivada-1366` | Tocada una zona y sin lesión elegida: los tres chips de gravedad apagados y «elige antes la lesión» al lado (clinica-3, sigue). |
| `hoy-toca-hecho-solo-*` | La banda en **verde**: «Hecho: revisar la uña operada · Se ha marcado solo al tocar esa zona del pie». No se tocó la banda: se tocó el dedo gordo. |
| `barra-de-caja-1366` | La hoja entera con la barra de caja abajo. |
| `pie-de-sesion-*` | La barra de caja de cerca: «Pasa a caja: Quiropodia extra · 27,00 € + Cura · 13,00 € = **40,00 €** · exento · sanitario» y, debajo, «Pie de riesgo: sin cobro, no has marcado nada». |
| `medidas-del-mapa.json` | **Los objetivos táctiles medidos sobre la página**, zona por zona y a los tres anchos. |

A 1024 y a 390 se guardan los cinco estados que cambian de forma con el
ancho; los seis restantes sólo a 1366. No es pereza: las capturas de
página completa a 1024 miden 5.800 px de alto y pesan 300 KB cada una, y
lo que esos seis estados enseñan (el nivel, el motivo de la propuesta) no
depende del ancho.

## Los objetivos táctiles del mapa, medidos

El prompt pide «zonas táctiles ≥ 44 px **medidas en captura**». Se miden
—con `boundingBox()` sobre la página, no con la constante del CSS— y
además contra el mínimo de la casa, que es **48**
(`docs/design/tokens.md` §4):

| Ancho | Zonas | La más pequeña |
| ----- | ----- | -------------- |
| 1366 | 22 | **50,0 px** |
| 1024 | 22 | **50,0 px** |
| 390 | 22 | **50,0 px** |

Las 22 (once por pie) pasan en los tres anchos, y la más justa es siempre
el **2.º dedo**, que es la de radio mínimo. El pie se pinta a su ancho
nominal en los tres: a 390 los dos pies bajan a una fila cada uno y el pie
no se encoge.

## Lo que el bucle encontró, y que ningún test veía

Tres cosas. Las tres son de píxeles o de palabras, y ninguna suite las
mira.

### 1 · La tecla «10» del dolor, sola y estirada a todo el ancho

A 1366, en la columna de la derecha, entraban **diez** teclas en la fila y
el «10» se quedaba abajo **ocupando los 790 px enteros**: una tecla de
ancho de pantalla al lado de diez de 74.

Es `flex-1` sin tope: el único elemento de la última fila se lo come todo.
Se arregla con un `max-w-[88px]`, que además hace que las once quepan en
una fila a 1366. A 390 no cambia nada (seis por fila de 55 px, por debajo
del tope).

Lo heredaba de clinica-3 —el control es el mismo— y allí no se vio porque
el panel de la sesión era más estrecho y las once nunca llegaban a caber
diez en una fila.

### 2 · «Sin cobro (no hay servicio asignado)» cuando sí lo había

La barra decía **«Pie de riesgo: sin cobro (no hay servicio asignado)»**
con la «Consulta de pie de riesgo · 20,00 €» ahí al lado, sin marcar.

Son dos cosas distintas y piden cosas distintas:

- **no hay servicio en su categoría** → hay que ir al catálogo;
- **no has marcado nada** → la visita se anota y no se cobra, y no hay
  nada que arreglar.

`resumenPorTipos` devuelve ahora el motivo (`SIN_SERVICIO` /
`NADA_MARCADO`) y `textoSinCobro` los redacta por separado. Con el texto
único, la dueña habría ido a tocar un catálogo que estaba bien.

### 3 · «Uña encarnada» significa dos cosas en la misma pantalla

Es a la vez una **lesión** del mapa (lo que la paciente tiene) y un
**acto** de la quiropodia (lo que se le hace, «uña encarnada · leve»). Los
dos botones están a la vez en pantalla y con el mismo texto.

No se ha tocado: los dos nombres vienen de listas validadas —las lesiones
de clinica-3 y los actos del mockup de clinica-5— y renombrarlos sin
preguntar sería inventarse el vocabulario de una podóloga. **Va a la lista
de lo que se pregunta a Rosario**, que es quien sabe si eso la confunde o
le parece lo normal.

Lo que sí deja: el sub-rótulo del acto («leve») y la caja gris del panel de
zona separan los dos sitios lo suficiente como para que no sea un fallo de
seguridad. Es una pregunta de vocabulario, no un bug.

## Cómo se repite

```bash
# 1 · stack propia (base, Redis y puertos de este worktree)
BANCO_API_PORT=3151 BANCO_ADMIN_PORT=5283 BANCO_TPV_PORT=5284 \
  pnpm --filter @mipiacetpv/e2e-ui run stack

# 2 · API y TPV
PORT=3151 pnpm --filter @mipiacetpv/api dev
MIPIACETPV_DEV_PORT=5284 MIPIACETPV_API_PROXY=http://127.0.0.1:3151 \
  pnpm --filter @mipiacetpv/tpv-web dev
```

El guion de la escena (valoración validada, alertas, sesión anterior con
pendiente y cita de hoy) y el del recorrido viven en el scratchpad de la
sesión, no en el repo: son de usar y tirar y dependen de los ids del seed.
Lo que sí está en el repo es el seed, que ya trae los tres niveles de
quiropodia, la cura y la consulta de pie de riesgo con sus categorías.
