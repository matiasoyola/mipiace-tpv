# Residencia · familias (portal y comunicación)

Criterio de Claude con delegación de Matías (14-10-2026). Se apoya en D-32 a D-34 (comunicación como
dimensión aparte, sin avisos automáticos, constancia también de lo no comunicado) y en D-60 (cada
control ya lleva su visibilidad para familia).

¿Y qué?: 11 de las 19 quejas verbales de 2025 fueron de familias (ropa y fisioterapia). La familia que
ve que su madre ha ido a gimnasia y ha comido bien no llama para preguntarlo; y la residencia puede
enseñar, con fecha, qué se le contó y quién.

---

## 1. Dos regímenes de publicación

| Régimen | Qué | Cómo llega |
|---|---|---|
| **Publicación automática** | Lo que no requiere juicio: actividades a las que ha ido, menú del día, fotos de actividades **con autorización de imagen firmada**, «su PAI se ha revisado», próximas citas externas | Aparece en el portal sin que nadie lo apruebe |
| **Comunicación deliberada** | Todo lo clínico y toda incidencia | Sólo cuando una persona del centro decide comunicarlo; queda registrado (quién, cuándo, vía, qué se dijo, respuesta) o registrado el **no comunicado** con motivo |

Ningún dato clínico ni incidencia aparece solo en el portal. Nunca (D-33).

## 2. Quién entra

- **Familiar responsable** y hasta N familiares autorizados **por el residente o su representante**,
  con lo que cada uno puede ver. La autorización es un consentimiento firmado (`ClientConsent`).
- Acceso **sin contraseñas**: enlace mágico por email o SMS (mismo patrón que los enlaces públicos y la
  valoración del paciente de la clínica: `PublicLink`). Pensado para hijos de 60 años.
- Todo acceso de un familiar se registra como cualquier otro.

## 3. Qué ve la familia

1. **Hoy**: «está como siempre» o nada (el «como siempre» es publicable; las desviaciones no — van por
   comunicación deliberada).
2. **Su semana**: actividades, gimnasia, terapia, salidas, visitas del podólogo o la peluquera.
3. **Mensajes** del centro (los comunicados deliberados que se envían por escrito).
4. **Documentos**: PAI firmado, consentimientos, facturas y recibos, certificado anual de pagos.
5. **Pedir**: cita para visita, cita con la dirección, servicio de peluquería o podología (entra como
   solicitud, no como cita confirmada), aviso de ropa que falta.

## 4. Ropa (queja nº 1 de las familias)

Inventario de prendas por residente con foto opcional; la lavandería marca **entregada / devuelta**;
prenda que no vuelve en N días → incidencia N1 (sujeto residente, tipo ropa). Alimenta el indicador de
AENOR «prendas extraviadas al mes». Va en el bloque de familias porque es donde duele.

## 5. Encuestas de satisfacción

Las de residentes y familiares pasan al portal y a la tablet (para residentes, con ayuda de la TO):
se cuentan **entregadas y recibidas** y la **representatividad** (Obs. 05 de AENOR). Las respuestas
alimentan el módulo de calidad (`07`).

## 6. Fuera

- Videollamada, chat en tiempo real con el personal: no. El personal no tiene que atender un chat.
- App nativa para familias: no; web móvil.

## 7. Entidades

`FamilyMember` (relación, permisos, vigencia) · `FamilyAccessGrant` (consentimiento) · `FamilyFeedItem`
(publicación automática) · `FamilyCommunication` (de `01`, ya en residencia-4) · `FamilyRequest` ·
`GarmentItem` + `GarmentMovement` · `Survey` / `SurveyDelivery` / `SurveyResponse`.
