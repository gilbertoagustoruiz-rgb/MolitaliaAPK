import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Camera, Check, CheckCircle2, Clock3, Download, FileSpreadsheet, Gift, LogOut, MapPin, PackageCheck, Plus, RefreshCw, Search, ShieldCheck, ShoppingBag, Smartphone, Store, Upload, UserRound, Users, Wifi, WifiOff, X } from 'lucide-react';

type Role = 'ANALISTA' | 'PROMOTOR' | 'SUPERVISOR' | 'TRADE' | 'ADMIN';
type Status = 'ACTIVO' | 'INACTIVO';
type SyncStatus = 'SINCRONIZADA' | 'PENDIENTE';
type Market = { id: string; department: string; province: string; district: string; name: string; status: Status };
type AppUser = { id: string; dni: string; name: string; role: Role; marketId?: string; status: Status };
type Client = { id: string; code: string; name: string; phone?: string; marketId: string; status: Status };
type Sale = { id: string; promoterId: string; clientId: string; marketId: string; mode: 'UNIDADES' | 'PLANCHAS'; units: number; amountSoles: number; planchas?: number; mix: Record<string, number>; bonus?: string; receiptPhoto: string; exchangePhoto?: string; date: string; status: SyncStatus };
type Attendance = { id: string; promoterId: string; clientId: string; marketId: string; type: 'ENTRADA' | 'SALIDA'; photo: string; date: string; status: SyncStatus };
type RedemptionItemId = 'AVENA' | 'BATEA' | 'MANDIL' | 'SPAGHETTI';
type RedemptionStock = Record<RedemptionItemId, number>;
type MarketInventory = { marketId: string; tastingStock: number; redemptionStock: RedemptionStock; updatedAt: string; exchangeStock?: number };
type InventoryMovementKind = 'CANJE' | 'DEGUSTACION' | 'AJUSTE_DEGUSTACION' | 'AJUSTE_CANJES';
type InventoryMovement = { id: string; marketId: string; kind: InventoryMovementKind; itemId?: RedemptionItemId; quantity: number; actorId: string; actorName: string; date: string; status: SyncStatus };
type Toast = { message: string; error?: boolean };

const MARKETS_SHEET = 'https://docs.google.com/spreadsheets/d/1GCbfnfCgZdXBaPzVsnrhjos_K0h5j0WXxKOanAIjUtM/export?format=csv&gid=0';
const seedMarkets: Market[] = [
  { id: '1', department: 'AMAZONAS', province: 'CHACHAPOYAS', district: 'CHACHAPOYAS', name: 'MERCADO MERCA CHACHA', status: 'ACTIVO' },
  { id: '2', department: 'AMAZONAS', province: 'CHACHAPOYAS', district: 'CHACHAPOYAS', name: 'MERCADO MODELO', status: 'ACTIVO' },
  { id: '101', department: 'LIMA', province: 'LIMA', district: 'LA VICTORIA', name: 'MERCADO MAYORISTA', status: 'ACTIVO' },
];
const seedUsers: AppUser[] = [
  { id: 'USR-001', dni: '12345678', name: 'Analista Below Trade', role: 'ANALISTA', status: 'ACTIVO' },
  { id: 'USR-002', dni: '87654321', name: 'Promotor Demo', role: 'PROMOTOR', marketId: '2', status: 'ACTIVO' },
];
const seedClients: Client[] = [
  { id: '1', code: 'CLI-000001', name: 'Bodega Rosita', phone: '999 555 101', marketId: '2', status: 'ACTIVO' },
  { id: '2', code: 'CLI-000002', name: 'Puesto El Buen Precio', marketId: '2', status: 'ACTIVO' },
];
const demoPromoterCredentials = [
  { id: 'USR-002', dni: '87654321', name: 'Promotor Demo', password: 'Promo2026' },
  { id: 'USR-003', dni: '87654322', name: 'Promotor Demo 2', password: 'Promo2026-2' },
  { id: 'USR-004', dni: '87654323', name: 'Promotor Demo 3', password: 'Promo2026-3' },
];
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
function demoMarkets(markets: Market[]) {
  return markets.filter(market => market.status === 'ACTIVO').slice(0, demoPromoterCredentials.length);
}
function ensureDemoPromoters(users: AppUser[], markets: Market[]) {
  const next = [...users];
  demoMarkets(markets).forEach((market, index) => {
    const credential = demoPromoterCredentials[index]; const record: AppUser = { id: credential.id, dni: credential.dni, name: credential.name, role: 'PROMOTOR', marketId: market.id, status: 'ACTIVO' }; const existingIndex = next.findIndex(user => user.id === record.id || user.dni === record.dni);
    if (existingIndex >= 0) next[existingIndex] = { ...next[existingIndex], ...record }; else next.push(record);
  });
  return next;
}
function ensureDemoClients(clients: Client[], markets: Market[]) {
  const next = [...clients];
  demoMarkets(markets).forEach((market, marketIndex) => {
    for (let clientIndex = 1; clientIndex <= 5; clientIndex += 1) {
      const id = `DEMO-CLI-${market.id}-${clientIndex}`; if (next.some(client => client.id === id)) continue;
      next.push({ id, code: `DEMO-${String(marketIndex + 1).padStart(2, '0')}-${String(clientIndex).padStart(2, '0')}`, name: `Cliente Demo ${clientIndex} · ${market.name}`, phone: `999 000 ${String(marketIndex * 10 + clientIndex).padStart(3, '0')}`, marketId: market.id, status: 'ACTIVO' });
    }
  });
  return next;
}
const products = [
  { sku: '801177', brand: 'TODINNO', name: 'Panetón Todinno 900 g + Todinnito 85 g' },
  { sku: '801200', brand: 'COSTA', name: 'Panetón Costa 800 g' },
  { sku: '800891', brand: 'PASQUALINO', name: 'Pasqualino 800 g' },
  { sku: '801201', brand: 'COSTA', name: 'Mini Costa Minions 80 g' },
  { sku: '801384', brand: 'COSTA', name: 'Mini Costa Jurassic 80 g' },
  { sku: '800659', brand: 'TODINNO', name: 'Todinnito 85 g' },
];

