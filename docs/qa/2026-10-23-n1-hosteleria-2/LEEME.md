# Pasada en el hierro · n1-hosteleria-2 · 23-10-2026

**Incompleta**: la parte de Matías no está hecha, y la mía se cortó.

## Lo que hay

| captura | qué enseña |
|---|---|
| `00-ap11-kds.png` | El KDS del AP11, **«En línea»** a las 19:21, sección `Cocina · Barra`. Es la comprobación que pide el guion ANTES de enviar nada. Trae estado viejo de ensayo: cuatro comandas pendientes (una de **7179 min**) y dos en «LISTAS» (T6, M5). |
| `02-mapa-tres-plegadas.png` | El mapa con la 1.29.0 en el N1. BARRA desplegada con sus 8 mesas de 88 px, **SALÓN «2 listos»** y **TERRAZA «1 ocupada»** plegadas. Y la **etiqueta LISTO en tinta oscura**, el arreglo de 1,66:1 → 10,82:1, visto en el aparato. |
| `03-mapa-terraza-plegada-con-el-dedo.png` | Lo mismo tras **un toque real** (`input tap` en 180×440) sobre la cabecera de Terraza: `plegada` pasa de `false` a `true` y el resumen dice «1 ocupada». Con `elementFromPoint` comprobado antes del toque. |

## Lo que se retiró

Cinco capturas más, todas de la **pantalla de PIN**: recargar el renderer
devuelve el TPV al acceso, así que las medidas que iban detrás de un `reload`
no miraban el mapa. No se guardan para que nadie las lea como si fueran del
mapa. La lección está en el `-done` §9.

## Lo que falta

Todo lo de la comanda —que es el hallazgo 1, el que hay que juzgar—, el envío a
cocina, el cobro, y el hallazgo 9 en el aparato. Ver §9 del `-done`.
