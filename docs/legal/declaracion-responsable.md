---
title: Declaración responsable del sistema informático de facturación
estado: GENERADO. No editar a mano.
generado_por: scripts/generar-declaracion-responsable.ts (pnpm docs:declaracion)
---

> **ESTE FICHERO SE GENERA.** El texto sale de
> `packages/verifactu/src/declaracion.ts` y de las constantes del productor
> de `packages/verifactu/src/productor.ts` — las mismas que firman cada
> registro de facturación. Para cambiarlo, cambia el código y ejecuta
> `pnpm docs:declaracion`. Editarlo a mano pone roja la suite
> (`packages/verifactu/test/declaracion-doc.test.ts`).

> **LA COPIA QUE VALE es la que sirve el sistema**, con la versión y la
> fecha de lo que está desplegado:
> `GET /legal/declaracion-responsable` y
> `GET /legal/declaracion-responsable.pdf`, o la pantalla
> «Declaración responsable» del panel. Este fichero lleva marcadores en su
> lugar porque es del repo y no de un despliegue.

# DECLARACIÓN RESPONSABLE DEL SISTEMA INFORMÁTICO DE FACTURACIÓN

### 1.a) Nombre del sistema informático a que se refiere esta declaración responsable

mipiacetpv

### 1.b) Código identificador del sistema informático a que se refiere el apartado a) de esta declaración responsable

MP

### 1.c) Identificador completo de la versión concreta del sistema informático a que se refiere esta declaración responsable

«la versión en ejecución» (servidor)

### 1.d) Componentes, hardware y software, de que consta el sistema informático a que se refiere esta declaración responsable, junto con una breve descripción de lo que hace dicho sistema informático y de sus principales funcionalidades

Se trata únicamente de software, sin componente hardware propio: se instala en terminales de caja y equipos de propósito general que cumplan los requisitos mínimos de la aplicación.

El sistema consta de tres componentes: (1) la aplicación de terminal punto de venta, en su versión web y en su versión para Android en terminales de caja; (2) el servidor, que comprende la API y la base de datos, alojados en la nube; y (3) el panel de gestión con el que el usuario administra su negocio y consulta su facturación.

Funcionalidades principales: expedición de facturas simplificadas en el terminal en el momento del cobro, con conexión o sin ella; generación del registro de facturación de alta y del registro de facturación de anulación, con huella SHA-256 encadenada por caja; incorporación a la factura del código QR tributario y de la leyenda «VERI*FACTU»; y conservación inalterable de los registros en el servidor, donde quedan listos para su remisión a la Agencia Estatal de Administración Tributaria.

Cada caja registradora constituye una instalación distinta del sistema informático de facturación, con su propio número de instalación, su serie de facturación y su propia cadena de huellas.

### 1.e) Indicación de si el sistema informático a que se refiere esta declaración responsable se ha producido de tal manera que, a los efectos de cumplir con el Reglamento, solo pueda funcionar exclusivamente como «VERI*FACTU»

S - Sí

### 1.f) Indicación de si el sistema informático a que se refiere la declaración responsable permite ser usado por varios obligados tributarios o por un mismo usuario para dar soporte a la facturación de varios obligados tributarios

S - Sí

Cada caja registradora factura por un único obligado tributario.

### 1.g) Tipos de firma utilizados para firmar los registros de facturación y de evento en el caso de que el sistema informático a que se refiere esta declaración responsable no sea utilizado como «VERI*FACTU»

No aplica. Este sistema informático de facturación sólo puede funcionar exclusivamente en la modalidad «VERI*FACTU», por lo que no realiza una firma electrónica expresa de los registros de facturación: la normativa considera que quedan firmados al ser remitidos correctamente a los servicios electrónicos de la Agencia Estatal de Administración Tributaria con la debida autenticación.

### 1.h) Razón social de la entidad productora del sistema informático a que se refiere esta declaración responsable

MI PIACE INTERNET SOLUTIONS SL

### 1.i) Número de identificación fiscal (NIF) español de la entidad productora del sistema informático a que se refiere esta declaración responsable

B45902186

### 1.j) Dirección postal completa de contacto de la entidad productora del sistema informático a que se refiere esta declaración responsable

Carretera CM-5100, km 30,500

45634 Buenaventura (Toledo)

España

### 1.k) La entidad productora del sistema informático a que se refiere esta declaración responsable hace constar que dicho sistema informático, en la versión indicada en ella, cumple con la normativa aplicable

El productor declara que este sistema informático de facturación cumple con lo dispuesto en el artículo 29.2.j) de la Ley 58/2003, de 17 de diciembre, General Tributaria, en el Reglamento aprobado por el Real Decreto 1007/2023, de 5 de diciembre, en la Orden HAC/1177/2024, de 17 de octubre, y en las especificaciones publicadas por la Agencia Estatal de Administración Tributaria en su sede electrónica.

### 1.l) Fecha y lugar en que la entidad productora de este sistema informático suscribe esta declaración responsable del mismo

Fecha: «la fecha de la versión en ejecución»

Lugar: Buenaventura (Toledo) – España

## Anexo

### 2.a) Otras formas de contacto con la entidad productora del sistema informático a que se refiere esta declaración responsable

Correo electrónico: soporte@mipiacetpv.com

### 2.b) Direcciones de internet de la entidad productora del sistema informático a que se refiere esta declaración responsable

Sitio web: https://mipiacetpv.com

---

Referencias: art. 15 de la Orden HAC/1177/2024; RD 1007/2023;
`docs/legal/posicion-verifactu.md` §4 (quién identifica al SIF) y
`docs/design/adr-019-cada-caja-es-un-sif.md` (cada caja, una instalación).
