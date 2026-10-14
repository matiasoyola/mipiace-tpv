# Fouzia Attaoui Batah · deja Holded

Preparado el 14-10-2026, sobre el guion de `holded-desconectar-done.md` §9 y el corte de Sirope
del 13-10 (`checklist-sirope.md`), que fue el ensayo. Aquí sólo lo propio de Fouzia.

## ¿Y qué?

1. **Se para un sync que no sirve a nadie.** Fouzia está en DRAFT y sólo tiene una venta, de
   prueba, pero el servidor sigue llamando a su Holded **cada 15 minutos** (tablero, tarea
   humana 10). Es carga, ruido en los logs y una clave de Holded viva que no protege nada.
2. **Riesgo cero**: no tiene terminal activo, no tiene devoluciones y la única venta (37,50 €, el
   08-06, la hizo nuestro cajero `mipiacetpv-test-*`) es anterior a verifactu. El corte no puede
   estropear ninguna factura.
3. **Si vuelve como clienta, empieza ya por el camino bueno**: sin Holded, como La Maestranza y
   Sirope (decisión 23-09: autónomos sin Holded).

## Lo que ya se sabe (sin mirar hoy)

| | Dato | De dónde |
|---|---|---|
| Fichas | 52 | copia de prod del 24-09 (`holded-desconectar-done` §2) |
| SKU repetidos | 0 | ídem — no hace falta SQL como en Sirope |
| Devoluciones pendientes | 0 | `abonos-holded-done` |
| Tickets | 1 · 37,50 € · cajero de pruebas · 08-06 | `verifactu-1b-done` |
| Terminales activos | 0 — sólo el dispositivo del modo prueba | `verifactu-1b-done` §4.2 |
| Sync con Holded | vivo, cada 15 min (al revés que Sirope, que estaba suspendido) | tablero 09-10 |
| Estado | DRAFT | tablero |

## F1 · La foto ANTES (desde el Mac)

Vale para dos cosas: confirmar que lo de arriba sigue siendo verdad y tener contra qué hacer el
diff.

```bash
cd ~/Developer/Claude/Projects/mipiacetpv && ssh root@76.13.142.28 'cd /opt/mipiacetpv && docker exec -i mipiacetpv-postgres sh -c "psql -U \$POSTGRES_USER -d \$POSTGRES_DB -P pager=off"' < docs/blocks/holded-desconectar-ensayo/foto.sql > ~/Desktop/fouzia-antes.txt && grep -i -A0 fouzia ~/Desktop/fouzia-antes.txt
```

- [ ] Fouzia sale con `holded_on = t`, `clave = t`, `dejo_holded` vacío.
- [ ] Sin SKU repetidos en la sección 3, sin `PENDING` ni `FAILED` suyos en la 6, sin turnos
      abiertos en la 7.

## F2 · La previsualización

Super-admin → Fouzia Attaoui Batah → **Dejar Holded**. Leerla entera.

- [ ] **Lo que puede bloquear y en Sirope no bloqueó: los datos fiscales.** Sirope tenía «NIF y
      razón social comprobados». Fouzia está en DRAFT y puede no tenerlos. Si bloquea por eso, se
      para aquí: rellenarlos exige datos de la clienta y eso depende de si sigue siéndolo.
- [ ] Terminal: debe decir «Sin terminales activos emparejados» (el del modo prueba no cuenta).
- [ ] Anotar fichas, contactos espejo, CRM y fiado que enseñe.

## F3 · El corte

- [ ] Teclear el nombre exacto del comercio y confirmar.

## F4 · Comprobar

```bash
cd ~/Developer/Claude/Projects/mipiacetpv && ssh root@76.13.142.28 'cd /opt/mipiacetpv && docker exec -i mipiacetpv-postgres sh -c "psql -U \$POSTGRES_USER -d \$POSTGRES_DB -P pager=off"' < docs/blocks/holded-desconectar-ensayo/foto.sql > ~/Desktop/fouzia-despues.txt && diff ~/Desktop/fouzia-antes.txt ~/Desktop/fouzia-despues.txt
```

- [ ] El diff **sólo toca a Fouzia**: tenant (sin interruptor ni clave, fecha de corte, sync
      `NOT_APPLICABLE`), catálogo (de `HOLDED` a `LOCAL`) y el md5 de su catálogo. Si cambia
      cualquier otro comercio o quedan `PENDING` en `holded_uploads`, se para.
