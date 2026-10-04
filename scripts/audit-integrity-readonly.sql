-- MolitaliaAPK · Auditoría de integridad NO DESTRUCTIVA
-- Solo SELECT. No corrige, elimina ni modifica información.
-- Puede ejecutarse completa en DBeaver sobre molitalia_db.

BEGIN TRANSACTION READ ONLY;

-- 1) Resumen de registros huérfanos.
WITH audit AS (
  SELECT 'sales.promoter_id -> users.id' AS relation, COUNT(*)::bigint AS orphan_count
  FROM sales s LEFT JOIN users u ON u.id=s.promoter_id
  WHERE NULLIF(s.promoter_id,'') IS NOT NULL AND u.id IS NULL
  UNION ALL
  SELECT 'sales.client_id -> clients.id', COUNT(*) FROM sales s LEFT JOIN clients c ON c.id=s.client_id
  WHERE NULLIF(s.client_id,'') IS NOT NULL AND c.id IS NULL
  UNION ALL
  SELECT 'sales.market_id -> markets.id', COUNT(*) FROM sales s LEFT JOIN markets m ON m.id=s.market_id
  WHERE NULLIF(s.market_id,'') IS NOT NULL AND m.id IS NULL
  UNION ALL
  SELECT 'clients.market_id -> markets.id', COUNT(*) FROM clients c LEFT JOIN markets m ON m.id=c.market_id
  WHERE NULLIF(c.market_id,'') IS NOT NULL AND m.id IS NULL
  UNION ALL
  SELECT 'attendance.promoter_id -> users.id', COUNT(*) FROM attendance a LEFT JOIN users u ON u.id=a.promoter_id
  WHERE NULLIF(a.promoter_id,'') IS NOT NULL AND u.id IS NULL
  UNION ALL
  SELECT 'attendance.client_id -> clients.id', COUNT(*) FROM attendance a LEFT JOIN clients c ON c.id=a.client_id
  WHERE NULLIF(a.client_id,'') IS NOT NULL AND c.id IS NULL
  UNION ALL
  SELECT 'attendance.market_id -> markets.id', COUNT(*) FROM attendance a LEFT JOIN markets m ON m.id=a.market_id
  WHERE NULLIF(a.market_id,'') IS NOT NULL AND m.id IS NULL
  UNION ALL
  SELECT 'session_closures.promoter_id -> users.id', COUNT(*) FROM session_closures sc LEFT JOIN users u ON u.id=sc.promoter_id
  WHERE NULLIF(sc.promoter_id,'') IS NOT NULL AND u.id IS NULL
  UNION ALL
  SELECT 'session_closures.market_id -> markets.id', COUNT(*) FROM session_closures sc LEFT JOIN markets m ON m.id=sc.market_id
  WHERE NULLIF(sc.market_id,'') IS NOT NULL AND m.id IS NULL
  UNION ALL
  SELECT 'session_closures.client_id -> clients.id', COUNT(*) FROM session_closures sc LEFT JOIN clients c ON c.id=sc.client_id
  WHERE NULLIF(sc.client_id,'') IS NOT NULL AND c.id IS NULL
  UNION ALL
  SELECT 'inventory.market_id -> markets.id (histórico)', COUNT(*) FROM inventory i LEFT JOIN markets m ON m.id=i.market_id
  WHERE NULLIF(i.market_id,'') IS NOT NULL AND m.id IS NULL
  UNION ALL
  SELECT 'inventory_movements.market_id -> markets.id (histórico/eventos)', COUNT(*) FROM inventory_movements im LEFT JOIN markets m ON m.id=im.market_id
  WHERE NULLIF(im.market_id,'') IS NOT NULL AND m.id IS NULL
  UNION ALL
  SELECT 'inventory_movements.actor_id -> users.id', COUNT(*) FROM inventory_movements im LEFT JOIN users u ON u.id=im.actor_id
  WHERE NULLIF(im.actor_id,'') IS NOT NULL AND im.actor_id NOT IN ('ADMIN','SYNC','SYSTEM') AND u.id IS NULL
  UNION ALL
  SELECT 'assignments.promoter_id -> users.id', COUNT(*) FROM assignments a LEFT JOIN users u ON u.id=a.promoter_id
  WHERE NULLIF(a.promoter_id,'') IS NOT NULL AND u.id IS NULL
  UNION ALL
  SELECT 'warehouse_movements.warehouse_id -> warehouses.id', COUNT(*) FROM warehouse_movements wm LEFT JOIN warehouses w ON w.id=wm.warehouse_id
  WHERE w.id IS NULL
  UNION ALL
  SELECT 'warehouse_movements.actor_id -> users.id', COUNT(*) FROM warehouse_movements wm LEFT JOIN users u ON u.id=wm.actor_id
  WHERE NULLIF(wm.actor_id,'') IS NOT NULL AND wm.actor_id NOT IN ('ADMIN','SYNC','SYSTEM') AND u.id IS NULL
  UNION ALL
  SELECT 'trade_approvals.promoter_id -> users.id', COUNT(*) FROM trade_approvals ta LEFT JOIN users u ON u.id=ta.promoter_id
  WHERE NULLIF(ta.promoter_id,'') IS NOT NULL AND u.id IS NULL
  UNION ALL
  SELECT 'trade_approvals.client_id -> clients.id', COUNT(*) FROM trade_approvals ta LEFT JOIN clients c ON c.id=ta.client_id
  WHERE NULLIF(ta.client_id,'') IS NOT NULL AND c.id IS NULL
  UNION ALL
  SELECT 'trade_approvals.market_id -> markets.id', COUNT(*) FROM trade_approvals ta LEFT JOIN markets m ON m.id=ta.market_id
  WHERE NULLIF(ta.market_id,'') IS NOT NULL AND m.id IS NULL
)
SELECT relation, orphan_count,
       CASE WHEN orphan_count=0 THEN 'OK' ELSE 'REVISAR' END AS estado
