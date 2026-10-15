# clinica-7 · el blindaje, visto en el producto real

Las pantallas que trae el bloque, recorridas en el producto de verdad a
**1366, 1024 y 390**, entrando con el PIN en el TPV de la clínica del banco
y con el login del panel. El bucle vive en
`apps/e2e-ui/capturas-clinica7.ts`.

**Los tres estados del contrato se mueven EN LA BASE**, no en el front: se
borra, se acepta y se revoca directamente sobre
`clinical_processor_agreements` (con el trigger de solo-inserción apagado un
instante, que es lo único que no se puede hacer en producción). Lo que la
cámara ve es lo que el producto hace con esos datos, no una pantalla
simulada.

Y entre cada cambio de estado hay una espera de **32 segundos**: la API
cachea el estado del contrato 30 s (`clinica/contrato.ts`), así que sin
esperar se fotografía la respuesta vieja.

## Quién entra, y por dónde

| Quién | Qué es | Por dónde llega a la historia |
| ----- | ------ | ----------------------------- |
| Lucía Martín | **dueña** y sanitaria | su cita de hoy → «Historia del paciente» |
| Ana Sanitaria | sanitaria, `CLINICIAN`, **sin caja** | entra y cae directa en su agenda; su cita → «Historia del paciente» |

Ana es la que prueba el aviso, y **no la recepcionista**: Marta no tiene la
marca de sanitaria y la pestaña «Historia» no existe para ella. El aviso de
«esto lo acepta la dueña» es para quien SÍ entra en la historia.

La historia se abre **desde la agenda** porque ahí es un overlay a pantalla
completa, que es como se usa. La captura `6-` enseña el otro camino —desde
la ficha del cliente— y es un hallazgo, no una pantalla más.

## Las capturas

| # | Qué enseña |
| - | ---------- |
| `1-aceptacion` | lo que ve **la dueña** sin contrato: el texto entero de la v1, el aviso de que está pendiente de abogado, la casilla y «Aceptar y activar la historia clínica» |
| `2-aviso-no-duena` | lo que ve **la sanitaria que no es la dueña**: el aviso, sin el texto del contrato y sin botón |
| `3-banda-solo-lectura` | el contrato **revocado**: la banda ámbar sobre la historia, que dice que se puede leer, imprimir y exportar y que no se puede escribir — y **ya no hay «Nueva visita»** |
| `4-seccion-panel` | la sección del panel: estado, versión, quién la aceptó y cuándo, la huella, el PDF, «Revocar el contrato» y «Descargar todas las historias» |
| `5-informe-con-clave` | el informe enviado por email: el acuse que dice que **no lleva adjunto**, y la clave de 6 cifras en la tarjeta negra, con su caducidad y sus 3 aperturas |
| `6-historia-en-la-ficha` | la MISMA pantalla abierta desde la ficha del cliente, dentro de la tarjeta de 448 px (ver hallazgos) |

## Las medidas

`medidas-de-clinica-7.json`, tomadas **sobre la página** y acotadas a lo que
de verdad se puede tocar: detrás de estos overlays siguen montadas la agenda
y la venta con sus botones de 32 px, y `document.elementFromPoint` los
descarta.

| Pantalla | 1366 | 1024 | 390 | Scroll horizontal |
| -------- | ---- | ---- | --- | ----------------- |
| aceptación | 44 px | 44 px | 44 px | no |
| aviso al que no es la dueña | 44 px | 44 px | 44 px | no |
| banda de solo lectura | 44 px | 44 px | 44 px | no |
| sección del panel | **36 px** | **36 px** | **28 px** | no |
| informe con la clave | 44 px | 44 px | 44 px | no |
| historia en la ficha | **36 px** | **36 px** | **36 px** | no |

(El número es el lado menor del objetivo táctil más pequeño de cada
pantalla.)

