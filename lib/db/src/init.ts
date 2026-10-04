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
      data jsonb NOT NULL DEFAULT '{}',
      record_updated_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

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

    CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouses_name ON warehouses(upper(name));
    CREATE INDEX IF NOT EXISTS idx_warehouse_movements_warehouse_date ON warehouse_movements(warehouse_id,movement_date DESC);
    CREATE INDEX IF NOT EXISTS idx_trade_approvals_status_requested ON trade_approvals(status,requested_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date DESC);
    CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(event_date DESC);
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