FROM audit
ORDER BY orphan_count DESC, relation;

-- 2) Mercados con warehouseId inválido o sin almacén operativo.
SELECT
  m.id AS market_id,
  m.name AS market_name,
  m.data->>'warehouseId' AS warehouse_id,
  CASE
    WHEN COALESCE(m.data->>'warehouseId','')='' THEN 'SIN_WAREHOUSE_ID'
    WHEN w.id IS NULL THEN 'WAREHOUSE_NO_EXISTE'
    WHEN w.status<>'ACTIVO' THEN 'WAREHOUSE_INACTIVO'
    ELSE 'OK'
  END AS estado
FROM markets m
LEFT JOIN warehouses w ON w.id=m.data->>'warehouseId'
WHERE m.status='ACTIVO'
  AND (
    COALESCE(m.data->>'warehouseId','')=''
    OR w.id IS NULL
    OR w.status<>'ACTIVO'
  )
ORDER BY m.name;

-- 3) Mercados asignados a más de un almacén por el arreglo legacy market_ids.
SELECT market_id, COUNT(*) AS warehouses_asignados, array_agg(warehouse_id ORDER BY warehouse_id) AS warehouse_ids
FROM (
  SELECT w.id AS warehouse_id, unnest(w.market_ids) AS market_id
  FROM warehouses w
  WHERE w.status='ACTIVO'
) x
GROUP BY market_id
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC, market_id;

-- 4) IDs de mercado almacenados en warehouses.market_ids que ya no existen.
SELECT w.id AS warehouse_id, w.name AS warehouse_name, x.market_id
FROM warehouses w
CROSS JOIN LATERAL unnest(w.market_ids) AS x(market_id)
LEFT JOIN markets m ON m.id=x.market_id
WHERE m.id IS NULL
ORDER BY w.name, x.market_id;

-- 5) Asignaciones con mercados inexistentes.
SELECT a.promoter_id, x.market_id
FROM assignments a
CROSS JOIN LATERAL unnest(a.market_ids) AS x(market_id)
LEFT JOIN markets m ON m.id=x.market_id
WHERE m.id IS NULL
ORDER BY a.promoter_id, x.market_id;

-- 6) Asignaciones con clientes inexistentes.
SELECT a.promoter_id, x.client_id
FROM assignments a
CROSS JOIN LATERAL unnest(a.client_ids) AS x(client_id)
LEFT JOIN clients c ON c.id=x.client_id
WHERE c.id IS NULL
ORDER BY a.promoter_id, x.client_id;