Las cuatro pantallas del TPV se quedan en **44 px**, y ese 44 no es de este
bloque: es la flecha de volver de la cabecera del overlay (`h-11 w-11`, de
clinica-6). Todo lo que añade clinica-7 —la casilla, el botón de aceptar, el
campo de la clave, el botón de abrir el documento— está en **48 o 56 px**,
que es el mínimo de la casa.

Los 36 y los 28 son del **panel**, que es de ratón y portátil y donde la
casa lleva 36 px desde B1 (`Cerrar sesión` mide lo mismo): los tres botones
nuevos de la sección siguen a sus vecinos en vez de inventarse un tamaño.
Queda apuntado, no arreglado — cambiarlo es cambiar el panel entero.

## Lo que encontró el bucle y no la suite

Dos, las dos arregladas y con su test (visto rojo al quitar el arreglo):

1. **La pantalla de aceptación no se podía alcanzar.** Sin contrato, la API
   contesta 423 a la historia; `HistoriaViva` salía por su rama de error y
   devolvía el mensaje crudo del 423 **antes** de llegar a la guarda. La
   dueña veía un recuadro rojo diciendo que la dueña tiene que aceptar el
   contrato, sin ninguna forma de aceptarlo. La guarda envuelve ahora el
   componente desde fuera, en `HistoriaViva` y en `SesionPodologia`.
   No lo vio ninguna suite porque los tests de pantalla mockean la API y le
   dan a la guarda un estado legible: nunca pasaban por la rama de error.
   → `clinica-7-pantallas.test.tsx`, «la guarda envuelve también la rama de
   error».
2. **En solo lectura seguía ofreciéndose escribir.** La banda decía «no se
   puede escribir nada nuevo» y justo debajo seguía «Nueva visita», en negro
   y encendido, con la tarjeta de «Hoy toca» como botón. Media hora de
   sesión para un 423 al cerrarla. La guarda publica el estado por contexto
   y `useSePuedeEscribirHistoria()` lo contesta; las dos puertas desaparecen
   y «Hoy toca» vuelve a decir dónde se empieza.
   → `clinica-7-pantallas.test.tsx`, «las puertas de escritura en solo
   lectura».

Y uno que se deja **apuntado y sin arreglar**, porque el arreglo es de
clinica-6 y no de este bloque:

3. **La historia abierta desde la ficha del cliente se pinta dentro de la
   tarjeta de 448 px** (`sm:max-w-md`, `ClientsPage.tsx`), no a pantalla
   completa. El contrato entero en una columna de 448 px se lee, pero el
   informe —que está pensado a dos columnas desde 1024— se queda con el
   papel cortado por la derecha. Desde la agenda, que es por donde se
   trabaja, la historia es un overlay a pantalla completa y no pasa. Ver
   `6-historia-en-la-ficha-1366.png`.

## Dos detalles del banco, para quien lo repita

- **La agenda no da cita a una hora que ya ha pasado**: «Esa hora ya ha
  pasado. El primer hueco es a las 17:15». El bucle corre a la hora que sea,
  así que las dos citas del banco se dan por la tarde (18:30 y 19:00). Con
  la hora de la mañana el panel de alta no se abre y el fallo se lee como
  «no encuentro la franja».
- **El buscador de la pantalla Clientes hay que pedirlo por su
  `placeholder`**: el primer `input[type=search]` del documento es el de
  productos de la venta, que sigue montada detrás del overlay. Buscar
  «Carmen» ahí devuelve «Sin resultados para «Carmen»» — del catálogo.

## Un detalle de la semilla, que no es del producto

La huella que enseña la sección del panel es la **canónica de la v1**
(`7baee64a…`), metida a mano junto con la aceptación: el banco inserta la
fila directamente, sin pasar por `POST /clinica/contrato/aceptar`, para
poder volver atrás. En producción la escribe la ruta, calculada sobre el
texto que se aceptó.

Y el avatar del panel pone **«MO»** para todo el mundo: es el valor por
defecto de `AdminShell.tsx:463`, de B1. No es de este bloque.
