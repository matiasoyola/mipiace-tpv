# Bloque clinica-7 · el blindaje

Rama `clinica-7-blindaje`, worktree `~/Developer/Claude/Projects/mipiacetpv-clinica-7`, desde
`origin/master` (`3494a15` o el que haya: lleva clinica-1…6, clinica-4 e iva-exento-sanitario).
Frente C. Escrito por Dirección el 14-10-2026.

Lee antes, en este orden:
1. `docs/blocks/clinica-4-done.md` — §8 y «Pendiente del abogado»: **este bloque cierra esa lista.**
2. `docs/blocks/clinica-1-done.md` — el gate (`apps/api/src/clinica/gate.ts`), el acceso por
   paciente y `ClinicalAccessLog`.
3. `docs/blocks/enlaces-publicos-done.md` y `apps/api/src/enlaces/` — la puerta común. El informe
   por email pasa a ir por ahí.
4. `apps/api/src/crypto.ts` (AES-256-GCM de la clave de Holded) y `apps/api/src/clinica/ficheros.ts`.
5. `infra/backup-postgres.sh` y `docker-compose.prod.yml`.

## Por qué existe

Mi Piace es **encargado del tratamiento de datos de salud** de cada clínica. Matías, 14-10:
«que nos curemos en salud todo lo posible, que seamos lo más estrictos posibles para proteger a Mi
Piace».

¿Y qué?:
1. **Si se filtra una copia, un dump o el volumen de ficheros, no se lee ni una historia.**
2. **Ni Matías ni nadie de soporte ve un diagnóstico** al lanzar SQL contra producción.
3. **Ningún PDF de salud sale de nuestros servidores por email.**
4. **Nada clínico se escribe sin un contrato de encargado aceptado**, con prueba de quién, cuándo y
   qué texto exacto.
5. **Al terminar con una clínica, sus datos se pueden devolver y después destruir de verdad,
   también en las copias.**

## Decisiones ya tomadas — no se re-debaten

### A · El contrato de encargado se acepta en el TPV

1. **Texto versionado en un paquete** (mismo patrón que las plantillas de consentimiento de
   clinica-4: versión, huella SHA-256 fijada por test, `pendienteDeValidar`). La v1 la entrega
   Dirección en `docs/clinica/contrato-encargado-v1.md`. Mientras no llegue, entra un texto de
   ejemplo con los mínimos del art. 28.3 RGPD, marcado como pendiente y con aviso ámbar en
   pantalla. **El texto no se escribe en el código de pantallas**, igual que la declaración
   responsable.
2. **Solo la dueña (OWNER) acepta.** Encargado, cajeros y sanitarios ven «La dueña tiene que
   aceptar el contrato de tratamiento de datos antes de usar la historia clínica».
3. **Lo que se guarda al aceptar** va en una tabla nueva, **solo de inserción** (un trigger impide
   UPDATE y DELETE, como los consentimientos): tenant, versión, huella del texto, usuario, fecha,
   dispositivo, IP y user-agent. **Revocar es una fila nueva** que apunta a la aceptación que
   revoca, no un UPDATE.
4. **Estado del módulo**, calculado por **una sola función pura** con test:
   - `clinicalRecordsEnabled = false` → la 404 de hoy, sin cambios.
   - Encendido y **nunca aceptado** → pantalla de aceptación (OWNER) o el aviso de arriba (resto).
     Ni una ruta clínica responde con datos.
   - Encendido y **aceptada la versión vigente sin revocar** → todo como hoy.
   - Encendido y **revocado, o aceptada solo una versión anterior** → **SOLO LECTURA**: se puede
     leer y exportar todo, y no se puede escribir nada clínico. Las rutas de escritura contestan
     423 con un código propio y un mensaje claro. La regla de Matías: «lo que lea está recogido
     con lo que aceptó hasta ese momento».
5. **Revocar no toca la agenda ni la caja.** Con el contrato no vigente, en un tenant clínico, las
   citas **nuevas** no admiten notas libres (`Appointment.notes`): solo hora, paciente y servicio.
   Las notas que ya existen se siguen viendo. Banda fija en las pantallas clínicas: «Historia
   clínica en solo lectura: el contrato de tratamiento no está vigente».
6. **En el TPV, sección «Contrato de tratamiento de datos»** en el panel del propietario
   (también dentro de la app): versión vigente, cuándo y quién la aceptó, el PDF de cada versión
   aceptada (para descargar siempre) y el botón «Revocar», con una confirmación que explica las
   consecuencias. Las rutas de leer el contrato quedan exentas del guard de cuenta bloqueada, como
   `/legal`.
