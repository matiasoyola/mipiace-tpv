-- holded-desconectar · la FOTO de un comercio, antes y después del corte.
--
-- Se corre sobre la copia de producción restaurada en
-- `mipiacetpv_ensayo_holded` y, el día del despliegue, sobre producción.
-- Mismo SQL las dos veces: una foto que se toma con una consulta distinta
-- antes y después no compara nada.
--
-- Todo agregado por tenant: ningún dato personal sale de aquí.

\pset footer off

\echo '=== 1 · tenants: interruptor, clave y estado del sync ==='
SELECT name,
       holded_enabled            AS holded_on,
       (holded_api_key_ciphertext IS NOT NULL) AS clave,
       holded_disconnected_at    AS dejo_holded,
       initial_sync_status       AS sync
FROM tenants ORDER BY name;

\echo '=== 2 · catálogo por origen y tipo ==='
SELECT t.name, p.source, p.kind, count(*) AS n,
       count(*) FILTER (WHERE p.sku IS NULL OR p.sku = '') AS sin_sku,
       count(*) FILTER (WHERE p.active)                    AS activos,
       count(*) FILTER (WHERE p.sellable_via_tpv)          AS vendibles,
       count(*) FILTER (WHERE p.archived_from_holded_at IS NOT NULL) AS archivados,
       count(*) FILTER (WHERE p.holded_product_id IS NOT NULL)       AS con_enlace,
       count(DISTINCT p.sku)                               AS skus_distintos
FROM products p JOIN tenants t ON t.id = p.tenant_id
GROUP BY 1,2,3 ORDER BY 1,2,3;

\echo '=== 3 · SKU duplicados (el que pisa el índice parcial) ==='
SELECT t.name, p.sku, count(*) AS n
FROM products p JOIN tenants t ON t.id = p.tenant_id
GROUP BY 1,2 HAVING count(*) > 1 ORDER BY 1, 3 DESC;

\echo '=== 4 · tickets por estado, con la suma ==='
SELECT t.name, tk.status, count(*) AS n, round(sum(tk.total)::numeric, 2) AS suma
FROM tickets tk JOIN tenants t ON t.id = tk.tenant_id
GROUP BY 1,2 ORDER BY 1,2;

\echo '=== 5 · devoluciones por estado ==='
SELECT t.name, r.status, count(*) AS n, round(sum(r.total)::numeric, 2) AS suma
FROM refunds r JOIN tenants t ON t.id = r.tenant_id
GROUP BY 1,2 ORDER BY 1,2;

\echo '=== 6 · subidas a Holded ==='
SELECT t.name, hu.kind, hu.status, count(*) AS n
FROM holded_uploads hu JOIN tenants t ON t.id = hu.tenant_id
GROUP BY 1,2,3 ORDER BY 1,2,3;

\echo '=== 7 · turnos abiertos ==='
SELECT t.name, count(*) AS abiertos
FROM shifts s
JOIN registers r ON r.id = s.register_id
JOIN stores st ON st.id = r.store_id
JOIN tenants t ON t.id = st.tenant_id
WHERE s.closed_at IS NULL GROUP BY 1 ORDER BY 1;

\echo '=== 8 · contactos (espejo de Holded) y clientes del CRM ==='
SELECT t.name,
       (SELECT count(*) FROM contacts c WHERE c.tenant_id = t.id) AS contactos,
       (SELECT count(*) FROM contacts c WHERE c.tenant_id = t.id AND c.active) AS contactos_activos,
       (SELECT count(*) FROM clients cl WHERE cl.tenant_id = t.id) AS clientes_crm,
       (SELECT count(*) FROM clients cl WHERE cl.tenant_id = t.id AND cl.holded_contact_id IS NOT NULL) AS crm_con_enlace
FROM tenants t ORDER BY t.name;

\echo '=== 9 · fiado abierto ==='
SELECT t.name, count(*) AS on_credit,
       coalesce(round(sum(tk.credit_pending)::numeric, 2), 0) AS deuda_viva
FROM tickets tk JOIN tenants t ON t.id = tk.tenant_id
WHERE tk.status = 'ON_CREDIT' GROUP BY 1 ORDER BY 1;

\echo '=== 10 · citas futuras y servicios con agenda ==='
SELECT t.name,
       -- Una cita no tiene columna de inicio: el instante vive en el
       -- `slot` (tstzrange) de sus asignaciones, que es donde el motor de
       -- disponibilidad lo necesita. "Futura" = tiene alguna asignación
       -- activa que empieza de hoy en adelante.
       (SELECT count(DISTINCT a.id) FROM appointments a
          JOIN appointment_assignments aa ON aa.appointment_id = a.id
         WHERE a.tenant_id = t.id AND aa.active AND upper(aa.slot) >= now()) AS citas_futuras,
       (SELECT count(*) FROM service_scheduling ss WHERE ss.tenant_id = t.id) AS servicios_con_agenda
FROM tenants t ORDER BY t.name;

\echo '=== 11 · registros fiscales por caja (VERI*FACTU) ==='
SELECT t.name, r.name AS caja, r.fiscal_series AS serie,
       count(f.id) AS registros
FROM registers r
JOIN stores st ON st.id = r.store_id
JOIN tenants t ON t.id = st.tenant_id
LEFT JOIN fiscal_records f ON f.register_id = r.id
GROUP BY 1,2,3 ORDER BY 1,2;

\echo '=== 12 · huella del catálogo por tenant (para comparar al byte) ==='
-- md5 del catálogo ENTERO de cada comercio, campo a campo. Si el corte de
-- Sole tocara una sola fila de otro comercio, su md5 cambia.
SELECT t.name,
       md5(string_agg(
         p.id::text || '|' || p.source || '|' || coalesce(p.sku,'~') || '|' ||
         p.name || '|' || p.base_price::text || '|' || p.tax_rate::text || '|' ||
         coalesce(p.holded_product_id,'~') || '|' || p.active::text || '|' ||
         p.sellable_via_tpv::text || '|' || coalesce(p.archived_from_holded_at::text,'~'),
         E'\n' ORDER BY p.id)) AS md5_catalogo,
       count(*) AS filas
FROM products p JOIN tenants t ON t.id = p.tenant_id
GROUP BY 1 ORDER BY 1;