function readStore<T>(key: string, fallback: T): T {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}
function writeStore(key: string, value: unknown) { localStorage.setItem(key, JSON.stringify(value)); }
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
function formatDate(value: string) { return new Date(value).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }); }
function formatSoles(value: number | undefined) { return `S/ ${Number(value ?? 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
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
    const credential = dni === '12345678' ? 'Below2026' : demoPromoterCredentials.find(item => item.dni === dni)?.password; const user = credential === password ? users.find(item => item.dni === dni && item.status === 'ACTIVO') || null : null;
    if (!user) { notify('DNI o clave incorrectos en esta demostración', true); return; }
    writeStore('bt-session', user); onLogin(user);
  };
  const fillDemoPromoter = (credential: typeof demoPromoterCredentials[number]) => { setDni(credential.dni); setPassword(credential.password); };
  return <main className="login-shell">
    <section className="login-hero"><Logo compact /><div className="hero-copy"><span className="eyebrow">CAMPAÑA 2026</span><h1>Panetones Molitalia</h1><p>Ventas, clientes, dinámicas y evidencias en una sola aplicación.</p></div><div className="hero-foot"><span /> Captura segura para trabajo en campo</div></section>
    <section className="login-panel"><form className="login-card" onSubmit={event => { event.preventDefault(); submit(); }}><div className="mobile-logo"><Logo /></div><div className="login-heading"><span className="icon-disc"><ShieldCheck /></span><div><h2>Bienvenido</h2><p>Ingresa con tu DNI y clave.</p></div></div>
       <Field label="DNI"><Input value={dni} onChange={value => setDni(value.replace(/\D/g, ''))} placeholder="12345678" maxLength={8} autoComplete="username" testId="input-dni" /></Field>
       <Field label="Clave"><Input value={password} onChange={setPassword} placeholder="Ingresa tu clave" type="password" autoComplete="current-password" testId="input-password" /></Field>
       <Btn className="primary full" type="submit" testId="button-login">Ingresar</Btn>
       <div className="demo-box"><p>Accesos de demostración</p><div className="demo-actions"><button onClick={() => { setDni('12345678'); setPassword('Below2026'); }} data-testid="button-demo-analista">Analista</button>{demoPromoterCredentials.map((credential, index) => <button key={credential.id} onClick={() => fillDemoPromoter(credential)} data-testid={index === 0 ? 'button-demo-promotor' : `button-demo-promotor-${index + 1}`}>{index === 0 ? 'Promotor' : `Promotor ${index + 1}`}</button>)}</div></div>
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
    onSave({ id: `USR-${Date.now()}`, dni, name: name.trim(), role, marketId: role === 'PROMOTOR' ? marketId : undefined, status: 'ACTIVO' }); close();
  };
  return <Modal title="Crear usuario" detail="Define acceso, rol y mercado." close={close}><div className="form-grid"><Field label="DNI *"><Input value={dni} onChange={value => setDni(value.replace(/\D/g, ''))} maxLength={8} testId="input-new-user-dni" /></Field><Field label="Nombre completo *"><Input value={name} onChange={setName} testId="input-new-user-name" /></Field><SelectField label="Rol *" value={role} onChange={value => setRole(value as Role)} items={['PROMOTOR', 'SUPERVISOR', 'ANALISTA', 'TRADE', 'ADMIN'].map(value => ({ value, label: value }))} />{role === 'PROMOTOR' && <SelectField label="Mercado asignado *" value={marketId} onChange={setMarketId} items={markets} />}<Field label="Clave temporal *"><Input value={password} onChange={setPassword} type="password" testId="input-new-user-password" /></Field></div><div className="modal-actions"><Btn variant="outline" onClick={close}>Cancelar</Btn><Btn onClick={save} testId="button-create-user">Crear usuario</Btn></div></Modal>;
}
function NewClientModal({ markets, count, onSave, close }: { markets: { value: string; label: string }[]; count: number; onSave: (client: Client) => void; close: () => void }) {
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [marketId, setMarketId] = useState('');
  const save = () => { if (!name.trim() || !marketId) return; onSave({ id: `${Date.now()}`, code: `CLI-${String(count + 1).padStart(6, '0')}`, name: name.trim(), phone: phone || undefined, marketId, status: 'ACTIVO' }); close(); };
  return <Modal title="Crear cliente" detail="El código y estado se generan automáticamente." close={close}><div className="form-grid"><Field label="Nombre del cliente *"><Input value={name} onChange={setName} testId="input-new-client-name" /></Field><Field label="Celular (opcional)"><Input value={phone} onChange={setPhone} testId="input-new-client-phone" /></Field><SelectField label="Mercado *" value={marketId} onChange={setMarketId} items={markets} /></div><div className="modal-actions"><Btn variant="outline" onClick={close}>Cancelar</Btn><Btn onClick={save} testId="button-create-client">Guardar cliente</Btn></div></Modal>;
}

function TastingLogoutModal({ available, onConfirm, close }: { available: number; onConfirm: (quantity: number) => void; close: () => void }) {
  const [quantity, setQuantity] = useState('');
  const parsed = quantity === '' ? NaN : Number(quantity);
  const valid = Number.isInteger(parsed) && parsed >= 0 && parsed <= available;
  return <Modal title="Declara tu degustación" detail="Antes de salir, indica cuántos panetones de degustación utilizaste hoy." close={close}>
    <div className="logout-declaration">
      <div className="stock-callout"><PackageCheck /><div><strong>{available} disponibles</strong><small>Stock de degustación en tu mercado</small></div></div>
      <Field label="Panetones utilizados *"><Input type="number" value={quantity} onChange={value => setQuantity(value.replace(/\D/g, ''))} min={0} step={1} placeholder="0" testId="input-tasting-usage" /></Field>
      {Number.isFinite(parsed) && parsed > available && <p className="modal-error">La cantidad ingresada supera el stock disponible ({available}).</p>}
      <p className="modal-hint">{available > 0 ? 'Si no utilizaste ninguno, registra 0. El stock se descontará al confirmar la salida.' : 'No hay stock disponible en este mercado. Registra 0 para cerrar la sesión o solicita una reposición.'}</p>
    </div>
    <div className="modal-actions"><Btn variant="outline" onClick={close}>Seguir trabajando</Btn><Btn disabled={!valid} onClick={() => onConfirm(parsed)} testId="button-confirm-logout"><LogOut /> Confirmar y salir</Btn></div>
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
    <div className="inventory-grid">{markets.map(market => {
      const stock = inventory.find(item => item.marketId === market.id) || emptyInventory(market.id); const totalRedemption = redemptionItems.reduce((sum, item) => sum + stock.redemptionStock[item.id], 0); const minimumStock = Math.min(stock.tastingStock, ...redemptionItems.map(item => stock.redemptionStock[item.id]));
      return <article className="inventory-card" key={market.id}><div className="inventory-card-head"><div><span className="inventory-market-id">{market.id}</span><h3>{market.name}</h3><p>{market.district} · {market.province}</p></div><span className={`stock-level ${levelClass(minimumStock)}`}>{minimumStock === 0 ? 'Agotado' : minimumStock <= 5 ? 'Stock bajo' : 'Disponible'}</span></div><div className="stock-counters"><div><small>DEGUSTACIÓN</small><strong>{stock.tastingStock}</strong><span>panetones</span></div><div><small>CANJES</small><strong>{totalRedemption}</strong><span>premios</span></div></div><div className="redemption-summary"><p>Premios disponibles para canje</p>{redemptionItems.map(item => <div key={item.id}><span>{item.label}</span><strong>{stock.redemptionStock[item.id]}</strong></div>)}</div></article>;
    })}</div>
    <section className="inventory-history"><div className="panel-header"><div><h2>Movimientos recientes</h2><p>Canjes, degustaciones y ajustes hechos por el equipo.</p></div></div>{sortedMovements.length ? <div className="movement-list">{sortedMovements.map(movement => { const amount = movementAmount(movement); return <article className="movement-row" key={movement.id}><span className={`movement-icon ${amount < 0 ? 'consume' : 'adjust'}`}>{amount < 0 ? <PackageCheck /> : <Plus />}</span><div><strong>{movementLabel(movement.kind, movement.itemId)}</strong><small>{marketMap[movement.marketId]?.name || 'Mercado'} · {movement.actorName} · {formatDate(movement.date)}</small></div><span className={`movement-amount ${amount < 0 ? 'negative' : 'positive'}`}>{amount > 0 ? '+' : ''}{amount}</span><StatusPill status={movement.status} /></article>; })}</div> : <div className="inventory-empty"><PackageCheck /><h3>Aún no hay movimientos</h3><p>Los descuentos y ajustes de stock aparecerán aquí.</p></div>}</section>
  </section>;
}

function AnalystApp({ user, markets, setMarkets, users, setUsers, clients, setClients, sales, attendance, inventory, movements, setInventory, setMovements, notify }: { user: AppUser; markets: Market[]; setMarkets: (value: Market[]) => void; users: AppUser[]; setUsers: (value: AppUser[]) => void; clients: Client[]; setClients: (value: Client[]) => void; sales: Sale[]; attendance: Attendance[]; inventory: MarketInventory[]; movements: InventoryMovement[]; setInventory: (value: MarketInventory[]) => void; setMovements: (value: InventoryMovement[]) => void; notify: (message: string, error?: boolean) => void }) {
  const [tab, setTab] = useState('inicio'); const [query, setQuery] = useState(''); const [modal, setModal] = useState<'user' | 'client' | null>(null); const [syncing, setSyncing] = useState(false);
  const activeMarkets = markets.filter(market => market.status === 'ACTIVO'); const marketMap = Object.fromEntries(markets.map(market => [market.id, market])); const today = new Date().toISOString().slice(0, 10);
  const marketOptions = activeMarkets.map(market => ({ value: market.id, label: `${market.name} · ${market.district}` }));
  const exportSales = () => { downloadCsv(`ventas-${today}.csv`, ['Código venta', 'Fecha', 'Promotor', 'Cliente', 'Mercado', 'Tipo', 'Unidades', 'Ingreso (S/)', 'Bonificación', 'Estado'], sales.map(sale => [sale.id, formatDate(sale.date), users.find(user => user.id === sale.promoterId)?.name, clients.find(client => client.id === sale.clientId)?.name, marketMap[sale.marketId]?.name, sale.mode, sale.units, (sale.amountSoles ?? 0).toFixed(2), sale.bonus || 'Sin canje', sale.status])); notify('Reporte de ventas descargado'); };
  const exportClients = () => { downloadCsv(`clientes-${today}.csv`, ['Código', 'Cliente', 'Celular', 'Mercado', 'Distrito', 'Estado'], clients.map(client => [client.code, client.name, client.phone || '', marketMap[client.marketId]?.name, marketMap[client.marketId]?.district, client.status])); notify('Reporte de clientes descargado'); };
  const exportUsers = () => { downloadCsv(`usuarios-${today}.csv`, ['ID', 'DNI', 'Nombre', 'Rol', 'Mercado', 'Estado'], users.map(user => [user.id, user.dni, user.name, user.role, marketMap[user.marketId || '']?.name || '', user.status])); notify('Reporte de usuarios descargado'); };
  const exportAttendance = () => { downloadCsv(`marcaciones-${today}.csv`, ['Código', 'Tipo', 'Fecha', 'Promotor', 'Tienda', 'Foto', 'Estado'], attendance.map(item => [item.id, item.type, formatDate(item.date), users.find(user => user.id === item.promoterId)?.name, clients.find(client => client.id === item.clientId)?.name, item.photo, item.status])); notify('Marcaciones descargadas'); };
  const exportSummary = () => { const withBonus = sales.filter(sale => sale.bonus).length; downloadCsv(`resumen-${today}.csv`, ['Fecha', 'Mercados activos', 'Usuarios activos', 'Clientes activos', 'Ventas', 'Con canje', 'Unidades', 'Ingresos (S/)'], [[new Date().toLocaleString('es-PE'), activeMarkets.length, users.filter(user => user.status === 'ACTIVO').length, clients.filter(client => client.status === 'ACTIVO').length, sales.length, withBonus, sales.reduce((sum, sale) => sum + sale.units, 0), sales.reduce((sum, sale) => sum + (sale.amountSoles ?? 0), 0).toFixed(2)]]); notify('Resumen descargado'); };
  const importMarkets = async () => {
    setSyncing(true);
    try {
      const response = await fetch(MARKETS_SHEET); if (!response.ok) throw new Error('No se pudo conectar');
      const lines = (await response.text()).split(/\r?\n/).filter(Boolean); const aliases = new Map<string, string>(); const imported = lines.slice(1).map((line, index) => { const cells = parseCsvLine(line); const sourceId = (cells[0] || `SHEET-${index + 1}`).trim(); const department = (cells[1] || 'LIMA').toUpperCase(); const province = (cells[2] || 'LIMA').toUpperCase(); const district = (cells[3] || 'LIMA').toUpperCase(); const name = (cells[4] || cells[3] || 'MERCADO IMPORTADO').toUpperCase(); const existing = markets.find(market => market.id === sourceId || market.id === `SHEET-${index + 1}` || (market.name === name && market.district === district && market.province === province)); if (existing && existing.id !== sourceId) aliases.set(existing.id, sourceId); return { id: sourceId, department, province, district, name, status: csvStatus(cells[5] || 'ACTIVO') }; }).filter(market => market.name);
      if (!imported.length) throw new Error('La hoja no contiene mercados');
      const remapMarketId = (marketId?: string) => marketId ? aliases.get(marketId) || marketId : marketId;
      const nextUsers = users.map(item => ({ ...item, marketId: remapMarketId(item.marketId) })); const nextClients = clients.map(item => ({ ...item, marketId: remapMarketId(item.marketId) || item.marketId })); const nextInventory = inventory.map(item => ({ ...item, marketId: remapMarketId(item.marketId) || item.marketId })); const nextMovements = movements.map(item => ({ ...item, marketId: remapMarketId(item.marketId) || item.marketId }));
      const importedIds = new Set(imported.map(market => market.id)); const referencedIds = new Set([...nextUsers.map(item => item.marketId), ...nextClients.map(item => item.marketId), ...nextInventory.map(item => item.marketId)].filter(Boolean) as string[]);
      const preservedAssignments = markets.filter(market => referencedIds.has(market.id) && !importedIds.has(market.id));
      const nextMarkets = [...imported, ...preservedAssignments]; const demoUsers = ensureDemoPromoters(nextUsers, nextMarkets); const demoClients = ensureDemoClients(nextClients, nextMarkets); setMarkets(nextMarkets); setUsers(demoUsers); setClients(demoClients); setInventory(nextInventory); setMovements(nextMovements); writeStore('bt-markets', nextMarkets); writeStore('bt-users', demoUsers); writeStore('bt-clients', demoClients); writeStore('bt-inventory', nextInventory); writeStore('bt-inventory-movements', nextMovements); notify(`${imported.length} mercados importados desde Google Sheets`);
    } catch { notify('No se pudo importar la hoja. Los mercados locales siguen disponibles.', true); } finally { setSyncing(false); }
  };
  const importUsers = async (file: File) => {
    setSyncing(true);
    try {
      const records = parseCsvRecords(await file.text()); const imported: AppUser[] = []; let skipped = 0; const importId = Date.now();
      records.forEach((record, index) => {
        const dni = csvField(record, ['dni', 'documento', 'documentoidentidad']); const name = csvField(record, ['nombre', 'nombrecompleto', 'usuario']); const roleValue = normalizeCsvHeader(csvField(record, ['rol', 'cargo'])).toUpperCase() as Role; const marketValue = csvField(record, ['marketid', 'idmercado', 'mercado', 'market']);
        if (!/^\d{8}$/.test(dni) || !name || !['PROMOTOR', 'SUPERVISOR', 'ANALISTA', 'TRADE', 'ADMIN'].includes(roleValue) || (roleValue === 'PROMOTOR' && !csvMarketId(marketValue, markets))) { skipped += 1; return; }
        imported.push({ id: csvField(record, ['id', 'codigo']) || `USR-IMP-${importId}-${index + 1}`, dni, name, role: roleValue, marketId: roleValue === 'PROMOTOR' ? csvMarketId(marketValue, markets) : undefined, status: csvStatus(csvField(record, ['estado', 'status'])) });
      });
      if (!imported.length) throw new Error('No se encontraron filas válidas. Revisa DNI, nombre, rol y mercado para promotores.');
      const next = [...users]; imported.forEach(item => { const index = next.findIndex(current => current.id === item.id || current.dni === item.dni); if (index >= 0) next[index] = { ...next[index], ...item }; else next.push(item); }); setUsers(next); writeStore('bt-users', next); notify(`${imported.length} usuarios importados${skipped ? ` · ${skipped} filas omitidas` : ''}`);
    } catch (error) { notify(`No se pudo importar usuarios: ${error instanceof Error ? error.message : 'formato inválido'}`, true); } finally { setSyncing(false); }
  };
  const importClients = async (file: File) => {
    setSyncing(true);
    try {
      const records = parseCsvRecords(await file.text()); const imported: Client[] = []; let skipped = 0; const importId = Date.now();
      records.forEach((record, index) => {
        const name = csvField(record, ['cliente', 'nombre', 'nombrecliente', 'tienda']); const marketId = csvMarketId(csvField(record, ['marketid', 'idmercado', 'mercado', 'market']), markets);
        if (!name || !marketId) { skipped += 1; return; }
        imported.push({ id: csvField(record, ['id']) || `CLI-IMP-${importId}-${index + 1}`, code: csvField(record, ['codigo', 'code']) || `CLI-${String(clients.length + index + 1).padStart(6, '0')}`, name, phone: csvField(record, ['celular', 'telefono', 'phone']) || undefined, marketId, status: csvStatus(csvField(record, ['estado', 'status'])) });
      });
      if (!imported.length) throw new Error('No se encontraron filas válidas. Revisa cliente y mercado.');
      const next = [...clients]; imported.forEach(item => { const index = next.findIndex(current => current.id === item.id || current.code === item.code); if (index >= 0) next[index] = { ...next[index], ...item }; else next.push(item); }); setClients(next); writeStore('bt-clients', next); notify(`${imported.length} clientes importados${skipped ? ` · ${skipped} filas omitidas` : ''}`);
    } catch (error) { notify(`No se pudo importar clientes: ${error instanceof Error ? error.message : 'formato inválido'}`, true); } finally { setSyncing(false); }
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
  const tabs = [['inicio', 'Resumen'], ['mercados', 'Mercados'], ['usuarios', 'Usuarios'], ['clientes', 'Clientes'], ['ventas', 'Ventas'], ['marcaciones', 'Marcaciones'], ['inventario', 'Canjes y degustación']];
  return <main className="workspace">
    <div className="page-head"><div><span className="eyebrow">PANEL DE CONTROL</span><h1>Hola, analista</h1><p>Supervisa el pulso de la campaña desde un solo lugar.</p></div></div>
    <nav className="tabs" aria-label="Módulos">{tabs.map(([value, label]) => <button key={value} className={`tab ${tab === value ? 'active' : ''}`} onClick={() => setTab(value)} data-testid={`tab-${value}`}>{label}</button>)}</nav>
     {tab === 'inicio' && <><div className="stats-grid"><Stat icon={<MapPin />} label="Mercados activos" value={activeMarkets.length} note="En la campaña" /><Stat icon={<Users />} label="Usuarios activos" value={users.filter(user => user.status === 'ACTIVO').length} note="Con acceso vigente" /><Stat icon={<Store />} label="Clientes activos" value={clients.filter(client => client.status === 'ACTIVO').length} note="Puntos vinculados" /><Stat icon={<ShoppingBag />} label="Ventas registradas" value={sales.length} note={`${sales.filter(sale => sale.status === 'PENDIENTE').length} pendientes`} /></div><div className="section-grid"><section className="panel"><div className="panel-header"><div><h2>Últimas ventas</h2><p>Registros capturados por promotores.</p></div><Btn variant="ghost" onClick={() => setTab('ventas')}>Ver todas</Btn></div><div className="panel-body">{sales.length ? <div className="record-list">{sales.slice(0, 4).map(sale => <article className="record" key={sale.id}><span className="record-icon"><ShoppingBag /></span><div className="record-main"><strong>{clients.find(client => client.id === sale.clientId)?.name || 'Tienda'}</strong><small>{sale.id} · {sale.units} unidades · {formatSoles(sale.amountSoles)} · {formatDate(sale.date)}</small><em><Gift /> {sale.bonus || 'Sin canje'}</em></div><StatusPill status={sale.status} /></article>)}</div> : <Empty />}</div></section><section className="panel"><div className="panel-header"><div><h2>Control operativo</h2><p>Estado del flujo configurado.</p></div></div><div className="panel-body"><div className="check-list"><p className="check"><CheckCircle2 /> Mercado asignado por analista</p><p className="check"><CheckCircle2 /> Clientes vinculados a un mercado</p><p className="check"><CheckCircle2 /> Entrada y salida con fotografía</p><p className="check"><CheckCircle2 /> Evidencias según la venta</p></div></div></section></div><section className="panel"><div className="panel-header"><div><h2>Descargas de campaña</h2><p>Exporta la información local para compartirla con el equipo.</p></div></div><div className="panel-body"><div className="download-grid"><DownloadCard title="Ventas" detail={`${sales.length} registros con evidencias`} onClick={exportSales} /><DownloadCard title="Clientes" detail={`${clients.length} clientes vinculados`} onClick={exportClients} /><DownloadCard title="Usuarios" detail={`${users.length} accesos, roles y asignaciones`} onClick={exportUsers} /><DownloadCard title="Resumen" detail="Indicadores consolidados de campaña" onClick={exportSummary} /></div></div></section></>}
    {tab === 'mercados' && <section className="panel"><div className="panel-header"><div><h2>Mercados</h2><p>Catálogo importado desde Google Sheets o guardado localmente.</p></div><Btn onClick={importMarkets} disabled={syncing} testId="button-refresh-markets"><RefreshCw /> Actualizar hoja</Btn></div><div className="panel-body"><div className="data-table"><div className="table-row header"><span>Mercado</span><span>Distrito</span><span>Provincia</span><span>Departamento</span><span>Estado</span></div>{markets.map(market => <div className="table-row" key={market.id}><span><strong>{market.name}</strong><small>{market.id}</small></span><span>{market.district}</span><span>{market.province}</span><span>{market.department}</span><StatusPill status={market.status} /></div>)}</div></div></section>}
      {tab === 'usuarios' && <section className="panel"><div className="panel-header"><div><h2>Usuarios</h2><p>Importa un CSV o crea accesos, roles y mercados.</p></div><div className="panel-actions"><CsvImportButton label="Importar usuarios" onImport={importUsers} testId="button-import-users" /><CsvExampleButton onDownload={downloadUsersExample} testId="button-example-users" /><Btn onClick={() => setModal('user')} testId="button-new-user"><Plus /> Nuevo usuario</Btn></div></div><div className="panel-body"><div className="import-hint">Columnas: DNI, Nombre, Rol, Mercado y Estado. En promotores, el mercado es obligatorio.</div><div className="record-list">{users.map(user => <article className="record" key={user.id}><span className="record-icon"><UserRound /></span><div className="record-main"><strong>{user.name}</strong><small>DNI {user.dni} · {user.role}</small>{user.marketId && <em><MapPin /> {marketMap[user.marketId]?.name || 'Mercado asignado'}</em>}</div><StatusPill status={user.status} /></article>)}</div></div></section>}
     {tab === 'clientes' && <section className="panel"><div className="panel-header"><div><h2>Clientes</h2><p>Importa un CSV o registra clientes activos por mercado.</p></div><div className="panel-actions"><CsvImportButton label="Importar clientes" onImport={importClients} testId="button-import-clients" /><CsvExampleButton onDownload={downloadClientsExample} testId="button-example-clients" /><Btn onClick={() => setModal('client')} testId="button-new-client"><Plus /> Nuevo cliente</Btn></div></div><div className="panel-body"><div className="import-hint">Columnas: Código, Cliente, Celular, Mercado y Estado.</div><div className="search-row"><div className="search-wrap"><Search /><Input value={query} onChange={setQuery} placeholder="Buscar cliente, código o mercado" testId="input-search-clients" /></div></div><div className="record-list">{filteredClients.length ? filteredClients.map(client => <article className="record" key={client.id}><span className="record-icon"><Store /></span><div className="record-main"><strong>{client.name}</strong><small>{client.code}{client.phone ? ` · ${client.phone}` : ''}</small><em><MapPin /> {marketMap[client.marketId]?.name}</em></div><StatusPill status={client.status} /></article>) : <Empty title="No hay coincidencias" detail="Prueba con otro nombre, código o mercado." />}</div></div></section>}
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
function PromoterApp({ user, markets, clients, sales, setSales, attendance, setAttendance, inventory, setInventory, movements, setMovements, notify }: { user: AppUser; markets: Market[]; clients: Client[]; sales: Sale[]; setSales: (value: Sale[]) => void; attendance: Attendance[]; setAttendance: (value: Attendance[]) => void; inventory: MarketInventory[]; setInventory: (value: MarketInventory[]) => void; movements: InventoryMovement[]; setMovements: (value: InventoryMovement[]) => void; notify: (message: string, error?: boolean) => void }) {
    const selectableMarkets = markets.filter(market => market.status === 'ACTIVO'); const [selectedMarketId, setSelectedMarketId] = useState(''); const [selectedClientId, setSelectedClientId] = useState(''); const [module, setModule] = useState<'MARCACIONES' | 'VENTAS'>('MARCACIONES'); const [view, setView] = useState<'LISTA' | 'NUEVA'>('LISTA');
    const available = clients.filter(client => client.marketId === selectedMarketId && client.status === 'ACTIVO'); const selectedMarket = selectableMarkets.find(market => market.id === selectedMarketId);
    const [clientId, setClientId] = useState(''); const [mode, setMode] = useState<'UNIDADES' | 'PLANCHAS'>('UNIDADES'); const [sku, setSku] = useState(products[0].sku); const [unitQty, setUnitQty] = useState(1); const [amountSoles, setAmountSoles] = useState(''); const [planchas, setPlanchas] = useState(1); const [mix, setMix] = useState({ TODINNO: 1, COSTA: 1, PASQUALINO: 4 }); const [receipt, setReceipt] = useState<File | null>(null); const [exchange, setExchange] = useState<File | null>(null);
     const [markClientId, setMarkClientId] = useState(''); const [markType, setMarkType] = useState<'ENTRADA' | 'SALIDA'>('ENTRADA'); const [markPhoto, setMarkPhoto] = useState<File | null>(null); const [tastingPrompt, setTastingPrompt] = useState(false); const [search, setSearch] = useState(''); const [modeFilter, setModeFilter] = useState<'TODO' | 'UNIDADES' | 'PLANCHAS'>('TODO');
     useEffect(() => { setClientId(selectedClientId); setMarkClientId(selectedClientId); }, [selectedClientId]);
     const marketStock = inventory.find(item => item.marketId === selectedMarketId) || emptyInventory(selectedMarketId); const redemptionTotal = redemptionItems.reduce((sum, item) => sum + marketStock.redemptionStock[item.id], 0); const totalMix = mix.TODINNO + mix.COSTA + mix.PASQUALINO; const total = mode === 'UNIDADES' ? unitQty : totalMix; const saleAmount = parseSoles(amountSoles); const bonus = bonusFor(mode, total, planchas); const requiredRedemptions = parseBonusItems(bonus); const missingRedemption = requiredRedemptionEntries(requiredRedemptions).find(([itemId, quantity]) => marketStock.redemptionStock[itemId] < quantity); const validMix = mode === 'UNIDADES' || (totalMix === planchas * 6 && Object.values(mix).every(value => value >= 1)); const canConfirm = Boolean(clientId && receipt && Number.isFinite(saleAmount) && saleAmount > 0 && validMix && (!bonus || (exchange && !missingRedemption)) && !(mode === 'PLANCHAS' && planchas > 80));
  const mineSales = sales.filter(sale => sale.promoterId === user.id); const mineAttendance = attendance.filter(item => item.promoterId === user.id); const filteredSales = mineSales.filter(sale => (modeFilter === 'TODO' || sale.mode === modeFilter) && `${sale.id} ${clients.find(client => client.id === sale.clientId)?.name || ''} ${sale.bonus || ''}`.toLowerCase().includes(search.toLowerCase())); const filteredAttendance = mineAttendance.filter(item => `${clients.find(client => client.id === item.clientId)?.name || ''} ${item.type}`.toLowerCase().includes(search.toLowerCase()));
  const saveSale = () => {
      if (!canConfirm) { notify(mode === 'PLANCHAS' && planchas > 80 ? 'Requiere autorización previa de Trade' : bonus && missingRedemption ? `Stock insuficiente de ${redemptionLabel(missingRedemption[0])} para este canje` : Number.isFinite(saleAmount) && saleAmount > 0 ? 'Completa venta y evidencias' : 'Ingresa un monto mayor a S/ 0.00', true); return; }
      const id = `VTA-${new Date().getFullYear()}-${String(sales.length + 1).padStart(6, '0')}`; const now = new Date().toISOString(); const sale: Sale = { id, promoterId: user.id, clientId, marketId: selectedMarketId, mode, units: total, amountSoles: saleAmount, planchas: mode === 'PLANCHAS' ? planchas : undefined, mix: mode === 'PLANCHAS' ? mix : { [products.find(product => product.sku === sku)?.brand || 'PRODUCTO']: unitQty }, bonus, receiptPhoto: `BOLETA - ${id}.jpg`, exchangePhoto: bonus ? `${bonus} - CLIENTE - ${id}.jpg` : undefined, date: now, status: syncStatus() };
     const next = [sale, ...sales]; setSales(next); writeStore('bt-sales', next);
      if (bonus) {
        const nextInventory = inventory.map(item => item.marketId === selectedMarketId ? { ...item, redemptionStock: requiredRedemptionEntries(requiredRedemptions).reduce((nextStock, [itemId, quantity]) => ({ ...nextStock, [itemId]: nextStock[itemId] - quantity }), { ...item.redemptionStock }), updatedAt: now } : item);
       const currentMovements = readStore<InventoryMovement[]>('bt-inventory-movements', []);
         const canjeMovements = requiredRedemptionEntries(requiredRedemptions).map(([itemId, quantity]) => ({ id: `CAN-${id}-${itemId}`, marketId: selectedMarketId, kind: 'CANJE' as const, itemId, quantity, actorId: user.id, actorName: user.name, date: now, status: syncStatus() }));
        const nextMovements = [...canjeMovements, ...currentMovements];
       setInventory(nextInventory); setMovements(nextMovements); writeStore('bt-inventory', nextInventory); writeStore('bt-inventory-movements', nextMovements);
     }
     setAmountSoles(''); setReceipt(null); setExchange(null); setView('LISTA'); notify(bonus ? 'Venta y canje registrados. Stock actualizado.' : 'Venta sin canje registrada');
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
     setTastingPrompt(false); setMarkPhoto(null); setMarkType(type === 'ENTRADA' ? 'SALIDA' : 'ENTRADA'); setView('LISTA'); notify(type === 'SALIDA' ? 'Salida y degustación registradas. Stock actualizado.' : 'Entrada registrada correctamente');
   };
   const saveAttendance = () => {
     if (!markClientId || !markPhoto) { notify('Selecciona la tienda y toma la fotografía', true); return; }
     const now = new Date(); const day = now.toISOString().slice(0, 10); const latest = mineAttendance.filter(item => item.clientId === markClientId && item.date.slice(0, 10) === day)[0];
     if (markType === 'SALIDA' && (!latest || latest.type !== 'ENTRADA')) { notify('Primero debes registrar la entrada en esta tienda', true); return; }
     if (markType === 'ENTRADA' && latest?.type === 'ENTRADA') { notify('Ya tienes una entrada abierta en esta tienda', true); return; }
     if (markType === 'SALIDA') { setTastingPrompt(true); return; }
     finalizeAttendance();
   };
   if (!selectedMarket || !selectedClientId) return <main className="promoter-page"><div className="promoter-setup"><span className="eyebrow">INICIO DE JORNADA</span><h1>Selecciona tu visita</h1><p>Primero elige el mercado donde trabajarás y luego el cliente que visitarás.</p>{selectableMarkets.length ? <><SelectField label="Mercado *" value={selectedMarketId} onChange={value => { setSelectedMarketId(value); setSelectedClientId(''); }} items={selectableMarkets.map(item => ({ value: item.id, label: `${item.name} · ${item.district}` }))} /><SelectField label="Cliente a visitar *" value={selectedClientId} onChange={setSelectedClientId} items={available.map(client => ({ value: client.id, label: `${client.code} · ${client.name}` }))} placeholder={selectedMarketId ? (available.length ? 'Seleccionar cliente' : 'No hay clientes en este mercado') : 'Primero selecciona un mercado'} /><p className="setup-hint"><CheckCircle2 /> Al elegir el cliente se habilitarán tus módulos de trabajo.</p></> : <div className="no-market"><MapPin /><h2>No hay mercados activos</h2><p>Solicita al analista que cargue un mercado antes de iniciar la jornada.</p></div>}</div></main>;
  return <main className="promoter-page"><div className="promoter-layout"><PromoterNav active={module} onChange={value => { setModule(value); setView('LISTA'); setSearch(''); }} /><div className="promoter-content">
     <div className="promoter-head"><div><span className="crumb">INICIO / PROCESAMIENTO DE PEDIDOS / {module === 'VENTAS' ? 'VENTAS' : 'TURNOS Y ASISTENCIAS'}</span><h1>{module === 'VENTAS' ? (view === 'LISTA' ? <>Mis ventas <small>{mineSales.length} registros</small></> : 'Añadir venta') : (view === 'LISTA' ? 'Registros de marcación' : 'Añadir registro de marcación')}</h1><p>{selectedMarket.name} · {user.name}</p></div>{view === 'LISTA' && <Btn onClick={() => setView('NUEVA')} testId={`button-new-${module.toLowerCase()}`}><Plus /> Nueva {module === 'VENTAS' ? 'venta' : 'marcación'}</Btn>}</div>
      <div className="market-banner"><span className="market-pin"><MapPin /></span><div><small>MERCADO SELECCIONADO</small><strong>{selectedMarket.name}</strong><p>{selectedMarket.district} · {selectedMarket.province} · {selectedMarket.department}</p></div><div className="market-stock-mini"><span>Premios <strong>{redemptionTotal}</strong></span><span>Degustación <strong>{marketStock.tastingStock}</strong></span></div><StatusPill status="ACTIVO" /></div>
     {module === 'VENTAS' && view === 'LISTA' && <div className="filters"><section className="dark-panel"><div className="dark-search"><Search /><Input value={search} onChange={setSearch} placeholder="Escribe para buscar" testId="input-search-sales" /></div>{filteredSales.length ? <div className="sale-table"><div className="sale-row header"><span>Ticket</span><span>Compra</span><span>Totales</span><span>Tienda</span><span>Promotor</span><span>Fecha y hora</span></div>{filteredSales.map(sale => <div className="sale-row" key={sale.id}><span><em className="ticket">{sale.id}</em></span><span className="product-cell"><PackageCheck /><span><strong>{sale.mode === 'PLANCHAS' ? `${sale.planchas} plancha(s) · Mix de marcas` : `${sale.units} unidad(es)`}</strong><small>{sale.bonus || 'Venta sin canje'}</small></span></span><span><strong>{sale.units} und.</strong><small>{sale.mode}</small></span><span className="store-cell"><Store /><span><strong>{clients.find(client => client.id === sale.clientId)?.name}</strong><small>{selectedMarket.name}</small></span></span><span><strong>{user.name}</strong><small>Promotor</small></span><span><strong>{formatDate(sale.date)}</strong><small>{sale.status}</small></span></div>)}</div> : <div className="dark-empty"><ShoppingBag /><h3>Aún no hay ventas</h3><p>Registra tu primera venta en este mercado.</p><Btn onClick={() => setView('NUEVA')}><Plus /> Nueva venta</Btn></div>}</section><aside className="filter-bar"><h3>Filtros</h3><label>Tipo de venta</label><div className="filter-switch">{(['TODO', 'UNIDADES', 'PLANCHAS'] as const).map(value => <button className={modeFilter === value ? 'active' : ''} key={value} onClick={() => setModeFilter(value)} data-testid={`filter-${value.toLowerCase()}`}>{value === 'TODO' ? 'Todo' : value.charAt(0) + value.slice(1).toLowerCase()}</button>)}</div><label>Buscar tienda o ticket</label><Input value={search} onChange={setSearch} placeholder="Escribe para buscar" /></aside></div>}
    {module === 'MARCACIONES' && view === 'LISTA' && <section className="dark-panel"><div className="dark-search"><Search /><Input value={search} onChange={setSearch} placeholder="Escribe para buscar" testId="input-search-attendance" /></div>{filteredAttendance.length ? <div className="mark-table"><div className="mark-row header"><span>Tienda</span><span>Promotor</span><span>Evento</span><span>Fecha y hora</span><span>Evidencia</span></div>{filteredAttendance.map(item => <div className="mark-row" key={item.id}><span className="store-cell"><Store /><span><strong>{clients.find(client => client.id === item.clientId)?.name || 'Tienda'}</strong><small>{clients.find(client => client.id === item.clientId)?.code}</small></span></span><span><strong>{user.name}</strong><small>Promotor</small></span><span><StatusPill status={item.type === 'ENTRADA' ? 'ACTIVO' : 'PENDIENTE'} /></span><span><strong>{formatDate(item.date)}</strong><small>{item.status}</small></span><span className="evidence-cell"><Camera /><small>Foto</small></span></div>)}</div> : <div className="dark-empty"><Clock3 /><h3>Aún no hay marcaciones</h3><p>Registra tu primera entrada en una tienda.</p><Btn onClick={() => setView('NUEVA')}><Plus /> Nueva marcación</Btn></div>}</section>}
    {view === 'NUEVA' && module === 'MARCACIONES' && <section className="dark-form"><div className="form-section-title">Información</div><div className="dark-form-body"><SelectField label="Tienda *" value={markClientId} onChange={setMarkClientId} items={available.map(client => ({ value: client.id, label: `${client.code} · ${client.name}` }))} /><SelectField label="Evento *" value={markType} onChange={value => setMarkType(value as 'ENTRADA' | 'SALIDA')} items={[{ value: 'ENTRADA', label: 'Entrada' }, { value: 'SALIDA', label: 'Salida' }]} /><PhotoField label="Foto *" hint="Foto del promotor realizando la marcación" file={markPhoto} setFile={setMarkPhoto} /></div><div className="dark-actions"><Btn variant="outline" onClick={() => setView('LISTA')}>Cancelar</Btn><Btn disabled={!markClientId || !markPhoto} onClick={saveAttendance} testId="button-save-attendance"><CheckCircle2 /> Guardar marcación</Btn></div></section>}
     {view === 'NUEVA' && module === 'VENTAS' && <section className="sale-layout"><section className="sale-form"><span className="eyebrow">INFORMACIÓN</span><h2>Registrar venta</h2><p>Completa la compra para evaluar el canje.</p><SelectField label="Cliente *" value={clientId} onChange={setClientId} items={available.map(client => ({ value: client.id, label: `${client.code} · ${client.name}` }))} /><Field label="Tipo de ingreso"><div className="mode-switch"><button className={mode === 'UNIDADES' ? 'selected' : ''} onClick={() => setMode('UNIDADES')} data-testid="button-mode-unidades"><ShoppingBag /> Unidades</button><button className={mode === 'PLANCHAS' ? 'selected' : ''} onClick={() => setMode('PLANCHAS')} data-testid="button-mode-planchas"><PackageCheck /> Planchas</button></div></Field><Field label="Ingreso en soles (S/) *"><div className="currency-input"><span aria-hidden="true">S/</span><Input type="number" value={amountSoles} onChange={setAmountSoles} min={0.01} step={0.01} placeholder="0.00" testId="input-sale-amount" /></div></Field>{mode === 'UNIDADES' ? <div className="form-grid"><SelectField label="Panetón / marca" value={sku} onChange={setSku} items={products.map(product => ({ value: product.sku, label: `${product.brand} · ${product.name}` }))} /><Field label="Unidades (máximo 2)"><Input type="number" value={unitQty} onChange={value => setUnitQty(Math.max(1, Math.min(2, Number(value) || 1)))} min={1} max={2} testId="input-sale-units" /></Field></div> : <div className="plancha-box"><Field label="Cantidad de planchas"><Input type="number" value={planchas} onChange={value => setPlanchas(Math.max(1, Number(value) || 1))} min={1} testId="input-sale-planchas" /></Field><p className="formula">Total requerido: <strong>{planchas * 6} unidades</strong> · mínimo 1 por marca</p><div className="brand-mix">{Object.entries(mix).map(([brand, quantity]) => <Field label={brand} key={brand}><Input type="number" value={quantity} onChange={value => setMix({ ...mix, [brand]: Math.max(0, Number(value) || 0) })} min={0} /></Field>)}</div><div className={`mix-status ${validMix ? 'valid' : 'invalid'}`}>{validMix ? <><CheckCircle2 /> Mix válido: {totalMix} unidades</> : <>Debes sumar {planchas * 6} unidades e incluir las 3 marcas.</>}</div></div>}<div className={`bonus-box ${bonus ? 'active' : ''}`}><Gift /><div><small>{bonus ? 'CANJE ACTIVADO' : 'SIN CANJE'}</small><strong>{bonus || 'La compra aún no activa una bonificación'}</strong>{bonus && <small>{requiredRedemptionEntries(requiredRedemptions).map(([itemId, quantity]) => `${quantity} ${redemptionLabel(itemId)}`).join(' · ')} · ${redemptionTotal} disponibles</small>}</div></div>{bonus && missingRedemption && <div className="stock-warning"><PackageCheck /> No hay stock suficiente de {redemptionLabel(missingRedemption[0])} para este canje.</div>}{mode === 'PLANCHAS' && planchas > 80 && <div className="trade-warning"><ShieldCheck /> Requiere autorización previa de Trade.</div>}<div className="evidence-grid"><PhotoField label="Foto de boleta *" hint="Obligatoria para toda venta" file={receipt} setFile={setReceipt} /><PhotoField label="Cliente con canje" hint={bonus ? 'Obligatoria para este canje' : 'No requerida sin canje'} file={exchange} setFile={setExchange} disabled={!bonus} /></div><div className="form-actions"><Btn variant="outline" onClick={() => setView('LISTA')}>Cancelar</Btn><Btn disabled={!canConfirm} onClick={saveSale} testId="button-save-sale"><CheckCircle2 /> Guardar venta</Btn></div></section><aside className="recent"><h3>Resumen del registro</h3><p>Validación de compra y canje.</p><div className="check-list"><p className="check"><Check /> Cliente seleccionado</p><p className="check"><Check /> {total} unidades registradas</p><p className="check"><Check /> Ingreso: {formatSoles(Number.isFinite(saleAmount) ? saleAmount : 0)}</p><p className="check"><Gift /> {bonus || 'Sin canje'}</p></div></aside></section>}
   </div></div>{tastingPrompt && <TastingLogoutModal available={marketStock.tastingStock} onConfirm={finalizeAttendance} close={() => setTastingPrompt(false)} />}</main>;
}

export default function App() {
   const [user, setUser] = useState<AppUser | null>(() => readStore<AppUser | null>('bt-session', null)); const [markets, setMarkets] = useState<Market[]>(() => readStore('bt-markets', seedMarkets)); const [users, setUsers] = useState<AppUser[]>(() => { const storedMarkets = readStore<Market[]>('bt-markets', seedMarkets); return ensureDemoPromoters(readStore('bt-users', seedUsers), storedMarkets); }); const [clients, setClients] = useState<Client[]>(() => { const storedMarkets = readStore<Market[]>('bt-markets', seedMarkets); return ensureDemoClients(readStore('bt-clients', seedClients), storedMarkets); }); const [sales, setSales] = useState<Sale[]>(() => readStore('bt-sales', [])); const [attendance, setAttendance] = useState<Attendance[]>(() => readStore('bt-attendance', [])); const [inventory, setInventory] = useState<MarketInventory[]>(() => initializeCampaignInventory(readStore<Market[]>('bt-markets', seedMarkets), readStore<MarketInventory[]>('bt-inventory', []))); const [movements, setMovements] = useState<InventoryMovement[]>(() => readStore('bt-inventory-movements', [])); const [toast, setToast] = useState<Toast | null>(null);
  const notify = (message: string, error = false) => setToast({ message, error });
  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => undefined);
  }, []);
  useEffect(() => { writeStore('bt-markets', markets); }, [markets]); useEffect(() => { writeStore('bt-users', users); }, [users]); useEffect(() => { writeStore('bt-clients', clients); }, [clients]); useEffect(() => { const next = ensureInventory(markets, inventory); if (next.length !== inventory.length) { setInventory(next); writeStore('bt-inventory', next); } }, [markets, inventory]); useEffect(() => { writeStore('bt-inventory', inventory); }, [inventory]); useEffect(() => { writeStore('bt-inventory-movements', movements); }, [movements]);
  const activeUser = useMemo(() => user ? users.find(item => item.dni === user.dni) || user : null, [user, users]);
  const logout = () => { localStorage.removeItem('bt-session'); setUser(null); };
  return <>{activeUser ? <Shell user={activeUser} logout={logout}>{activeUser.role === 'PROMOTOR' ? <PromoterApp user={activeUser} markets={markets} clients={clients} sales={sales} setSales={setSales} attendance={attendance} setAttendance={setAttendance} inventory={inventory} setInventory={setInventory} movements={movements} setMovements={setMovements} notify={notify} /> : <AnalystApp user={activeUser} markets={markets} setMarkets={setMarkets} users={users} setUsers={setUsers} clients={clients} setClients={setClients} sales={sales} attendance={attendance} inventory={inventory} movements={movements} setInventory={setInventory} setMovements={setMovements} notify={notify} />}</Shell> : <Login users={users} onLogin={setUser} notify={notify} />}<ToastView toast={toast} clear={() => setToast(null)} /></>;
}