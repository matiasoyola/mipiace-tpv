---
title: Acuerdo de Encargado del Tratamiento (DPA) — mipiacetpv
estado: BORRADOR (v0.1) — requiere validación de asesor legal antes de firmar
fecha: 2026-06-13
base: art. 28 RGPD (Reglamento UE 2016/679) y LOPDGDD 3/2018
---

> **AVISO — BORRADOR.** Base de trabajo redactada por el equipo mipiacetpv. **No es asesoramiento jurídico.** Revisar con asesor antes de firmar. Completar campos `«…»` y verificar la lista de subencargados (cláusula 7) contra la infraestructura real en cada momento.

# Acuerdo de Encargado del Tratamiento

Conforme al artículo 28 del RGPD, entre:

- **RESPONSABLE del tratamiento:** el Cliente identificado en el contrato principal (el comercio que usa mipiacetpv).
- **ENCARGADO del tratamiento:** `«Razón social / autónomo»`, NIF `«NIF»`, titular de mipiacetpv (el "Encargado").

## 1. Objeto

El Encargado tratará datos personales por cuenta del Responsable **únicamente** para prestar el servicio mipiacetpv (registro de ventas y su transmisión a la cuenta de Holded del Responsable, y servicios accesorios: envío de tickets, soporte).

## 2. Datos y categorías de interesados

| Categorías de datos | Interesados |
|---|---|
| Identificativos y de contacto: nombre, NIF/CIF, email, teléfono | Clientes finales del Responsable (en contactos y tickets) |
| Datos de operación: líneas de venta, importes, fecha/hora, tienda/caja | Operaciones del Responsable |
| Datos de personal de caja: nombre, email, PIN/credenciales | Empleados/cajeros del Responsable |

**No se tratan categorías especiales** (art. 9 RGPD) de forma deliberada. El Encargado aplica **minimización**: p. ej. el buscador de clientes muestra solo nombre y los últimos dígitos de identificadores.

## 3. Duración

Vigente mientras dure la prestación del servicio. A su fin, se aplica la cláusula 9.

## 4. Obligaciones del Encargado

El Encargado se obliga a:

a) Tratar los datos **solo según instrucciones documentadas** del Responsable (este acuerdo y el uso del servicio). Si una instrucción infringe la normativa, lo notificará.

b) Garantizar la **confidencialidad** de quienes traten los datos.

c) Aplicar las **medidas técnicas y organizativas** del Anexo A (art. 32 RGPD).

d) Respetar las condiciones de **subcontratación** (cláusula 7).

e) **Asistir** al Responsable, en la medida de lo posible, para responder a los derechos de los interesados (acceso, rectificación, supresión, oposición, portabilidad, limitación).

f) **Asistir** al Responsable en el cumplimiento de los arts. 32 a 36 (seguridad, notificación de brechas, evaluaciones de impacto).

g) **Notificar sin dilación indebida** y, a más tardar en `«48»` horas, cualquier **violación de seguridad** de la que tenga conocimiento, con la información del art. 33.3.

h) Poner a disposición del Responsable la información necesaria para **demostrar el cumplimiento** y permitir auditorías razonables.

## 5. Obligaciones del Responsable

El Responsable garantiza disponer de **base jurídica** para los tratamientos que encomienda, informar a sus clientes finales y mantener correctamente sus datos (incluidos los de su cuenta de Holded).

## 6. Ubicación del tratamiento

Los datos se alojan en servidores ubicados en la **Unión Europea** (`«Frankfurt, Alemania»`, proveedor Hostinger). No se realizan transferencias internacionales fuera del EEE salvo las que impliquen los subencargados listados, en cuyo caso se aplicarán las garantías del Capítulo V del RGPD. ⚠️ *Verificar la ubicación real de cada subencargado (Sentry, Backblaze, Google) y sus garantías de transferencia.*

## 7. Subencargados

El Responsable **autoriza** al Encargado a recurrir a los siguientes subencargados, necesarios para el servicio. El Encargado informará de cualquier cambio con antelación razonable, pudiendo el Responsable oponerse por motivos fundados.

| Subencargado | Finalidad | Ubicación / garantía ⚠️ verificar |
|---|---|---|
| Hostinger (VPS) | Hosting de la aplicación y base de datos | UE (Frankfurt) |
| Holded | Destino de las ventas (cuenta del propio Responsable) | UE — *relación contratada por el propio Responsable* |
| Proveedor SMTP / correo | Envío de tickets y notificaciones (no-reply@mipiacetpv) | `«verificar»` |
| Sentry | Registro de errores de la aplicación | `«UE/EEUU — verificar»` |
| Backblaze B2 (si se activa) | Copia de seguridad cifrada offsite | `«EEUU — verificar garantías»` |
| Google Workspace | Correo corporativo del equipo (soporte) | `«verificar»` |
| UptimeRobot | Monitorización de disponibilidad (sin datos personales) | `«verificar»` |

> Nota: la cuenta de **Holded** es contratada y administrada por el propio Responsable; mipiacetpv se limita a transmitir a ella usando la clave de API que el Responsable proporciona. ⚠️ *Confirmar con asesor si Holded debe figurar como subencargado del Encargado o como tratamiento propio del Responsable.*

## 8. Medidas de seguridad (Anexo A)

- **Cifrado** de las claves de API de Holded en base de datos (AES-256-GCM).
- **Argon2id** para contraseñas y PINs; doble factor (2FA) en el panel de super-administración.
- **Tokens** de sesión versionados y de vida corta; control de acceso por roles (OWNER/MANAGER/CAJERO) y aislamiento por tenant.
- **TLS** (HTTPS) en todas las comunicaciones; cabeceras de seguridad (CSP, Permissions-Policy).
- **Copias de seguridad** periódicas cifradas; registro de auditoría de acciones administrativas.
- **Minimización** y enmascaramiento de identificadores en interfaces.

## 9. Devolución y supresión

A la finalización, y a elección del Responsable, el Encargado **devolverá** (exportación en formato reutilizable) o **suprimirá/anonimizará** los datos personales, salvo obligación legal de conservación, certificándolo si se solicita.

## 10. Responsabilidad

Cada parte responde de los daños que cause por incumplimiento de sus obligaciones bajo el RGPD, en los términos del art. 82.

---

| El Responsable (Cliente) | El Encargado (mipiacetpv) |
|---|---|
| Fdo.: | Fdo.: |
