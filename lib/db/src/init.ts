import { pool } from "./index";

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
      PRIMARY KEY(collection,record_id)
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouses_name ON warehouses(upper(name));

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
    ALTER TABLE markets ADD COLUMN IF NOT EXISTS warehouse_id text;

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
    ALTER TABLE product_prices ADD COLUMN IF NOT EXISTS brand text;
    ALTER TABLE product_prices ADD COLUMN IF NOT EXISTS presentation text;
    ALTER TABLE product_prices ADD COLUMN IF NOT EXISTS unit_measure numeric NOT NULL DEFAULT 1;
    ALTER TABLE product_prices ADD COLUMN IF NOT EXISTS weight_kg numeric(14,3);
    ALTER TABLE product_prices ADD COLUMN IF NOT EXISTS units_per_plancha numeric NOT NULL DEFAULT 1;
    ALTER TABLE product_prices ADD COLUMN IF NOT EXISTS sale_modes text[] NOT NULL DEFAULT '{}';
    ALTER TABLE product_prices ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVO';

    CREATE TABLE IF NOT EXISTS sale_items (
      id text PRIMARY KEY,
      sale_id text NOT NULL,
      product_sku text,
      product_name text NOT NULL DEFAULT '',
      brand text,
      presentation text,
      units numeric NOT NULL DEFAULT 0,
      unit_price numeric(14,2) NOT NULL DEFAULT 0,
      amount_soles numeric(14,2) NOT NULL DEFAULT 0,
      data jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
    CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_sku);

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
    CREATE INDEX IF NOT EXISTS idx_trade_approvals_status_requested ON trade_approvals(status,requested_at DESC);

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
    CREATE INDEX IF NOT EXISTS idx_warehouse_movements_warehouse_date ON warehouse_movements(warehouse_id,movement_date DESC);

    -- Legacy inventory tables remain for historical compatibility only.
    -- New operational stock is owned by warehouses + warehouse_movements.
    CREATE TABLE IF NOT EXISTS inventory (
      market_id text PRIMARY KEY,
      tasting_stock numeric NOT NULL DEFAULT 0,
      redemption_stock jsonb NOT NULL DEFAULT '{}',
      data jsonb NOT NULL DEFAULT '{}',
      record_updated_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
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

    -- Non-destructive backfill of normalized catalog/warehouse columns.
    UPDATE product_prices
       SET brand = COALESCE(NULLIF(brand,''), NULLIF(data->>'brand','')),
           presentation = COALESCE(NULLIF(presentation,''), NULLIF(data->>'presentation','')),
           unit_measure = COALESCE(NULLIF((data->>'unitMeasure')::numeric,0), unit_measure, 1),
           weight_kg = COALESCE(weight_kg, NULLIF((data->>'weightKg')::numeric,0)),
           units_per_plancha = COALESCE(NULLIF((data->>'unitsPerPlancha')::numeric,0), units_per_plancha, 1),
           sale_modes = CASE
             WHEN cardinality(sale_modes) > 0 THEN sale_modes
             WHEN jsonb_typeof(data->'saleModes')='array'
               THEN ARRAY(SELECT jsonb_array_elements_text(data->'saleModes'))
             ELSE ARRAY[]::text[]
           END,
           status = COALESCE(NULLIF(status,''), NULLIF(data->>'status',''), 'ACTIVO');

    UPDATE markets m
       SET warehouse_id = NULLIF(m.data->>'warehouseId','')
     WHERE m.warehouse_id IS NULL
       AND NULLIF(m.data->>'warehouseId','') IS NOT NULL
       AND EXISTS (SELECT 1 FROM warehouses w WHERE w.id = m.data->>'warehouseId');

    -- Relational detail for sales. Existing sales remain untouched.
    INSERT INTO sale_items (id,sale_id,product_sku,product_name,brand,presentation,units,unit_price,amount_soles,data)
    SELECT
      s.id || ':P:' || line.ordinality,
      s.id,
      CASE WHEN p.sku IS NOT NULL THEN p.sku ELSE NULL END,
      COALESCE(p.product,line.item->>'product',line.item->>'sku','Producto'),
      COALESCE(p.brand,line.item->>'brand'),
      COALESCE(p.presentation,line.item->>'presentation',s.data->>'presentation'),
      CASE WHEN COALESCE(line.item->>'units','') ~ '^[0-9]+([.][0-9]+)?$' THEN (line.item->>'units')::numeric ELSE 0 END,
      CASE WHEN COALESCE(line.item->>'unitPrice','') ~ '^[0-9]+([.][0-9]+)?$' THEN (line.item->>'unitPrice')::numeric ELSE 0 END,
      CASE
        WHEN COALESCE(line.item->>'units','') ~ '^[0-9]+([.][0-9]+)?$'
         AND COALESCE(line.item->>'unitPrice','') ~ '^[0-9]+([.][0-9]+)?$'
        THEN (line.item->>'units')::numeric * (line.item->>'unitPrice')::numeric
        ELSE 0
      END,
      line.item
    FROM sales s
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(s.data->'planchaLines')='array' THEN s.data->'planchaLines' ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS line(item,ordinality)
    LEFT JOIN product_prices p ON p.sku = line.item->>'sku'
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO sale_items (id,sale_id,product_sku,product_name,brand,presentation,units,unit_price,amount_soles,data)
    SELECT
      s.id || ':U:1',
      s.id,
      p.sku,
      COALESCE(p.product,'Producto'),
      p.brand,
      COALESCE(p.presentation,s.data->>'presentation'),
      s.units,
      COALESCE(price.value::numeric,0),
      s.amount_soles,
      jsonb_build_object('source','historical-unit-backfill','key',price.key)
    FROM sales s
    CROSS JOIN LATERAL (
      SELECT key,value
      FROM jsonb_each_text(
        CASE WHEN jsonb_typeof(s.data->'unitPrices')='object' THEN s.data->'unitPrices' ELSE '{}'::jsonb END
      )
      LIMIT 1
    ) price
    LEFT JOIN product_prices p ON p.sku = price.key
    WHERE s.mode='UNIDADES'
      AND NOT EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id=s.id)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO sale_items (id,sale_id,product_sku,product_name,brand,presentation,units,unit_price,amount_soles,data)
    SELECT
      s.id || ':L:' || row_number() OVER (PARTITION BY s.id ORDER BY mix.key),
      s.id,
      p.sku,
      COALESCE(p.product,mix.key),
      COALESCE(p.brand,mix.key),
      COALESCE(p.presentation,s.data->>'presentation'),
      CASE WHEN mix.value ~ '^[0-9]+([.][0-9]+)?$' THEN mix.value::numeric ELSE 0 END,
      COALESCE(NULLIF(s.data->'unitPrices'->>mix.key,'')::numeric,0),
      CASE WHEN mix.value ~ '^[0-9]+([.][0-9]+)?$'
        THEN mix.value::numeric * COALESCE(NULLIF(s.data->'unitPrices'->>mix.key,'')::numeric,0)
        ELSE 0 END,
      jsonb_build_object('source','legacy-mix-backfill','key',mix.key)
    FROM sales s
    CROSS JOIN LATERAL jsonb_each_text(
      CASE WHEN jsonb_typeof(s.data->'mix')='object' THEN s.data->'mix' ELSE '{}'::jsonb END
    ) mix
    LEFT JOIN LATERAL (
      SELECT pp.*
      FROM product_prices pp
      WHERE upper(COALESCE(pp.brand,pp.data->>'brand','')) = upper(mix.key)
      ORDER BY
        CASE
          WHEN upper(mix.key)='COSTA' AND upper(pp.product)='PANETON COSTA 800 GR' THEN 0
          WHEN upper(mix.key)='TODINNO' AND upper(pp.product) LIKE 'PANET_N TODINNO%TODINNITO%' THEN 0
          WHEN upper(mix.key)='PASQUALINO' AND upper(pp.product) LIKE 'PASQUALINO 800 GR%' THEN 0
          ELSE 1
        END,
        pp.created_at
      LIMIT 1
    ) p ON true
    WHERE s.mode='PLANCHAS'
      AND NOT EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id=s.id)
    ON CONFLICT (id) DO NOTHING;

    CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date DESC);
    CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(event_date DESC);
    CREATE INDEX IF NOT EXISTS idx_movements_date ON inventory_movements(movement_date DESC);
    CREATE INDEX IF NOT EXISTS idx_closures_date ON session_closures(closure_date DESC);

    -- Foreign keys are added NOT VALID: they protect all new writes without deleting
    -- or rewriting legacy rows. Clean relations are validated automatically.
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_markets_warehouse') THEN
        ALTER TABLE markets ADD CONSTRAINT fk_markets_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) NOT VALID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_clients_market') THEN
        ALTER TABLE clients ADD CONSTRAINT fk_clients_market FOREIGN KEY (market_id) REFERENCES markets(id) NOT VALID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_sales_promoter') THEN
        ALTER TABLE sales ADD CONSTRAINT fk_sales_promoter FOREIGN KEY (promoter_id) REFERENCES users(id) NOT VALID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_sales_client') THEN
        ALTER TABLE sales ADD CONSTRAINT fk_sales_client FOREIGN KEY (client_id) REFERENCES clients(id) NOT VALID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_sales_market') THEN
        ALTER TABLE sales ADD CONSTRAINT fk_sales_market FOREIGN KEY (market_id) REFERENCES markets(id) NOT VALID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_attendance_promoter') THEN
        ALTER TABLE attendance ADD CONSTRAINT fk_attendance_promoter FOREIGN KEY (promoter_id) REFERENCES users(id) NOT VALID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_attendance_client') THEN
        ALTER TABLE attendance ADD CONSTRAINT fk_attendance_client FOREIGN KEY (client_id) REFERENCES clients(id) NOT VALID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_attendance_market') THEN
        ALTER TABLE attendance ADD CONSTRAINT fk_attendance_market FOREIGN KEY (market_id) REFERENCES markets(id) NOT VALID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_inventory_market') THEN
        ALTER TABLE inventory ADD CONSTRAINT fk_inventory_market FOREIGN KEY (market_id) REFERENCES markets(id) NOT VALID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_assignments_promoter') THEN
        ALTER TABLE assignments ADD CONSTRAINT fk_assignments_promoter FOREIGN KEY (promoter_id) REFERENCES users(id) NOT VALID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_closures_promoter') THEN
        ALTER TABLE session_closures ADD CONSTRAINT fk_closures_promoter FOREIGN KEY (promoter_id) REFERENCES users(id) NOT VALID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_closures_market') THEN
        ALTER TABLE session_closures ADD CONSTRAINT fk_closures_market FOREIGN KEY (market_id) REFERENCES markets(id) NOT VALID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_closures_client') THEN
        ALTER TABLE session_closures ADD CONSTRAINT fk_closures_client FOREIGN KEY (client_id) REFERENCES clients(id) NOT VALID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_trade_promoter') THEN
        ALTER TABLE trade_approvals ADD CONSTRAINT fk_trade_promoter FOREIGN KEY (promoter_id) REFERENCES users(id) NOT VALID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_trade_client') THEN
        ALTER TABLE trade_approvals ADD CONSTRAINT fk_trade_client FOREIGN KEY (client_id) REFERENCES clients(id) NOT VALID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_trade_market') THEN
        ALTER TABLE trade_approvals ADD CONSTRAINT fk_trade_market FOREIGN KEY (market_id) REFERENCES markets(id) NOT VALID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_sale_items_sale') THEN
        ALTER TABLE sale_items ADD CONSTRAINT fk_sale_items_sale FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE NOT VALID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_sale_items_product') THEN
        ALTER TABLE sale_items ADD CONSTRAINT fk_sale_items_product FOREIGN KEY (product_sku) REFERENCES product_prices(sku) NOT VALID;
      END IF;
    END $$;

    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM markets m LEFT JOIN warehouses w ON w.id=m.warehouse_id WHERE m.warehouse_id IS NOT NULL AND w.id IS NULL)
        THEN ALTER TABLE markets VALIDATE CONSTRAINT fk_markets_warehouse; END IF;
      IF NOT EXISTS (SELECT 1 FROM clients c LEFT JOIN markets m ON m.id=c.market_id WHERE m.id IS NULL)
        THEN ALTER TABLE clients VALIDATE CONSTRAINT fk_clients_market; END IF;
      IF NOT EXISTS (SELECT 1 FROM sales s LEFT JOIN users u ON u.id=s.promoter_id WHERE u.id IS NULL)
        THEN ALTER TABLE sales VALIDATE CONSTRAINT fk_sales_promoter; END IF;
      IF NOT EXISTS (SELECT 1 FROM sales s LEFT JOIN clients c ON c.id=s.client_id WHERE c.id IS NULL)
        THEN ALTER TABLE sales VALIDATE CONSTRAINT fk_sales_client; END IF;
      IF NOT EXISTS (SELECT 1 FROM sales s LEFT JOIN markets m ON m.id=s.market_id WHERE m.id IS NULL)
        THEN ALTER TABLE sales VALIDATE CONSTRAINT fk_sales_market; END IF;
      IF NOT EXISTS (SELECT 1 FROM attendance a LEFT JOIN users u ON u.id=a.promoter_id WHERE u.id IS NULL)
        THEN ALTER TABLE attendance VALIDATE CONSTRAINT fk_attendance_promoter; END IF;
      IF NOT EXISTS (SELECT 1 FROM attendance a LEFT JOIN clients c ON c.id=a.client_id WHERE c.id IS NULL)
        THEN ALTER TABLE attendance VALIDATE CONSTRAINT fk_attendance_client; END IF;
      IF NOT EXISTS (SELECT 1 FROM attendance a LEFT JOIN markets m ON m.id=a.market_id WHERE m.id IS NULL)
        THEN ALTER TABLE attendance VALIDATE CONSTRAINT fk_attendance_market; END IF;
      IF NOT EXISTS (SELECT 1 FROM sale_items si LEFT JOIN sales s ON s.id=si.sale_id WHERE s.id IS NULL)
        THEN ALTER TABLE sale_items VALIDATE CONSTRAINT fk_sale_items_sale; END IF;
      IF NOT EXISTS (SELECT 1 FROM sale_items si LEFT JOIN product_prices p ON p.sku=si.product_sku WHERE si.product_sku IS NOT NULL AND p.sku IS NULL)
        THEN ALTER TABLE sale_items VALIDATE CONSTRAINT fk_sale_items_product; END IF;
    END $$;

    CREATE OR REPLACE VIEW app_integrity_audit AS
      SELECT 'clients.market_id -> markets.id' AS relation, count(*)::bigint AS orphan_count
        FROM clients c LEFT JOIN markets m ON m.id=c.market_id WHERE m.id IS NULL
      UNION ALL
      SELECT 'sales.promoter_id -> users.id', count(*)::bigint
        FROM sales s LEFT JOIN users u ON u.id=s.promoter_id WHERE u.id IS NULL
      UNION ALL
      SELECT 'sales.client_id -> clients.id', count(*)::bigint
        FROM sales s LEFT JOIN clients c ON c.id=s.client_id WHERE c.id IS NULL
      UNION ALL
      SELECT 'sales.market_id -> markets.id', count(*)::bigint
        FROM sales s LEFT JOIN markets m ON m.id=s.market_id WHERE m.id IS NULL
      UNION ALL
      SELECT 'attendance.promoter_id -> users.id', count(*)::bigint
        FROM attendance a LEFT JOIN users u ON u.id=a.promoter_id WHERE u.id IS NULL
      UNION ALL
      SELECT 'attendance.client_id -> clients.id', count(*)::bigint
        FROM attendance a LEFT JOIN clients c ON c.id=a.client_id WHERE c.id IS NULL
      UNION ALL
      SELECT 'attendance.market_id -> markets.id', count(*)::bigint
        FROM attendance a LEFT JOIN markets m ON m.id=a.market_id WHERE m.id IS NULL
      UNION ALL
      SELECT 'markets.warehouse_id -> warehouses.id', count(*)::bigint
        FROM markets m LEFT JOIN warehouses w ON w.id=m.warehouse_id WHERE m.warehouse_id IS NOT NULL AND w.id IS NULL
      UNION ALL
      SELECT 'sale_items.sale_id -> sales.id', count(*)::bigint
        FROM sale_items si LEFT JOIN sales s ON s.id=si.sale_id WHERE s.id IS NULL
      UNION ALL
      SELECT 'sale_items.product_sku -> product_prices.sku', count(*)::bigint
        FROM sale_items si LEFT JOIN product_prices p ON p.sku=si.product_sku WHERE si.product_sku IS NOT NULL AND p.sku IS NULL;
  `);
}
