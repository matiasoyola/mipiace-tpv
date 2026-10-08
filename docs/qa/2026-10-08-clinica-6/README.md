# clinica-6 · el mockup recorrido en el producto real

`docs/mockups/clinica-historia-v2.html` recorrido entero en la pantalla de
verdad, a **1366, 1024 y 390**, entrando con el PIN de la podóloga y
abriendo la historia **desde la cita del día** (que es donde «Hoy toca» y
«Nueva visita» pueden abrir una sesión).

El paciente es Carmen, con una historia **mezclada v1 + v2**:

| Día | Qué | Qué deja en la historia |
| --- | --- | --- |
| 2 sep | Valoración, respondida por un familiar y validada | la franja roja (diabetes, anticoagulación, alergia al látex) y el «Ojo hoy» |
| 7 sep | **Sesión v1** (clinica-3), sin tipos | tres zonas marcadas y el dolor en 7 |
| 21 sep | Exploración + **v2** quiropodia completa + pie de riesgo | la capa de sensibilidad, y el talón derecho que deja de marcarse |
| 6 oct | **v2** cirugía de uña | dos pendientes abiertos → «Hoy toca» |

## Las capturas

| # | Qué enseña |
| - | ---------- |
| `01-al-abrir` | «Carmen en 10 segundos»: franja roja, Hoy toca, dolor, última vez y ojo hoy — sin tocar nada |
| `02-zona-curada` | el talón derecho tocado: su línea de evolución y el paso «Ya no estaba marcada» |
| `03-sensibilidad` | la capa de monofilamento, de lectura |
| `04-visitas` | la lista con el tipo en columna, el nivel con sus tres barras, los chips y el dolor — y la v1 como «Sesión» |
| `05-visita-v1-solo-lectura` | una visita abierta, **sin bloque de caja** |
| `06-documentos` | la valoración, con «Respondió un familiar». Ni consentimientos ni informe: son de clinica-4 |
| `07-que-visita-es-hoy` | la hoja de tipos, con «Cirugía» recomendada por el pendiente |

## Las medidas

`medidas-de-la-historia.json`, tomadas **sobre la página** y sólo dentro de
la historia (detrás del overlay sigue montada la agenda, con sus botones de
32 px):

| Ancho | Zonas del pie | La más pequeña | Botón más pequeño | Scroll horizontal |
| ----- | ------------- | -------------- | ----------------- | ----------------- |
| 1366 | 22 | **48,4 px** | 48 px | no |
| 1024 | 22 | **48,4 px** | 48 px | no |
| 390 | 22 | **48,4 px** | 48 px | no |

El prompt pide ≥ 44 px; el mínimo de la casa es 48.

## Lo que encontró el bucle y no la suite

1. **Abrir una visita tumbaba la pantalla entera** contra el ErrorBoundary
   (`Cannot read properties of undefined (reading 'toLowerCase')`): una
   `proximaCita` que este despliegue no reconoce dejaba
   `NOMBRE_DE_PROXIMA_CITA[prox]` en `undefined`. La pantalla que se caía es
   la de LEER la historia. Arreglado con `esProximaCita`, y con su test.
2. **Los botones de capa medían 40 px** (el `height: 40px` del mockup), por
   debajo del 44 del prompt y del 48 de la casa. A `min-h-touch`.
3. **El chip repetía el nivel** que ya estaba en el título de la fila
   («Quiropodia completa» dos veces, con las tres barras en medio).
4. **El pie se espejaba al revés desde clinica-3**: los tres mockups
   validados espejan el IZQUIERDO, para que los dedos gordos queden hacia
   dentro. Arreglado en el único sitio donde se dibuja el pie.
