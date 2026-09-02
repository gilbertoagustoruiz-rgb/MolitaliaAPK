import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Camera, Check, CheckCircle2, Clock3, Download, FileSpreadsheet, Gift, LogOut, MapPin, PackageCheck, Plus, RefreshCw, Search, ShieldCheck, ShoppingBag, Smartphone, Store, Upload, UserRound, Users, Wifi, WifiOff, X } from 'lucide-react';

type Role = 'ANALISTA' | 'PROMOTOR' | 'SUPERVISOR' | 'TRADE' | 'ADMIN';
type Status = 'ACTIVO' | 'INACTIVO';
type SyncStatus = 'SINCRONIZADA' | 'PENDIENTE';
type Market = { id: string; department: string; region?: string; province: string; district: string; name: string; status: Status };
type AppUser = { id: string; dni: string; name: string; role: Role; marketId?: string; password?: string; status: Status };
type PromoterAssignment = { promoterId: string; marketIds: string[]; clientIds: string[]; updatedAt: string };
type AssignmentRelationship = { key: string; promoter: AppUser; marketId: string; client: Client | null };
type Client = { id: string; code: string; name: string; phone?: string; marketId: string; status: Status };
type Sale = { id: string; promoterId: string; clientId: string; marketId: string; mode: 'UNIDADES' | 'PLANCHAS'; units: number; amountSoles: number; weightKg?: number; unitPrices?: Record<string, number>; planchas?: number; mix: Record<string, number>; bonus?: string; comment?: string; receiptPhoto: string; exchangePhoto?: string; date: string; status: SyncStatus };
type Attendance = { id: string; promoterId: string; clientId: string; marketId: string; type: 'ENTRADA' | 'SALIDA'; photo: string; date: string; status: SyncStatus };
type SessionClosure = { id: string; promoterId: string; marketId: string; clientId?: string; tastingUsed: number; leads: number; date: string; status: SyncStatus };
type RedemptionItemId = 'AVENA' | 'BATEA' | 'MANDIL' | 'SPAGHETTI';
type RedemptionStock = Record<RedemptionItemId, number>;
type MarketInventory = { marketId: string; tastingStock: number; redemptionStock: RedemptionStock; updatedAt: string; exchangeStock?: number };
type InventoryMovementKind = 'CANJE' | 'DEGUSTACION' | 'AJUSTE_DEGUSTACION' | 'AJUSTE_CANJES';
type InventoryMovement = { id: string; marketId: string; kind: InventoryMovementKind; itemId?: RedemptionItemId; quantity: number; actorId: string; actorName: string; date: string; status: SyncStatus };
type Toast = { message: string; error?: boolean };

const MARKETS_SHEET = 'https://docs.google.com/spreadsheets/d/1GCbfnfCgZdXBaPzVsnrhjos_K0h5j0WXxKOanAIjUtM/export?format=csv&gid=0';
const CLIENTS_SHEET_ID = '1K5KSSrBPiTtldeOjZ--w--3v9ID1oUq_z_PFkqMYtZA';
const USERS_SHEET_ID = '1xKb-WZaJYFoBxeanLDVBxu6SJlv7Kz2sKIYwS8veEyo';
const GOOGLE_SHEETS_PROXY = '/api/google-sheets';
const DEFAULT_CAMPAIGN_TASTING_STOCK = 20;
const DEFAULT_CAMPAIGN_REDEMPTION_STOCK = 10;
const DEFAULT_STOCK_SEED_KEY = 'bt-inventory-defaults-v1';
const redemptionItems: { id: RedemptionItemId; label: string }[] = [
  { id: 'AVENA', label: 'Avena' },
  { id: 'BATEA', label: 'Batea' },
  { id: 'MANDIL', label: 'Mandil' },
  { id: 'SPAGHETTI', label: 'Spaghetti' },
];
function emptyRedemptionStock(): RedemptionStock {
  return { AVENA: DEFAULT_CAMPAIGN_REDEMPTION_STOCK, BATEA: DEFAULT_CAMPAIGN_REDEMPTION_STOCK, MANDIL: DEFAULT_CAMPAIGN_REDEMPTION_STOCK, SPAGHETTI: DEFAULT_CAMPAIGN_REDEMPTION_STOCK };
}
function emptyInventory(marketId: string): MarketInventory {
  return { marketId, tastingStock: DEFAULT_CAMPAIGN_TASTING_STOCK, redemptionStock: emptyRedemptionStock(), updatedAt: new Date().toISOString() };
}
function ensureInventory(markets: Market[], stored: MarketInventory[]) {
  const byMarket = new Map(stored.map(item => [item.marketId, item]));
  const next: MarketInventory[] = Array.from(byMarket.values()).map(existing => {
    const legacyStock = Math.max(0, Math.floor(Number(existing.exchangeStock) || 0));
    const source = existing.redemptionStock || emptyRedemptionStock();
    const redemptionStock = redemptionItems.reduce((result, item) => ({ ...result, [item.id]: Math.max(0, Math.floor(Number(source[item.id]) || 0)) }), {} as RedemptionStock);
    return { ...existing, tastingStock: Math.max(0, Math.floor(Number(existing.tastingStock) || 0)), redemptionStock, exchangeStock: legacyStock, updatedAt: existing.updatedAt || new Date().toISOString() };
  });
  markets.forEach(market => {
    if (!byMarket.has(market.id)) next.push(emptyInventory(market.id));
  });
  return next;
}
function initializeCampaignInventory(markets: Market[], stored: MarketInventory[]) {
  const normalized = ensureInventory(markets, stored);
  if (readStore<boolean>(DEFAULT_STOCK_SEED_KEY, false)) return normalized;
  const seeded = normalized.map(item => ({ ...item, tastingStock: DEFAULT_CAMPAIGN_TASTING_STOCK, redemptionStock: emptyRedemptionStock(), updatedAt: new Date().toISOString() }));
  writeStore('bt-inventory', seeded); writeStore(DEFAULT_STOCK_SEED_KEY, true);
  return seeded;
}
const products = [
  { sku: '801177', brand: 'TODINNO', name: 'Panetón Todinno 900 g + Todinnito 85 g', weightKg: 0.9 },
  { sku: '801200', brand: 'COSTA', name: 'Panetón Costa 800 g', weightKg: 0.8 },
  { sku: '800891', brand: 'PASQUALINO', name: 'Pasqualino 800 g', weightKg: 0.8 },
  { sku: '801201', brand: 'COSTA', name: 'Mini Costa Minions 80 g', weightKg: 0.08 },
  { sku: '801384', brand: 'COSTA', name: 'Mini Costa Jurassic 80 g', weightKg: 0.08 },
  { sku: '800659', brand: 'TODINNO', name: 'Todinnito 85 g', weightKg: 0.085 },
];
const planchaProducts = { TODINNO: products[0], COSTA: products[1], PASQUALINO: products[2] };

