# Cafetería Sirope · deja Holded y nuevo plan de despliegue

Preparado el 10-10-2026. **Decisión de Matías (10-10): Sirope deja Holded.** Sustituye al
checklist de julio, que daba por hecho que Holded era su sistema fiscal (sigue en el historial de
git, commit `13497cc`).

Sirope va así por el mismo camino que La Maestranza (`checklist-maestranza.md`): **el TPV es su
SIF** (serie `C1` por caja, número correlativo, QR y leyenda), **el catálogo es local** y se edita
en el panel, y **su gestor liquida a partir de los tickets** (decisión del 27-09).

## ¿Y qué?

1. **Es el primer «Dejar Holded» en producción, con riesgo cero.** Sirope no ha vendido nunca
   (ACTIVE desde el 08-06, 0 ventas reales): el corte no puede estropear ni una factura. Sirve de
   **ensayo general del corte de Peluquería Sole**, que sí vende y es el que importa.
2. **Hoy Sirope no podría facturar aunque quisiera**: su Holded está con la **suscripción
   suspendida** (visto en el super-admin el 10-10; el sync está parado). Sin el corte, su sistema
   fiscal es una cuenta que no funciona; con el corte, lo es el TPV.
3. **Sirope cambia sus precios desde el panel**, sin pasar por Holded.
4. **Un solo camino de implantación en hostelería**: el de La Maestranza.

Son dos partes que **no dependen una de otra**: la A se hace en remoto cuando se quiera; la B es la
visita al local.

---

## Parte A · La desconexión (remota, sin visita y sin desplegar nada)

Producción ya lleva «Dejar Holded» desde el 27-09 (`holded-desconectar`, ADR-020). No hace falta
desplegar: la CI roja de master no afecta. Guion base: `docs/blocks/holded-desconectar-done.md` §9;
aquí sólo lo propio de Sirope.

### A1 · Sacar el laboratorio de Sirope (antes que nada)

Sirope es hoy **nuestra cuenta de laboratorio**: el AP11-1006 está emparejado a ella. Después del
corte, **cada cobro en Sirope es una factura real** con su NIF, y los registros fiscales no se
borran (trigger append-only). Es lo que pasó con la cuenta de ensayo de La Maestranza el 06-10.

- [ ] Emparejado hoy (10-10): **sólo el AP11-1006** a Tienda principal · Caja 1, último latido 02-09.
- [ ] El AP11 de laboratorio se **desvincula de Sirope** y se vincula a **PRUEBAS MIPIACE**.
      Antes, comprobar que ese AP11 no es el «AP11 de cocina» de la pasada del frente H; si lo es,
      se coordina con esa sesión y no se toca a mitad de pasada.
- [ ] Regla desde el corte: **en Sirope no cobra nadie más que Sirope.**

### A2 · La previsualización, leída el 10-10 (11:40)

Super-admin → Cafetería Sirope → **Dejar Holded**: **«Todavía no se puede»**, y por **un único
motivo**: tres SKU repetidos que escribió el cliente. Todo lo demás, en verde:

| | |
|---|---|
| Fichas que pasan a ser del comercio | **191** (121 productos + 70 servicios), las 191 conservan su enlace |
| Archivadas en Holded | 85 (siguen fuera de la rejilla) |
| Líneas de ticket colgando | 86 (todas de pruebas) |
| Sin cerrar con Holded / devolubles | 0 / 0 |
| Contactos espejo / CRM / fiado | 5 / 0 / 0,00 € |
| Email automático | 0 en su historia: no pierde nada |
| Facturación | «NIF y razón social comprobados» · Tienda principal · Caja 1 → serie `C1`, 0 registros |
| Terminal | **el AP11-1006 de laboratorio**, APK desconocida, último latido 02-09 |

### A3 · Los tres SKU repetidos, por SQL en producción (13-10)

**El panel no sirve**, aunque la previsualización lo ofrezca: `PATCH /catalog/products/:id` sólo
escribe fichas `LOCAL` (`local-products.ts`, regla 1) y la bandeja de SKU escribe en Holded, que
está suspendido. Con el sync parado nada los pisa, así que se cambian en la base, con guardas
(cada `UPDATE` tiene que tocar exactamente una fila y el SKU nuevo no puede existir):

| SKU repetido | Se queda | Cambia |
|---|---|---|
| `CAF-DES-03` | Desayuno 3 · Café + Croissant | la versión **Sin gluten** → `CAF-DES-03-SG` |
| `CAF-DES-04` | Desayuno 4 · Café + Croissant Plancha | la versión **Sin gluten** → `CAF-DES-04-SG` |
| `SKU215` | Coca cola | **Coca cola zero** → `SKU215-Z` |