- [ ] Panel de Fouzia → Catálogo: fichas con «Editar», sin «De Holded».
- [ ] Super-admin → Facturación: su caja con serie y **0 registros**.
- [ ] **No se cobra venta de prueba** (igual que en Sirope): sería una factura real con su NIF.
- [ ] A los 15 minutos, en los logs del API ya no aparece el sync de Fouzia.

## F5 · Después

- [ ] Tablero de Dirección §6: Fouzia fuera de Holded; tarea humana 10 sólo queda para Las Lomas
      (y Cachitos, que sigue sincronizando).
- [ ] **Su suscripción de Holded** no se toca desde aquí: el corte no la cancela ni borra nada en
      Holded. Cancelarla es cosa de la clienta.
- [ ] **Aviso a la clienta**: sólo si sigue siéndolo (ver la decisión abierta).

## Decisión (14-10, Matías)

**Fouzia sigue siendo clienta.** Pasa al TPV sin Holded y **se le regalan unos meses de cuota**
(número de meses por cerrar). Se sigue este checklist tal cual, con el aviso del §9.4 adaptado:
precios desde Catálogo, factura simplificada `C1`, devoluciones con su gestor, sin vuelta atrás
desde el panel, y los meses de cuota regalados.

## F1 · Resultado (14-10, 10:27)

Foto en `~/Desktop/fouzia-antes.txt`. Todo coincide con lo esperado: Holded encendido con clave y
sync `DONE`; 52 productos `HOLDED` con enlace y 52 SKU distintos; sin SKU repetidos; 1 ticket
`TEST` de 37,50 €; 1 subida `SKIPPED` y ningún `PENDING`; sin turnos abiertos; 8 contactos, 0 CRM,
0 fiado; Caja 1 con serie `C1` y 0 registros; md5 del catálogo `70ae6854…`, igual que el 24-09.

## F2 · Hallazgo (14-10, 10:40) · en DRAFT no hay botón

- El super-admin pinta «Dejar Holded» **sólo en ACTIVE** (`TenantDetailPage.tsx`: en DRAFT la
  página enseña Salud, Modo prueba y Activar, y no el bloque de acciones). La API
  (`holded/dejar-holded.ts`) no mira el estado: es un límite de la pantalla, no de la regla.
- **Su Holded tiene la suscripción suspendida** («el sync está parado»), como Sirope. El tablero
  decía que seguía sincronizando cada 15 min: es falso.
- Datos fiscales: «Fouzia Attaoui Batah» · NIF `02333696R` → la previsualización no se parará por
  esto. Todos los checks del onboarding, en verde.
- Camino: **Activar cuenta** (crea el OWNER, le manda el email con credenciales y purga el ticket
  de prueba) → la ficha pasa a ACTIVE → **Dejar Holded**. Activar es irreversible y el email le
  llega en el acto: va después de hablar con ella.

## F3 · Corte hecho (14-10-2026, 08:57:10 UTC)

- **En DRAFT, sin activar la cuenta**: se llamó a la API desde la sesión de super-admin
  (`GET` y luego `POST /super-admin/tenants/:id/dejar-holded` con el nombre tecleado), porque la
  pantalla no pinta el botón en DRAFT. Así no sale el email de activación a la clienta.
- Previsualización: `puedeArrancar: true`, sin bloqueos. 52 fichas (52 productos, 0 servicios),
  52 SKU intactos, 0 IVA sin resolver, sin ventas en vuelo, 8 contactos, 0 CRM, 0 deuda, suelo
  fiscal OK, Caja 1 serie `C1` 0 registros, sin terminales.
- Respuesta: `cortado: true`, 52 productos convertidos, 0 SKU acuñados, 0 subidas huérfanas, colas
  vacías, tarea repetible del sync quitada, sin errores.
- Comprobado en código antes del corte: tras él, `holdedEnabled = false` y los checks de Holded del
  onboarding dejan de aplicar, así que **«Activar cuenta» sigue disponible** para cuando se hable
  con ella.
- Defecto para la cola: el botón «Dejar Holded» no sale en DRAFT aunque la API lo admite.
