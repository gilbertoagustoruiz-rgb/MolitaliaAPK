import { pool } from "./index";

/**
 * Esquema canónico de MolitaliaAPK.
 *
 * Política:
 * - CREATE TABLE / CREATE INDEX IF NOT EXISTS: nunca borra ni reemplaza datos.
 * - ALTER TABLE ... ADD COLUMN IF NOT EXISTS: solo completa columnas faltantes.
 * - inventory e inventory_movements se conservan por compatibilidad/histórico.
 * - El saldo operativo vive en warehouses.stock y warehouse_movements.
 */
export async function ensureDatabaseSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_metadata (
      key text PRIMARY KEY,
      value text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS app_storage_tombstones (
      collection text NOT NULL,
      record_id text NOT NULL,
      deleted_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(collection,record_id)
    );
    ALTER TABLE app_storage_tombstones ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
    ALTER TABLE app_storage_tombstones ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

    CREATE TABLE IF NOT EXISTS markets (
      id text PRIMARY KEY,
      name text NOT NULL DEFAULT '',
      region text,
      department text,
      province text,
      district text,
      status text NOT NULL DEFAULT 'ACTIVO',
      data jsonb NOT NULL DEFAULT '{}',
      record_updated_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS users (
      id text PRIMARY KEY,
      dni text NOT NULL UNIQUE,
      name text NOT NULL DEFAULT '',
      role text NOT NULL DEFAULT 'PROMOTOR',
      status text NOT NULL DEFAULT 'ACTIVO',
      password_hash text,
      data jsonb NOT NULL DEFAULT '{}',
      record_updated_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS clients (
      id text PRIMARY KEY,
      code text NOT NULL DEFAULT '',
      name text NOT NULL DEFAULT '',
      market_id text NOT NULL DEFAULT '',
      status text NOT NULL DEFAULT 'ACTIVO',
      data jsonb NOT NULL DEFAULT '{}',
      record_updated_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS sales (
      id text PRIMARY KEY,
      promoter_id text NOT NULL DEFAULT '',
      client_id text NOT NULL DEFAULT '',
      market_id text NOT NULL DEFAULT '',
      mode text NOT NULL DEFAULT '',
      units numeric NOT NULL DEFAULT 0,
      amount_soles numeric(14,2) NOT NULL DEFAULT 0,
      weight_kg numeric(14,3),
      sale_date timestamptz NOT NULL DEFAULT now(),
      status text NOT NULL DEFAULT 'SINCRONIZADA',
      receipt_photo text,
      exchange_photo text,
      redemption_rule_id text,
      data jsonb NOT NULL DEFAULT '{}',
      record_updated_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS redemption_rules (
      id text PRIMARY KEY,
      code text NOT NULL UNIQUE,
      name text NOT NULL,
      sale_mode text NOT NULL,
      quantity_basis text NOT NULL DEFAULT 'PLANCHAS',
      min_quantity numeric NOT NULL DEFAULT 0,
      max_quantity numeric,
      min_exclusive boolean NOT NULL DEFAULT false,
      repeatable boolean NOT NULL DEFAULT false,
      step_quantity numeric,
      eligible_skus text[] NOT NULL DEFAULT '{}',
      accessory text NOT NULL DEFAULT 'NINGUNO',
      items jsonb NOT NULL DEFAULT '{}',
      valid_from timestamptz,
      valid_to timestamptz,
      priority integer NOT NULL DEFAULT 100,
      status text NOT NULL DEFAULT 'ACTIVO',
      data jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE sales ADD COLUMN IF NOT EXISTS redemption_rule_id text;

    CREATE TABLE IF NOT EXISTS trade_approvals (
      id text PRIMARY KEY,
      promoter_id text NOT NULL DEFAULT '',
      client_id text NOT NULL DEFAULT '',
      market_id text NOT NULL DEFAULT '',
      status text NOT NULL DEFAULT 'PENDIENTE',
      requested_at timestamptz NOT NULL DEFAULT now(),
      resolved_at timestamptz,
      resolved_by text,
      resolution_comment text,
      data jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id text PRIMARY KEY,
      promoter_id text NOT NULL DEFAULT '',
      client_id text NOT NULL DEFAULT '',
      market_id text NOT NULL DEFAULT '',
      event_type text NOT NULL DEFAULT '',
      event_date timestamptz NOT NULL DEFAULT now(),
      status text NOT NULL DEFAULT 'SINCRONIZADA',
      photo text,
      data jsonb NOT NULL DEFAULT '{}',
      record_updated_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS promoter_location_tracking (
      id text PRIMARY KEY,
      promoter_id text NOT NULL DEFAULT '',
      market_id text NOT NULL DEFAULT '',
      client_id text NOT NULL DEFAULT '',
      event_type text NOT NULL DEFAULT 'TRACKING',
      reference_id text,
      latitude numeric(10,7) NOT NULL,
      longitude numeric(10,7) NOT NULL,
      accuracy_meters numeric(10,2),
      battery_level numeric(5,2),
      battery_charging boolean,
      online boolean NOT NULL DEFAULT true,
      source text NOT NULL DEFAULT 'BROWSER_GEOLOCATION',
      recorded_at timestamptz NOT NULL DEFAULT now(),
      synced_at timestamptz NOT NULL DEFAULT now(),
      data jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS promoter_tracking_diagnostics (
      id text PRIMARY KEY,
      promoter_id text NOT NULL DEFAULT '',
      market_id text NOT NULL DEFAULT '',
      client_id text NOT NULL DEFAULT '',
      event_type text NOT NULL DEFAULT 'TRACKING',
      error_code text NOT NULL DEFAULT 'UNKNOWN',
      message text NOT NULL DEFAULT '',
      recorded_at timestamptz NOT NULL DEFAULT now(),
      synced_at timestamptz NOT NULL DEFAULT now(),
      data jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS warehouses (
      id text PRIMARY KEY,
      name text NOT NULL DEFAULT '',
      location text,
      status text NOT NULL DEFAULT 'ACTIVO',
      market_ids text[] NOT NULL DEFAULT '{}',
      stock jsonb NOT NULL DEFAULT '{}',
      data jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS warehouse_movements (
      id text PRIMARY KEY,
      warehouse_id text NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
      kind text NOT NULL DEFAULT 'RECARGA',
      item_id text NOT NULL,
      quantity numeric NOT NULL DEFAULT 0,
      actor_id text NOT NULL DEFAULT '',
      movement_date timestamptz NOT NULL DEFAULT now(),
      data jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS transfers (
      id text PRIMARY KEY,
      source_warehouse_id text NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
      destination_warehouse_id text NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
      items jsonb NOT NULL DEFAULT '{}',
      note text,
      status text NOT NULL DEFAULT 'ACTIVO',
      actor_id text NOT NULL DEFAULT '',
      transfer_date timestamptz NOT NULL DEFAULT now(),
      data jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT transfers_distinct_warehouses CHECK (source_warehouse_id <> destination_warehouse_id)
    );

    -- LEGACY/HISTÓRICO. No es fuente de saldo operativo.
    CREATE TABLE IF NOT EXISTS inventory (
      market_id text PRIMARY KEY,
      tasting_stock numeric NOT NULL DEFAULT 0,
      redemption_stock jsonb NOT NULL DEFAULT '{}',
      data jsonb NOT NULL DEFAULT '{}',
      record_updated_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    -- Historial de eventos de canje/degustación. No es fuente de saldo operativo.
    CREATE TABLE IF NOT EXISTS inventory_movements (
      id text PRIMARY KEY,
      market_id text NOT NULL DEFAULT '',
      kind text NOT NULL DEFAULT '',
      item_id text,
      quantity numeric NOT NULL DEFAULT 0,
      actor_id text NOT NULL DEFAULT '',
      movement_date timestamptz NOT NULL DEFAULT now(),
      status text NOT NULL DEFAULT 'SINCRONIZADA',
      data jsonb NOT NULL DEFAULT '{}',
      record_updated_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS assignments (
      promoter_id text PRIMARY KEY,
      promoter_dni text,
      market_ids text[] NOT NULL DEFAULT '{}',
      client_ids text[] NOT NULL DEFAULT '{}',
      data jsonb NOT NULL DEFAULT '{}',
      record_updated_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS session_closures (
      id text PRIMARY KEY,
      promoter_id text NOT NULL DEFAULT '',
      market_id text NOT NULL DEFAULT '',
      client_id text,
      tasting_used numeric NOT NULL DEFAULT 0,
      leads numeric NOT NULL DEFAULT 0,
      closure_date timestamptz NOT NULL DEFAULT now(),
      status text NOT NULL DEFAULT 'SINCRONIZADA',
      data jsonb NOT NULL DEFAULT '{}',
      record_updated_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS product_prices (
      sku text PRIMARY KEY,
      product text NOT NULL DEFAULT '',
      units_per_package numeric NOT NULL DEFAULT 0,
      unit_price numeric(14,2) NOT NULL DEFAULT 0,
      total_price numeric(14,2) NOT NULL DEFAULT 0,
      data jsonb NOT NULL DEFAULT '{}',
      record_updated_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      sale_id text NOT NULL,
      line_no integer NOT NULL,
      sku text NOT NULL,
      product_name text NOT NULL DEFAULT '',
      quantity numeric NOT NULL DEFAULT 0,
      unit_price numeric(14,2) NOT NULL DEFAULT 0,
      amount_soles numeric(14,2) NOT NULL DEFAULT 0,
      mode text NOT NULL DEFAULT '',
      presentation text,
      data jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (sale_id,line_no)
    );

    -- Backfill aditivo: normaliza únicamente ventas cuyo SKU ya está explícito.
    -- La venta original en sales.data nunca se modifica ni se elimina.
    INSERT INTO sale_items
      (sale_id,line_no,sku,product_name,quantity,unit_price,amount_soles,mode,presentation,data)
    SELECT
      s.id,
      lines.ordinality::integer,
      lines.item->>'sku',
      COALESCE(lines.item->>'product',''),
      COALESCE(NULLIF(lines.item->>'units','')::numeric,0),
      COALESCE(NULLIF(lines.item->>'unitPrice','')::numeric,0),
      COALESCE(NULLIF(lines.item->>'units','')::numeric,0) *
        COALESCE(NULLIF(lines.item->>'unitPrice','')::numeric,0),
      s.mode,
      NULLIF(lines.item->>'presentation',''),
      lines.item
    FROM sales s
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(s.data->'planchaLines')='array' THEN s.data->'planchaLines'
        ELSE '[]'::jsonb
      END
    ) WITH ORDINALITY AS lines(item,ordinality)
    WHERE COALESCE(lines.item->>'sku','') <> ''
    ON CONFLICT (sale_id,line_no) DO NOTHING;

    INSERT INTO sale_items
      (sale_id,line_no,sku,product_name,quantity,unit_price,amount_soles,mode,presentation,data)
    SELECT
      s.id,
      1,
      unit_price.key,
      COALESCE(p.product,s.data->>'product',''),
      s.units,
      COALESCE(NULLIF(unit_price.value,'')::numeric,0),
      s.units * COALESCE(NULLIF(unit_price.value,'')::numeric,0),
      s.mode,
      NULLIF(s.data->>'presentation',''),
      jsonb_build_object(
        'sku',unit_price.key,
        'quantity',s.units,
        'unitPrice',COALESCE(NULLIF(unit_price.value,'')::numeric,0),
        'source','historical-unitPrices'
      )
    FROM sales s
    CROSS JOIN LATERAL (
      SELECT key,value
      FROM jsonb_each_text(
        CASE
          WHEN jsonb_typeof(s.data->'unitPrices')='object' THEN s.data->'unitPrices'
          ELSE '{}'::jsonb
        END
      )
      ORDER BY key
      LIMIT 1
    ) AS unit_price
    LEFT JOIN product_prices p ON p.sku=unit_price.key
    WHERE s.mode='UNIDADES'
      AND NOT EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id=s.id)
    ON CONFLICT (sale_id,line_no) DO NOTHING;

    CREATE TABLE IF NOT EXISTS client_categories (
      id text PRIMARY KEY,
      name text NOT NULL UNIQUE,
      status text NOT NULL DEFAULT 'ACTIVO',
      data jsonb NOT NULL DEFAULT '{}',
      record_updated_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    INSERT INTO client_categories (id,name,status,data,record_updated_at)
    VALUES
      ('MIXTO','MIXTO','ACTIVO','{"id":"MIXTO","name":"MIXTO","status":"ACTIVO"}',now()),
      ('CONFETI','CONFETI','ACTIVO','{"id":"CONFETI","name":"CONFETI","status":"ACTIVO"}',now())
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO redemption_rules (
      id,code,name,sale_mode,quantity_basis,min_quantity,max_quantity,min_exclusive,
      repeatable,step_quantity,eligible_skus,accessory,items,priority,status,data
    ) VALUES
      (
        'RR-ESC-001','ESCALA_1','Escala 1','PLANCHAS','UNITS',24,24,false,
        false,null,ARRAY['TODINNITO-85','MINI-COSTA-MINIONS-80','MINI-COSTA-JURASSIC-80'],
        'NINGUNO','{"AVENA":2}'::jsonb,10,'ACTIVO',
        '{"description":"24 unidades mini = 1/2 plancha"}'::jsonb
      ),
      (
        'RR-ESC-002','ESCALA_2','Escala 2','UNIDADES','UNITS',1,2,false,
        true,1,ARRAY[]::text[],
        'NINGUNO','{"AVENA":1}'::jsonb,20,'ACTIVO',
        '{"description":"1 unidad = 1 Avena; 2 unidades = 2 Avenas; de 3 a 5 unidades ver Escala 2 · 3 a 5; no aplica a minis 80/85 g"}'::jsonb
      ),
      (
        'RR-ESC-003','ESCALA_3','Escala 3','PLANCHAS','PLANCHAS',1,1,false,
        false,null,ARRAY[]::text[],'NINGUNO','{"AVENA":3,"SPAGHETTI":1}'::jsonb,30,'ACTIVO','{}'::jsonb
      ),
      (
        'RR-ESC-004','ESCALA_4','Escala 4','PLANCHAS','PLANCHAS',4,4,false,
        false,null,ARRAY[]::text[],'NINGUNO','{"AVENA":12,"SPAGHETTI":3}'::jsonb,40,'ACTIVO','{}'::jsonb
      ),
      (
        'RR-ESC-005','ESCALA_5','Escala 5','PLANCHAS','PLANCHAS',10,10,false,
        false,null,ARRAY[]::text[],'NINGUNO','{"AVENA":24,"SPAGHETTI":10}'::jsonb,50,'ACTIVO','{}'::jsonb
      ),
      (
        'RR-ESC-005-M','ESCALA_5_MANDIL','Escala 5 + Mandil','PLANCHAS','PLANCHAS',10,10,false,
        false,null,ARRAY[]::text[],'MANDIL','{"AVENA":24,"SPAGHETTI":10,"MANDIL":1}'::jsonb,51,'ACTIVO','{}'::jsonb
      ),
      (
        'RR-ESC-005-B','ESCALA_5_BATEA','Escala 5 + Batea','PLANCHAS','PLANCHAS',10,10,false,
        false,null,ARRAY[]::text[],'BATEA','{"AVENA":24,"SPAGHETTI":10,"BATEA":1}'::jsonb,52,'ACTIVO','{}'::jsonb
      ),
      (
        'RR-ESC-006','ESCALA_6','Escala 6','PLANCHAS','PLANCHAS',80,null,true,
        false,null,ARRAY[]::text[],'NINGUNO','{"AVENA":144,"SPAGHETTI":100}'::jsonb,60,'ACTIVO','{}'::jsonb
      ),
      (
        'RR-ESC-006-M','ESCALA_6_MANDIL','Escala 6 + Mandil','PLANCHAS','PLANCHAS',80,null,true,
        false,null,ARRAY[]::text[],'MANDIL','{"AVENA":144,"SPAGHETTI":100,"MANDIL":4}'::jsonb,61,'ACTIVO','{}'::jsonb
      ),
      (
        'RR-ESC-006-B','ESCALA_6_BATEA','Escala 6 + Batea','PLANCHAS','PLANCHAS',80,null,true,
        false,null,ARRAY[]::text[],'BATEA','{"AVENA":144,"SPAGHETTI":100,"BATEA":4}'::jsonb,62,'ACTIVO','{}'::jsonb
      )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO redemption_rules (
      id,code,name,sale_mode,quantity_basis,min_quantity,max_quantity,min_exclusive,
      repeatable,step_quantity,eligible_skus,accessory,items,priority,status,data
    ) VALUES
      (
        'RR-ESC-003-2-3','ESCALA_3_2_3','Escala 3 · 2 a 3 planchas','PLANCHAS','PLANCHAS',2,3,false,
        false,null,ARRAY[]::text[],'NINGUNO','{"AVENA":6,"SPAGHETTI":2}'::jsonb,31,'ACTIVO',
        '{"description":"Compatibilidad con dinámica anterior para 2-3 planchas"}'::jsonb
      ),
      (
        'RR-ESC-004-5-7','ESCALA_4_5_7','Escala 4 · 5 a 7 planchas','PLANCHAS','PLANCHAS',5,7,false,
        false,null,ARRAY[]::text[],'NINGUNO','{"AVENA":15,"SPAGHETTI":4}'::jsonb,41,'ACTIVO',
        '{"description":"Compatibilidad con dinámica anterior para 5-7 planchas"}'::jsonb
      ),
      (
        'RR-ESC-004-8-9','ESCALA_4_8_9','Escala 4 · 8 a 9 planchas','PLANCHAS','PLANCHAS',8,9,false,
        false,null,ARRAY[]::text[],'NINGUNO','{"AVENA":24,"SPAGHETTI":6}'::jsonb,42,'ACTIVO',
        '{"description":"Compatibilidad con dinámica anterior para 8-9 planchas"}'::jsonb
      ),
      (
        'RR-ESC-005-11-13','ESCALA_5_11_13','Escala 5 · 11 a 13 planchas','PLANCHAS','PLANCHAS',11,13,false,
        false,null,ARRAY[]::text[],'NINGUNO','{"AVENA":27,"SPAGHETTI":11}'::jsonb,53,'ACTIVO','{}'::jsonb
      ),
      (
        'RR-ESC-005-11-13-M','ESCALA_5_11_13_MANDIL','Escala 5 · 11 a 13 + Mandil','PLANCHAS','PLANCHAS',11,13,false,
        false,null,ARRAY[]::text[],'MANDIL','{"AVENA":27,"SPAGHETTI":11,"MANDIL":1}'::jsonb,54,'ACTIVO','{}'::jsonb
      ),
      (
        'RR-ESC-005-11-13-B','ESCALA_5_11_13_BATEA','Escala 5 · 11 a 13 + Batea','PLANCHAS','PLANCHAS',11,13,false,
        false,null,ARRAY[]::text[],'BATEA','{"AVENA":27,"SPAGHETTI":11,"BATEA":1}'::jsonb,55,'ACTIVO','{}'::jsonb
      ),
      (
        'RR-ESC-005-14-19','ESCALA_5_14_19','Escala 5 · 14 a 19 planchas','PLANCHAS','PLANCHAS',14,19,false,
        false,null,ARRAY[]::text[],'NINGUNO','{"AVENA":36,"SPAGHETTI":13}'::jsonb,56,'ACTIVO','{}'::jsonb
      ),
      (
        'RR-ESC-005-14-19-M','ESCALA_5_14_19_MANDIL','Escala 5 · 14 a 19 + Mandil','PLANCHAS','PLANCHAS',14,19,false,
        false,null,ARRAY[]::text[],'MANDIL','{"AVENA":36,"SPAGHETTI":13,"MANDIL":1}'::jsonb,57,'ACTIVO','{}'::jsonb
      ),
      (
        'RR-ESC-005-14-19-B','ESCALA_5_14_19_BATEA','Escala 5 · 14 a 19 + Batea','PLANCHAS','PLANCHAS',14,19,false,
        false,null,ARRAY[]::text[],'BATEA','{"AVENA":36,"SPAGHETTI":13,"BATEA":1}'::jsonb,58,'ACTIVO','{}'::jsonb
      ),
      (
        'RR-ESC-005-20-79','ESCALA_5_20_79','Escala 5 · 20 a 79 planchas','PLANCHAS','PLANCHAS',20,79,false,
        false,null,ARRAY[]::text[],'NINGUNO','{"AVENA":48,"SPAGHETTI":20}'::jsonb,59,'ACTIVO','{}'::jsonb
      ),
      (
        'RR-ESC-005-20-79-M','ESCALA_5_20_79_MANDIL','Escala 5 · 20 a 79 + Mandil','PLANCHAS','PLANCHAS',20,79,false,
        false,null,ARRAY[]::text[],'MANDIL','{"AVENA":48,"SPAGHETTI":20,"MANDIL":2}'::jsonb,59,'ACTIVO','{}'::jsonb
      ),
      (
        'RR-ESC-005-20-79-B','ESCALA_5_20_79_BATEA','Escala 5 · 20 a 79 + Batea','PLANCHAS','PLANCHAS',20,79,false,
        false,null,ARRAY[]::text[],'BATEA','{"AVENA":48,"SPAGHETTI":20,"BATEA":2}'::jsonb,59,'ACTIVO','{}'::jsonb
      )
    ON CONFLICT (id) DO NOTHING;

    -- Escala SOLO AVENA: en todos los almacenes, el promotor la elige en cada venta.
    INSERT INTO redemption_rules (
      id,code,name,sale_mode,quantity_basis,min_quantity,max_quantity,min_exclusive,
      repeatable,step_quantity,eligible_skus,accessory,items,priority,status,data
    ) VALUES
      ('RR-SAV-MINI-HALF','SAV_MINI_MEDIA','Solo Avena · Minis 1/2 plancha','PLANCHAS','UNITS',24,24,false,false,null,ARRAY['TODINNITO-85','MINI-COSTA-MINIONS-80','MINI-COSTA-JURASSIC-80'],'NINGUNO','{"AVENA":2}'::jsonb,10,'ACTIVO','{"program":"SOLO_AVENA","description":"Minis: 1/2 plancha (24 und) = 2 Avenas"}'::jsonb),
      ('RR-SAV-MINI-1','SAV_MINI_1','Solo Avena · Minis 1 plancha o más','PLANCHAS','PLANCHAS',1,null,false,false,null,ARRAY['TODINNITO-85','MINI-COSTA-MINIONS-80','MINI-COSTA-JURASSIC-80'],'NINGUNO','{"AVENA":4}'::jsonb,5,'ACTIVO','{"program":"SOLO_AVENA","description":"Minis: 1 plancha o más = 4 Avenas"}'::jsonb),
      ('RR-SAV-UNI-1-2','SAV_UNI_1_2','Solo Avena · 1 a 2 unidades','UNIDADES','UNITS',1,2,false,true,1,ARRAY[]::text[],'NINGUNO','{"AVENA":1}'::jsonb,20,'ACTIVO','{"program":"SOLO_AVENA","description":"1 unidad = 1 Avena; 2 unidades = 2 Avenas"}'::jsonb),
      ('RR-SAV-UNI-3-5','SAV_UNI_3_5','Solo Avena · 3 a 5 unidades','UNIDADES','UNITS',3,5,false,false,null,ARRAY[]::text[],'NINGUNO','{"AVENA":2}'::jsonb,21,'ACTIVO','{"program":"SOLO_AVENA","description":"3 a 5 unidades = 2 Avenas"}'::jsonb),
      ('RR-SAV-P1','SAV_PLANCHAS_1','Solo Avena · 1 a 3 planchas','PLANCHAS','PLANCHAS',1,3,false,false,null,ARRAY[]::text[],'NINGUNO','{"AVENA":6}'::jsonb,30,'ACTIVO','{"program":"SOLO_AVENA","description":"1 a 3 planchas = 6 Avenas"}'::jsonb),
      ('RR-SAV-P4','SAV_PLANCHAS_4','Solo Avena · 4 a 9 planchas','PLANCHAS','PLANCHAS',4,9,false,false,null,ARRAY[]::text[],'NINGUNO','{"AVENA":24}'::jsonb,30,'ACTIVO','{"program":"SOLO_AVENA","description":"4 a 9 planchas = 24 Avenas"}'::jsonb),
      ('RR-SAV-P10','SAV_PLANCHAS_10','Solo Avena · 10 a 79 planchas','PLANCHAS','PLANCHAS',10,79,false,false,null,ARRAY[]::text[],'NINGUNO','{"AVENA":60}'::jsonb,30,'ACTIVO','{"program":"SOLO_AVENA","description":"10 a 79 planchas = 60 Avenas"}'::jsonb),
      ('RR-SAV-P10-B','SAV_PLANCHAS_10_B','Solo Avena · 10 a 79 planchas + Batea','PLANCHAS','PLANCHAS',10,79,false,false,null,ARRAY[]::text[],'BATEA','{"AVENA":50,"BATEA":1}'::jsonb,31,'ACTIVO','{"program":"SOLO_AVENA","description":"10 a 79 planchas = 50 Avenas + 1 Batea"}'::jsonb),
      ('RR-SAV-P80','SAV_PLANCHAS_80','Solo Avena · 80 planchas o más','PLANCHAS','PLANCHAS',80,null,false,false,null,ARRAY[]::text[],'NINGUNO','{"AVENA":432}'::jsonb,30,'ACTIVO','{"program":"SOLO_AVENA","description":"80 planchas o más = 432 Avenas"}'::jsonb),
      ('RR-SAV-P80-B','SAV_PLANCHAS_80_B','Solo Avena · 80 planchas o más + Batea','PLANCHAS','PLANCHAS',80,null,false,false,null,ARRAY[]::text[],'BATEA','{"AVENA":408,"BATEA":4}'::jsonb,31,'ACTIVO','{"program":"SOLO_AVENA","description":"80 planchas o más = 408 Avenas (17 fardos) + 4 Bateas"}'::jsonb)
    ON CONFLICT (id) DO NOTHING;

    -- Escala EXCEPCIONAL (solo Spaghetti), para almacenes sin Avena (p. ej.
    -- Productores y La Parada): el promotor elige Tradicional o Excepcional.
    INSERT INTO redemption_rules (
      id,code,name,sale_mode,quantity_basis,min_quantity,max_quantity,min_exclusive,
      repeatable,step_quantity,eligible_skus,accessory,items,priority,status,data
    ) VALUES
      ('RR-EXC-MINI-HALF','EXC_MINI_MEDIA','Excepcional · Minis 1/2 plancha','PLANCHAS','UNITS',24,24,false,false,null,ARRAY['TODINNITO-85','MINI-COSTA-MINIONS-80','MINI-COSTA-JURASSIC-80'],'NINGUNO','{"SPAGHETTI":1}'::jsonb,10,'ACTIVO','{"program":"EXCEPCIONAL","description":"Minis: 1/2 plancha (24 und) = 1 Spaghetti"}'::jsonb),
      ('RR-EXC-MINI-1','EXC_MINI_PLANCHAS','Excepcional · Minis 1 plancha o más','PLANCHAS','PLANCHAS',1,null,false,false,null,ARRAY['TODINNITO-85','MINI-COSTA-MINIONS-80','MINI-COSTA-JURASSIC-80'],'NINGUNO','{"SPAGHETTI":2}'::jsonb,5,'ACTIVO','{"program":"EXCEPCIONAL","description":"Minis: 1 plancha o más = 2 Spaghetti fijo"}'::jsonb),
      ('RR-EXC-UNI','EXC_UNIDADES','Excepcional · Unidades','UNIDADES','UNITS',1,5,false,true,1,ARRAY[]::text[],'NINGUNO','{"SPAGHETTI":1}'::jsonb,20,'ACTIVO','{"program":"EXCEPCIONAL","description":"1 Spaghetti por unidad (1 a 5 und)"}'::jsonb),
      ('RR-EXC-P1','EXC_PLANCHAS_1','Excepcional · 1 a 3 planchas','PLANCHAS','PLANCHAS',1,3,false,false,null,ARRAY[]::text[],'NINGUNO','{"SPAGHETTI":2}'::jsonb,30,'ACTIVO','{"program":"EXCEPCIONAL","description":"1 a 3 planchas = 2 Spaghetti"}'::jsonb),
      ('RR-EXC-P4','EXC_PLANCHAS_4','Excepcional · 4 a 9 planchas','PLANCHAS','PLANCHAS',4,9,false,false,null,ARRAY[]::text[],'NINGUNO','{"SPAGHETTI":8}'::jsonb,30,'ACTIVO','{"program":"EXCEPCIONAL","description":"4 a 9 planchas = 8 Spaghetti"}'::jsonb),
      ('RR-EXC-P10','EXC_PLANCHAS_10','Excepcional · 10 a 79 planchas','PLANCHAS','PLANCHAS',10,79,false,false,null,ARRAY[]::text[],'NINGUNO','{"SPAGHETTI":20}'::jsonb,30,'ACTIVO','{"program":"EXCEPCIONAL","description":"10 a 79 planchas = 20 Spaghetti"}'::jsonb),
      ('RR-EXC-P80','EXC_PLANCHAS_80','Excepcional · 80 planchas o más','PLANCHAS','PLANCHAS',80,null,false,false,null,ARRAY[]::text[],'NINGUNO','{"SPAGHETTI":160}'::jsonb,30,'ACTIVO','{"program":"EXCEPCIONAL","description":"80 planchas o más = 160 Spaghetti"}'::jsonb)
    ON CONFLICT (id) DO NOTHING;

    -- Planchas solo de minis (Todinnito 85 g, Mini Costa Minions 80 g, Mini Costa
    -- Jurassic 80 g): desde 1 plancha, 4 Avenas fijas (no se multiplica).
    INSERT INTO redemption_rules (
      id,code,name,sale_mode,quantity_basis,min_quantity,max_quantity,min_exclusive,
      repeatable,step_quantity,eligible_skus,accessory,items,priority,status,data
    ) VALUES (
      'RR-ESC-MINI-1','ESCALA_MINIS','Escala Minis · 1 plancha o más','PLANCHAS','PLANCHAS',1,null,false,
      false,null,ARRAY['TODINNITO-85','MINI-COSTA-MINIONS-80','MINI-COSTA-JURASSIC-80'],'NINGUNO','{"AVENA":4}'::jsonb,5,'ACTIVO',
      '{"description":"Solo minis 80/85 g: 1 plancha o más = 4 Avenas (1/2 plancha = Escala 1)"}'::jsonb
    )
    ON CONFLICT (id) DO NOTHING;

    -- Ventas por unidad de 3 a 5 unidades: 2 Avenas (no se repite por unidad).
    INSERT INTO redemption_rules (
      id,code,name,sale_mode,quantity_basis,min_quantity,max_quantity,min_exclusive,
      repeatable,step_quantity,eligible_skus,accessory,items,priority,status,data
    ) VALUES (
      'RR-ESC-002-3-5','ESCALA_2_3_5','Escala 2 · 3 a 5 unidades','UNIDADES','UNITS',3,5,false,
      false,null,ARRAY[]::text[],'NINGUNO','{"AVENA":2}'::jsonb,21,'ACTIVO',
      '{"description":"3, 4 o 5 unidades = 2 Avenas; no aplica a minis 80/85 g"}'::jsonb
    )
    ON CONFLICT (id) DO NOTHING;

    -- Canje Excepcional: se elimina el tramo de 30 planchas (65 Spaghetti); de 10 a 79 planchas = 20 Spaghetti.
    DELETE FROM redemption_rules WHERE id='RR-EXC-P30';
    UPDATE redemption_rules
    SET max_quantity=79,
        name='Excepcional · 10 a 79 planchas',
        data=jsonb_set(COALESCE(data,'{}'::jsonb),'{description}',to_jsonb('10 a 79 planchas = 20 Spaghetti'::text),true),
        updated_at=now()
    WHERE id='RR-EXC-P10' AND (max_quantity IS DISTINCT FROM 79 OR name <> 'Excepcional · 10 a 79 planchas');

    UPDATE redemption_rules
    SET min_exclusive=false, updated_at=now()
    WHERE id IN ('RR-ESC-006','RR-ESC-006-M','RR-ESC-006-B')
      AND min_exclusive=true;

    UPDATE redemption_rules
    SET min_quantity=1,
        max_quantity=2,
        min_exclusive=false,
        repeatable=true,
        step_quantity=1,
        eligible_skus=ARRAY[]::text[],
        items='{"AVENA":1}'::jsonb,
        data=jsonb_set(
          COALESCE(data,'{}'::jsonb),
          '{description}',
          to_jsonb('1 unidad = 1 Avena; 2 unidades = 2 Avenas; de 3 a 5 unidades ver Escala 2 · 3 a 5; no aplica a minis 80/85 g'::text),
          true
        ),
        updated_at=now()
    WHERE id='RR-ESC-002';

    CREATE INDEX IF NOT EXISTS idx_redemption_rules_active ON redemption_rules(status,priority);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouses_name ON warehouses(upper(name));
    CREATE INDEX IF NOT EXISTS idx_warehouse_movements_warehouse_date ON warehouse_movements(warehouse_id,movement_date DESC);
    CREATE INDEX IF NOT EXISTS idx_transfers_source_date ON transfers(source_warehouse_id,transfer_date DESC);
    CREATE INDEX IF NOT EXISTS idx_transfers_destination_date ON transfers(destination_warehouse_id,transfer_date DESC);
    CREATE INDEX IF NOT EXISTS idx_trade_approvals_status_requested ON trade_approvals(status,requested_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date DESC);
    CREATE INDEX IF NOT EXISTS idx_sales_redemption_rule ON sales(redemption_rule_id);
    CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(event_date DESC);
    CREATE INDEX IF NOT EXISTS idx_tracking_promoter_date ON promoter_location_tracking(promoter_id,recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tracking_market_date ON promoter_location_tracking(market_id,recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tracking_event_date ON promoter_location_tracking(event_type,recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tracking_diag_promoter_date ON promoter_tracking_diagnostics(promoter_id,recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tracking_diag_event_date ON promoter_tracking_diagnostics(event_type,recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_movements_date ON inventory_movements(movement_date DESC);
    CREATE INDEX IF NOT EXISTS idx_closures_date ON session_closures(closure_date DESC);
    CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
    CREATE INDEX IF NOT EXISTS idx_sale_items_sku ON sale_items(sku);

    -- FK seguras: solo se crean y validan cuando la auditoría no encuentra huérfanos.
    -- Si existen datos históricos inconsistentes, el arranque continúa sin borrar ni alterar filas.
    DO $fk$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname='clients_market_fk'
      ) AND NOT EXISTS (
        SELECT 1 FROM clients c LEFT JOIN markets m ON m.id=c.market_id
        WHERE c.market_id='' OR m.id IS NULL
      ) THEN
        ALTER TABLE clients ADD CONSTRAINT clients_market_fk
          FOREIGN KEY (market_id) REFERENCES markets(id) NOT VALID;
        ALTER TABLE clients VALIDATE CONSTRAINT clients_market_fk;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname='sales_promoter_fk'
      ) AND NOT EXISTS (
        SELECT 1 FROM sales s LEFT JOIN users u ON u.id=s.promoter_id
        WHERE s.promoter_id='' OR u.id IS NULL
      ) THEN
        ALTER TABLE sales ADD CONSTRAINT sales_promoter_fk
          FOREIGN KEY (promoter_id) REFERENCES users(id) NOT VALID;
        ALTER TABLE sales VALIDATE CONSTRAINT sales_promoter_fk;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname='sales_client_fk'
      ) AND NOT EXISTS (
        SELECT 1 FROM sales s LEFT JOIN clients c ON c.id=s.client_id
        WHERE s.client_id='' OR c.id IS NULL
      ) THEN
        ALTER TABLE sales ADD CONSTRAINT sales_client_fk
          FOREIGN KEY (client_id) REFERENCES clients(id) NOT VALID;
        ALTER TABLE sales VALIDATE CONSTRAINT sales_client_fk;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname='sales_market_fk'
      ) AND NOT EXISTS (
        SELECT 1 FROM sales s LEFT JOIN markets m ON m.id=s.market_id
        WHERE s.market_id='' OR m.id IS NULL
      ) THEN
        ALTER TABLE sales ADD CONSTRAINT sales_market_fk
          FOREIGN KEY (market_id) REFERENCES markets(id) NOT VALID;
        ALTER TABLE sales VALIDATE CONSTRAINT sales_market_fk;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname='sales_redemption_rule_fk'
      ) AND NOT EXISTS (
        SELECT 1
        FROM sales s
        LEFT JOIN redemption_rules r ON r.id=s.redemption_rule_id
        WHERE s.redemption_rule_id IS NOT NULL AND r.id IS NULL
      ) THEN
        ALTER TABLE sales ADD CONSTRAINT sales_redemption_rule_fk
          FOREIGN KEY (redemption_rule_id) REFERENCES redemption_rules(id)
          ON UPDATE CASCADE ON DELETE SET NULL NOT VALID;
        ALTER TABLE sales VALIDATE CONSTRAINT sales_redemption_rule_fk;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname='sale_items_sale_fk'
      ) AND NOT EXISTS (
        SELECT 1 FROM sale_items si LEFT JOIN sales s ON s.id=si.sale_id
        WHERE s.id IS NULL
      ) THEN
        ALTER TABLE sale_items ADD CONSTRAINT sale_items_sale_fk
          FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE NOT VALID;
        ALTER TABLE sale_items VALIDATE CONSTRAINT sale_items_sale_fk;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname='sale_items_sku_fk'
      ) AND NOT EXISTS (
        SELECT 1 FROM sale_items si LEFT JOIN product_prices p ON p.sku=si.sku
        WHERE p.sku IS NULL
      ) THEN
        ALTER TABLE sale_items ADD CONSTRAINT sale_items_sku_fk
          FOREIGN KEY (sku) REFERENCES product_prices(sku)
          ON UPDATE CASCADE ON DELETE RESTRICT NOT VALID;
        ALTER TABLE sale_items VALIDATE CONSTRAINT sale_items_sku_fk;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname='attendance_promoter_fk'
      ) AND NOT EXISTS (
        SELECT 1 FROM attendance a LEFT JOIN users u ON u.id=a.promoter_id
        WHERE a.promoter_id='' OR u.id IS NULL
      ) THEN
        ALTER TABLE attendance ADD CONSTRAINT attendance_promoter_fk
          FOREIGN KEY (promoter_id) REFERENCES users(id) NOT VALID;
        ALTER TABLE attendance VALIDATE CONSTRAINT attendance_promoter_fk;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname='attendance_client_fk'
      ) AND NOT EXISTS (
        SELECT 1 FROM attendance a LEFT JOIN clients c ON c.id=a.client_id
        WHERE a.client_id='' OR c.id IS NULL
      ) THEN
        ALTER TABLE attendance ADD CONSTRAINT attendance_client_fk
          FOREIGN KEY (client_id) REFERENCES clients(id) NOT VALID;
        ALTER TABLE attendance VALIDATE CONSTRAINT attendance_client_fk;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname='attendance_market_fk'
      ) AND NOT EXISTS (
        SELECT 1 FROM attendance a LEFT JOIN markets m ON m.id=a.market_id
        WHERE a.market_id='' OR m.id IS NULL
      ) THEN
        ALTER TABLE attendance ADD CONSTRAINT attendance_market_fk
          FOREIGN KEY (market_id) REFERENCES markets(id) NOT VALID;
        ALTER TABLE attendance VALIDATE CONSTRAINT attendance_market_fk;
      END IF;
    END $fk$;
  `);
}

/**
 * Índices de rendimiento para el feed incremental, tombstones y consultas por promotor.
 *
 * - Solo agregan índices: no modifican, borran ni migran filas.
 * - CONCURRENTLY no bloquea lecturas ni escrituras; por eso cada índice va en su
 *   propia sentencia (no puede ejecutarse dentro de una transacción).
 * - Se ejecuta después de que el servidor ya atiende peticiones, para no demorar el arranque.
 * - Si un intento anterior quedó INVÁLIDO (p. ej. reinicio a mitad de la creación),
 *   se elimina únicamente ese índice inválido y se vuelve a crear. Ningún dato se toca.
 */
const performanceIndexes: Array<{ name: string; definition: string }> = [
  { name: "idx_sales_updated_at", definition: "ON sales(updated_at)" },
  { name: "idx_attendance_updated_at", definition: "ON attendance(updated_at)" },
  { name: "idx_movements_updated_at", definition: "ON inventory_movements(updated_at)" },
  { name: "idx_tombstones_deleted_at", definition: "ON app_storage_tombstones(deleted_at)" },
  { name: "idx_attendance_promoter_date", definition: "ON attendance(promoter_id,event_date DESC)" },
  { name: "idx_attendance_date_promoter_market", definition: "ON attendance(event_date,promoter_id,market_id)" },
  { name: "idx_sales_promoter_date", definition: "ON sales(promoter_id,sale_date DESC)" },
];

export async function ensurePerformanceIndexes(
  log: (message: string, error?: unknown) => void = (message, error) =>
    error ? console.error(message, error) : console.info(message),
) {
  for (const index of performanceIndexes) {
    try {
      const existing = await pool.query(
        `SELECT i.indisvalid AS valid
           FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid
          WHERE c.relname=$1 AND c.relkind='i' LIMIT 1`,
        [index.name],
      );
      if (existing.rows[0]?.valid === true) continue;
      if (existing.rows.length) {
        await pool.query(`DROP INDEX CONCURRENTLY IF EXISTS ${index.name}`);
      }
      await pool.query(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${index.name} ${index.definition}`,
      );
      log(`Índice de rendimiento listo: ${index.name}`);
    } catch (error) {
      // Un índice faltante solo afecta velocidad; nunca debe detener la app.
      log(`No se pudo crear el índice ${index.name}`, error);
    }
  }
}
