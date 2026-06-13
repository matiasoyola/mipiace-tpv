---
title: Posición de mipiacetpv frente a Verifactu (RD 1007/2023)
estado: BORRADOR (v0.1) — argumentación interna, PENDIENTE de validación por asesor fiscal
fecha: 2026-06-13
---

> **AVISO.** Documento canónico que recoge la posición de mipiacetpv frente al Reglamento de sistemas informáticos de facturación (Verifactu). Es la argumentación del equipo; **debe ser validada por un asesor fiscal** antes de usarse como respuesta oficial a clientes o terceros. Es lo primero que preguntará un cliente serio o un competidor.

# Posición frente a Verifactu

## 1. Resumen ejecutivo (la tesis)

**mipiacetpv no es un sistema informático de facturación (SIF) a los efectos del Real Decreto 1007/2023.** mipiacetpv es un terminal de punto de venta que **registra operaciones de venta** y las **transmite a Holded**, que es el sistema de facturación del cliente. **Holded es el SIF** sujeto a las obligaciones de Verifactu; mipiacetpv queda fuera de ese ámbito porque no emite ni conserva facturas con valor fiscal: genera tickets internos y los envía como *salesreceipts* a Holded.

## 2. Qué exige Verifactu (marco)

El RD 1007/2023 desarrolla el art. 29.2.j) de la LGT y regula los requisitos de los **sistemas informáticos de facturación**: integridad, conservación, accesibilidad, legibilidad, trazabilidad e inalterabilidad de los **registros de facturación**, con huella/hash encadenado y, en su caso, remisión a la AEAT ("Verifactu"). El sujeto obligado es **quien produce las facturas** mediante ese sistema.

⚠️ *El asesor debe confirmar la versión vigente del RD y sus plazos de entrada en vigor aplicables al cliente, que han sido objeto de modificaciones.*

## 3. Por qué mipiacetpv queda fuera del ámbito SIF

1. **No emite facturas.** mipiacetpv produce **tickets de venta con numeración interna propia**, no facturas con eficacia fiscal. La conversión a factura y su registro fiscal ocurren **en Holded**.
2. **No es el sistema de conservación fiscal.** Los documentos con valor fiscal (facturas, registros) **residen en Holded**, contratado y administrado por el propio cliente.
3. **Holded es un SIF certificado/adaptado a Verifactu** (lo declara su proveedor). Es Holded quien asume las obligaciones de integridad, encadenamiento y remisión.
4. **mipiacetpv actúa como fuente de datos de venta**, equivalente funcional a un sistema de captura de operaciones que alimenta al sistema de facturación, no como el sistema de facturación en sí.

## 4. Frontera técnica (cómo se materializa)

- El TPV crea un *ticket* con `internalNumber` (numeración propia, secuencial por caja) → no es número de factura.
- El worker lo envía a Holded como **salesreceipt** vía API, usando la cuenta del cliente.
- Holded asigna su propia numeración/documento fiscal y aplica sus controles Verifactu.
- mipiacetpv **no altera ni firma** documentos fiscales; su numeración interna es para trazabilidad operativa y arqueo, no fiscal.

## 5. Riesgos y matices a validar con el asesor ⚠️

- **Numeración interna del ticket:** confirmar que tener numeración propia operativa no arrastra a mipiacetpv al ámbito SIF (la clave es que **no es la numeración fiscal**).
- **Ticket digital al cliente final:** el PDF/QR que entrega mipiacetpv es un **justificante de la operación**, no una factura. Confirmar la redacción para no inducir a error (que no parezca una factura simplificada con valor fiscal si no lo es).
- **Caso "factura simplificada":** si en algún flujo el ticket pretendiera funcionar como factura simplificada, esa frontera cambia. Hoy la posición es que **la factura la hace Holded**.
- **Dependencia de la certificación de Holded:** nuestra posición se apoya en que Holded cumple Verifactu. Conviene **dejarlo documentado** (declaración del proveedor) y revisarlo periódicamente.

## 6. Cómo responder a un cliente

> "mipiacetpv es tu terminal de venta: registra los cobros y los manda a tu Holded. **Quien emite y conserva las facturas conforme a Verifactu es Holded**, que es tu sistema de facturación. Nosotros no sustituimos a Holded en lo fiscal; lo alimentamos. Por eso la exactitud fiscal depende de tu configuración en Holded, y así está recogido en el contrato."

## 7. Pendiente

- ☐ Validación formal por **asesor fiscal** de esta posición.
- ☐ Obtener y archivar la **declaración de Holded** sobre su adaptación a Verifactu.
- ☐ Revisar la redacción del **justificante digital** para que no se confunda con una factura.
- ☐ Enlazar este documento desde el contrato piloto (cláusula 2) y el checklist de implantación. ✅ *(ya referenciado)*

## Relación con otros documentos

- Cláusula 2 del `contrato-piloto.md` (frontera fiscal).
- `dpa-encargado-tratamiento.md` (datos personales).
- Memoria interna: marco legal fiscal · capa superior a Holded.
