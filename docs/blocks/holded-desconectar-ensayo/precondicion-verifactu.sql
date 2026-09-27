-- verifactu-1 §7.2 · la precondición que ABORTA la migración, comprobada
-- ANTES de lanzarla. Se corre tal cual sobre producción.
--
-- La migración `20260924000000_verifactu_1_registro` se para si alguna caja
-- tiene más de un TERMINAL activo, y no revoca nada por su cuenta: decidir
-- cuál se queda no es cosa de una migración.
SELECT t.name AS comercio, s.name AS tienda, r.name AS caja, r.id AS caja_id,
       count(*) AS terminales_activos
FROM devices d
JOIN registers r ON r.id = d.register_id
JOIN stores s ON s.id = r.store_id
JOIN tenants t ON t.id = s.tenant_id
WHERE d.revoked_at IS NULL
  -- verifactu-1b · el dispositivo del modo prueba NO es un terminal de caja
  -- y no compite por la cadena. Antes de la migración la columna `kind` no
  -- existe todavía, así que aquí se filtra por el user-agent que lo crea.
  AND d.user_agent <> 'internal/mipiacetpv-test'
GROUP BY 1,2,3,4
HAVING count(*) > 1
ORDER BY 5 DESC;