- [ ] Correr el SQL (comando en la conversación del 13-10) y ver las seis filas con su SKU.
- [ ] Previsualizar otra vez: tiene que desaparecer el «Todavía no se puede».
- [ ] Defecto menor para la cola: el texto del bloqueo `SKU_DUPLICADO_DEL_CLIENTE` ofrece «desde
      Catálogo en el panel», que no existe para fichas de Holded.

### A4 · La foto ANTES (desde el Mac)

```bash
cd ~/Developer/Claude/Projects/mipiacetpv && ssh root@76.13.142.28 'cd /opt/mipiacetpv && docker exec -i mipiacetpv-postgres sh -c "psql -U \$POSTGRES_USER -d \$POSTGRES_DB -P pager=off" < docs/blocks/holded-desconectar-ensayo/foto.sql' > ~/Desktop/sirope-antes.txt && wc -l ~/Desktop/sirope-antes.txt
```

### A5 · El corte

- [ ] Teclear el nombre exacto del comercio y confirmar.

### A6 · Comprobar (en este orden)

```bash
cd ~/Developer/Claude/Projects/mipiacetpv && ssh root@76.13.142.28 'cd /opt/mipiacetpv && docker exec -i mipiacetpv-postgres sh -c "psql -U \$POSTGRES_USER -d \$POSTGRES_DB -P pager=off" < docs/blocks/holded-desconectar-ensayo/foto.sql' > ~/Desktop/sirope-despues.txt && diff ~/Desktop/sirope-antes.txt ~/Desktop/sirope-despues.txt
```

- [ ] El diff **sólo toca a Cafetería Sirope**. Si cambia cualquier otro comercio, o quedan filas
      `PENDING` en `holded_uploads`, se para.
- [ ] Panel → Catálogo de Sirope: las fichas salen con «Editar» y sin «De Holded».
- [ ] Cambiar un precio y verlo en el TPV (sin cobrar).
- [ ] Super-admin → Facturación (VERI*FACTU): la caja con su serie y **0 registros**.
- [ ] **Diferencia con el guion de Sole: aquí NO se cobra la venta de prueba** del §9.3 paso 7.
      En Sirope sería la factura `C1/1` de verdad. La primera venta la hace Sirope el día de la
      visita.
- [ ] Apuntar lo aprendido (cuánto tardó, qué enseñó la previsualización, cualquier sorpresa) en
      el plan de la visita a Sole: este corte es su ensayo.

### A7 · Después del corte

- [ ] **Aviso corto al dueño**, por escrito: sus precios se cambian desde Catálogo; cada ticket será
      una factura simplificada del TPV (serie `C1`); las devoluciones devuelven el dinero y el
      abono lo hace su gestor (pantalla «Devoluciones · asesor»); volver a Holded no se hace desde
      el panel.
- [ ] **La suscripción de Holded de Sirope** ya está suspendida. El corte no la necesita viva;
      cerrarla del todo es decisión de Matías.

---

## Parte B · Nuevo plan de despliegue (Fase 2, sin Holded)

Lo que cambia frente al plan de julio: **no hay activación** (la cuenta ya está ACTIVE y tiene
propietario), **no hay «primera venta en su Holded»** y **cada caja es una serie** con un solo
terminal (la precondición de verifactu-1 no deja dos terminales en la misma caja).

### B1 · Datos que faltan (se piden de uno en uno)

- [ ] **Razón social**. La cuenta dice «Cafetería Sirope» con NIF `04183876S`, que es un DNI:
      **es autónoma**, y en su factura tiene que salir su **nombre y apellidos**, no el nombre
      del local (el nombre comercial va al pie). Corregirlo en «Datos fiscales» **antes de la
      primera venta**: la comprobación de la previsualización mira que haya datos, no que el nombre
      sea el de la titular del NIF.
- [ ] **Terminal**: su AP propio, que nunca se dejó funcionando. Modelo y qué falló.
- [ ] **¿Una caja o dos?** Dos cajas = dos terminales y dos series (`C1`, `C2`).
- [ ] **Impresora**: modelo y conexión.
- [ ] **Sala real**: zonas y mesas (la provisional B1-B3, M1-M4, T1-T2 es de relleno).
- [ ] **Camareros** que cobran (alias y PIN).
- [ ] **¿Pantalla de cocina?** Módulo «Cocina», se cobra por pantalla. Si sí, la visita va detrás de
      kds-1 y kds-2 en producción.
- [ ] **Propietaria**: `gemmamgc72@gmail.com`, último acceso el 09-07. ¿Sigue siendo ella y
      recuerda la contraseña?
- [ ] **Fecha** de la visita (mañana, nunca la tarde antes de un fin de semana).

### B2 · Antes de salir (remoto)

