# Bloque v1.10.2 · La impresión deja de mentir

> **Hallazgo en producción, 2026-08-20.** En Cafetería Sirope, Caja 1, con **cero impresoras configuradas**
> (admin → Impresoras dice literalmente "Sin impresoras configuradas"), se pulsó **"Reimprimir ticket"** sobre el
> ticket #000014 y el TPV respondió:
>
> > *"Enviado a impresora. La copia llevará marca COPIA."*
>
> No hay impresora. No salió papel por ningún sitio. **La app afirma haber impreso cuando no ha impreso nada.**

## Por qué esto es lo primero de la lista

Un TPV que miente sobre si ha impreso es peor que un TPV que no imprime. El cajero da por hecho que el ticket
salió, el cliente se va sin él, y nadie se entera hasta que hay una reclamación. Sole no tendría forma de
distinguir "la impresora está sin papel" de "todo bien".

Y afecta al riesgo abierto del AP12: aunque el hardware funcione, **el camino de error de impresión está roto**.
Impresora sin papel, desconectada, IP cambiada, tapa abierta → el TPV dirá "enviado".

## Alcance

### 1. Sin impresora configurada ≠ enviado

Si la caja no tiene impresora, la acción de imprimir/reimprimir **no debe reportar éxito**. Estado vacío honesto:
*"Esta caja no tiene impresora configurada"*, con enlace a configurarla si el usuario tiene permiso. Idealmente el
botón ni siquiera se ofrece como acción normal.

### 2. El resultado de imprimir se propaga hasta la UI

Recorrer `platform/printer/*` (`PrinterTransport`, `UsbNativeTransport`, `WebUsbTransport`,
`WifiBackendTransport`) y `lib/escposPrint.ts`: el mensaje de éxito hoy se pinta **sin esperar** al resultado real
del transporte. Debe pintarse **después**, y sólo si el transporte confirma. Tres estados visibles, no uno:
enviando / impreso / **falló, con el motivo y un botón de reintentar**.

Aplica a los tres puntos donde se imprime: el overlay de éxito tras el cobro, la reimpresión desde el detalle de
ticket, y la comanda a cocina.

### 3. Que un fallo de impresión nunca tumbe el cobro

Regla que ya se cumple y hay que **preservar explícitamente con un test**: el dinero manda. Si la impresión falla,
el ticket sigue cobrado. Lo que cambia es que el cajero se entera.

### 4. Telemetría

Un fallo de impresión debería llegar a Sentry con el transporte y el motivo. Hoy no hay una sola llamada a
`captureException` en toda la carpeta `platform/printer/`. Sin eso no sabremos nunca cuántas veces le ha pasado
esto a un cliente.

## Restricciones

- No tocar el camino de cobro (ADR-010). Este bloque cambia lo que se **cuenta** al cajero, no lo que se cobra.
- Respetar la arquitectura de transportes de v1.10: el arreglo va en la capa, no en cada pantalla.
- Worktree propio (`../mipiacetpv-v1-10-2-impresion`), verificado con `git worktree list`. Devuelve el hash del
  commit al cerrar. No push.

## Entregables

- Estado vacío "sin impresora configurada" en los tres puntos de impresión.
- Propagación real del resultado + estado de error con motivo y reintento.
- Test que demuestre que un fallo de impresión **no** tumba el cobro.
- `captureException` en los fallos de transporte.
- `docs/blocks/v1-10-2-impresion-honesta-done.md`.
- **Criterio de "funciona"**: en una caja sin impresora, pulsar imprimir dice que no hay impresora. Con impresora
  configurada pero apagada, dice que falló y por qué. En ninguno de los dos casos aparece "Enviado a impresora".

## Fuera de alcance (explícito)

- Rediseñar la configuración de impresoras.
- Cola de reintentos de impresión persistente.
- Cualquier cosa del cierre de día (va en `bloque-v1-11-cierre-de-dia.md`).