7. **Exportar el centro entero** (solo OWNER, queda registrado): un ZIP con la historia completa de
   cada paciente en PDF (el informe «historia completa» de clinica-4), sus fotos y consentimientos
   descifrados, y un JSON con todo. Es la «devolución de datos» del art. 28.3.g. Funciona igual con
   el contrato revocado.

### B · Cifrado de ficheros en disco

8. **Fotos, PDF de consentimientos y PDF de informes**, cifrados con AES-256-GCM antes de escribir
   en `clinical_files`. La huella que se guarda y se comprueba es la del contenido **en claro**,
   comprobada después de descifrar: un fichero manipulado se sigue detectando.
9. Formato con versión y prefijo (`v1:` o una cabecera binaria equivalente), como `crypto.ts`.
   Cambiar el formato es migración.

### C · Cifrado del texto clínico en la base

10. **Se cifra todo lo que dice algo de la salud.** Como mínimo: `ClinicalEntry.body`,
    `ClinicalAddendum.body`, las respuestas y alertas de `ClinicalAssessment`,
    `ClinicalPhoto.zona` y `withdrawReason`, `ClientConsent.revokeReason` cuando `clinical = true`,
    y `Appointment.notes` y `Client.notes` **en tenants con la clínica encendida**. **Haz el
    inventario completo** de columnas que puedan llevar datos de salud y ponlo en el `-done` con la
    decisión de cada una. Si dudas, se cifra.
11. **En claro solo lo que hace falta para funcionar y no dice nada de la salud por sí mismo**:
    ids, tenant, fechas, autor, tipo de visita (la agenda ya lo enseña como servicio), estado y el
    registro de accesos.
12. **Búsqueda**: dentro de la historia de un paciente se descifra y se busca en memoria. No se
    construye búsqueda entre pacientes; si un día hace falta, irá por índice ciego (HMAC) sobre
    campos estructurados, nunca sobre texto libre. Dilo en el `-done`.
13. **La API descifra; el cliente nunca ve la clave ni texto cifrado.** Ni la tablet ni el panel
    cambian de contrato de datos.

### D · Las claves (las decisiones de fondo)

14. **Clave por clínica (DEK) envuelta por una clave maestra (KEK).**
    - Cada tenant clínico tiene su DEK aleatoria de 32 bytes, guardada en la base **envuelta**
      (cifrada) con la KEK.
    - La KEK va en una variable de entorno nueva (`CLINICAL_KEK`, base64 de 32 bytes, con
      `CLINICAL_KEK_ID`). Nunca está en la base ni en el repo.
    - **Por qué**: borrar la DEK de una clínica deja ilegibles sus datos **en todas las copias de
      seguridad pasadas**. Es la única forma real de «destruir» al terminar el contrato
      (crypto-shredding). Se construye la función y su test. **La pantalla para lanzarla NO**: es
      una operación de superadmin con doble confirmación y queda para su bloque. Déjalo escrito.
15. **AAD**: cada valor cifrado va atado a `tenantId + tabla + columna + id de fila`. Así un texto
    copiado de un paciente a otro no se descifra. Test que lo sabotea.
16. **Rotación**: la KEK lleva id; re-envolver las DEK con una KEK nueva es un script del repo
    con su test. Las filas no se re-cifran: solo se re-envuelven las DEK.
17. **Arranque**: si existe algún tenant clínico y falta la KEK, o no descifra una fila canario,
    **la API no arranca** y lo dice en el log. Fallar al arrancar es mejor que escribir algo que no
    se puede leer.
18. **Ningún log, error de Sentry ni respuesta incluye texto en claro, DEK ni KEK.** Hay test.

### E · Copias de seguridad

19. `infra/backup-postgres.sh` **cifra el paquete (dump + volumen clínico) con `age`** para una
    **clave pública**. En el VPS solo está la pública: el VPS puede cifrar copias pero **no
    descifrarlas**. La privada vive fuera del VPS (tarea humana, abajo).
20. **Simulacro de restauración** como script del repo: restaura una copia en una base de prueba
    con la privada, arranca la API contra ella y descifra la fila canario y un fichero. Se ejecuta
    en el bloque y su salida va al `-done`.

### F · Fuera los adjuntos