- [ ] **APK 1.23.0 publicada en `/apk`** (frente B). Sirope no lleva una APK que no esté publicada.
- [ ] Producción sana: `curl -s https://api.mipiacetpv.com/health`; anotar el sha de rollback.
- [ ] **Catálogo repasado en el panel** contra la carta impresa (`sirope/Carta_Sirope_imprenta.pdf`,
      `Sirope_precios_TPV_vs_carta.xlsx`): precio **con IVA** igual al de la carta, nombres de la
      carta, categorías para los chips. Alérgenos de la carta sin gluten si entra Cocina.
- [ ] Sala y cajeros creados según B1.
- [ ] Terminal preparado **en el taller** con `checklist-terminal.md` (WebView: el AP12 trae el 83 y
      hace falta ≥ 84).
- [ ] **Declaración responsable firmada** (tarea humana 4): Sirope va a cobrar con nuestro SIF.
- [ ] Contrato piloto con la cláusula 2 revisada (verifactu-1 §7.4) y modelo de representación,
      listos para firmar.

### B3 · En el local (lo que no se simula)

- [ ] Terminal en la wifi del local; zona horaria Europe/Madrid (sin SIM se va a Asia/Shanghai).
- [ ] **Impresora**: sólo sirve USB ESC/POS enchufada al terminal. Red, Bluetooth o fiscal
      propietaria → no sirve; llevar una térmica USB de 80 mm de repuesto (20 % de margen si se le
      vende). Ticket con serie, número, QR, leyenda y cabecera fiscal correcta.
- [ ] Modo avión 2 min: venta offline → reconecta → sube sola y su registro no se repite.
- [ ] Si hay dos cajas: expulsión pasiva y doble cobro simultáneo con dos terminales reales.
- [ ] Propietario: login, contraseña y PIN; renombrar la tienda.
- [ ] Formación: el cobro nace en la mesa, venta rápida en barra, devolución (y dónde ve el gestor
      el abono), arqueo X y cierre Z. El fiado no se enseña.

### B4 · Criterio de «desplegado» sin Holded

- [ ] Primera venta real de Sirope con su registro `C1/1`, visible en el panel de Facturación, y el
      ticket impreso con QR.
- [ ] Arqueo del primer turno que cuadra.
- [ ] Todas las puertas de B3 en verde.
- [ ] Teléfono de soporte en la barra.

Hasta entonces, Sirope está «validada en prueba», y se dice así.

---

## Hecho el 13-10 · Sirope ha dejado Holded (primer corte en producción)

- **SKU** (A3): los tres cambiados por SQL en producción con guardas. Quedan `CAF-DES-03-SG`,
  `CAF-DES-04-SG` y `SKU215-Z`. Después la previsualización salió sin bloqueos.
- **Laboratorio fuera** (A1): el AP11-1006 (emparejamiento `wv`) revocado desde Dispositivos. La
  previsualización pasó a «Sin terminales activos emparejados». Queda el dispositivo «mipiacetpv ·
  modo prueba», que es el de «Probar TPV» y no factura.
- **Corte** (A5): 13-10-2026 a las 18:01:57 UTC. El panel dice «191 fichas pasan a ser suyas».
  Holded aparece como «Lo dejó · 13/10/2026», «Encender Holded» sale deshabilitado y la caja tiene
  la serie `C1` con 0 registros, «Íntegra».
- **Foto antes/después** (A6): el diff sólo toca a Cafetería Sirope, en tres sitios: el tenant
  (sin interruptor ni clave, con fecha de corte y sync `NOT_APPLICABLE`), el catálogo
  (121 + 70 de `HOLDED` a `LOCAL`, el resto de columnas idénticas) y el md5 de su catálogo. Los
  otros siete comercios no cambian ni un byte.
- **No se cobró venta de prueba**: la `C1/1` será la primera venta real de Sirope.

### Lo que ha salido para la Parte B

1. **El QR de la factura apunta al entorno de pruebas de la AEAT** y los registros no se remiten
   (lo dice el panel de Facturación). Hay que decidirlo antes de la primera venta real de Sirope.
   La Maestranza está igual.
2. **La razón social difiere entre pantallas**: el super-admin dice «Cafetería Sirope» y el panel de
   la dueña (Mi cuenta) «Gemma María Gómez Cid - Cafetería Sirope», con dirección en Avenida
   Francisco Aguirre 240, Talavera. Hay que comprobar cuál sale impresa en el ticket y dejar
   la de la titular.
3. **Mi cuenta de la dueña seguía diciendo «Conectada correctamente · última sincronización hace 6
   min»** con la suscripción suspendida. Se comprueba que tras el corte ya no lo dice.

### Para Sirope antes que nada
- [ ] Aviso corto a la dueña (A7).
