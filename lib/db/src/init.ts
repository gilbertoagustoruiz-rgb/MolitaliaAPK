import { pool } from "./index";

export async function ensureDatabaseSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_metadata (key text PRIMARY KEY,value text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS app_storage_tombstones (collection text NOT NULL,record_id text NOT NULL,deleted_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(collection,record_id));
    CREATE TABLE IF NOT EXISTS markets (id text PRIMARY KEY,name text NOT NULL DEFAULT '',region text,department text,province text,district text,status text NOT NULL DEFAULT 'ACTIVO',data jsonb NOT NULL DEFAULT '{}',record_updated_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY,dni text NOT NULL UNIQUE,name text NOT NULL DEFAULT '',role text NOT NULL DEFAULT 'PROMOTOR',status text NOT NULL DEFAULT 'ACTIVO',password_hash text,data jsonb NOT NULL DEFAULT '{}',record_updated_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS clients (id text PRIMARY KEY,code text NOT NULL DEFAULT '',name text NOT NULL DEFAULT '',market_id text NOT NULL DEFAULT '',status text NOT NULL DEFAULT 'ACTIVO',data jsonb NOT NULL DEFAULT '{}',record_updated_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS sales (id text PRIMARY KEY,promoter_id text NOT NULL DEFAULT '',client_id text NOT NULL DEFAULT '',market_id text NOT NULL DEFAULT '',mode text NOT NULL DEFAULT '',units numeric NOT NULL DEFAULT 0,amount_soles numeric(14,2) NOT NULL DEFAULT 0,weight_kg numeric(14,3),sale_date timestamptz NOT NULL DEFAULT now(),status text NOT NULL DEFAULT 'SINCRONIZADA',receipt_photo text,exchange_photo text,data jsonb NOT NULL DEFAULT '{}',record_updated_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS attendance (id text PRIMARY KEY,promoter_id text NOT NULL DEFAULT '',client_id text NOT NULL DEFAULT '',market_id text NOT NULL DEFAULT '',event_type text NOT NULL DEFAULT '',event_date timestamptz NOT NULL DEFAULT now(),status text NOT NULL DEFAULT 'SINCRONIZADA',photo text,data jsonb NOT NULL DEFAULT '{}',record_updated_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS inventory (market_id text PRIMARY KEY,tasting_stock numeric NOT NULL DEFAULT 0,redemption_stock jsonb NOT NULL DEFAULT '{}',data jsonb NOT NULL DEFAULT '{}',record_updated_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS inventory_movements (id text PRIMARY KEY,market_id text NOT NULL DEFAULT '',kind text NOT NULL DEFAULT '',item_id text,quantity numeric NOT NULL DEFAULT 0,actor_id text NOT NULL DEFAULT '',movement_date timestamptz NOT NULL DEFAULT now(),status text NOT NULL DEFAULT 'SINCRONIZADA',data jsonb NOT NULL DEFAULT '{}',record_updated_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS assignments (promoter_id text PRIMARY KEY,promoter_dni text,market_ids text[] NOT NULL DEFAULT '{}',client_ids text[] NOT NULL DEFAULT '{}',data jsonb NOT NULL DEFAULT '{}',record_updated_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS session_closures (id text PRIMARY KEY,promoter_id text NOT NULL DEFAULT '',market_id text NOT NULL DEFAULT '',client_id text,tasting_used numeric NOT NULL DEFAULT 0,leads numeric NOT NULL DEFAULT 0,closure_date timestamptz NOT NULL DEFAULT now(),status text NOT NULL DEFAULT 'SINCRONIZADA',data jsonb NOT NULL DEFAULT '{}',record_updated_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS product_prices (sku text PRIMARY KEY,product text NOT NULL DEFAULT '',units_per_package numeric NOT NULL DEFAULT 0,unit_price numeric(14,2) NOT NULL DEFAULT 0,total_price numeric(14,2) NOT NULL DEFAULT 0,data jsonb NOT NULL DEFAULT '{}',record_updated_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
    ALTER TABLE product_prices ALTER COLUMN data TYPE jsonb USING COALESCE(data::text, '{}')::jsonb;
    CREATE TABLE IF NOT EXISTS client_categories (id text PRIMARY KEY,name text NOT NULL UNIQUE,status text NOT NULL DEFAULT 'ACTIVO',data jsonb NOT NULL DEFAULT '{}',record_updated_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
    INSERT INTO client_categories (id,name,status,data,record_updated_at)
    VALUES
      ('MIXTO','MIXTO','ACTIVO','{"id":"MIXTO","name":"MIXTO","status":"ACTIVO"}',now()),
      ('CONFETI','CONFETI','ACTIVO','{"id":"CONFETI","name":"CONFETI","status":"ACTIVO"}',now())
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO product_prices (sku,product,units_per_package,unit_price,total_price,data,record_updated_at)
    VALUES
      ('801177','Panetón Todinno 900 g + Todinnito 85 g',1,25,25,jsonb_build_object('sku','801177','product','Panetón Todinno 900 g + Todinnito 85 g','brand','TODINNO','weightKg',0.9,'saleModes',jsonb_build_array('UNIDADES','PLANCHAS'),'unitsPerPackage',1,'unitPrice',25,'totalPrice',25,'status','ACTIVO'),now()),
      ('801200','Panetón Costa 800 g',1,25,25,jsonb_build_object('sku','801200','product','Panetón Costa 800 g','brand','COSTA','weightKg',0.8,'saleModes',jsonb_build_array('UNIDADES','PLANCHAS'),'unitsPerPackage',1,'unitPrice',25,'totalPrice',25,'status','ACTIVO'),now()),
      ('800891','Pasqualino 800 g',1,25,25,jsonb_build_object('sku','800891','product','Pasqualino 800 g','brand','PASQUALINO','weightKg',0.8,'saleModes',jsonb_build_array('UNIDADES','PLANCHAS'),'unitsPerPackage',1,'unitPrice',25,'totalPrice',25,'status','ACTIVO'),now()),
      ('801201','Mini Costa Minions 80 g',1,5,5,jsonb_build_object('sku','801201','product','Mini Costa Minions 80 g','brand','COSTA MINIONS','weightKg',0.08,'saleModes',jsonb_build_array('UNIDADES'),'unitsPerPackage',1,'unitPrice',5,'totalPrice',5,'status','ACTIVO'),now()),
      ('801384','Mini Costa Jurassic 80 g',1,5,5,jsonb_build_object('sku','801384','product','Mini Costa Jurassic 80 g','brand','COSTA JURASSIC','weightKg',0.08,'saleModes',jsonb_build_array('UNIDADES'),'unitsPerPackage',1,'unitPrice',5,'totalPrice',5,'status','ACTIVO'),now()),
      ('800659','Todinnito 85 g',1,5,5,jsonb_build_object('sku','800659','product','Todinnito 85 g','brand','TODINNITO','weightKg',0.085,'saleModes',jsonb_build_array('UNIDADES'),'unitsPerPackage',1,'unitPrice',5,'totalPrice',5,'status','ACTIVO'),now())
    ON CONFLICT (sku) DO NOTHING;
    UPDATE product_prices
    SET data = COALESCE(data, '{}'::jsonb) || jsonb_build_object(
      'sku',sku,'product',product,'brand','TODINNO','weightKg',0.9,
      'saleModes',jsonb_build_array('UNIDADES','PLANCHAS'),
      'unitsPerPackage',units_per_package,'unitPrice',unit_price,
      'totalPrice',total_price,'status',COALESCE(data->>'status','ACTIVO')
    ),record_updated_at=COALESCE(record_updated_at,now())
    WHERE sku='801177';
    UPDATE product_prices
    SET data = COALESCE(data, '{}'::jsonb) || jsonb_build_object(
      'sku',sku,'product',product,'brand','COSTA','weightKg',0.8,
      'saleModes',jsonb_build_array('UNIDADES','PLANCHAS'),
      'unitsPerPackage',units_per_package,'unitPrice',unit_price,
      'totalPrice',total_price,'status',COALESCE(data->>'status','ACTIVO')
    ),record_updated_at=COALESCE(record_updated_at,now())
    WHERE sku='801200';
    UPDATE product_prices
    SET data = COALESCE(data, '{}'::jsonb) || jsonb_build_object(
      'sku',sku,'product',product,'brand','PASQUALINO','weightKg',0.8,
      'saleModes',jsonb_build_array('UNIDADES','PLANCHAS'),
      'unitsPerPackage',units_per_package,'unitPrice',unit_price,
      'totalPrice',total_price,'status',COALESCE(data->>'status','ACTIVO')
    ),record_updated_at=COALESCE(record_updated_at,now())
    WHERE sku='800891';
    UPDATE product_prices
    SET data = COALESCE(data, '{}'::jsonb) || jsonb_build_object(
      'sku',sku,'product',product,'brand','COSTA MINIONS','weightKg',0.08,
      'saleModes',jsonb_build_array('UNIDADES'),
      'unitsPerPackage',units_per_package,'unitPrice',unit_price,
      'totalPrice',total_price,'status',COALESCE(data->>'status','ACTIVO')
    ),record_updated_at=COALESCE(record_updated_at,now())
    WHERE sku='801201';
    UPDATE product_prices
    SET data = COALESCE(data, '{}'::jsonb) || jsonb_build_object(
      'sku',sku,'product',product,'brand','COSTA JURASSIC','weightKg',0.08,
      'saleModes',jsonb_build_array('UNIDADES'),
      'unitsPerPackage',units_per_package,'unitPrice',unit_price,
      'totalPrice',total_price,'status',COALESCE(data->>'status','ACTIVO')
    ),record_updated_at=COALESCE(record_updated_at,now())
    WHERE sku='801384';
    UPDATE product_prices
    SET data = COALESCE(data, '{}'::jsonb) || jsonb_build_object(
      'sku',sku,'product',product,'brand','TODINNITO','weightKg',0.085,
      'saleModes',jsonb_build_array('UNIDADES'),
      'unitsPerPackage',units_per_package,'unitPrice',unit_price,
      'totalPrice',total_price,'status',COALESCE(data->>'status','ACTIVO')
    ),record_updated_at=COALESCE(record_updated_at,now())
    WHERE sku='800659';
    CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date DESC); CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(event_date DESC); CREATE INDEX IF NOT EXISTS idx_movements_date ON inventory_movements(movement_date DESC); CREATE INDEX IF NOT EXISTS idx_closures_date ON session_closures(closure_date DESC);
  `);
}