-- 7) Cliente asignado en assignments a un mercado que no corresponde al cliente.
SELECT a.promoter_id, c.id AS client_id, c.name AS client_name, c.market_id AS client_market_id, a.market_ids
FROM assignments a
CROSS JOIN LATERAL unnest(a.client_ids) AS x(client_id)
JOIN clients c ON c.id=x.client_id
WHERE NOT (c.market_id=ANY(a.market_ids))
ORDER BY a.promoter_id, c.name;

-- 8) Stock operativo de almacenes: valores negativos o claves inesperadas.
SELECT
  w.id,
  w.name,
  w.stock,
  k.key AS item,
  k.value AS raw_value
FROM warehouses w
CROSS JOIN LATERAL jsonb_each_text(COALESCE(w.stock,'{}'::jsonb)) k
WHERE
  CASE WHEN k.value ~ '^-?[0-9]+(?:\.[0-9]+)?$' THEN k.value::numeric < 0 ELSE true END
  OR k.key NOT IN ('PANETON_900G','PANETON_85G','AVENA','BATEA','MANDIL','SPAGHETTI')
ORDER BY w.name, k.key;

-- 9) Almacenes activos sin las seis claves de stock operativo.
SELECT
  w.id,
  w.name,
  ARRAY(
    SELECT required_key
    FROM unnest(ARRAY['PANETON_900G','PANETON_85G','AVENA','BATEA','MANDIL','SPAGHETTI']) required_key
    WHERE NOT (COALESCE(w.stock,'{}'::jsonb) ? required_key)
  ) AS claves_faltantes
FROM warehouses w
WHERE w.status='ACTIVO'
  AND EXISTS (
    SELECT 1
    FROM unnest(ARRAY['PANETON_900G','PANETON_85G','AVENA','BATEA','MANDIL','SPAGHETTI']) required_key
    WHERE NOT (COALESCE(w.stock,'{}'::jsonb) ? required_key)
  )
ORDER BY w.name;

-- 10) Movimientos de almacén cuyo mercado difiere del mercado de referencia guardado.
SELECT wm.id, wm.warehouse_id, wm.kind, wm.item_id, wm.quantity,
       wm.data->>'marketId' AS movement_market_id
FROM warehouse_movements wm
LEFT JOIN markets m ON m.id=wm.data->>'marketId'
WHERE COALESCE(wm.data->>'marketId','')<>'' AND m.id IS NULL
ORDER BY wm.movement_date DESC;

-- 11) Resumen de tablas históricas que deben quedar SOLO como compatibilidad/histórico.
SELECT 'inventory' AS tabla, COUNT(*)::bigint AS registros FROM inventory
UNION ALL
SELECT 'inventory_movements', COUNT(*) FROM inventory_movements
UNION ALL
SELECT 'users_con_stock_legacy', COUNT(*) FROM users
 WHERE data ? 'tastingStock' OR data ? 'redemptionStock';

-- 12) Conteo general para poder comparar antes/después de cualquier hardening.
SELECT 'markets' AS tabla, COUNT(*)::bigint AS registros FROM markets
UNION ALL SELECT 'users', COUNT(*) FROM users
UNION ALL SELECT 'clients', COUNT(*) FROM clients
UNION ALL SELECT 'sales', COUNT(*) FROM sales
UNION ALL SELECT 'attendance', COUNT(*) FROM attendance
UNION ALL SELECT 'session_closures', COUNT(*) FROM session_closures
UNION ALL SELECT 'trade_approvals', COUNT(*) FROM trade_approvals
UNION ALL SELECT 'warehouses', COUNT(*) FROM warehouses
UNION ALL SELECT 'warehouse_movements', COUNT(*) FROM warehouse_movements
UNION ALL SELECT 'inventory', COUNT(*) FROM inventory
UNION ALL SELECT 'inventory_movements', COUNT(*) FROM inventory_movements
UNION ALL SELECT 'assignments', COUNT(*) FROM assignments
UNION ALL SELECT 'product_prices', COUNT(*) FROM product_prices
UNION ALL SELECT 'client_categories', COUNT(*) FROM client_categories
ORDER BY tabla;

ROLLBACK;