21. **El informe por email deja de llevar adjunto.** El correo lleva un enlace por la puerta común
    (`purpose` nuevo en `reglas.ts`):
    - caduca a los 7 días, admite como máximo 3 aperturas y se puede anular desde la historia;
    - **para abrirlo pide un código de 6 cifras** que se enseña UNA vez en pantalla a quien lo envía,
      para darlo por otro canal (en mano o por teléfono). Se guarda solo su huella. 5 códigos
      fallidos anulan el enlace;
    - cada apertura queda en `ClinicalAccessLog` como acceso externo;
    - el cuerpo del correo no dice ni el tipo de informe (regla de clinica-4, se mantiene).
22. **Test de guardia**: ningún envío del módulo clínico pasa un adjunto al `EmailSender`. Si
    alguien vuelve a meter `attachments`, el test se pone rojo.
23. Imprimir y entregar en mano siguen como hoy.

### G · Mi Piace no mira

24. **El superadmin no abre historias**: ni rutas, ni suplantación, ni soporte de cajeros. Test
    que lo intenta por cada camino que exista y espera la misma 404.

## Rendimiento: criterio de cierre

25. Mide la apertura de la historia de un paciente grande de demo (200 visitas, 20 fotos) **antes y
    después**, en la misma máquina, con la mediana de 20 aperturas. **Si sube más de 50 ms, el
    bloque no se cierra**: se optimiza. Números al `-done`.

## Migración

- Tablas nuevas: aceptaciones y revocaciones del contrato, y DEK envueltas por tenant.
- Columnas cifradas: **expand → migrar → contract**. Columna nueva cifrada, script que cifra lo
  existente y verifica (descifra y compara cada fila), y la columna en claro **no se borra en esta
  migración**: se vacía y se borra en una posterior, dicha en el `-done`. En producción el módulo
  está apagado en todos los tenants, así que el script se ejecuta sobre cero o casi cero filas,
  **pero se escribe y se prueba como si hubiera miles** sobre una copia de desarrollo con datos.
- Ficheros ya escritos en `clinical_files`: el mismo script los cifra en su sitio, de forma
  idempotente.

## Lo que NO entra

- La pantalla de crypto-shredding (sí la función).
- La supresión RGPD al vencer plazos (su bloque).
- La app iOS, los bonos, el dictado y la búsqueda entre pacientes.
- Reescribir el texto del contrato: lo pone Dirección.

## Cómo se da por hecho

- Suite verde en local y CI. **Tabla de sabotajes en el `-done`**, cada test visto en rojo, con el
  fichero de test entero (no `-t`). Como mínimo:
  - estado del módulo (los cuatro casos de la decisión 4);
  - una escritura con el contrato revocado → 423, y la lectura → 200;
  - aceptar sin ser OWNER → rechazado;
  - el trigger impide UPDATE/DELETE de aceptaciones;
  - un valor cifrado movido a otra fila o tenant no descifra (AAD);
  - la base vista con `psql` no contiene ningún texto clínico en claro (grep de un texto canario
    sobre un `pg_dump`);
  - un fichero manipulado da error de huella;
  - la API no arranca sin KEK teniendo tenants clínicos;
  - el enlace del informe: caducado, gastado, anulado, código erróneo ×5 → anulado; todos con la
    misma 404;
  - ningún adjunto en envíos clínicos;
  - el superadmin no abre historias;
  - borrar la DEK deja ilegible la historia de ese tenant y no la de otro.
- Simulacro de restauración ejecutado y pegado en el `-done`.
- Medida de rendimiento antes/después en el `-done`.
- Capturas en `docs/qa/2026-10-xx-clinica-7/` a 1366, 1024 y 390: aceptación, aviso al no-OWNER,
  banda de solo lectura, sección del contrato en el panel, envío del informe con el código.
- `docs/blocks/clinica-7-done.md` con el inventario de columnas, las decisiones tomadas sin
  preguntar, los sabotajes y **«Al desplegar»**, que debe incluir en este orden:
  1. **Tareas humanas ANTES de desplegar** (abajo).
  2. Copia de la base.
  3. Variables nuevas en el VPS.
  4. Migración y script de cifrado, con su verificación.
  5. Simulacro de restauración contra la primera copia cifrada de la noche.
- **Push de la rama y PR abierto: autorizados.** Ni merge ni despliegue: eso es de Dirección.

## Tareas humanas (Matías) — antes de desplegar

1. Generar la KEK y el par de claves de `age`. El bloque deja un script que las genera y dice
   dónde pegar cada una.
2. **Guardar la KEK y la privada de `age` en DOS sitios fuera del VPS** (gestor de contraseñas y
   una copia física). **Si se pierden, se pierden todas las historias, y hay que conservarlas
   5 años.**
3. Que un abogado revise la v1 del contrato de encargado antes de que Rosario lo acepte.