function readStore<T>(key: string, fallback: T): T {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}
function writeStore(key: string, value: unknown) { localStorage.setItem(key, JSON.stringify(value)); }
const APP_DATA_KEYS = ['bt-session', 'bt-markets', 'bt-users', 'bt-clients', 'bt-sales', 'bt-attendance', 'bt-inventory', 'bt-inventory-movements', 'bt-session-closures', DEFAULT_STOCK_SEED_KEY];
const TEST_DATA_CLEARED_KEY = 'bt-test-data-cleared-v1';
function clearTestDataOnce() {
  if (typeof localStorage === 'undefined' || localStorage.getItem(TEST_DATA_CLEARED_KEY)) return;
  APP_DATA_KEYS.forEach(key => localStorage.removeItem(key));
  localStorage.setItem(TEST_DATA_CLEARED_KEY, 'true');
}
function csvValue(value: unknown) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
function downloadCsv(filename: string, headers: string[], rows: unknown[][]) {
  const csv = [headers, ...rows].map(row => row.map(csvValue).join(';')).join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  link.download = filename; document.body.appendChild(link); link.click(); link.remove();
  URL.revokeObjectURL(link.href);
}
function parseCsvLine(line: string) {
  const values: string[] = []; let current = ''; let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const character = line[i];
    if (character === '"' && line[i + 1] === '"') { current += '"'; i += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { values.push(current); current = ''; }
    else current += character;
  }
  values.push(current); return values;
}
function parseCsvText(text: string) {
  const firstLine = text.split(/\r?\n/).find(line => line.trim()) || '';
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows: string[][] = []; let row: string[] = []; let current = ''; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const character = text[i];
    if (character === '"' && text[i + 1] === '"') { current += '"'; i += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === delimiter && !quoted) { row.push(current.trim()); current = ''; }
    else if (character === '\n' && !quoted) { row.push(current.trim().replace(/\r$/, '')); current = ''; if (row.some(value => value)) rows.push(row); row = []; }
    else current += character;
  }
  if (current || row.length) { row.push(current.trim().replace(/\r$/, '')); if (row.some(value => value)) rows.push(row); }
  return rows;
}
function parseCsvRecords(text: string) {
  const rows = parseCsvText(text);
  if (rows.length < 2) throw new Error('El CSV debe tener encabezados y al menos una fila');
  const headers = rows[0].map(normalizeCsvHeader);
  return rows.slice(1).map(row => Object.fromEntries(headers.map((header, index) => [header, (row[index] || '').trim()])));
}
async function fetchGoogleSheetRecords(sheetId: string) {
  const response = await fetch(`${GOOGLE_SHEETS_PROXY}/${encodeURIComponent(sheetId)}?gid=0`);
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.json() as { message?: string }).message || ''; } catch { detail = ''; }
    throw new Error(detail || `Google Sheets no disponible (${response.status})`);
  }
  return parseCsvRecords(await response.text());
}
function normalizeCsvHeader(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
function csvField(record: Record<string, string>, aliases: string[]) {
  const key = aliases.map(normalizeCsvHeader).find(alias => Object.prototype.hasOwnProperty.call(record, alias));
  return key ? record[key] : '';
}
function csvStatus(value: string): Status {
  return normalizeCsvHeader(value) === 'inactivo' ? 'INACTIVO' : 'ACTIVO';
}
function csvMarketId(value: string, markets: Market[]) {
  const normalized = normalizeCsvHeader(value);
  return markets.find(market => [market.id, market.name, market.district].some(candidate => normalizeCsvHeader(candidate) === normalized))?.id;
}
function importedUserFromRecord(record: Record<string, string>, index: number, markets: Market[]): AppUser | null {
  const dni = csvField(record, ['dni', 'documento', 'documentoidentidad']);
  const firstName = csvField(record, ['nombre', 'nombrecompleto', 'usuario', 'nombres']);
  const lastName = csvField(record, ['apellido', 'apellidos']);
  const name = [firstName, lastName].filter(Boolean).join(' ');
  const rawRole = normalizeCsvHeader(csvField(record, ['rol', 'cargo', 'perfil', 'tipousuario']));
  const roleValue = rawRole.startsWith('promotor') ? 'PROMOTOR' : rawRole === 'coordinador' ? 'SUPERVISOR' : rawRole.toUpperCase() as Role;
  const marketValue = csvField(record, ['marketid', 'idmercado', 'idmerc', 'mercadoid', 'mercado', 'market', 'nombremercado']);
  const marketId = marketValue ? csvMarketId(marketValue, markets) : undefined;
  if (!/^\d{8}$/.test(dni) || !name || !['PROMOTOR', 'SUPERVISOR', 'ANALISTA', 'TRADE', 'ADMIN'].includes(roleValue) || (roleValue === 'PROMOTOR' && marketValue && !marketId)) return null;
  return { id: csvField(record, ['id', 'codigo', 'idusuario', 'idpromotor']) || `USR-IMP-${index + 1}`, dni, name, role: roleValue, marketId: roleValue === 'PROMOTOR' ? marketId : undefined, password: csvField(record, ['clave', 'password', 'contrasena']) || undefined, status: csvStatus(csvField(record, ['estado', 'status'])) };
}
function formatDate(value: string) { return new Date(value).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }); }
function formatSoles(value: number | undefined) { return `S/ ${Number(value ?? 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function formatKilos(value: number | undefined) { return `${Number(value ?? 0).toLocaleString('es-PE', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg`; }
function saleExportBreakdown(sale: Sale) {
  if (sale.mode === 'PLANCHAS') {
    return Object.entries(sale.mix || {}).filter(([, quantity]) => Number(quantity) > 0).map(([brand, quantity]) => ({
      label: planchaProducts[brand as keyof typeof planchaProducts]?.brand || brand,
      units: Number(quantity),
      unitPrice: Number(sale.unitPrices?.[brand] ?? 0),
    }));
  }
  const sku = Object.keys(sale.unitPrices || {})[0];
  const product = products.find(item => item.sku === sku);
  const brand = product?.brand || Object.keys(sale.mix || {})[0] || 'Producto';
  return [{ label: product ? `${product.brand} · ${product.name}` : brand, units: sale.units, unitPrice: Number(sale.unitPrices?.[sku] ?? (sale.units > 0 ? sale.amountSoles / sale.units : 0)) }];
}
type SalesSummaryRow = { key: string; region: string; city: string; soles: number; units: number; kilos: number; salesCount: number };
function saleWeightKg(sale: Sale) {
  if (Number(sale.weightKg) > 0) return Number(sale.weightKg);
  if (sale.mode === 'UNIDADES') {
    const sku = Object.keys(sale.unitPrices || {})[0];
    return sale.units * (products.find(item => item.sku === sku)?.weightKg || 0);
  }
  return Object.entries(sale.mix || {}).reduce((sum, [brand, quantity]) => sum + Number(quantity) * (planchaProducts[brand as keyof typeof planchaProducts]?.weightKg || 0), 0);
}
function aggregateSalesByRegionCity(sales: Sale[], markets: Market[]) {
  const marketMap = Object.fromEntries(markets.map(market => [market.id, market]));
  const grouped = new Map<string, SalesSummaryRow>();
  sales.forEach(sale => {
    const market = marketMap[sale.marketId];
    const region = market?.region || market?.department || 'SIN REGIÓN';
    const city = market?.province || market?.district || 'SIN CIUDAD';
    const key = `${region} · ${city}`;
    const current = grouped.get(key) || { key, region, city, soles: 0, units: 0, kilos: 0, salesCount: 0 };
    current.soles += Number(sale.amountSoles) || 0;
    current.units += Number(sale.units) || 0;
    current.kilos += saleWeightKg(sale);
    current.salesCount += 1;
    grouped.set(key, current);
  });
  return Array.from(grouped.values()).sort((first, second) => second.soles - first.soles);
}
type SalesMetricRow = { key: string; label: string; subtitle: string; soles: number; units: number; kilos: number; salesCount: number };
function aggregateSalesMetrics(sales: Sale[], getGroup: (sale: Sale) => { key: string; label: string; subtitle: string }) {
  const grouped = new Map<string, SalesMetricRow>();
  sales.forEach(sale => {
    const group = getGroup(sale);
    const current = grouped.get(group.key) || { ...group, soles: 0, units: 0, kilos: 0, salesCount: 0 };
    current.soles += Number(sale.amountSoles) || 0;
    current.units += Number(sale.units) || 0;
    current.kilos += saleWeightKg(sale);
    current.salesCount += 1;
    grouped.set(group.key, current);
  });
  return Array.from(grouped.values()).sort((first, second) => second.soles - first.soles);
}
function aggregateSalesByRegion(sales: Sale[], markets: Market[]) {
  const marketMap = Object.fromEntries(markets.map(market => [market.id, market]));
  return aggregateSalesMetrics(sales, sale => {
    const market = marketMap[sale.marketId];
    const region = market?.region || market?.department || 'SIN REGIÓN';
    return { key: region, label: region, subtitle: 'Región' };
  });
}
function aggregateSalesByMarket(sales: Sale[], markets: Market[]) {
  const marketMap = Object.fromEntries(markets.map(market => [market.id, market]));
  return aggregateSalesMetrics(sales, sale => {
    const market = marketMap[sale.marketId];
    return { key: sale.marketId, label: market?.name || 'MERCADO NO IDENTIFICADO', subtitle: `${market?.region || market?.department || 'SIN REGIÓN'} · ${market?.province || market?.district || 'SIN CIUDAD'}` };
  });
}
function aggregateSalesByPromoter(sales: Sale[], users: AppUser[]) {
  const userMap = Object.fromEntries(users.map(user => [user.id, user]));
  return aggregateSalesMetrics(sales, sale => {
    const promoter = userMap[sale.promoterId];
    return { key: sale.promoterId, label: promoter?.name || 'PROMOTOR NO IDENTIFICADO', subtitle: promoter?.dni ? `DNI ${promoter.dni}` : 'Promotor' };
  });
}
function aggregateSalesByBrand(sales: Sale[]) {
  const grouped = new Map<string, SalesMetricRow>();
  sales.forEach(sale => {
    const entries = Object.entries(sale.mix || {});
    const brandEntries = entries.length ? entries : [['SIN MARCA', sale.units] as [string, number]];
    brandEntries.forEach(([brand, rawQuantity]) => {
      const units = Number(rawQuantity) || 0;
      if (units <= 0) return;
      const unitPrice = Number(sale.unitPrices?.[brand] ?? 0);
      const amount = sale.mode === 'PLANCHAS' ? units * unitPrice : (sale.units > 0 ? sale.amountSoles * (units / sale.units) : 0);
      const kilos = sale.mode === 'PLANCHAS' ? units * (planchaProducts[brand as keyof typeof planchaProducts]?.weightKg || 0) : saleWeightKg(sale) * (sale.units > 0 ? units / sale.units : 0);
      const key = brand.toUpperCase();
      const current = grouped.get(key) || { key, label: key, subtitle: 'Marca', soles: 0, units: 0, kilos: 0, salesCount: 0 };
      current.soles += amount;
      current.units += units;
      current.kilos += kilos;
      current.salesCount += 1;
      grouped.set(key, current);
    });
  });
  return Array.from(grouped.values()).sort((first, second) => second.units - first.units);
}
function parseSoles(value: string) { return Number(value.replace(',', '.')); }
function syncStatus(): SyncStatus { return typeof navigator === 'undefined' || navigator.onLine ? 'SINCRONIZADA' : 'PENDIENTE'; }
function movementLabel(kind: InventoryMovementKind, itemId?: RedemptionItemId) {
  const itemSuffix = itemId ? ` · ${redemptionLabel(itemId)}` : '';
  return `${kind === 'CANJE' ? 'Canje registrado' : kind === 'DEGUSTACION' ? 'Degustación declarada' : kind === 'AJUSTE_DEGUSTACION' ? 'Ajuste de degustación' : 'Ajuste de canjes'}${itemSuffix}`;
}
function movementAmount(movement: InventoryMovement) {
  if (movement.kind === 'CANJE' || movement.kind === 'DEGUSTACION') return -movement.quantity;
  return movement.quantity;
}
function redemptionLabel(itemId?: RedemptionItemId) {
  return redemptionItems.find(item => item.id === itemId)?.label || 'Premio';
}
function parseBonusItems(bonus?: string): Partial<RedemptionStock> {
  if (!bonus) return {};
  const text = bonus.toUpperCase();
  const requirements: Partial<RedemptionStock> = {};
  const match = (itemId: RedemptionItemId, pattern: RegExp) => {
    const found = text.match(pattern);
    if (found) requirements[itemId] = Number(found[1]);
  };
  match('AVENA', /(\d+)\s+AVENA(?:S)?/);
  match('BATEA', /(\d+)\s+BATEA(?:S)?/);
  match('MANDIL', /(\d+)\s+MANDIL(?:ES)?/);
  match('SPAGHETTI', /(\d+)\s+SPAGHETTI/);
  return requirements;
}
function requiredRedemptionEntries(requirements: Partial<RedemptionStock>) {
  return redemptionItems.filter(item => (requirements[item.id] || 0) > 0).map(item => [item.id, requirements[item.id] || 0] as const);
}
function bonusFor(mode: 'UNIDADES' | 'PLANCHAS', total: number, planchas: number) {
  if (mode === 'UNIDADES') return total === 2 ? '1 AVENA CLÁSICA' : undefined;
  if (planchas > 80) return '144 AVENAS + 100 SPAGHETTI + 4 MANDILES';
  if (planchas === 10) return '24 AVENAS + 10 SPAGHETTI + 1 MANDIL';
  if (planchas === 4) return '12 AVENAS + 3 SPAGHETTI';
  if (planchas === 1) return '3 AVENAS + 1 SPAGHETTI';
  return undefined;
}

function Logo({ compact = false }: { compact?: boolean }) {
  return <img className={`logo ${compact ? 'logo-invert' : ''}`} src="/below-trade-logo.png" alt="Below Trade" data-testid="img-below-trade-logo" />;
}
function Btn({ children, onClick, variant = 'primary', disabled = false, type = 'button', className = '', testId }: { children: ReactNode; onClick?: () => void; variant?: 'primary' | 'dark' | 'outline' | 'ghost' | 'danger'; disabled?: boolean; type?: 'button' | 'submit'; className?: string; testId?: string }) {
  return <button type={type} disabled={disabled} onClick={onClick} className={`btn btn-${variant} ${className}`} data-testid={testId}>{children}</button>;
}
function CsvImportButton({ label, onImport, testId }: { label: string; onImport: (file: File) => Promise<void>; testId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const chooseFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setLoading(true);
    try { await onImport(file); } finally { setLoading(false); }
  };
  return <><input ref={inputRef} className="csv-file-input" type="file" accept=".csv,text/csv" onChange={chooseFile} /><Btn variant="outline" onClick={() => inputRef.current?.click()} disabled={loading} testId={testId}>{loading ? <RefreshCw className="spin" /> : <Upload />}{loading ? 'Leyendo CSV...' : label}</Btn></>;
}
function CsvExampleButton({ onDownload, testId }: { onDownload: () => void; testId: string }) {
  return <Btn variant="outline" onClick={onDownload} testId={testId}><Download /> Descargar ejemplo</Btn>;
}
function Input({ value, onChange, placeholder, type = 'text', min, max, step, maxLength, autoComplete, testId }: { value: string | number; onChange: (value: string) => void; placeholder?: string; type?: string; min?: number; max?: number; step?: number; maxLength?: number; autoComplete?: string; testId?: string }) {
  return <input className="input" value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} type={type} min={min} max={max} step={step} maxLength={maxLength} autoComplete={autoComplete} data-testid={testId} />;
}
function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return <label className={`field ${className}`}><span className="form-label">{label}</span>{children}</label>;
}
function SelectField({ label, value, onChange, items, placeholder = 'Seleccionar' }: { label: string; value: string; onChange: (value: string) => void; items: { value: string; label: string }[]; placeholder?: string }) {
  return <Field label={label}><select className="select" value={value} onChange={event => onChange(event.target.value)} data-testid={`select-${label.toLowerCase().replaceAll(' ', '-')}`}><option value="">{placeholder}</option>{items.map(item => <option value={item.value} key={item.value}>{item.label}</option>)}</select></Field>;
}
function Empty({ title = 'Aún no hay ventas', detail = 'Los registros aparecerán aquí.' }: { title?: string; detail?: string }) {
  return <div className="empty" data-testid="empty-state"><ShoppingBag /><h3>{title}</h3><p>{detail}</p></div>;
}
function StatusPill({ status }: { status: string }) {
  const className = status === 'PENDIENTE' ? 'pending' : status === 'INACTIVO' ? 'inactive' : status === 'SINCRONIZADA' ? 'synced' : 'active';
  return <span className={`status ${className}`} data-testid={`status-${status.toLowerCase()}`}>{status}</span>;
}
function PhotoField({ label, hint, file, setFile, disabled = false }: { label: string; hint: string; file: File | null; setFile: (file: File | null) => void; disabled?: boolean }) {
  return <label className={`photo-field ${file ? 'ready' : ''} ${disabled ? 'disabled' : ''}`} data-testid={`photo-field-${label.toLowerCase().replaceAll(' ', '-')}`}>
    <input type="file" accept="image/*" capture="environment" disabled={disabled} onChange={event => setFile(event.target.files?.[0] ?? null)} />
    <span><Camera /></span><strong>{file ? file.name : label}</strong><small>{file ? 'Foto lista para cargar' : hint}</small>
  </label>;
}

function ToastView({ toast, clear }: { toast: Toast | null; clear: () => void }) {
  useEffect(() => { if (!toast) return undefined; const timer = window.setTimeout(clear, 3200); return () => window.clearTimeout(timer); }, [toast, clear]);
  return toast ? <div className={`toast ${toast.error ? 'error' : ''}`} role="status" data-testid="status-feedback">{toast.message}</div> : null;
}
function Modal({ title, detail, children, close }: { title: string; detail: string; children: ReactNode; close: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) close(); }}>
    <section className="modal" role="dialog" aria-modal="true" aria-label={title}><div className="modal-head"><div><h2>{title}</h2><p>{detail}</p></div><button className="icon-button" onClick={close} aria-label="Cerrar" data-testid="button-close-modal"><X /></button></div>{children}</section>
  </div>;
}

function Login({ users, onLogin, notify }: { users: AppUser[]; onLogin: (user: AppUser) => void; notify: (message: string, error?: boolean) => void }) {
  const [dni, setDni] = useState(''); const [password, setPassword] = useState('');
  const submit = () => {
    const user = users.find(item => item.dni === dni && item.password === password && item.status === 'ACTIVO') || null;
    if (!user) { notify('DNI o clave incorrectos', true); return; }
    writeStore('bt-session', user); onLogin(user);
  };
  return <main className="login-shell">
    <section className="login-hero"><Logo compact /><div className="hero-copy"><span className="eyebrow">CAMPAÑA 2026</span><h1>Panetones Molitalia</h1><p>Ventas, clientes, dinámicas y evidencias en una sola aplicación.</p></div><div className="hero-foot"><span /> Captura segura para trabajo en campo</div></section>
    <section className="login-panel"><form className="login-card" onSubmit={event => { event.preventDefault(); submit(); }}><div className="mobile-logo"><Logo /></div><div className="login-heading"><span className="icon-disc"><ShieldCheck /></span><div><h2>Bienvenido</h2><p>Ingresa con tu DNI y clave.</p></div></div>
       <Field label="DNI"><Input value={dni} onChange={value => setDni(value.replace(/\D/g, ''))} placeholder="12345678" maxLength={8} autoComplete="username" testId="input-dni" /></Field>
       <Field label="Clave"><Input value={password} onChange={setPassword} placeholder="Ingresa tu clave" type="password" autoComplete="current-password" testId="input-password" /></Field>
       <Btn className="primary full" type="submit" testId="button-login">Ingresar</Btn>
      <div className="login-note"><Smartphone /> Instalable en iPhone y Android</div>
     </form></section>
  </main>;
}

function Shell({ user, logout, children }: { user: AppUser; logout: () => void; children: ReactNode }) {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  useEffect(() => { const update = () => setOnline(navigator.onLine); update(); window.addEventListener('online', update); window.addEventListener('offline', update); return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); }; }, []);
  return <div className="bt-app"><header className="topbar"><Logo compact /><div className="campaign"><small>Campaña</small><strong>Panetones Molitalia</strong></div><div className="top-user"><div className="top-user-info"><strong>{user.name}</strong><small>{user.role}</small></div><Btn variant="ghost" onClick={logout} testId="button-logout"><LogOut /> Salir</Btn></div></header>{!online && <div className="offline-bar" role="status" aria-live="polite" data-testid="status-offline"><WifiOff /> Sin conexión · cambios guardados en este dispositivo</div>}{online && <div className="offline-bar" role="status" aria-live="polite" data-testid="status-online"><Wifi /> Con conexión · aplicación lista para operar</div>}{children}</div>;
}

function Stat({ icon, label, value, note }: { icon: ReactNode; label: string; value: number; note: string }) {
  return <article className="stat" data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`}><span className="stat-icon">{icon}</span><div><p>{label}</p><strong>{value.toLocaleString('es-PE')}</strong><small>{note}</small></div></article>;
}
function DownloadCard({ title, detail, onClick }: { title: string; detail: string; onClick: () => void }) {
  return <article className="download-card"><span><Download /></span><div><strong>{title}</strong><small>{detail}</small></div><Btn variant="outline" onClick={onClick} testId={`button-download-${title.toLowerCase()}`}><Download /> Descargar</Btn></article>;
}

function NewUserModal({ markets, onSave, close }: { markets: { value: string; label: string }[]; onSave: (user: AppUser) => void; close: () => void }) {
  const [dni, setDni] = useState(''); const [name, setName] = useState(''); const [marketId, setMarketId] = useState(''); const [password, setPassword] = useState(''); const [role, setRole] = useState<Role>('PROMOTOR');
  const save = () => {
    if (dni.length !== 8 || !name.trim() || password.length < 8 || (role === 'PROMOTOR' && !marketId)) return;
    onSave({ id: `USR-${Date.now()}`, dni, name: name.trim(), role, marketId: role === 'PROMOTOR' ? marketId : undefined, password, status: 'ACTIVO' }); close();
  };
  return <Modal title="Crear usuario" detail="Define acceso, rol y mercado." close={close}><div className="form-grid"><Field label="DNI *"><Input value={dni} onChange={value => setDni(value.replace(/\D/g, ''))} maxLength={8} testId="input-new-user-dni" /></Field><Field label="Nombre completo *"><Input value={name} onChange={setName} testId="input-new-user-name" /></Field><SelectField label="Rol *" value={role} onChange={value => setRole(value as Role)} items={['PROMOTOR', 'SUPERVISOR', 'ANALISTA', 'TRADE', 'ADMIN'].map(value => ({ value, label: value }))} />{role === 'PROMOTOR' && <SelectField label="Mercado asignado *" value={marketId} onChange={setMarketId} items={markets} />}<Field label="Clave temporal *"><Input value={password} onChange={setPassword} type="password" testId="input-new-user-password" /></Field></div><div className="modal-actions"><Btn variant="outline" onClick={close}>Cancelar</Btn><Btn onClick={save} testId="button-create-user">Crear usuario</Btn></div></Modal>;
}
function NewClientModal({ markets, count, onSave, close }: { markets: { value: string; label: string }[]; count: number; onSave: (client: Client) => void; close: () => void }) {
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [marketId, setMarketId] = useState('');
  const save = () => { if (!name.trim() || !marketId) return; onSave({ id: `${Date.now()}`, code: `CLI-${String(count + 1).padStart(6, '0')}`, name: name.trim(), phone: phone || undefined, marketId, status: 'ACTIVO' }); close(); };
  return <Modal title="Crear cliente" detail="El código y estado se generan automáticamente." close={close}><div className="form-grid"><Field label="Nombre del cliente *"><Input value={name} onChange={setName} testId="input-new-client-name" /></Field><Field label="Celular (opcional)"><Input value={phone} onChange={setPhone} testId="input-new-client-phone" /></Field><SelectField label="Mercado *" value={marketId} onChange={setMarketId} items={markets} /></div><div className="modal-actions"><Btn variant="outline" onClick={close}>Cancelar</Btn><Btn onClick={save} testId="button-create-client">Guardar cliente</Btn></div></Modal>;
}

function SessionCloseModal({ available, onConfirm, close }: { available: number; onConfirm: (tastingUsed: number, leads: number) => void; close: () => void }) {
  const [quantity, setQuantity] = useState(''); const [leads, setLeads] = useState('');
  const parsedQuantity = quantity === '' ? NaN : Number(quantity); const parsedLeads = leads === '' ? NaN : Number(leads);
  const valid = Number.isInteger(parsedQuantity) && parsedQuantity >= 0 && parsedQuantity <= available && Number.isInteger(parsedLeads) && parsedLeads >= 0;
  return <Modal title="Cierra tu jornada" detail="Antes de salir, registra tu degustación y los posibles Leads de hoy." close={close}>
    <div className="logout-declaration">
      <div className="stock-callout"><PackageCheck /><div><strong>{available} disponibles</strong><small>Stock de degustación en tu mercado</small></div></div>
      <div className="form-grid"><Field label="Panetones utilizados *"><Input type="number" value={quantity} onChange={value => setQuantity(value.replace(/\D/g, ''))} min={0} step={1} placeholder="0" testId="input-tasting-usage" /></Field><Field label="Posibles Leads *"><Input type="number" value={leads} onChange={value => setLeads(value.replace(/\D/g, ''))} min={0} step={1} placeholder="0" testId="input-session-leads" /></Field></div>
      {Number.isFinite(parsedQuantity) && parsedQuantity > available && <p className="modal-error">La cantidad ingresada supera el stock disponible ({available}).</p>}
      <p className="modal-hint">{available > 0 ? 'Si no utilizaste ninguno o no tuviste Leads, registra 0. La degustación se descontará al cerrar la sesión.' : 'No hay stock disponible en este mercado. Registra 0 en degustación y Leads para cerrar la sesión.'}</p>
    </div>
    <div className="modal-actions"><Btn variant="outline" onClick={close}>Seguir trabajando</Btn><Btn disabled={!valid} onClick={() => onConfirm(parsedQuantity, parsedLeads)} testId="button-confirm-logout"><LogOut /> Confirmar y salir</Btn></div>
  </Modal>;
}

function InventoryModule({ markets, inventory, movements, notify, onImportCsv, onDownloadExample }: { markets: Market[]; inventory: MarketInventory[]; movements: InventoryMovement[]; notify: (message: string, error?: boolean) => void; onImportCsv: (file: File) => Promise<void>; onDownloadExample: () => void }) {
  const marketMap = Object.fromEntries(markets.map(market => [market.id, market]));
  const totals = inventory.reduce((result, item) => ({ tasting: result.tasting + item.tastingStock, redemption: result.redemption + redemptionItems.reduce((sum, redemption) => sum + item.redemptionStock[redemption.id], 0) }), { tasting: 0, redemption: 0 });
  const exportInventory = () => {
    const today = new Date().toISOString().slice(0, 10);
    downloadCsv(`stock-canjes-degustacion-${today}.csv`, ['Mercado', 'Distrito', 'Stock degustación', ...redemptionItems.map(item => `Stock ${item.label}`), 'Actualizado'], markets.map(market => { const stock = inventory.find(item => item.marketId === market.id) || emptyInventory(market.id); return [market.name, market.district, stock.tastingStock, ...redemptionItems.map(item => stock.redemptionStock[item.id]), formatDate(stock.updatedAt)]; }));
    notify('Reporte de stock descargado');
  };
  const exportMovements = () => {
    const today = new Date().toISOString().slice(0, 10);
    downloadCsv(`movimientos-stock-${today}.csv`, ['Fecha', 'Mercado', 'Movimiento', 'Cantidad', 'Responsable', 'Estado'], movements.map(movement => [formatDate(movement.date), marketMap[movement.marketId]?.name || 'Mercado', movementLabel(movement.kind, movement.itemId), movementAmount(movement), movement.actorName, movement.status]));
    notify('Reporte de movimientos descargado');
  };
  const sortedMovements = [...movements].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  const levelClass = (value: number) => value === 0 ? 'empty' : value <= 5 ? 'low' : 'available';
  return <section className="inventory-module">
    <div className="inventory-overview"><div><span className="eyebrow">CONTROL DE CAMPAÑA</span><h2>Canjes y degustaciones</h2><p>Consulta las existencias importadas por mercado y revisa los consumos registrados.</p></div><div className="inventory-actions"><CsvImportButton label="Importar stock" onImport={onImportCsv} testId="button-import-inventory" /><CsvExampleButton onDownload={onDownloadExample} testId="button-example-inventory" /><Btn variant="outline" onClick={exportInventory}><Download /> Stock CSV</Btn><Btn variant="outline" onClick={exportMovements}><Download /> Movimientos CSV</Btn></div></div>
    <div className="inventory-summary"><article><span className="inventory-summary-icon"><PackageCheck /></span><div><small>STOCK TOTAL DE DEGUSTACIÓN</small><strong>{totals.tasting}</strong><p>Panetones disponibles</p></div></article><article><span className="inventory-summary-icon accent"><Gift /></span><div><small>UNIDADES DE CANJE</small><strong>{totals.redemption}</strong><p>Premios disponibles</p></div></article><article><span className="inventory-summary-icon blue"><MapPin /></span><div><small>MERCADOS CONTROLADOS</small><strong>{markets.length}</strong><p>Con saldo independiente</p></div></article></div>
    <section className="inventory-history"><div className="panel-header"><div><h2>Movimientos recientes</h2><p>Canjes, degustaciones y ajustes hechos por el equipo.</p></div></div>{sortedMovements.length ? <div className="movement-list">{sortedMovements.map(movement => { const amount = movementAmount(movement); return <article className="movement-row" key={movement.id}><span className={`movement-icon ${amount < 0 ? 'consume' : 'adjust'}`}>{amount < 0 ? <PackageCheck /> : <Plus />}</span><div><strong>{movementLabel(movement.kind, movement.itemId)}</strong><small>{marketMap[movement.marketId]?.name || 'Mercado'} · {movement.actorName} · {formatDate(movement.date)}</small></div><span className={`movement-amount ${amount < 0 ? 'negative' : 'positive'}`}>{amount > 0 ? '+' : ''}{amount}</span><StatusPill status={movement.status} /></article>; })}</div> : <div className="inventory-empty"><PackageCheck /><h3>Aún no hay movimientos</h3><p>Los descuentos y ajustes de stock aparecerán aquí.</p></div>}</section>
  </section>;
}

function AssignmentModule({ markets, users, clients, assignments, setAssignments, setUsers, notify }: { markets: Market[]; users: AppUser[]; clients: Client[]; assignments: PromoterAssignment[]; setAssignments: (value: PromoterAssignment[]) => void; setUsers: (value: AppUser[]) => void; notify: (message: string, error?: boolean) => void }) {
  const promoters = users.filter(user => user.role === 'PROMOTOR' && user.status === 'ACTIVO');
  const activeMarkets = markets.filter(market => market.status === 'ACTIVO');
  const [selectedPromoterId, setSelectedPromoterId] = useState('');
  const [selectedMarketIds, setSelectedMarketIds] = useState<string[]>([]);
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [marketSearch, setMarketSearch] = useState('');
  const selectedPromoter = promoters.find(promoter => promoter.id === selectedPromoterId);
  const filteredPromoters = promoters.filter(promoter => `${promoter.name} ${promoter.dni}`.toLowerCase().includes(employeeSearch.toLowerCase()));
  const filteredMarkets = activeMarkets.filter(market => `${market.name} ${market.region || ''} ${market.department} ${market.province} ${market.district}`.toLowerCase().includes(marketSearch.toLowerCase()));
  const promoterOptions = selectedPromoter && !filteredPromoters.some(promoter => promoter.id === selectedPromoter.id) ? [selectedPromoter, ...filteredPromoters] : filteredPromoters;
  const assignmentFor = (promoterId: string) => assignments.find(assignment => assignment.promoterId === promoterId);
  const relationshipRows = promoters.flatMap<AssignmentRelationship>(promoter => {
    const saved = assignmentFor(promoter.id);
    const marketIds = saved ? saved.marketIds : promoter.marketId ? [promoter.marketId] : [];
    return marketIds.flatMap<AssignmentRelationship>(marketId => {
      const marketClients = clients.filter(client => client.marketId === marketId && client.status === 'ACTIVO' && (!saved || saved.clientIds.includes(client.id)));
      return marketClients.length ? marketClients.map(client => ({ key: `${promoter.id}-${marketId}-${client.id}`, promoter, marketId, client })) : [{ key: `${promoter.id}-${marketId}-empty`, promoter, marketId, client: null }];
    });
  });
  const selectPromoter = (promoterId: string) => {
    setSelectedPromoterId(promoterId);
    const promoter = promoters.find(item => item.id === promoterId);
    const saved = assignmentFor(promoterId);
    const marketIds = saved?.marketIds || (promoter?.marketId ? [promoter.marketId] : []);
    setSelectedMarketIds(marketIds.filter(marketId => activeMarkets.some(market => market.id === marketId)));
    setSelectedClientIds(saved?.clientIds || clients.filter(client => marketIds.includes(client.marketId) && client.status === 'ACTIVO').map(client => client.id));
  };
  const toggleMarket = (marketId: string) => {
    const enabled = selectedMarketIds.includes(marketId);
    setSelectedMarketIds(enabled ? selectedMarketIds.filter(id => id !== marketId) : [...selectedMarketIds, marketId]);
    if (enabled) setSelectedClientIds(selectedClientIds.filter(clientId => clients.find(client => client.id === clientId)?.marketId !== marketId));
  };
  const toggleClient = (clientId: string) => setSelectedClientIds(selectedClientIds.includes(clientId) ? selectedClientIds.filter(id => id !== clientId) : [...selectedClientIds, clientId]);
  const toggleAllClients = (marketId: string) => {
    const marketClientIds = clients.filter(client => client.marketId === marketId && client.status === 'ACTIVO').map(client => client.id);
    const allSelected = marketClientIds.length > 0 && marketClientIds.every(clientId => selectedClientIds.includes(clientId));
    setSelectedClientIds(allSelected ? selectedClientIds.filter(clientId => !marketClientIds.includes(clientId)) : Array.from(new Set([...selectedClientIds, ...marketClientIds])));
  };
  const saveAssignment = () => {
    if (!selectedPromoterId) { notify('Selecciona un promotor para asignar', true); return; }
    if (!selectedMarketIds.length) { notify('Selecciona al menos un mercado', true); return; }
    if (!selectedClientIds.length) { notify('Selecciona al menos un cliente', true); return; }
    const next = [...assignments.filter(assignment => assignment.promoterId !== selectedPromoterId), { promoterId: selectedPromoterId, marketIds: selectedMarketIds, clientIds: selectedClientIds, updatedAt: new Date().toISOString() }];
    setAssignments(next);
    setUsers(users.map(user => user.id === selectedPromoterId ? { ...user, marketId: selectedMarketIds[0] } : user));
    notify(`Asignación guardada para ${selectedPromoter?.name || 'el promotor'}`);
  };
  const clearAssignment = () => {
    if (!selectedPromoterId) { notify('Selecciona un promotor para quitar su asignación', true); return; }
    const next = [...assignments.filter(assignment => assignment.promoterId !== selectedPromoterId), { promoterId: selectedPromoterId, marketIds: [], clientIds: [], updatedAt: new Date().toISOString() }];
    setAssignments(next);
    setUsers(users.map(user => user.id === selectedPromoterId ? { ...user, marketId: undefined } : user));
    setSelectedMarketIds([]); setSelectedClientIds([]);
    notify(`Asignación retirada para ${selectedPromoter?.name || 'el promotor'}`);
  };
  return <section className="assignment-module">
    <div className="assignment-intro"><div><span className="eyebrow">COBERTURA DE CAMPO</span><h2>Asignar mercados y clientes</h2><p>Define exactamente qué puede visitar cada promotor. Los cambios quedan guardados en este dispositivo.</p></div><div className="assignment-counter"><strong>{assignments.filter(assignment => assignment.marketIds.length > 0).length}</strong><small>promotores con asignación</small></div></div>
    <div className="assignment-grid">
      <section className="panel assignment-card"><div className="panel-header"><div><h2>1. Elige un promotor</h2><p>{promoters.length} promotores activos disponibles.</p></div><Users /></div><div className="panel-body"><div className="assignment-search"><label>Buscar empleado</label><div className="search-wrap"><Search /><Input value={employeeSearch} onChange={setEmployeeSearch} placeholder="Nombre o DNI" testId="input-search-employees" /></div></div><SelectField label="Promotor *" value={selectedPromoterId} onChange={selectPromoter} items={promoterOptions.map(promoter => ({ value: promoter.id, label: `${promoter.name} · DNI ${promoter.dni}` }))} placeholder={filteredPromoters.length ? 'Seleccionar promotor' : 'No hay coincidencias'} />{selectedPromoter && <div className="assignment-person"><span className="record-icon"><UserRound /></span><div><strong>{selectedPromoter.name}</strong><small>{selectedPromoter.dni} · {selectedPromoter.role}</small></div><StatusPill status={selectedPromoter.status} /></div>}<div className="assignment-subtitle"><strong>Mercados asignados</strong><small>Puede trabajar en uno o varios mercados.</small></div>{activeMarkets.length ? <details className="assignment-dropdown"><summary><span>Seleccionar mercados</span><strong>{selectedMarketIds.length ? `${selectedMarketIds.length} mercado${selectedMarketIds.length === 1 ? '' : 's'} seleccionado${selectedMarketIds.length === 1 ? '' : 's'}` : 'Ningún mercado seleccionado'}</strong></summary><div className="assignment-dropdown-menu"><div className="assignment-search"><label>Buscar mercado</label><div className="search-wrap"><Search /><Input value={marketSearch} onChange={setMarketSearch} placeholder="Nombre, región o distrito" testId="input-search-markets-assignment" /></div></div><div className="assignment-dropdown-head"><small>{filteredMarkets.length} de {activeMarkets.length} mercados activos</small><button type="button" className="text-button" onClick={() => setSelectedMarketIds(Array.from(new Set([...selectedMarketIds, ...filteredMarkets.map(market => market.id)])))} disabled={!filteredMarkets.length}>Seleccionar resultados</button></div><div className="assignment-check-list">{filteredMarkets.length ? filteredMarkets.map(market => <label className={`assignment-check ${selectedMarketIds.includes(market.id) ? 'selected' : ''}`} key={market.id}><input type="checkbox" checked={selectedMarketIds.includes(market.id)} onChange={() => toggleMarket(market.id)} /><span><strong>{market.name}</strong><small>{market.region || market.department} · {market.district}</small></span></label>) : <p className="assignment-empty">No hay mercados que coincidan con la búsqueda.</p>}</div></div></details> : <Empty title="No hay mercados activos" detail="Actualiza primero la hoja de Mercados." />}</div></section>
      <section className="panel assignment-card"><div className="panel-header"><div><h2>2. Elige sus clientes</h2><p>{selectedClientIds.length} clientes seleccionados.</p></div><Store /></div><div className="panel-body">{selectedMarketIds.length ? <div className="assignment-client-groups">{selectedMarketIds.map(marketId => { const market = markets.find(item => item.id === marketId); const marketClients = clients.filter(client => client.marketId === marketId && client.status === 'ACTIVO'); const allSelected = marketClients.length > 0 && marketClients.every(client => selectedClientIds.includes(client.id)); return <div className="assignment-client-group" key={marketId}><div className="assignment-group-head"><div><strong>{market?.name || 'Mercado'}</strong><small>{marketClients.length} clientes activos · {marketClients.filter(client => selectedClientIds.includes(client.id)).length} seleccionados</small></div><button type="button" className="text-button" onClick={() => toggleAllClients(marketId)}>{allSelected ? 'Quitar todos' : 'Seleccionar todos'}</button></div>{marketClients.length ? marketClients.map(client => <label className="assignment-client" key={client.id}><input type="checkbox" checked={selectedClientIds.includes(client.id)} onChange={() => toggleClient(client.id)} /><span><strong>{client.name}</strong><small>{client.code}{client.phone ? ` · ${client.phone}` : ''}</small></span></label>) : <p className="assignment-empty">No hay clientes activos en este mercado.</p>}</div>; })}</div> : <Empty title="Selecciona un mercado" detail="Aquí aparecerán sus clientes para asignarlos al promotor." />}</div></section>
    </div>
    <div className="assignment-actions"><Btn variant="danger" onClick={clearAssignment} disabled={!selectedPromoterId}>Quitar asignación</Btn><Btn onClick={saveAssignment} disabled={!selectedPromoterId || !selectedMarketIds.length || !selectedClientIds.length} testId="button-save-assignment"><CheckCircle2 /> Guardar asignación</Btn></div>
    <section className="panel assignment-summary"><div className="panel-header"><div><h2>Resumen de relaciones</h2><p>Tiendas y clientes vinculados a cada promotor por mercado.</p></div><div className="assignment-summary-count"><strong>{relationshipRows.filter(row => row.client).length}</strong><small>relaciones activas</small></div></div><div className="panel-body">{relationshipRows.length ? <div className="assignment-table"><div className="assignment-table-row header"><span>Promotor</span><span>Mercado</span><span>Tienda / cliente</span><span>Estado</span></div>{relationshipRows.map(row => <div className="assignment-table-row" key={row.key}><span><strong>{row.promoter.name}</strong><small>DNI {row.promoter.dni}</small></span><span><strong>{markets.find(market => market.id === row.marketId)?.name || 'Mercado no identificado'}</strong><small>{markets.find(market => market.id === row.marketId)?.district || '—'}</small></span><span>{row.client ? <><strong>{row.client.name}</strong><small>{row.client.code}{row.client.phone ? ` · ${row.client.phone}` : ''}</small></> : <><strong className="assignment-unassigned">Sin clientes asignados</strong><small>Selecciona clientes para habilitar la visita.</small></>}</span><StatusPill status={row.client ? row.client.status : 'INACTIVO'} /></div>)}</div> : <Empty title="Aún no hay relaciones asignadas" detail="Selecciona un promotor, mercados y clientes para ver el resumen." />}</div></section>
  </section>;
}

function LegacySalesDashboard({ sales, markets, onViewSales, onExport }: { sales: Sale[]; markets: Market[]; onViewSales: () => void; onExport: () => void }) {
  const rows = useMemo(() => aggregateSalesByRegionCity(sales, markets), [sales, markets]);
  const totals = rows.reduce((result, row) => ({ soles: result.soles + row.soles, units: result.units + row.units, kilos: result.kilos + row.kilos }), { soles: 0, units: 0, kilos: 0 });
  const maxSoles = Math.max(...rows.map(row => row.soles), 1);
  return <div className="sales-dashboard">
    <div className="dashboard-heading"><div><span className="eyebrow">RESUMEN DE VENTAS</span><h2>Ventas por región y ciudad</h2><p>Consolidado de todos los pedidos registrados en la campaña.</p></div><div className="page-actions"><Btn variant="outline" onClick={onExport}><Download /> Descargar resumen</Btn><Btn onClick={onViewSales}>Ver ventas</Btn></div></div>
    <div className="dashboard-kpis">
      <article className="dashboard-kpi"><span className="dashboard-kpi-icon orange"><ShoppingBag /></span><div><small>VENTAS EN SOLES</small><strong>{formatSoles(totals.soles)}</strong><p>{sales.length} pedidos registrados</p></div></article>
      <article className="dashboard-kpi"><span className="dashboard-kpi-icon blue"><PackageCheck /></span><div><small>VENTAS EN UNIDADES</small><strong>{totals.units.toLocaleString('es-PE')}</strong><p>Unidades vendidas</p></div></article>
      <article className="dashboard-kpi"><span className="dashboard-kpi-icon green"><MapPin /></span><div><small>VENTA EN KILOS</small><strong>{formatKilos(totals.kilos)}</strong><p>Peso estimado vendido</p></div></article>
      <article className="dashboard-kpi"><span className="dashboard-kpi-icon navy"><Users /></span><div><small>REGIÓN · CIUDAD</small><strong>{rows.length}</strong><p>Zonas con ventas</p></div></article>
    </div>
    <div className="sales-dashboard-grid">
      <section className="panel"><div className="panel-header"><div><h2>Ventas en soles por zona</h2><p>Las zonas están ordenadas de mayor a menor facturación.</p></div></div><div className="panel-body">{rows.length ? <div className="sales-bars">{rows.slice(0, 8).map(row => <div className="sales-bar" key={row.key}><div className="sales-bar-label"><strong>{row.region} · {row.city}</strong><b>{formatSoles(row.soles)}</b></div><div className="sales-bar-track"><span style={{ width: `${Math.max(4, (row.soles / maxSoles) * 100)}%` }} /></div><small>{row.units.toLocaleString('es-PE')} unidades · {formatKilos(row.kilos)} · {row.salesCount} pedido{row.salesCount === 1 ? '' : 's'}</small></div>)}</div> : <Empty title="Aún no hay ventas" detail="El dashboard se actualizará al registrar el primer pedido." />}</div></section>
      <section className="panel"><div className="panel-header"><div><h2>Detalle por región · ciudad</h2><p>Ventas acumuladas por cada zona.</p></div></div><div className="panel-body dashboard-table-wrap">{rows.length ? <div className="dashboard-table"><div className="dashboard-table-row header"><span>Región · Ciudad</span><span>Ventas (S/)</span><span>Unidades</span><span>Kilos</span></div>{rows.map(row => <div className="dashboard-table-row" key={row.key}><strong>{row.region} · {row.city}</strong><b>{formatSoles(row.soles)}</b><span>{row.units.toLocaleString('es-PE')}</span><span>{formatKilos(row.kilos)}</span></div>)}</div> : <Empty title="Sin datos para mostrar" detail="Registra ventas para ver el consolidado." />}</div></section>
    </div>
  </div>;
}

function SalesDashboard({ sales, markets, users, onViewSales, onExport }: { sales: Sale[]; markets: Market[]; users: AppUser[]; onViewSales: () => void; onExport: () => void }) {
  const regionRows = useMemo(() => aggregateSalesByRegion(sales, markets), [sales, markets]);
  const marketRows = useMemo(() => aggregateSalesByMarket(sales, markets), [sales, markets]);
  const promoterRows = useMemo(() => aggregateSalesByPromoter(sales, users), [sales, users]);
  const brandRows = useMemo(() => aggregateSalesByBrand(sales), [sales]);
  const totals = sales.reduce((result, sale) => ({ soles: result.soles + (Number(sale.amountSoles) || 0), units: result.units + (Number(sale.units) || 0), kilos: result.kilos + saleWeightKg(sale) }), { soles: 0, units: 0, kilos: 0 });
  const maxRegionSoles = Math.max(...regionRows.map(row => row.soles), 1);
  const totalBrandUnits = brandRows.reduce((sum, row) => sum + row.units, 0);
  let pieOffset = 0;
  const brandColors = ['#d85b2b', '#2b6d9c', '#3f9670', '#e4a83d', '#7565a8', '#8c9aa9'];
  const pieSegments = brandRows.map((row, index) => {
    const start = pieOffset;
    pieOffset += totalBrandUnits ? (row.units / totalBrandUnits) * 100 : 0;
    return `${brandColors[index % brandColors.length]} ${start}% ${pieOffset}%`;
  });
  const pieStyle = { background: pieSegments.length ? `conic-gradient(${pieSegments.join(', ')})` : 'conic-gradient(#dfe6ee 0 100%)' };
  return <div className="sales-dashboard">
    <div className="dashboard-heading"><div><span className="eyebrow">RESUMEN DE VENTAS</span><h2>Desempeño de la campaña</h2><p>Consolidado de todos los pedidos registrados por región, mercado, promotor y marca.</p></div><div className="page-actions"><Btn variant="outline" onClick={onExport}><Download /> Descargar resumen</Btn><Btn onClick={onViewSales}>Ver ventas</Btn></div></div>
    <div className="dashboard-kpis">
      <article className="dashboard-kpi"><span className="dashboard-kpi-icon orange"><ShoppingBag /></span><div><small>VENTA EN SOLES</small><strong>{formatSoles(totals.soles)}</strong><p>{sales.length} pedidos registrados</p></div></article>
      <article className="dashboard-kpi"><span className="dashboard-kpi-icon blue"><PackageCheck /></span><div><small>VENTA EN UNIDADES</small><strong>{totals.units.toLocaleString('es-PE')}</strong><p>Unidades vendidas</p></div></article>
      <article className="dashboard-kpi"><span className="dashboard-kpi-icon green"><MapPin /></span><div><small>VENTA EN KILOS</small><strong>{formatKilos(totals.kilos)}</strong><p>Peso estimado vendido</p></div></article>
    </div>
    <div className="summary-sections">
      <section className="panel"><div className="panel-header"><div><h2>Resumen por Región</h2><p>Ventas agrupadas por la región de cada mercado.</p></div></div><div className="panel-body">{regionRows.length ? <div className="summary-list">{regionRows.map((row, index) => <div className="summary-row" key={row.key}><div className="summary-row-head"><strong>{index + 1}. {row.label}</strong><b>{formatSoles(row.soles)}</b></div><div className="summary-track"><span style={{ width: `${Math.max(4, (row.soles / maxRegionSoles) * 100)}%` }} /></div><small>{row.units.toLocaleString('es-PE')} unidades · {formatKilos(row.kilos)} · {row.salesCount} pedido{row.salesCount === 1 ? '' : 's'}</small></div>)}</div> : <Empty title="Aún no hay ventas" detail="El resumen por región se actualizará con el primer pedido." />}</div></section>
      <section className="panel"><div className="panel-header"><div><h2>Resumen por Mercados</h2><p>Resultado acumulado de cada mercado.</p></div></div><div className="panel-body summary-table-wrap">{marketRows.length ? <div className="summary-table"><div className="summary-table-row header"><span>Mercado</span><span>Ventas (S/)</span><span>Unidades</span><span>Kilos</span></div>{marketRows.map(row => <div className="summary-table-row" key={row.key}><div><strong>{row.label}</strong><small>{row.subtitle}</small></div><b>{formatSoles(row.soles)}</b><span>{row.units.toLocaleString('es-PE')}</span><span>{formatKilos(row.kilos)}</span></div>)}</div> : <Empty title="Sin mercados con ventas" detail="Los mercados aparecerán aquí al registrar pedidos." />}</div></section>
    </div>
    <div className="summary-sections">
      <section className="panel"><div className="panel-header"><div><h2>Mejores Promotores</h2><p>Ordenados por venta total en soles.</p></div></div><div className="panel-body">{promoterRows.length ? <div className="promoter-ranking">{promoterRows.slice(0, 5).map((row, index) => <div className="promoter-ranking-row" key={row.key}><span className="ranking-position">{index + 1}</span><div><strong>{row.label}</strong><small>{row.subtitle} · {row.units.toLocaleString('es-PE')} unidades · {formatKilos(row.kilos)}</small></div><b>{formatSoles(row.soles)}</b></div>)}</div> : <Empty title="Aún no hay promotores con ventas" detail="El ranking aparecerá con los primeros pedidos." />}</div></section>
      <section className="panel"><div className="panel-header"><div><h2>Detalle por Marcas</h2><p>Distribución de unidades vendidas por marca.</p></div></div><div className="panel-body brand-pie-layout">{brandRows.length ? <><div className="brand-pie" style={pieStyle} aria-label="Distribución de ventas por marca"><span>{totalBrandUnits.toLocaleString('es-PE')}<small>unidades</small></span></div><div className="brand-legend">{brandRows.map((row, index) => <div className="brand-legend-row" key={row.key}><span className="brand-swatch" style={{ background: brandColors[index % brandColors.length] }} /><div><strong>{row.label}</strong><small>{row.units.toLocaleString('es-PE')} unidades · {formatSoles(row.soles)}</small></div><b>{totalBrandUnits ? `${((row.units / totalBrandUnits) * 100).toFixed(1)}%` : '0%'}</b></div>)}</div></> : <Empty title="Sin detalle por marcas" detail="El pastel aparecerá al registrar ventas." />}</div></section>
    </div>
  </div>;
}

function AnalystApp({ user, markets, setMarkets, users, setUsers, clients, setClients, sales, attendance, inventory, movements, assignments, setAssignments, setInventory, setMovements, notify }: { user: AppUser; markets: Market[]; setMarkets: (value: Market[]) => void; users: AppUser[]; setUsers: (value: AppUser[]) => void; clients: Client[]; setClients: (value: Client[]) => void; sales: Sale[]; attendance: Attendance[]; inventory: MarketInventory[]; movements: InventoryMovement[]; assignments: PromoterAssignment[]; setAssignments: (value: PromoterAssignment[]) => void; setInventory: (value: MarketInventory[]) => void; setMovements: (value: InventoryMovement[]) => void; notify: (message: string, error?: boolean) => void }) {
  const [tab, setTab] = useState('inicio'); const [query, setQuery] = useState(''); const [modal, setModal] = useState<'user' | 'client' | null>(null); const [syncing, setSyncing] = useState(false);
   const activeMarkets = markets.filter(market => market.status === 'ACTIVO'); const marketMap = Object.fromEntries(markets.map(market => [market.id, market])); const marketAssignmentSummary = useMemo(() => Object.fromEntries(markets.map(market => [market.id, { clients: clients.filter(client => client.marketId === market.id && client.status === 'ACTIVO').length, promoters: users.filter(current => { if (current.role !== 'PROMOTOR' || current.status !== 'ACTIVO') return false; const assignment = assignments.find(item => item.promoterId === current.id); return assignment ? assignment.marketIds.includes(market.id) : current.marketId === market.id; }).length }])), [markets, clients, users, assignments]); const today = new Date().toISOString().slice(0, 10);
  const marketOptions = activeMarkets.map(market => ({ value: market.id, label: `${market.name} · ${market.region || market.department} · ${market.district}` }));
  const exportSales = () => { downloadCsv(`ventas-${today}.csv`, ['Código venta', 'Fecha', 'Promotor', 'Cliente', 'Mercado', 'Tipo', 'Marca / producto', 'Unidades por marca', 'Monto unitario por marca (S/)', 'Unidades totales', 'Peso (kg)', 'Ingreso total (S/)', 'Bonificación', 'Comentario', 'Estado'], sales.map(sale => { const breakdown = saleExportBreakdown(sale); return [sale.id, formatDate(sale.date), users.find(user => user.id === sale.promoterId)?.name, clients.find(client => client.id === sale.clientId)?.name, marketMap[sale.marketId]?.name, sale.mode, breakdown.map(item => item.label).join(' | '), breakdown.map(item => item.units).join(' | '), breakdown.map(item => item.unitPrice.toFixed(2)).join(' | '), sale.units, (sale.weightKg ?? 0).toFixed(3), (sale.amountSoles ?? 0).toFixed(2), sale.bonus || 'Sin canje', sale.comment || '', sale.status]; })); notify('Reporte de ventas con marcas y precios descargado'); };
  const exportClients = () => { downloadCsv(`clientes-${today}.csv`, ['Código', 'Cliente', 'Celular', 'Mercado', 'Distrito', 'Estado'], clients.map(client => [client.code, client.name, client.phone || '', marketMap[client.marketId]?.name, marketMap[client.marketId]?.district, client.status])); notify('Reporte de clientes descargado'); };
  const exportUsers = () => { downloadCsv(`usuarios-${today}.csv`, ['ID', 'DNI', 'Nombre', 'Rol', 'Mercado', 'Estado'], users.map(user => [user.id, user.dni, user.name, user.role, marketMap[user.marketId || '']?.name || '', user.status])); notify('Reporte de usuarios descargado'); };
  const exportAttendance = () => { downloadCsv(`marcaciones-${today}.csv`, ['Código', 'Tipo', 'Fecha', 'Promotor', 'Tienda', 'Foto', 'Estado'], attendance.map(item => [item.id, item.type, formatDate(item.date), users.find(user => user.id === item.promoterId)?.name, clients.find(client => client.id === item.clientId)?.name, item.photo, item.status])); notify('Marcaciones descargadas'); };
  const exportSummary = () => { const summaryRows = aggregateSalesByRegionCity(sales, markets); downloadCsv(`resumen-${today}.csv`, ['Región', 'Ciudad', 'Ventas (S/)', 'Ventas (unidades)', 'Venta (kg)', 'Pedidos'], summaryRows.map(row => [row.region, row.city, row.soles.toFixed(2), row.units, row.kilos.toFixed(3), row.salesCount])); notify('Resumen por región y ciudad descargado'); };
  const importMarkets = async () => {
    setSyncing(true);
    try {
      const response = await fetch(MARKETS_SHEET); if (!response.ok) throw new Error('No se pudo conectar');
      const rows = parseCsvText(await response.text()); if (rows.length < 2) throw new Error('La hoja no contiene encabezados y filas de mercados'); const headers = rows[0].map(normalizeCsvHeader); const column = (aliases: string[], fallback: number) => aliases.map(normalizeCsvHeader).map(alias => headers.indexOf(alias)).find(index => index >= 0) ?? fallback; const idIndex = column(['idmerc', 'id', 'codigo'], 0); const departmentIndex = column(['departamento'], 1); const provinceIndex = column(['provincia', 'ciudad'], 2); const districtIndex = column(['distrito'], 3); const nameIndex = column(['nombredelmercado', 'mercado', 'nombre'], 4); const statusIndex = column(['estado', 'status'], 5); const regionIndex = column(['region'], 6); const lookupDepartmentIndex = headers.lastIndexOf('departamento'); const lookupRegionIndex = headers.lastIndexOf('region'); const hasRegionLookup = lookupDepartmentIndex >= 0 && lookupRegionIndex >= 0 && (lookupDepartmentIndex !== departmentIndex || lookupRegionIndex !== regionIndex); const regionLookup = new Map<string, string>(); if (hasRegionLookup) rows.slice(1).forEach(cells => { const lookupDepartment = (cells[lookupDepartmentIndex] || '').trim(); const lookupRegion = (cells[lookupRegionIndex] || '').trim(); if (lookupDepartment && lookupRegion && normalizeCsvHeader(lookupDepartment) !== 'departamento') regionLookup.set(normalizeCsvHeader(lookupDepartment), lookupRegion.toUpperCase()); }); const aliases = new Map<string, string>(); const imported: Market[] = rows.slice(1).map((cells, index) => { const rawName = (cells[nameIndex] || '').trim(); if (!rawName) return null; const sourceId = (cells[idIndex] || `SHEET-${index + 1}`).trim(); const department = (cells[departmentIndex] || 'LIMA').trim().toUpperCase(); const province = (cells[provinceIndex] || 'LIMA').trim().toUpperCase(); const district = (cells[districtIndex] || 'LIMA').trim().toUpperCase(); const name = rawName.toUpperCase(); const rawRegion = (cells[regionIndex] || '').trim(); const normalizedRegion = normalizeCsvHeader(rawRegion); const region = rawRegion && !['activo', 'inactivo', 'region'].includes(normalizedRegion) ? rawRegion.toUpperCase() : regionLookup.get(normalizeCsvHeader(department)) || department; const existing = markets.find(market => market.id === sourceId || market.id === `SHEET-${index + 1}` || (market.name === name && market.district === district && market.province === province)); if (existing && existing.id !== sourceId) aliases.set(existing.id, sourceId); return { id: sourceId, department, region, province, district, name, status: csvStatus(cells[statusIndex] || 'ACTIVO') }; }).filter(Boolean) as Market[];
      if (!imported.length) throw new Error('La hoja no contiene mercados');
      const remapMarketId = (marketId?: string) => marketId ? aliases.get(marketId) || marketId : marketId;
      const nextUsers = users.map(item => ({ ...item, marketId: remapMarketId(item.marketId) })); const nextClients = clients.map(item => ({ ...item, marketId: remapMarketId(item.marketId) || item.marketId })); const nextInventory = inventory.map(item => ({ ...item, marketId: remapMarketId(item.marketId) || item.marketId })); const nextMovements = movements.map(item => ({ ...item, marketId: remapMarketId(item.marketId) || item.marketId }));
       const importedIds = new Set(imported.map(market => market.id)); const referencedIds = new Set([...nextUsers.map(item => item.marketId), ...nextClients.map(item => item.marketId), ...nextInventory.map(item => item.marketId)].filter(Boolean) as string[]);
      const preservedAssignments = markets.filter(market => referencedIds.has(market.id) && !importedIds.has(market.id));
       const nextMarkets = [...imported, ...preservedAssignments]; setMarkets(nextMarkets); setUsers(nextUsers); setClients(nextClients); setInventory(nextInventory); setMovements(nextMovements); writeStore('bt-markets', nextMarkets); writeStore('bt-users', nextUsers); writeStore('bt-clients', nextClients); writeStore('bt-inventory', nextInventory); writeStore('bt-inventory-movements', nextMovements); notify(`${imported.length} mercados importados desde Google Sheets`);
    } catch { notify('No se pudo importar la hoja. Los mercados locales siguen disponibles.', true); } finally { setSyncing(false); }
  };
  const mergeImportedUsers = (records: Record<string, string>[]) => {
    const imported: AppUser[] = []; let skipped = 0; const importId = Date.now();
    records.forEach((record, index) => {
      const dni = csvField(record, ['dni', 'documento', 'documentoidentidad']); const firstName = csvField(record, ['nombre', 'nombrecompleto', 'usuario', 'nombres']); const lastName = csvField(record, ['apellido', 'apellidos']); const name = [firstName, lastName].filter(Boolean).join(' '); const rawRole = normalizeCsvHeader(csvField(record, ['rol', 'cargo', 'perfil', 'tipousuario'])); const roleValue = rawRole.startsWith('promotor') ? 'PROMOTOR' : rawRole.toUpperCase() as Role; const marketValue = csvField(record, ['marketid', 'idmercado', 'idmerc', 'mercadoid', 'mercado', 'market', 'nombremercado']);
      const marketId = marketValue ? csvMarketId(marketValue, markets) : undefined;
      if (!/^\d{8}$/.test(dni) || !name || !['PROMOTOR', 'SUPERVISOR', 'ANALISTA', 'TRADE', 'ADMIN'].includes(roleValue) || (roleValue === 'PROMOTOR' && marketValue && !marketId)) { skipped += 1; return; }
      imported.push({ id: csvField(record, ['id', 'codigo', 'idusuario', 'idpromotor']) || `USR-IMP-${importId}-${index + 1}`, dni, name, role: roleValue, marketId: roleValue === 'PROMOTOR' ? marketId : undefined, password: csvField(record, ['clave', 'password', 'contrasena']) || undefined, status: csvStatus(csvField(record, ['estado', 'status'])) });
    });
    if (!imported.length) throw new Error('No se encontraron filas válidas. Revisa DNI, nombre, rol y mercado para promotores.');
    const marketLoads = new Map(markets.map(market => [market.id, users.filter(item => item.role === 'PROMOTOR' && item.status === 'ACTIVO' && item.marketId === market.id).length]));
    imported.forEach(item => { if (item.role !== 'PROMOTOR' || item.marketId) return; const target = markets.slice().sort((first, second) => (marketLoads.get(first.id) || 0) - (marketLoads.get(second.id) || 0))[0]; if (target) { item.marketId = target.id; marketLoads.set(target.id, (marketLoads.get(target.id) || 0) + 1); } });
    const next = [...users]; imported.forEach(item => { const index = next.findIndex(current => current.id === item.id || current.dni === item.dni); if (index >= 0) next[index] = { ...next[index], ...item }; else next.push(item); }); setUsers(next); writeStore('bt-users', next);
    return `${imported.length} usuarios importados${skipped ? ` · ${skipped} filas omitidas` : ''}`;
  };
  const importUsers = async (file: File) => {
    setSyncing(true);
    try { notify(mergeImportedUsers(parseCsvRecords(await file.text()))); } catch (error) { notify(`No se pudo importar usuarios: ${error instanceof Error ? error.message : 'formato inválido'}`, true); } finally { setSyncing(false); }
  };
  const importUsersFromSheet = async () => {
    setSyncing(true);
    try { notify(mergeImportedUsers(await fetchGoogleSheetRecords(USERS_SHEET_ID))); } catch (error) { notify(`No se pudo actualizar usuarios desde Google Sheets: ${error instanceof Error ? error.message : 'hoja no disponible'}`, true); } finally { setSyncing(false); }
  };
  const mergeImportedClients = (records: Record<string, string>[]) => {
    const imported: Client[] = []; let skipped = 0; const importId = Date.now();
    records.forEach((record, index) => {
      const name = csvField(record, ['cliente', 'nombre', 'nombrecliente', 'tienda', 'razonsocial', 'nombrecomercial']); const marketId = csvMarketId(csvField(record, ['marketid', 'idmercado', 'mercado', 'market', 'nombremercado']), markets);
      if (!name || !marketId) { skipped += 1; return; }
      imported.push({ id: csvField(record, ['id', 'idcliente']) || `CLI-IMP-${importId}-${index + 1}`, code: csvField(record, ['codigo', 'code', 'codigocliente']) || `CLI-${String(clients.length + index + 1).padStart(6, '0')}`, name, phone: csvField(record, ['celular', 'telefono', 'phone', 'movil']) || undefined, marketId, status: csvStatus(csvField(record, ['estado', 'status'])) });
    });
    if (!imported.length) throw new Error('No se encontraron filas válidas. Revisa cliente y mercado.');
    const next = [...clients]; imported.forEach(item => { const index = next.findIndex(current => current.id === item.id || current.code === item.code); if (index >= 0) next[index] = { ...next[index], ...item }; else next.push(item); }); setClients(next); writeStore('bt-clients', next);
    return `${imported.length} clientes importados${skipped ? ` · ${skipped} filas omitidas` : ''}`;
  };
  const importClients = async (file: File) => {
    setSyncing(true);
    try { notify(mergeImportedClients(parseCsvRecords(await file.text()))); } catch (error) { notify(`No se pudo importar clientes: ${error instanceof Error ? error.message : 'formato inválido'}`, true); } finally { setSyncing(false); }
  };
  const importClientsFromSheet = async () => {
    setSyncing(true);
    try { notify(mergeImportedClients(await fetchGoogleSheetRecords(CLIENTS_SHEET_ID))); } catch (error) { notify(`No se pudo actualizar clientes desde Google Sheets: ${error instanceof Error ? error.message : 'hoja no disponible'}`, true); } finally { setSyncing(false); }
  };
  const importInventory = async (file: File) => {
    setSyncing(true);
    try {
      const records = parseCsvRecords(await file.text()); const imported: { marketId: string; stock: MarketInventory }[] = []; let skipped = 0; const importId = Date.now();
      records.forEach(record => {
        const marketId = csvMarketId(csvField(record, ['marketid', 'idmercado', 'mercado', 'market']), markets);
        if (!marketId) { skipped += 1; return; }
        const current = inventory.find(item => item.marketId === marketId) || emptyInventory(marketId); const readStock = (aliases: string[], fallback: number) => { const raw = csvField(record, aliases); if (raw === '') return fallback; const value = Number(raw.replace(',', '.')); if (!Number.isInteger(value) || value < 0) throw new Error(`Stock inválido en ${marketId}`); return value; };
        const redemptionStock = redemptionItems.reduce((result, item) => ({ ...result, [item.id]: readStock([`stock${item.id}`, item.id, `cantidad${item.id}`], current.redemptionStock[item.id]) }), {} as RedemptionStock);
        imported.push({ marketId, stock: { ...current, marketId, tastingStock: readStock(['stockdegustacion', 'degustacion', 'panetonesdegustacion'], current.tastingStock), redemptionStock, updatedAt: new Date().toISOString() } });
      });
      if (!imported.length) throw new Error('No se encontraron filas válidas. Revisa el mercado y las columnas de stock.');
      const nextInventory = [...inventory]; const newMovements = [...movements];
      imported.forEach(({ marketId, stock }, rowIndex) => {
        const current = nextInventory.find(item => item.marketId === marketId) || emptyInventory(marketId); const index = nextInventory.findIndex(item => item.marketId === marketId);
        if (index >= 0) nextInventory[index] = stock; else nextInventory.push(stock);
        const date = stock.updatedAt; const addMovement = (kind: InventoryMovementKind, quantity: number, itemId?: RedemptionItemId) => { if (quantity !== 0) newMovements.unshift({ id: `IMP-${importId}-${rowIndex}-${itemId || kind}`, marketId, kind, itemId, quantity, actorId: user.id, actorName: user.name, date, status: syncStatus() }); };
        addMovement('AJUSTE_DEGUSTACION', stock.tastingStock - current.tastingStock);
        redemptionItems.forEach(item => addMovement('AJUSTE_CANJES', stock.redemptionStock[item.id] - current.redemptionStock[item.id], item.id));
      });
      setInventory(nextInventory); setMovements(newMovements); writeStore('bt-inventory', nextInventory); writeStore('bt-inventory-movements', newMovements); notify(`${imported.length} stocks importados${skipped ? ` · ${skipped} filas omitidas` : ''}`);
    } catch (error) { notify(`No se pudo importar stock: ${error instanceof Error ? error.message : 'formato inválido'}`, true); } finally { setSyncing(false); }
  };
  const downloadUsersExample = () => {
    const market = activeMarkets[0] || markets[0];
    downloadCsv('ejemplo-usuarios.csv', ['DNI', 'Nombre', 'Rol', 'Mercado', 'Estado'], [['87654322', 'Promotor Ejemplo', 'PROMOTOR', market?.name || 'MERCADO MODELO', 'ACTIVO']]);
    notify('Ejemplo de usuarios descargado');
  };
  const downloadClientsExample = () => {
    const market = activeMarkets[0] || markets[0];
    downloadCsv('ejemplo-clientes.csv', ['Código', 'Cliente', 'Celular', 'Mercado', 'Estado'], [['CLI-EJEMPLO-001', 'Bodega Ejemplo', '999888777', market?.name || 'MERCADO MODELO', 'ACTIVO']]);
    notify('Ejemplo de clientes descargado');
  };
  const downloadInventoryExample = () => {
    const market = activeMarkets[0] || markets[0];
    downloadCsv('ejemplo-canjes-degustacion.csv', ['Mercado', 'Stock degustación', 'Stock Avena', 'Stock Batea', 'Stock Mandil', 'Stock Spaghetti'], [[market?.name || 'MERCADO MODELO', 20, 50, 10, 15, 40]]);
    notify('Ejemplo de canjes y degustación descargado');
  };
  const saveUser = (user: AppUser) => { const next = [...users, user]; setUsers(next); writeStore('bt-users', next); setModal(null); notify('Usuario creado con clave temporal'); };
  const saveClient = (client: Client) => { const next = [...clients, client]; setClients(next); writeStore('bt-clients', next); setModal(null); notify('Cliente creado como ACTIVO'); };
  const filteredClients = clients.filter(client => `${client.name} ${client.code} ${marketMap[client.marketId]?.name || ''}`.toLowerCase().includes(query.toLowerCase()));
   const tabs = [['inicio', 'Resumen'], ['mercados', 'Mercados'], ['usuarios', 'Usuarios'], ['clientes', 'Clientes'], ['asignaciones', 'Asignaciones'], ['ventas', 'Ventas'], ['marcaciones', 'Marcaciones'], ['inventario', 'Canjes y degustación']];
  return <main className="workspace">
    <div className="page-head"><div><span className="eyebrow">PANEL DE CONTROL</span><h1>Hola, analista</h1><p>Supervisa el pulso de la campaña desde un solo lugar.</p></div></div>
    <nav className="tabs" aria-label="Módulos">{tabs.map(([value, label]) => <button key={value} className={`tab ${tab === value ? 'active' : ''}`} onClick={() => setTab(value)} data-testid={`tab-${value}`}>{label}</button>)}</nav>
       {tab === 'inicio' && <SalesDashboard sales={sales} markets={markets} users={users} onViewSales={() => setTab('ventas')} onExport={exportSummary} />}
     {tab === 'mercados' && <section className="panel"><div className="panel-header"><div><h2>Mercados</h2><p>Catálogo importado desde Google Sheets o guardado localmente.</p></div><Btn onClick={importMarkets} disabled={syncing} testId="button-refresh-markets"><RefreshCw /> Actualizar hoja</Btn></div><div className="panel-body"><div className="data-table"><div className="table-row header"><span>Mercado</span><span>Región</span><span>Departamento</span><span>Provincia</span><span>Distrito</span><span>Clientes</span><span>Promotores</span><span>Estado</span></div>{markets.map(market => <div className="table-row" key={market.id}><span><strong>{market.name}</strong><small>{market.id}</small></span><span>{market.region || '—'}</span><span>{market.department}</span><span>{market.province}</span><span>{market.district}</span><span>{marketAssignmentSummary[market.id]?.clients || 0}</span><span>{marketAssignmentSummary[market.id]?.promoters || 0}</span><StatusPill status={market.status} /></div>)}</div></div></section>}
       {tab === 'usuarios' && <section className="panel"><div className="panel-header"><div><h2>Usuarios</h2><p>Sincroniza la hoja de Google Sheets o importa un CSV.</p></div><div className="panel-actions"><Btn variant="outline" onClick={importUsersFromSheet} disabled={syncing} testId="button-refresh-users"><RefreshCw /> Actualizar hoja</Btn><CsvImportButton label="Importar usuarios" onImport={importUsers} testId="button-import-users" /><CsvExampleButton onDownload={downloadUsersExample} testId="button-example-users" /><Btn onClick={() => setModal('user')} testId="button-new-user"><Plus /> Nuevo usuario</Btn></div></div><div className="panel-body"><div className="import-hint">Origen conectado: Google Sheets · Columnas: DNI, Nombre, Rol, Mercado y Estado.</div><div className="record-list">{users.map(user => <article className="record" key={user.id}><span className="record-icon"><UserRound /></span><div className="record-main"><strong>{user.name}</strong><small>DNI {user.dni} · {user.role}</small>{user.marketId && <em><MapPin /> {marketMap[user.marketId]?.name || 'Mercado asignado'}</em>}</div><StatusPill status={user.status} /></article>)}</div></div></section>}
     {tab === 'clientes' && <section className="panel"><div className="panel-header"><div><h2>Clientes</h2><p>Sincroniza la hoja de Google Sheets o importa un CSV.</p></div><div className="panel-actions"><Btn variant="outline" onClick={importClientsFromSheet} disabled={syncing} testId="button-refresh-clients"><RefreshCw /> Actualizar hoja</Btn><CsvImportButton label="Importar clientes" onImport={importClients} testId="button-import-clients" /><CsvExampleButton onDownload={downloadClientsExample} testId="button-example-clients" /><Btn onClick={() => setModal('client')} testId="button-new-client"><Plus /> Nuevo cliente</Btn></div></div><div className="panel-body"><div className="import-hint">Origen conectado: Google Sheets · Columnas: Código, Cliente, Celular, Mercado y Estado.</div><div className="search-row"><div className="search-wrap"><Search /><Input value={query} onChange={setQuery} placeholder="Buscar cliente, código o mercado" testId="input-search-clients" /></div></div><div className="record-list">{filteredClients.length ? filteredClients.map(client => <article className="record" key={client.id}><span className="record-icon"><Store /></span><div className="record-main"><strong>{client.name}</strong><small>{client.code}{client.phone ? ` · ${client.phone}` : ''}</small><em><MapPin /> {marketMap[client.marketId]?.name}</em></div><StatusPill status={client.status} /></article>) : <Empty title="No hay coincidencias" detail="Prueba con otro nombre, código o mercado." />}</div></div></section>}
      {tab === 'asignaciones' && <AssignmentModule markets={markets} users={users} clients={clients} assignments={assignments} setAssignments={setAssignments} setUsers={setUsers} notify={notify} />}
      {tab === 'ventas' && <section className="panel"><div className="panel-header"><div><h2>Ventas y evidencias</h2><p>Seguimiento de registros por promotor.</p></div><Btn variant="outline" onClick={exportSales}><Download /> Descargar</Btn></div><div className="panel-body">{sales.length ? <div className="record-list">{sales.map(sale => { const promoter = users.find(item => item.id === sale.promoterId); return <article className="record" key={sale.id}><span className="record-icon"><ShoppingBag /></span><div className="record-main"><strong>{clients.find(client => client.id === sale.clientId)?.name || 'Tienda'}</strong><small>Promotor: {promoter?.name || 'No identificado'} · DNI {promoter?.dni || '—'} · {marketMap[sale.marketId]?.name || 'Mercado no identificado'}</small><small>{sale.id} · {sale.units} unidades · {sale.mode} · {formatSoles(sale.amountSoles)}</small><em><Gift /> {sale.bonus || 'Sin canje'} · {formatDate(sale.date)}</em></div><StatusPill status={sale.status} /></article>; })}</div> : <Empty />}</div></section>}
     {tab === 'marcaciones' && <section className="panel"><div className="panel-header"><div><h2>Marcaciones de asistencia</h2><p>Entradas y salidas registradas por los promotores.</p></div><Btn variant="outline" onClick={exportAttendance}><Download /> Descargar</Btn></div><div className="panel-body">{attendance.length ? <div className="record-list">{attendance.map(item => <article className="record" key={item.id}><span className="record-icon"><Clock3 /></span><div className="record-main"><strong>{clients.find(client => client.id === item.clientId)?.name || 'Tienda'}</strong><small>{users.find(user => user.id === item.promoterId)?.name} · {formatDate(item.date)}</small><em><Camera /> {item.photo}</em></div><span className={`status ${item.type === 'ENTRADA' ? 'active' : 'pending'}`}>{item.type}</span></article>)}</div> : <Empty title="Aún no hay marcaciones" detail="Las entradas y salidas aparecerán aquí." />}</div></section>}
      {tab === 'inventario' && <InventoryModule markets={markets} inventory={inventory} movements={movements} notify={notify} onImportCsv={importInventory} onDownloadExample={downloadInventoryExample} />}
    {modal === 'user' && <NewUserModal markets={marketOptions} onSave={saveUser} close={() => setModal(null)} />}
    {modal === 'client' && <NewClientModal markets={marketOptions} count={clients.length} onSave={saveClient} close={() => setModal(null)} />}
  </main>;
}

function PromoterNav({ active, onChange }: { active: 'MARCACIONES' | 'VENTAS'; onChange: (value: 'MARCACIONES' | 'VENTAS') => void }) {
  return <aside className="promoter-nav"><p className="nav-label">TAREAS DIARIAS</p><button className={active === 'MARCACIONES' ? 'active' : ''} onClick={() => onChange('MARCACIONES')} data-testid="nav-marcaciones"><Clock3 /> Marcaciones</button><button className={active === 'VENTAS' ? 'active' : ''} onClick={() => onChange('VENTAS')} data-testid="nav-ventas"><ShoppingBag /> Ventas</button></aside>;
}
function PromoterApp({ user, markets, clients, assignments, sales, setSales, attendance, setAttendance, inventory, setInventory, movements, setMovements, notify, onSessionSelection }: { user: AppUser; markets: Market[]; clients: Client[]; assignments: PromoterAssignment[]; sales: Sale[]; setSales: (value: Sale[]) => void; attendance: Attendance[]; setAttendance: (value: Attendance[]) => void; inventory: MarketInventory[]; setInventory: (value: MarketInventory[]) => void; movements: InventoryMovement[]; setMovements: (value: InventoryMovement[]) => void; notify: (message: string, error?: boolean) => void; onSessionSelection: (selection: { marketId: string; clientId: string }) => void }) {
     const promoterAssignment = assignments.find(assignment => assignment.promoterId === user.id); const assignedMarketIds = promoterAssignment ? promoterAssignment.marketIds : user.marketId ? [user.marketId] : []; const selectableMarkets = markets.filter(market => market.status === 'ACTIVO' && assignedMarketIds.includes(market.id)); const [selectedMarketId, setSelectedMarketId] = useState(''); const [selectedClientId, setSelectedClientId] = useState(''); const [module, setModule] = useState<'MARCACIONES' | 'VENTAS'>('MARCACIONES'); const [view, setView] = useState<'LISTA' | 'NUEVA'>('LISTA');
     const available = clients.filter(client => client.marketId === selectedMarketId && client.status === 'ACTIVO' && (!promoterAssignment || promoterAssignment.clientIds.includes(client.id))); const selectedMarket = selectableMarkets.find(market => market.id === selectedMarketId);
      const [clientId, setClientId] = useState(''); const [mode, setMode] = useState<'UNIDADES' | 'PLANCHAS'>('UNIDADES'); const [sku, setSku] = useState(products[0].sku); const [unitQty, setUnitQty] = useState(1); const [unitPriceSoles, setUnitPriceSoles] = useState(''); const [brandPrices, setBrandPrices] = useState({ TODINNO: '', COSTA: '', PASQUALINO: '' }); const [planchas, setPlanchas] = useState(1); const [mix, setMix] = useState({ TODINNO: 1, COSTA: 1, PASQUALINO: 4 }); const [comment, setComment] = useState(''); const [receipt, setReceipt] = useState<File | null>(null); const [exchange, setExchange] = useState<File | null>(null);
     const [markClientId, setMarkClientId] = useState(''); const [markType, setMarkType] = useState<'ENTRADA' | 'SALIDA'>('ENTRADA'); const [markPhoto, setMarkPhoto] = useState<File | null>(null); const [search, setSearch] = useState(''); const [modeFilter, setModeFilter] = useState<'TODO' | 'UNIDADES' | 'PLANCHAS'>('TODO');
     useEffect(() => { setClientId(selectedClientId); setMarkClientId(selectedClientId); onSessionSelection({ marketId: selectedMarketId, clientId: selectedClientId }); }, [selectedMarketId, selectedClientId]);
      const selectedProduct = products.find(product => product.sku === sku) || products[0]; const brandUnitPrices = Object.fromEntries(Object.keys(planchaProducts).map(brand => [brand, parseSoles(brandPrices[brand as keyof typeof brandPrices])])) as Record<string, number>; const marketStock = inventory.find(item => item.marketId === selectedMarketId) || emptyInventory(selectedMarketId); const redemptionTotal = redemptionItems.reduce((sum, item) => sum + marketStock.redemptionStock[item.id], 0); const totalMix = mix.TODINNO + mix.COSTA + mix.PASQUALINO; const total = mode === 'UNIDADES' ? unitQty : totalMix; const unitPrice = parseSoles(unitPriceSoles); const saleAmount = mode === 'UNIDADES' ? unitQty * unitPrice : Object.entries(mix).reduce((sum, [brand, quantity]) => sum + quantity * (brandUnitPrices[brand] || 0), 0); const orderWeightKg = mode === 'UNIDADES' ? unitQty * selectedProduct.weightKg : Object.entries(mix).reduce((sum, [brand, quantity]) => sum + quantity * (planchaProducts[brand as keyof typeof planchaProducts]?.weightKg || 0), 0); const weightPerPlanchaKg = mode === 'PLANCHAS' && planchas > 0 ? orderWeightKg / planchas : 0; const pricesValid = mode === 'UNIDADES' ? unitPrice > 0 : Object.entries(mix).filter(([, quantity]) => quantity > 0).every(([brand]) => (brandUnitPrices[brand] || 0) > 0); const bonus = bonusFor(mode, total, planchas); const requiredRedemptions = parseBonusItems(bonus); const missingRedemption = requiredRedemptionEntries(requiredRedemptions).find(([itemId, quantity]) => marketStock.redemptionStock[itemId] < quantity); const validMix = mode === 'UNIDADES' || (totalMix === planchas * 6 && Object.values(mix).every(value => value >= 1)); const saleFormValid = Boolean(clientId && receipt && pricesValid && Number.isFinite(saleAmount) && saleAmount > 0 && validMix && (!bonus || (exchange && !missingRedemption)) && !(mode === 'PLANCHAS' && planchas > 80));
    const mineSales = sales.filter(sale => sale.promoterId === user.id); const mineAttendance = attendance.filter(item => item.promoterId === user.id); const today = new Date().toISOString().slice(0, 10); const todayAttendanceFor = (id: string) => mineAttendance.filter(item => item.clientId === id && item.date.slice(0, 10) === today); const latestAttendanceFor = (id: string) => todayAttendanceFor(id).sort((first, second) => new Date(second.date).getTime() - new Date(first.date).getTime())[0]; const exitedToday = (id: string) => todayAttendanceFor(id).some(item => item.type === 'SALIDA'); const sellingClients = available.filter(client => latestAttendanceFor(client.id)?.type === 'ENTRADA' && !exitedToday(client.id)); const canSellForSelectedClient = Boolean(clientId && latestAttendanceFor(clientId)?.type === 'ENTRADA' && !exitedToday(clientId)); const canConfirm = Boolean(canSellForSelectedClient && saleFormValid); const filteredSales = mineSales.filter(sale => (modeFilter === 'TODO' || sale.mode === modeFilter) && `${sale.id} ${clients.find(client => client.id === sale.clientId)?.name || ''} ${sale.bonus || ''} ${sale.comment || ''}`.toLowerCase().includes(search.toLowerCase())); const filteredAttendance = mineAttendance.filter(item => `${clients.find(client => client.id === item.clientId)?.name || ''} ${item.type}`.toLowerCase().includes(search.toLowerCase()));
  const saveSale = () => {
       if (!canSellForSelectedClient) { notify(exitedToday(clientId) ? 'Este cliente quedó cerrado por hoy después de registrar la salida. Podrás vender nuevamente mañana.' : 'Debes registrar una entrada activa en este cliente antes de registrar una venta.', true); return; }
       if (!pricesValid) { notify(mode === 'UNIDADES' ? 'Ingresa un precio unitario mayor a S/ 0.00.' : 'Ingresa el precio unitario de cada marca utilizada.', true); return; }
       if (!canConfirm) { notify(mode === 'PLANCHAS' && planchas > 80 ? 'Requiere autorización previa de Trade' : bonus && missingRedemption ? `Stock insuficiente de ${redemptionLabel(missingRedemption[0])} para este canje` : Number.isFinite(saleAmount) && saleAmount > 0 ? 'Completa venta y evidencias' : 'Ingresa un precio unitario mayor a S/ 0.00', true); return; }
        const id = `VTA-${new Date().getFullYear()}-${String(sales.length + 1).padStart(6, '0')}`; const now = new Date().toISOString(); const sale: Sale = { id, promoterId: user.id, clientId, marketId: selectedMarketId, mode, units: total, amountSoles: saleAmount, weightKg: orderWeightKg, unitPrices: mode === 'UNIDADES' ? { [selectedProduct.sku]: unitPrice } : brandUnitPrices, planchas: mode === 'PLANCHAS' ? planchas : undefined, mix: mode === 'PLANCHAS' ? mix : { [selectedProduct.brand]: unitQty }, bonus, comment: comment.trim() || undefined, receiptPhoto: `BOLETA - ${id}.jpg`, exchangePhoto: bonus ? `${bonus} - CLIENTE - ${id}.jpg` : undefined, date: now, status: syncStatus() };
     const next = [sale, ...sales]; setSales(next); writeStore('bt-sales', next);
      if (bonus) {
        const nextInventory = inventory.map(item => item.marketId === selectedMarketId ? { ...item, redemptionStock: requiredRedemptionEntries(requiredRedemptions).reduce((nextStock, [itemId, quantity]) => ({ ...nextStock, [itemId]: nextStock[itemId] - quantity }), { ...item.redemptionStock }), updatedAt: now } : item);
       const currentMovements = readStore<InventoryMovement[]>('bt-inventory-movements', []);
         const canjeMovements = requiredRedemptionEntries(requiredRedemptions).map(([itemId, quantity]) => ({ id: `CAN-${id}-${itemId}`, marketId: selectedMarketId, kind: 'CANJE' as const, itemId, quantity, actorId: user.id, actorName: user.name, date: now, status: syncStatus() }));
        const nextMovements = [...canjeMovements, ...currentMovements];
       setInventory(nextInventory); setMovements(nextMovements); writeStore('bt-inventory', nextInventory); writeStore('bt-inventory-movements', nextMovements);
     }
      setUnitPriceSoles(''); setBrandPrices({ TODINNO: '', COSTA: '', PASQUALINO: '' }); setComment(''); setReceipt(null); setExchange(null); setView('LISTA'); notify(bonus ? 'Venta y canje registrados. Stock actualizado.' : 'Venta sin canje registrada');
  };
   const finalizeAttendance = (tastingUsed = 0) => {
      const stock = inventory.find(item => item.marketId === selectedMarketId) || emptyInventory(selectedMarketId);
     if (tastingUsed > stock.tastingStock) { notify(`Solo hay ${stock.tastingStock} panetones de degustación disponibles`, true); return; }
      const now = new Date(); const id = `MAR-${now.getFullYear()}-${String(attendance.length + 1).padStart(6, '0')}`; const type = markType; const item: Attendance = { id, promoterId: user.id, clientId: markClientId, marketId: selectedMarketId, type, photo: `${type} - ${available.find(client => client.id === markClientId)?.name || 'TIENDA'} - ${id}.jpg`, date: now.toISOString(), status: syncStatus() };
     const next = [item, ...attendance]; setAttendance(next); writeStore('bt-attendance', next);
     if (type === 'SALIDA') {
        const updatedInventory = inventory.some(entry => entry.marketId === selectedMarketId)
          ? inventory.map(entry => entry.marketId === selectedMarketId ? { ...entry, tastingStock: entry.tastingStock - tastingUsed, updatedAt: now.toISOString() } : entry)
         : [...inventory, { ...stock, tastingStock: stock.tastingStock - tastingUsed, updatedAt: now.toISOString() }];
        const movement: InventoryMovement = { id: `DEG-${id}`, marketId: selectedMarketId, kind: 'DEGUSTACION', quantity: tastingUsed, actorId: user.id, actorName: user.name, date: now.toISOString(), status: syncStatus() };
       const nextMovements = [movement, ...movements];
       setInventory(updatedInventory); setMovements(nextMovements); writeStore('bt-inventory', updatedInventory); writeStore('bt-inventory-movements', nextMovements);
     }
      setMarkPhoto(null); setMarkType(type === 'ENTRADA' ? 'SALIDA' : 'ENTRADA'); setView('LISTA'); notify(type === 'SALIDA' ? 'Salida registrada correctamente.' : 'Entrada registrada correctamente');
   };
   const saveAttendance = () => {
     if (!markClientId || !markPhoto) { notify('Selecciona la tienda y toma la fotografía', true); return; }
     const now = new Date(); const day = now.toISOString().slice(0, 10); const latest = mineAttendance.filter(item => item.clientId === markClientId && item.date.slice(0, 10) === day)[0];
     if (markType === 'SALIDA' && (!latest || latest.type !== 'ENTRADA')) { notify('Primero debes registrar la entrada en esta tienda', true); return; }
     if (markType === 'ENTRADA' && latest?.type === 'ENTRADA') { notify('Ya tienes una entrada abierta en esta tienda', true); return; }
      if (markType === 'SALIDA') { finalizeAttendance(); return; }
     finalizeAttendance();
   };
   if (!selectedMarket || !selectedClientId) return <main className="promoter-page"><div className="promoter-setup"><span className="eyebrow">INICIO DE JORNADA</span><h1>Selecciona tu visita</h1><p>Primero elige el mercado donde trabajarás y luego el cliente que visitarás.</p>{selectableMarkets.length ? <><SelectField label="Mercado *" value={selectedMarketId} onChange={value => { setSelectedMarketId(value); setSelectedClientId(''); }} items={selectableMarkets.map(item => ({ value: item.id, label: `${item.name} · ${item.district}` }))} /><SelectField label="Cliente a visitar *" value={selectedClientId} onChange={setSelectedClientId} items={available.map(client => ({ value: client.id, label: `${client.code} · ${client.name}` }))} placeholder={selectedMarketId ? (available.length ? 'Seleccionar cliente' : 'No hay clientes en este mercado') : 'Primero selecciona un mercado'} /><p className="setup-hint"><CheckCircle2 /> Al elegir el cliente se habilitarán tus módulos de trabajo.</p></> : <div className="no-market"><MapPin /><h2>{promoterAssignment ? 'Sin mercados asignados' : 'No hay mercados disponibles'}</h2><p>{promoterAssignment ? 'Solicita al analista que te asigne al menos un mercado y sus clientes.' : 'Solicita al analista que cargue un mercado antes de iniciar la jornada.'}</p></div>}</div></main>;
  return <main className="promoter-page"><div className="promoter-layout"><PromoterNav active={module} onChange={value => { setModule(value); setView('LISTA'); setSearch(''); }} /><div className="promoter-content">
     <div className="promoter-head"><div><span className="crumb">INICIO / PROCESAMIENTO DE PEDIDOS / {module === 'VENTAS' ? 'VENTAS' : 'TURNOS Y ASISTENCIAS'}</span><h1>{module === 'VENTAS' ? (view === 'LISTA' ? <>Mis ventas <small>{mineSales.length} registros</small></> : 'Añadir venta') : (view === 'LISTA' ? 'Registros de marcación' : 'Añadir registro de marcación')}</h1><p>{selectedMarket.name} · {user.name}</p></div>{view === 'LISTA' && <Btn onClick={() => setView('NUEVA')} testId={`button-new-${module.toLowerCase()}`}><Plus /> Nueva {module === 'VENTAS' ? 'venta' : 'marcación'}</Btn>}</div>
      <div className="market-banner"><span className="market-pin"><MapPin /></span><div><small>MERCADO SELECCIONADO</small><strong>{selectedMarket.name}</strong><p>{selectedMarket.district} · {selectedMarket.province} · {selectedMarket.department}</p></div><div className="market-stock-mini"><span>Premios <strong>{redemptionTotal}</strong></span><span>Degustación <strong>{marketStock.tastingStock}</strong></span></div><StatusPill status="ACTIVO" /></div>
     {module === 'VENTAS' && view === 'LISTA' && <div className="filters"><section className="dark-panel"><div className="dark-search"><Search /><Input value={search} onChange={setSearch} placeholder="Escribe para buscar" testId="input-search-sales" /></div>{filteredSales.length ? <div className="sale-table"><div className="sale-row header"><span>Ticket</span><span>Compra</span><span>Totales</span><span>Tienda</span><span>Promotor</span><span>Fecha y hora</span></div>{filteredSales.map(sale => <div className="sale-row" key={sale.id}><span><em className="ticket">{sale.id}</em></span><span className="product-cell"><PackageCheck /><span><strong>{sale.mode === 'PLANCHAS' ? `${sale.planchas} plancha(s) · Mix de marcas` : `${sale.units} unidad(es)`}</strong><small>{sale.bonus || 'Venta sin canje'}{sale.comment ? ` · ${sale.comment}` : ''}</small></span></span><span><strong>{sale.units} und.</strong><small>{sale.mode} · {formatKilos(sale.weightKg)}</small></span><span className="store-cell"><Store /><span><strong>{clients.find(client => client.id === sale.clientId)?.name}</strong><small>{selectedMarket.name}</small></span></span><span><strong>{user.name}</strong><small>Promotor</small></span><span><strong>{formatDate(sale.date)}</strong><small>{sale.status}</small></span></div>)}</div> : <div className="dark-empty"><ShoppingBag /><h3>Aún no hay ventas</h3><p>Registra tu primera venta en este mercado.</p><Btn onClick={() => setView('NUEVA')}><Plus /> Nueva venta</Btn></div>}</section><aside className="filter-bar"><h3>Filtros</h3><label>Tipo de venta</label><div className="filter-switch">{(['TODO', 'UNIDADES', 'PLANCHAS'] as const).map(value => <button className={modeFilter === value ? 'active' : ''} key={value} onClick={() => setModeFilter(value)} data-testid={`filter-${value.toLowerCase()}`}>{value === 'TODO' ? 'Todo' : value.charAt(0) + value.slice(1).toLowerCase()}</button>)}</div><label>Buscar tienda o ticket</label><Input value={search} onChange={setSearch} placeholder="Escribe para buscar" /></aside></div>}
    {module === 'MARCACIONES' && view === 'LISTA' && <section className="dark-panel"><div className="dark-search"><Search /><Input value={search} onChange={setSearch} placeholder="Escribe para buscar" testId="input-search-attendance" /></div>{filteredAttendance.length ? <div className="mark-table"><div className="mark-row header"><span>Tienda</span><span>Promotor</span><span>Evento</span><span>Fecha y hora</span><span>Evidencia</span></div>{filteredAttendance.map(item => <div className="mark-row" key={item.id}><span className="store-cell"><Store /><span><strong>{clients.find(client => client.id === item.clientId)?.name || 'Tienda'}</strong><small>{clients.find(client => client.id === item.clientId)?.code}</small></span></span><span><strong>{user.name}</strong><small>Promotor</small></span><span><StatusPill status={item.type === 'ENTRADA' ? 'ACTIVO' : 'PENDIENTE'} /></span><span><strong>{formatDate(item.date)}</strong><small>{item.status}</small></span><span className="evidence-cell"><Camera /><small>Foto</small></span></div>)}</div> : <div className="dark-empty"><Clock3 /><h3>Aún no hay marcaciones</h3><p>Registra tu primera entrada en una tienda.</p><Btn onClick={() => setView('NUEVA')}><Plus /> Nueva marcación</Btn></div>}</section>}
    {view === 'NUEVA' && module === 'MARCACIONES' && <section className="dark-form"><div className="form-section-title">Información</div><div className="dark-form-body"><SelectField label="Tienda *" value={markClientId} onChange={setMarkClientId} items={available.map(client => ({ value: client.id, label: `${client.code} · ${client.name}` }))} /><SelectField label="Evento *" value={markType} onChange={value => setMarkType(value as 'ENTRADA' | 'SALIDA')} items={[{ value: 'ENTRADA', label: 'Entrada' }, { value: 'SALIDA', label: 'Salida' }]} /><PhotoField label="Foto *" hint="Foto del promotor realizando la marcación" file={markPhoto} setFile={setMarkPhoto} /></div><div className="dark-actions"><Btn variant="outline" onClick={() => setView('LISTA')}>Cancelar</Btn><Btn disabled={!markClientId || !markPhoto} onClick={saveAttendance} testId="button-save-attendance"><CheckCircle2 /> Guardar marcación</Btn></div></section>}
     {view === 'NUEVA' && module === 'VENTAS' && <section className="sale-layout"><section className="sale-form"><span className="eyebrow">INFORMACIÓN</span><h2>Registrar venta</h2><p>Completa la compra para evaluar el canje.</p><div className={`attendance-gate ${sellingClients.length ? 'ready' : 'blocked'}`}><Clock3 /><span>{sellingClients.length ? 'Venta habilitada para clientes con Entrada activa.' : 'Debes marcar Entrada en el cliente antes de registrar una venta.'}</span></div><SelectField label="Cliente *" value={clientId} onChange={setClientId} items={sellingClients.map(client => ({ value: client.id, label: `${client.code} · ${client.name}` }))} placeholder={sellingClients.length ? 'Seleccionar cliente con Entrada activa' : 'Sin clientes con Entrada activa'} /><Field label="Tipo de ingreso"><div className="mode-switch"><button className={mode === 'UNIDADES' ? 'selected' : ''} onClick={() => setMode('UNIDADES')} data-testid="button-mode-unidades"><ShoppingBag /> Unidades</button><button className={mode === 'PLANCHAS' ? 'selected' : ''} onClick={() => setMode('PLANCHAS')} data-testid="button-mode-planchas"><PackageCheck /> Planchas</button></div></Field><Field label="Comentario (opcional)"><textarea className="input textarea" value={comment} onChange={event => setComment(event.target.value)} placeholder="Agrega una observación de la visita o venta" maxLength={300} rows={3} data-testid="input-sale-comment" /></Field>{mode === 'UNIDADES' ? <div className="form-grid"><SelectField label="Panetón / marca" value={sku} onChange={setSku} items={products.map(product => ({ value: product.sku, label: `${product.brand} · ${product.name} · ${formatKilos(product.weightKg)}` }))} /><Field label="Unidades (máximo 2)"><Input type="number" value={unitQty} onChange={value => setUnitQty(Math.max(1, Math.min(2, Number(value) || 1)))} min={1} max={2} testId="input-sale-units" /></Field><Field label="Precio unitario (S/) *" className="full-field"><Input type="number" value={unitPriceSoles} onChange={setUnitPriceSoles} min={0.01} step={0.01} placeholder="0.00" testId="input-unit-price" /></Field></div> : <div className="plancha-box"><Field label="Cantidad de planchas"><Input type="number" value={planchas} onChange={value => setPlanchas(Math.max(1, Number(value) || 1))} min={1} testId="input-sale-planchas" /></Field><p className="formula">Total requerido: <strong>{planchas * 6} unidades</strong> · mínimo 1 por marca · {formatKilos(weightPerPlanchaKg)} por plancha</p><div className="brand-mix">{Object.entries(mix).map(([brand, quantity]) => <Field label={brand} key={brand}><Input type="number" value={quantity} onChange={value => setMix({ ...mix, [brand]: Math.max(0, Number(value) || 0) })} min={0} /></Field>)}</div><div className="brand-prices">{Object.entries(mix).map(([brand]) => <Field label={`${brand} · precio unitario (S/) *`} key={`price-${brand}`}><Input type="number" value={brandPrices[brand as keyof typeof brandPrices]} onChange={value => setBrandPrices({ ...brandPrices, [brand]: value })} min={0.01} step={0.01} placeholder="0.00" testId={`input-price-${brand.toLowerCase()}`} /></Field>)}</div><div className={`mix-status ${validMix ? 'valid' : 'invalid'}`}>{validMix ? <><CheckCircle2 /> Mix válido: {totalMix} unidades</> : <>Debes sumar {planchas * 6} unidades e incluir las 3 marcas.</>}</div></div>}<div className="order-total"><span>Total calculado</span><strong>{formatSoles(saleAmount)}</strong><small>{mode === 'PLANCHAS' ? `${formatKilos(orderWeightKg)} total · ${formatKilos(weightPerPlanchaKg)} por plancha` : `${formatKilos(orderWeightKg)} de producto`}</small></div><div className={`bonus-box ${bonus ? 'active' : ''}`}><Gift /><div><small>{bonus ? 'CANJE ACTIVADO' : 'SIN CANJE'}</small><strong>{bonus || 'La compra aún no activa una bonificación'}</strong>{bonus && <small>{requiredRedemptionEntries(requiredRedemptions).map(([itemId, quantity]) => `${quantity} ${redemptionLabel(itemId)}`).join(' · ')} · ${redemptionTotal} disponibles</small>}</div></div>{bonus && missingRedemption && <div className="stock-warning"><PackageCheck /> No hay stock suficiente de {redemptionLabel(missingRedemption[0])} para este canje.</div>}{mode === 'PLANCHAS' && planchas > 80 && <div className="trade-warning"><ShieldCheck /> Requiere autorización previa de Trade.</div>}<div className="evidence-grid"><PhotoField label="Foto de boleta *" hint="Obligatoria para toda venta" file={receipt} setFile={setReceipt} /><PhotoField label="Cliente con canje" hint={bonus ? 'Obligatoria para este canje' : 'No requerida sin canje'} file={exchange} setFile={setExchange} disabled={!bonus} /></div><div className="form-actions"><Btn variant="outline" onClick={() => setView('LISTA')}>Cancelar</Btn><Btn disabled={!canConfirm} onClick={saveSale} testId="button-save-sale"><CheckCircle2 /> Guardar venta</Btn></div></section><aside className="recent"><h3>Resumen del registro</h3><p>Validación de compra, precio y peso.</p><div className="check-list"><p className="check"><Check /> Cliente con Entrada activa</p><p className="check"><Check /> {total} unidades registradas</p><p className="check"><Check /> Total: {formatSoles(Number.isFinite(saleAmount) ? saleAmount : 0)}</p><p className="check"><Check /> Peso: {formatKilos(orderWeightKg)}</p><p className="check"><Gift /> {bonus || 'Sin canje'}</p></div></aside></section>}
    </div></div></main>;
}

export default function App() {
   clearTestDataOnce();
   const [user, setUser] = useState<AppUser | null>(() => readStore<AppUser | null>('bt-session', null)); const [markets, setMarkets] = useState<Market[]>(() => readStore('bt-markets', [])); const [users, setUsers] = useState<AppUser[]>(() => readStore('bt-users', [])); const [clients, setClients] = useState<Client[]>(() => readStore('bt-clients', [])); const [sales, setSales] = useState<Sale[]>(() => readStore('bt-sales', [])); const [attendance, setAttendance] = useState<Attendance[]>(() => readStore('bt-attendance', [])); const [inventory, setInventory] = useState<MarketInventory[]>(() => initializeCampaignInventory(readStore<Market[]>('bt-markets', []), readStore<MarketInventory[]>('bt-inventory', []))); const [movements, setMovements] = useState<InventoryMovement[]>(() => readStore('bt-inventory-movements', [])); const [assignments, setAssignments] = useState<PromoterAssignment[]>(() => readStore('bt-promoter-assignments', [])); const [toast, setToast] = useState<Toast | null>(null); const [sessionClosePrompt, setSessionClosePrompt] = useState(false); const [promoterSession, setPromoterSession] = useState({ marketId: '', clientId: '' });
   const notify = (message: string, error = false) => setToast({ message, error });
   const syncUsersForLogin = (imported: AppUser[]) => {
     const next = [...users];
     imported.forEach(item => {
       const index = next.findIndex(current => current.id === item.id || current.dni === item.dni);
       if (index >= 0) next[index] = { ...next[index], ...item };
       else next.push(item);
     });
     setUsers(next);
     writeStore('bt-users', next);
   };
   useEffect(() => {
     let cancelled = false;
     const syncUsersOnOpen = async () => {
       try {
         const records = await fetchGoogleSheetRecords(USERS_SHEET_ID);
         const imported = records.map((record, index) => importedUserFromRecord(record, index, [])).filter((item): item is AppUser => Boolean(item));
         if (!cancelled && imported.length) syncUsersForLogin(imported);
       } catch {
         // La app conserva los usuarios locales para permitir el acceso offline.
       }
     };
     void syncUsersOnOpen();
     return () => { cancelled = true; };
   }, []);
  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => undefined);
  }, []);
   useEffect(() => { writeStore('bt-markets', markets); }, [markets]); useEffect(() => { writeStore('bt-users', users); }, [users]); useEffect(() => { writeStore('bt-clients', clients); }, [clients]); useEffect(() => { const next = ensureInventory(markets, inventory); if (next.length !== inventory.length) { setInventory(next); writeStore('bt-inventory', next); } }, [markets, inventory]); useEffect(() => { writeStore('bt-inventory', inventory); }, [inventory]); useEffect(() => { writeStore('bt-inventory-movements', movements); }, [movements]); useEffect(() => { writeStore('bt-promoter-assignments', assignments); }, [assignments]);
   const activeUser = useMemo(() => user ? users.find(item => item.dni === user.dni) || user : null, [user, users]);
   const logoutImmediately = () => { localStorage.removeItem('bt-session'); setSessionClosePrompt(false); setPromoterSession({ marketId: '', clientId: '' }); setUser(null); };
    const requestLogout = () => {
      if (activeUser?.role === 'PROMOTOR') {
        const today = new Date().toISOString().slice(0, 10);
        const hasAttendanceToday = attendance.some(item => item.promoterId === activeUser.id && item.type === 'ENTRADA' && item.date.slice(0, 10) === today);
        if (!hasAttendanceToday) {
          notify('Debes marcar Entrada en asistencia antes de cerrar sesión.', true);
          return;
        }
        setSessionClosePrompt(true);
        return;
      }
      logoutImmediately();
    };
   const completePromoterLogout = (tastingUsed: number, leads: number) => {
     if (!activeUser) return;
     const marketId = promoterSession.marketId || activeUser.marketId || ''; const clientId = promoterSession.clientId || undefined; const stock = inventory.find(item => item.marketId === marketId) || emptyInventory(marketId);
     if (tastingUsed > stock.tastingStock) { notify(`Solo hay ${stock.tastingStock} panetones de degustación disponibles`, true); return; }
     const now = new Date().toISOString(); const updatedInventory = marketId ? (inventory.some(item => item.marketId === marketId) ? inventory.map(item => item.marketId === marketId ? { ...item, tastingStock: item.tastingStock - tastingUsed, updatedAt: now } : item) : [...inventory, { ...stock, tastingStock: stock.tastingStock - tastingUsed, updatedAt: now }]) : inventory;
     const nextMovements = tastingUsed > 0 && marketId ? [{ id: `DEG-CIERRE-${activeUser.id}-${Date.now()}`, marketId, kind: 'DEGUSTACION' as const, quantity: tastingUsed, actorId: activeUser.id, actorName: activeUser.name, date: now, status: syncStatus() }, ...movements] : movements;
     const closure: SessionClosure = { id: `CIERRE-${new Date().getFullYear()}-${String(readStore<SessionClosure[]>('bt-session-closures', []).length + 1).padStart(6, '0')}`, promoterId: activeUser.id, marketId, clientId, tastingUsed, leads, date: now, status: syncStatus() };
     const closures = [closure, ...readStore<SessionClosure[]>('bt-session-closures', [])]; writeStore('bt-session-closures', closures);
     setInventory(updatedInventory); setMovements(nextMovements); writeStore('bt-inventory', updatedInventory); writeStore('bt-inventory-movements', nextMovements); logoutImmediately();
   };
   const logoutMarketId = promoterSession.marketId || activeUser?.marketId || ''; const logoutStock = inventory.find(item => item.marketId === logoutMarketId)?.tastingStock ?? (logoutMarketId ? DEFAULT_CAMPAIGN_TASTING_STOCK : 0);
    return <>{activeUser ? <><Shell user={activeUser} logout={requestLogout}>{activeUser.role === 'PROMOTOR' ? <PromoterApp user={activeUser} markets={markets} clients={clients} assignments={assignments} sales={sales} setSales={setSales} attendance={attendance} setAttendance={setAttendance} inventory={inventory} setInventory={setInventory} movements={movements} setMovements={setMovements} notify={notify} onSessionSelection={setPromoterSession} /> : <AnalystApp user={activeUser} markets={markets} setMarkets={setMarkets} users={users} setUsers={setUsers} clients={clients} setClients={setClients} sales={sales} attendance={attendance} inventory={inventory} movements={movements} assignments={assignments} setAssignments={setAssignments} setInventory={setInventory} setMovements={setMovements} notify={notify} />}</Shell>{sessionClosePrompt && activeUser.role === 'PROMOTOR' && <SessionCloseModal available={logoutStock} onConfirm={completePromoterLogout} close={() => setSessionClosePrompt(false)} />}</> : <Login users={users} onLogin={setUser} notify={notify} />}<ToastView toast={toast} clear={() => setToast(null)} /></>;
}