import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Camera, Check, CheckCircle2, Clock3, Download, FileSpreadsheet, Gift, LogOut, MapPin, PackageCheck, Pencil, Plus, RefreshCw, Search, ShieldCheck, ShoppingBag, Smartphone, Store, Trash2, Upload, UserRound, Users, Wifi, WifiOff, X } from 'lucide-react';

type Role = 'ANALISTA' | 'PROMOTOR' | 'PROMOTOR ROTATIVO' | 'PROMOTOR PERMANENTE' | 'COORDINADOR' | 'SUPERVISOR' | 'TRADE' | 'ADMIN' | 'CLIENTE';
const promoterRoles: Role[] = ['PROMOTOR', 'PROMOTOR ROTATIVO', 'PROMOTOR PERMANENTE'];
const selectablePromoterRoles: Role[] = ['PROMOTOR ROTATIVO', 'PROMOTOR PERMANENTE'];
function isPromoterRole(role?: Role) {
  return Boolean(role && promoterRoles.includes(role));
}
function isZoneManagerRole(role?: Role) {
  return isPromoterRole(role) || role === 'COORDINADOR';
}
type Status = 'ACTIVO' | 'INACTIVO';
type SyncStatus = 'SINCRONIZADA' | 'PENDIENTE';
type Market = { id: string; department: string; region?: string; province: string; district: string; name: string; status: Status };
type AppUser = { id: string; dni: string; name: string; role: Role; roleLabel?: string; marketId?: string; clientId?: string; password?: string; status: Status; tastingStock?: number; redemptionStock?: RedemptionStock; sheetArchived?: boolean };
type PromoterAssignment = { promoterId: string; promoterDni?: string; marketIds: string[]; clientIds: string[]; updatedAt: string };
type AssignmentRelationship = { key: string; promoter: AppUser; marketId: string; client: Client | null };
type ClientCategory = 'MIXTO' | 'CONFETI';
type Client = { id: string; code: string; name: string; phone?: string; category?: ClientCategory; marketId: string; status: Status };
type ProductPrice = { sku: string; product: string; unitsPerPackage: number; unitPrice: number; totalPrice: number; updatedAt: string };
type Sale = { id: string; promoterId: string; promoterRole?: Role; promoterRoleLabel?: string; clientId: string; marketId: string; marketRegion?: string; marketDepartment?: string; marketProvince?: string; marketDistrict?: string; mode: 'UNIDADES' | 'PLANCHAS'; units: number; amountSoles: number; weightKg?: number; unitPrices?: Record<string, number>; planchas?: number; mix: Record<string, number>; bonus?: string; redemptionCount?: number; redemptionItems?: Partial<RedemptionStock>; comment?: string; receiptPhoto: string; exchangePhoto?: string; date: string; updatedAt?: string; status: SyncStatus };
type Attendance = { id: string; promoterId: string; promoterRole?: Role; promoterRoleLabel?: string; clientId: string; marketId: string; type: 'ENTRADA' | 'SALIDA'; photo: string; date: string; status: SyncStatus };
type SessionClosure = { id: string; promoterId: string; promoterRole?: Role; promoterRoleLabel?: string; marketId: string; clientId?: string; tastingUsed: number; leads: number; date: string; status: SyncStatus };
type RedemptionItemId = 'AVENA' | 'BATEA' | 'MANDIL' | 'SPAGHETTI';
type CanjeProductId = 'CANJE_AVENA_2' | 'CANJE_AVENA_1' | 'CANJE_AVENA_3_SPAGHETTI_1' | 'CANJE_AVENA_12_SPAGHETTI_3' | 'CANJE_AVENA_24_SPAGHETTI_10' | 'CANJE_AVENA_24_SPAGHETTI_10_MANDIL_1' | 'CANJE_AVENA_144_SPAGHETTI_100_MANDIL_4' | 'CANJE_AVENA_24_SPAGHETTI_10_BATEA_1' | 'CANJE_AVENA_144_SPAGHETTI_100_BATEA_4' | 'CANJE_AVENA_30_SPAGHETTI_10' | 'CANJE_AVENA_144_SPAGHETTI_100';
type DegustacionProductId = 'PANETON';
type RedemptionStock = Record<RedemptionItemId, number>;
type MarketInventory = { marketId: string; tastingStock: number; redemptionStock: RedemptionStock; updatedAt: string; exchangeStock?: number };
type InventoryMovementKind = 'CANJE' | 'DEGUSTACION' | 'AJUSTE_DEGUSTACION' | 'AJUSTE_CANJES';
type InventoryMovement = { id: string; marketId: string; kind: InventoryMovementKind; itemId?: RedemptionItemId; canjeProductId?: CanjeProductId; canjeProductLabel?: string; canjeComponents?: Partial<RedemptionStock>; degustacionProductId?: DegustacionProductId; degustacionProductLabel?: string; quantity: number; actorId: string; actorName: string; promoterId?: string; date: string; status: SyncStatus };
type AdminCanje = InventoryMovement & { source: 'movement' | 'sale'; canjeId: string; sale?: Sale };
type AdminDegustacion = InventoryMovement & { source: 'movement'; degustacionId: string };
type Toast = { message: string; error?: boolean };
type CloudSnapshot = {
  markets: Market[];
  users: AppUser[];
  clients: Client[];
  sales: Sale[];
  attendance: Attendance[];
  inventory: MarketInventory[];
  movements: InventoryMovement[];
  assignments: PromoterAssignment[];
  closures: SessionClosure[];
  productPrices: ProductPrice[];
};

const MARKETS_SHEET_ID = '1GCbfnfCgZdXBaPzVsnrhjos_K0h5j0WXxKOanAIjUtM';
const MARKETS_SHEET = `https://docs.google.com/spreadsheets/d/${MARKETS_SHEET_ID}/export?format=csv&gid=0`;
const CLIENTS_SHEET_ID = '1K5KSSrBPiTtldeOjZ--w--3v9ID1oUq_z_PFkqMYtZA';
const USERS_SHEET_ID = '1xKb-WZaJYFoBxeanLDVBxu6SJlv7Kz2sKIYwS8veEyo';
const PRICES_SHEET_ID = '1Jbs7xShDVBH5_bA4yLNJEIZkaCvSl44WEOYRpNh53N8';
const GOOGLE_SHEETS_PROXY = '/api/google-sheets';
const APP_STORAGE_READ = '/api/app-storage';
const APP_STORAGE_SYNC = '/api/app-storage/sync';
const APP_STORAGE_ASSIGNMENTS = '/api/app-storage/assignments';
const APP_STORAGE_LOGIN = '/api/app-storage/login';
const APP_STORAGE_ADMIN = '/api/app-storage/admin';
const GOOGLE_DRIVE_PHOTO_UPLOAD = '/api/evidence-photos';
const PRODUCT_PRICES_STORE_KEY = 'bt-product-prices';
const DEFAULT_CAMPAIGN_TASTING_STOCK = 0;
const DEFAULT_CAMPAIGN_REDEMPTION_STOCK = 0;
const DEFAULT_STOCK_SEED_KEY = 'bt-inventory-defaults-v1';
const redemptionItems: { id: RedemptionItemId; label: string }[] = [
  { id: 'AVENA', label: 'Avena' },
  { id: 'BATEA', label: 'Batea' },
  { id: 'MANDIL', label: 'Mandil' },
  { id: 'SPAGHETTI', label: 'Spaghetti' },
];
const canjeProducts: { id: CanjeProductId; label: string; components: Partial<RedemptionStock> }[] = [
  { id: 'CANJE_AVENA_2', label: '2 UN AVENA CLÁSICA', components: { AVENA: 2 } },
  { id: 'CANJE_AVENA_1', label: '1 UN AVENA CLÁSICA', components: { AVENA: 1 } },
  { id: 'CANJE_AVENA_3_SPAGHETTI_1', label: '3 UN AVENA CLASICA + 1 UN SPAGUETTI', components: { AVENA: 3, SPAGHETTI: 1 } },
  { id: 'CANJE_AVENA_12_SPAGHETTI_3', label: '12 UN AVENA CLÁSICA + 3 UN SPAGUETTI', components: { AVENA: 12, SPAGHETTI: 3 } },
  { id: 'CANJE_AVENA_24_SPAGHETTI_10', label: '24 UN AVENA CLÁSICA + 10 UN SPAGUETTI', components: { AVENA: 24, SPAGHETTI: 10 } },
  { id: 'CANJE_AVENA_24_SPAGHETTI_10_MANDIL_1', label: '24 UN AVENA CLÁSICA + 10 UN SPAGUETTI + 1 UN MANDIL', components: { AVENA: 24, SPAGHETTI: 10, MANDIL: 1 } },
  { id: 'CANJE_AVENA_144_SPAGHETTI_100_MANDIL_4', label: '144 UN AVENA CLÁSICA + 100 UN SPAGUETTI + 4 MANDILES', components: { AVENA: 144, SPAGHETTI: 100, MANDIL: 4 } },
  { id: 'CANJE_AVENA_24_SPAGHETTI_10_BATEA_1', label: '24 UN AVENA CLÁSICA + 10 UN SPAGUETTI + 1 UN BATEAS', components: { AVENA: 24, SPAGHETTI: 10, BATEA: 1 } },
  { id: 'CANJE_AVENA_144_SPAGHETTI_100_BATEA_4', label: '144 UN AVENA CLÁSICA + 100 UN SPAGUETTI + 4 BATEAS', components: { AVENA: 144, SPAGHETTI: 100, BATEA: 4 } },
  { id: 'CANJE_AVENA_30_SPAGHETTI_10', label: '30 UN AVENA CLÁSICA + 10 UN SPAGUETTI', components: { AVENA: 30, SPAGHETTI: 10 } },
  { id: 'CANJE_AVENA_144_SPAGHETTI_100', label: '144 UN AVENA CLÁSICA + 100 UN SPAGUETTI', components: { AVENA: 144, SPAGHETTI: 100 } },
];
const commonCanjeProductIds: CanjeProductId[] = ['CANJE_AVENA_2', 'CANJE_AVENA_1', 'CANJE_AVENA_3_SPAGHETTI_1', 'CANJE_AVENA_12_SPAGHETTI_3'];
const mandilCanjeProductIds: CanjeProductId[] = [...commonCanjeProductIds, 'CANJE_AVENA_24_SPAGHETTI_10_MANDIL_1', 'CANJE_AVENA_144_SPAGHETTI_100_MANDIL_4'];
const bateaCanjeProductIds: CanjeProductId[] = [...commonCanjeProductIds, 'CANJE_AVENA_24_SPAGHETTI_10_BATEA_1', 'CANJE_AVENA_144_SPAGHETTI_100_BATEA_4'];
const noAccessoryCanjeProductIds: CanjeProductId[] = [...commonCanjeProductIds, 'CANJE_AVENA_30_SPAGHETTI_10', 'CANJE_AVENA_144_SPAGHETTI_100'];
function activeCanjeProducts(date = new Date(), stock?: RedemptionStock) {
  const month = date.getMonth() + 1;
  const accessoriesExhausted = Boolean(stock && stock.MANDIL <= 0 && stock.BATEA <= 0);
  let ids: CanjeProductId[] = [];
  if (month === 9 || month === 10) ids = accessoriesExhausted ? noAccessoryCanjeProductIds : mandilCanjeProductIds;
  else if (month === 11) ids = accessoriesExhausted ? noAccessoryCanjeProductIds : bateaCanjeProductIds;
  else if (month === 12) ids = noAccessoryCanjeProductIds;
  return ids.map(id => canjeProducts.find(product => product.id === id)).filter(Boolean) as typeof canjeProducts;
}
const degustacionProducts: { id: DegustacionProductId; label: string }[] = [
  { id: 'PANETON', label: 'Panetón' },
];
function emptyRedemptionStock(): RedemptionStock {
  return { AVENA: DEFAULT_CAMPAIGN_REDEMPTION_STOCK, BATEA: DEFAULT_CAMPAIGN_REDEMPTION_STOCK, MANDIL: DEFAULT_CAMPAIGN_REDEMPTION_STOCK, SPAGHETTI: DEFAULT_CAMPAIGN_REDEMPTION_STOCK };
}
function userRedemptionStock(user: AppUser): RedemptionStock {
  const source = user.redemptionStock || emptyRedemptionStock();
  return redemptionItems.reduce((result, item) => ({ ...result, [item.id]: Math.max(0, Math.floor(Number(source[item.id]) || 0)) }), {} as RedemptionStock);
}
function userTastingStock(user: AppUser) {
  return Math.max(0, Math.floor(Number(user.tastingStock) || 0));
}
function withUserStock(user: AppUser, tastingStock: number, redemptionStock: RedemptionStock): AppUser {
  return { ...user, tastingStock: Math.max(0, Math.floor(Number(tastingStock) || 0)), redemptionStock: userRedemptionStock({ ...user, redemptionStock }) };
}
function emptyInventory(marketId: string): MarketInventory {
  return { marketId, tastingStock: DEFAULT_CAMPAIGN_TASTING_STOCK, redemptionStock: emptyRedemptionStock(), updatedAt: new Date().toISOString() };
}
function normalizeInventory(stored: MarketInventory[]) {
  const byMarket = new Map(stored.map(item => [item.marketId, item]));
  return Array.from(byMarket.values()).map(existing => {
    const legacyStock = Math.max(0, Math.floor(Number(existing.exchangeStock) || 0));
    const source = existing.redemptionStock || emptyRedemptionStock();
    const redemptionStock = redemptionItems.reduce((result, item) => ({ ...result, [item.id]: Math.max(0, Math.floor(Number(source[item.id]) || 0)) }), {} as RedemptionStock);
    return { ...existing, tastingStock: Math.max(0, Math.floor(Number(existing.tastingStock) || 0)), redemptionStock, exchangeStock: legacyStock, updatedAt: existing.updatedAt || new Date().toISOString() };
  });
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
function assignmentMatchesUser(assignment: PromoterAssignment, user: AppUser) {
  return assignment.promoterId === user.id || Boolean(assignment.promoterDni && assignment.promoterDni === user.dni);
}
function mergeAssignments(current: PromoterAssignment[], incoming: PromoterAssignment[]) {
  const next = new Map(current.map(item => [item.promoterDni || item.promoterId, item]));
  incoming.forEach(item => {
    const key = item.promoterDni || item.promoterId;
    const previous = next.get(key);
    if (!previous || !previous.updatedAt || !item.updatedAt || item.updatedAt >= previous.updatedAt) next.set(key, item);
  });
  return Array.from(next.values());
}
function saleFreshness(sale: Sale) {
  return sale.updatedAt || sale.date || '';
}
function mergeSales(local: Sale[], incoming: Sale[]) {
  const next = new Map(incoming.map(sale => [sale.id, sale]));
  local.forEach(localSale => {
    const cloudSale = next.get(localSale.id);
    if (!cloudSale) {
      // Solo se conserva lo que todavía no fue confirmado por el servidor.
      // Una venta sincronizada ausente del snapshot debe reflejar una eliminación real.
      if (localSale.status === 'PENDIENTE') next.set(localSale.id, localSale);
      return;
    }
    if (saleFreshness(localSale) > saleFreshness(cloudSale)) next.set(localSale.id, localSale);
  });
  return Array.from(next.values());
}
function cloudSnapshotFromStores(): CloudSnapshot {
  const users = readStore<AppUser[]>('bt-users', []).map(({ password: _password, ...user }) => user);
  return {
    markets: readStore<Market[]>('bt-markets', []),
    users,
    clients: readStore<Client[]>('bt-clients', []),
    sales: readStore<Sale[]>('bt-sales', []),
    attendance: readStore<Attendance[]>('bt-attendance', []),
    inventory: readStore<MarketInventory[]>('bt-inventory', []),
    movements: readStore<InventoryMovement[]>('bt-inventory-movements', []),
    assignments: readStore<PromoterAssignment[]>('bt-promoter-assignments', []),
    closures: readStore<SessionClosure[]>('bt-session-closures', []),
    productPrices: readStore<ProductPrice[]>(PRODUCT_PRICES_STORE_KEY, []),
  };
}
type PendingPhotoUpload = {
  id: string;
  entityType: 'sale' | 'attendance';
  entityId: string;
  field: 'receiptPhoto' | 'exchangePhoto' | 'photo';
  clientName?: string;
  marketName?: string;
  recordType?: string;
  fileName: string;
  mimeType: string;
  blob: Blob;
};
const PHOTO_QUEUE_DB = 'below-trade-photo-queue';
const PHOTO_QUEUE_STORE = 'uploads';
function openPhotoQueue() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(PHOTO_QUEUE_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(PHOTO_QUEUE_STORE)) request.result.createObjectStore(PHOTO_QUEUE_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
type PhotoUploadContext = Pick<PendingPhotoUpload, 'clientName' | 'marketName' | 'recordType'>;
async function queuePhotoUpload(file: File, entityType: PendingPhotoUpload['entityType'], entityId: string, field: PendingPhotoUpload['field'], context: PhotoUploadContext) {
  const database = await openPhotoQueue();
  const upload: PendingPhotoUpload = { id: `${entityType}:${entityId}:${field}`, entityType, entityId, field, ...context, fileName: file.name || `${field}.jpg`, mimeType: file.type || 'image/jpeg', blob: file };
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(PHOTO_QUEUE_STORE, 'readwrite');
    transaction.objectStore(PHOTO_QUEUE_STORE).put(upload);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}
async function pendingPhotoUploads() {
  const database = await openPhotoQueue();
  const uploads = await new Promise<PendingPhotoUpload[]>((resolve, reject) => {
    const request = database.transaction(PHOTO_QUEUE_STORE, 'readonly').objectStore(PHOTO_QUEUE_STORE).getAll();
    request.onsuccess = () => resolve(request.result as PendingPhotoUpload[]);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return uploads;
}
async function removePhotoUpload(id: string) {
  const database = await openPhotoQueue();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(PHOTO_QUEUE_STORE, 'readwrite');
    transaction.objectStore(PHOTO_QUEUE_STORE).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}
async function uploadPhoto(upload: PendingPhotoUpload) {
  const response = await fetch(GOOGLE_DRIVE_PHOTO_UPLOAD, {
    method: 'POST',
    headers: {
      'Content-Type': upload.mimeType,
      'X-File-Name': encodeURIComponent(upload.fileName),
      'X-Record-Id': upload.entityId,
      'X-Evidence-Type': upload.field,
      'X-Client-Name': encodeURIComponent(upload.clientName || 'CLIENTE NO IDENTIFICADO'),
      'X-Market-Name': encodeURIComponent(upload.marketName || 'MERCADO NO IDENTIFICADO'),
      'X-Record-Type': encodeURIComponent(upload.recordType || (upload.entityType === 'sale' ? 'VENTA' : 'ASISTENCIA')),
    },
    body: upload.blob,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(payload?.message || 'No se pudo cargar la evidencia');
  }
  return response.json() as Promise<{ id: string; url: string }>;
}
const APP_DATA_KEYS = ['bt-session', 'bt-markets', 'bt-users', 'bt-clients', 'bt-sales', 'bt-attendance', 'bt-inventory', 'bt-inventory-movements', 'bt-session-closures', PRODUCT_PRICES_STORE_KEY, DEFAULT_STOCK_SEED_KEY];
const TEST_DATA_CLEARED_KEY = 'bt-test-data-cleared-v1';
const CATALOG_DATA_CLEARED_KEY = 'bt-operational-data-cleared-v2';
const CATALOG_REVISION_STORE_KEY = 'bt-catalog-revision';
const USERS_CLEARED_KEY = 'bt-users-cleared-v1';
function clearTestDataOnce() {
  if (typeof localStorage === 'undefined' || localStorage.getItem(TEST_DATA_CLEARED_KEY)) return;
  APP_DATA_KEYS.forEach(key => localStorage.removeItem(key));
  localStorage.setItem(TEST_DATA_CLEARED_KEY, 'true');
}
function clearCatalogDataOnce() {
  if (typeof localStorage === 'undefined' || localStorage.getItem(CATALOG_DATA_CLEARED_KEY)) return;
  localStorage.removeItem('bt-markets');
  localStorage.removeItem('bt-clients');
  localStorage.removeItem('bt-sales');
  localStorage.removeItem('bt-attendance');
  localStorage.removeItem('bt-inventory');
  localStorage.removeItem('bt-inventory-movements');
  localStorage.removeItem('bt-promoter-assignments');
  localStorage.removeItem('bt-session-closures');
  localStorage.removeItem(DEFAULT_STOCK_SEED_KEY);
  localStorage.setItem(CATALOG_DATA_CLEARED_KEY, 'true');
}
function keepAnalystUsersOnce() {
  if (typeof localStorage === 'undefined' || localStorage.getItem(USERS_CLEARED_KEY)) return;
  const localUsers = readStore<AppUser[]>('bt-users', []);
  writeStore('bt-users', localUsers.filter(user => user.role === 'ANALISTA'));
  localStorage.setItem(USERS_CLEARED_KEY, 'true');
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
function csvHasField(record: Record<string, string>, aliases: string[]) {
  return aliases.map(normalizeCsvHeader).some(alias => Object.prototype.hasOwnProperty.call(record, alias));
}
function csvStatus(value: string): Status {
  return normalizeCsvHeader(value) === 'inactivo' ? 'INACTIVO' : 'ACTIVO';
}
function importedDni(value: string) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 7 ? digits.padStart(8, '0') : digits;
}
function importedRole(value: string): Role | undefined {
  const normalized = normalizeCsvHeader(value);
  if (normalized.includes('promotorpermanente')) return 'PROMOTOR PERMANENTE';
  if (normalized.includes('promotorrotativo')) return 'PROMOTOR ROTATIVO';
  if (normalized === 'promotor' || normalized.includes('promotor')) return 'PROMOTOR';
  if (normalized.includes('coordinador')) return 'COORDINADOR';
  if (normalized.includes('analista')) return 'ANALISTA';
  if (normalized.includes('supervisor')) return 'SUPERVISOR';
  if (normalized.includes('trade')) return 'TRADE';
  if (normalized.includes('admin')) return 'ADMIN';
  if (normalized.includes('cliente')) return 'CLIENTE';
  return undefined;
}
function csvNumber(value: string) {
  const normalized = value.replace(/[^\d,.-]/g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}
function importedPriceFromRecord(record: Record<string, string>): ProductPrice | null {
  const sku = csvField(record, ['sku', 'codigo', 'codigoproducto']);
  const unitPrice = csvNumber(csvField(record, ['preciounitario', 'punitario', 'precio']));
  if (!sku || unitPrice <= 0) return null;
  return {
    sku,
    product: csvField(record, ['producto', 'descripcion', 'nombreproducto']) || sku,
    unitsPerPackage: csvNumber(csvField(record, ['und', 'unidades', 'unidadesporcaja'])),
    unitPrice,
    totalPrice: csvNumber(csvField(record, ['preciototal', 'total'])),
    updatedAt: new Date().toISOString(),
  };
}
function csvMarketId(value: string, markets: Market[]) {
  const normalized = normalizeCsvHeader(value);
  return markets.find(market => [market.id, market.name, market.district].some(candidate => normalizeCsvHeader(candidate) === normalized))?.id;
}
function importedUserFromRecord(record: Record<string, string>, index: number, markets: Market[]): AppUser | null {
  const dni = importedDni(csvField(record, ['dni', 'documento', 'documentoidentidad']));
  const firstName = csvField(record, ['nombre', 'nombrecompleto', 'nombreyapellido', 'nombres', 'usuario']);
  const lastName = csvField(record, ['apellido', 'apellidos']);
  const name = [firstName, lastName].filter(Boolean).join(' ');
  const roleLabel = csvField(record, ['rol', 'cargo', 'perfil', 'tipousuario']).trim().toUpperCase();
  const roleValue = importedRole(roleLabel);
  const marketValue = csvField(record, ['marketid', 'idmercado', 'idmerc', 'mercadoid', 'mercado', 'market', 'nombremercado']);
  const marketId = marketValue ? csvMarketId(marketValue, markets) : undefined;
  if (!/^\d{8}$/.test(dni) || !name || !roleValue || (isZoneManagerRole(roleValue) && marketValue && !marketId)) return null;
  return {
    id: csvField(record, ['id', 'codigo', 'idusuario', 'idpromotor']) || `USR-IMP-${index + 1}`,
    dni, name, role: roleValue, roleLabel: roleLabel || roleValue,
    marketId: isZoneManagerRole(roleValue) ? marketId : undefined,
    clientId: roleValue === 'CLIENTE' ? csvField(record, ['idcliente', 'clienteid', 'codigocliente']) || undefined : undefined,
    password: csvField(record, ['clave', 'password', 'contrasena']) || undefined,
    status: csvStatus(csvField(record, ['estado', 'status'])),
  };
}
function importedMarketsFromRecords(records: Record<string, string>[]) {
  return records.flatMap<Market>((record) => {
    const id = csvField(record, ['idmerc', 'idmercado', 'id', 'codigo']);
    const name = csvField(record, ['nombredelmercado', 'mercado', 'nombre']);
    if (!id || !name) return [];
    const department = (csvField(record, ['departamento']) || 'LIMA').toUpperCase();
    return [{
      id,
      department,
      region: (csvField(record, ['region']) || department).toUpperCase(),
      province: (csvField(record, ['provincia', 'ciudad']) || department).toUpperCase(),
      district: (csvField(record, ['distrito']) || department).toUpperCase(),
      name: name.toUpperCase(),
      status: csvStatus(csvField(record, ['estado', 'status'])),
    }];
  });
}
function importedClientsFromRecords(records: Record<string, string>[], markets: Market[]) {
  return records.flatMap<Client>((record) => {
    const code = csvField(record, ['codigo', 'code', 'codigocliente']);
    const name = csvField(record, ['cliente', 'nombre', 'nombrecliente', 'tienda', 'razonsocial', 'nombrecomercial']);
    const marketId = csvMarketId(csvField(record, ['marketid', 'idmercado', 'idmerc', 'mercado', 'market', 'nombremercado']), markets);
    if (!code || !name || !marketId) return [];
    return {
      id: csvField(record, ['id', 'idcliente']) || code,
      code,
      name,
      phone: csvField(record, ['celular', 'telefono', 'phone', 'movil']) || undefined,
      marketId,
      status: csvStatus(csvField(record, ['estado', 'status'])),
    };
  });
}
function mergeReferenceRows<T>(current: T[], incoming: T[], keyOf: (item: T) => string) {
  const merged = new Map(current.map(item => [keyOf(item), item]));
  incoming.forEach(item => {
    const key = keyOf(item);
    if (!key) return;
    const previous = merged.get(key);
    const defined = Object.fromEntries(Object.entries(item as Record<string, unknown>).filter(([, value]) => value !== undefined));
    merged.set(key, { ...(previous as object), ...defined } as T);
  });
  return Array.from(merged.values());
}
function mergeUsersByDni(current: AppUser[], incoming: AppUser[]) {
  const merged = new Map<string, AppUser>();
  [...current, ...incoming].forEach(user => {
    const key = user.dni.trim();
    if (!key) return;
    const previous = merged.get(key);
    merged.set(key, {
      ...previous,
      ...user,
      password: user.password || previous?.password,
    });
  });
  return Array.from(merged.values());
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
    const region = sale.marketRegion || market?.region || sale.marketDepartment || market?.department || 'SIN REGIÓN';
    const city = sale.marketProvince || market?.province || sale.marketDistrict || market?.district || 'SIN CIUDAD';
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
type MarketStockSummary = {
  marketId: string;
  tastingDelivered: number;
  tastingUsed: number;
  tastingRemaining: number;
  redemptionDelivered: RedemptionStock;
  redemptionUsed: RedemptionStock;
  redemptionRemaining: RedemptionStock;
};
function movementComponentQuantity(movement: InventoryMovement, itemId: RedemptionItemId) {
  const components = movement.canjeComponents || canjeProducts.find(product => product.id === movement.canjeProductId)?.components;
  if (components) return (Number(components[itemId]) || 0) * Math.max(0, Number(movement.quantity) || 0);
  return movement.itemId === itemId ? Math.max(0, Number(movement.quantity) || 0) : 0;
}
function signedMovementComponentQuantity(movement: InventoryMovement, itemId: RedemptionItemId) {
  const components = movement.canjeComponents || canjeProducts.find(product => product.id === movement.canjeProductId)?.components;
  if (components) return (Number(components[itemId]) || 0) * (Number(movement.quantity) || 0);
  return movement.itemId === itemId ? Number(movement.quantity) || 0 : 0;
}
function reconcileInventory(stored: MarketInventory[], movements: InventoryMovement[]) {
  const normalized = normalizeInventory(stored);
  const marketIds = new Set([
    ...normalized.map(item => item.marketId),
    ...movements.filter(movement => !movement.promoterId && ['AJUSTE_DEGUSTACION', 'DEGUSTACION', 'AJUSTE_CANJES', 'CANJE'].includes(movement.kind)).map(movement => movement.marketId),
  ]);
  return Array.from(marketIds).map(marketId => {
    const current = normalized.find(item => item.marketId === marketId) || emptyInventory(marketId);
    const marketMovements = movements.filter(movement => movement.marketId === marketId && !movement.promoterId);
    const tastingMovements = marketMovements.filter(movement => movement.kind === 'AJUSTE_DEGUSTACION' || movement.kind === 'DEGUSTACION');
    const tastingStock = tastingMovements.length
      ? Math.max(0, tastingMovements.reduce((total, movement) => total + (movement.kind === 'AJUSTE_DEGUSTACION' ? Number(movement.quantity) || 0 : -Math.max(0, Number(movement.quantity) || 0)), 0))
      : current.tastingStock;
    const redemptionStock = redemptionItems.reduce((result, item) => {
      const itemMovements = marketMovements.filter(movement => (movement.kind === 'AJUSTE_CANJES' || movement.kind === 'CANJE') && (movement.itemId === item.id || signedMovementComponentQuantity(movement, item.id) !== 0));
      const stock = itemMovements.length
        ? Math.max(0, itemMovements.reduce((total, movement) => total + (movement.kind === 'AJUSTE_CANJES' ? signedMovementComponentQuantity(movement, item.id) : -movementComponentQuantity(movement, item.id)), 0))
        : current.redemptionStock[item.id];
      return { ...result, [item.id]: stock };
    }, {} as RedemptionStock);
    return { ...current, tastingStock, redemptionStock };
  });
}
function sumMovementQuantities(movements: InventoryMovement[], marketId: string, kind: InventoryMovementKind, itemId?: RedemptionItemId) {
  return movements
    .filter(movement => movement.marketId === marketId && movement.kind === kind && (!itemId || movementComponentQuantity(movement, itemId) > 0))
    .reduce((sum, movement) => sum + (itemId ? movementComponentQuantity(movement, itemId) : Math.max(0, Number(movement.quantity) || 0)), 0);
}
function summarizeMarketStock(marketId: string, inventory: MarketInventory[], movements: InventoryMovement[]): MarketStockSummary {
  const current = inventory.find(item => item.marketId === marketId) || emptyInventory(marketId);
  const tastingUsed = sumMovementQuantities(movements, marketId, 'DEGUSTACION');
  const redemptionUsed = redemptionItems.reduce((result, item) => ({ ...result, [item.id]: sumMovementQuantities(movements, marketId, 'CANJE', item.id) }), {} as RedemptionStock);
  const tastingDelivered = DEFAULT_CAMPAIGN_TASTING_STOCK + movements
    .filter(movement => movement.marketId === marketId && movement.kind === 'AJUSTE_DEGUSTACION')
    .reduce((sum, movement) => sum + Math.max(0, Number(movement.quantity) || 0), 0);
  const redemptionDelivered = redemptionItems.reduce((result, item) => ({
    ...result,
    [item.id]: DEFAULT_CAMPAIGN_REDEMPTION_STOCK + movements
      .filter(movement => movement.marketId === marketId && movement.kind === 'AJUSTE_CANJES' && movement.itemId === item.id)
      .reduce((sum, movement) => sum + Math.max(0, Number(movement.quantity) || 0), 0),
  }), {} as RedemptionStock);
  return {
    marketId,
    tastingDelivered,
    tastingUsed,
    tastingRemaining: current.tastingStock,
    redemptionDelivered,
    redemptionUsed,
    redemptionRemaining: current.redemptionStock,
  };
}
function sumRedemptionStock(stock: RedemptionStock) {
  return redemptionItems.reduce((sum, item) => sum + (Number(stock[item.id]) || 0), 0);
}
function redemptionStockText(stock: RedemptionStock) {
  return redemptionItems.map(item => `${item.label}: ${stock[item.id]}`).join(' · ');
}
function aggregateSalesByRegion(sales: Sale[], markets: Market[]) {
  const marketMap = Object.fromEntries(markets.map(market => [market.id, market]));
  return aggregateSalesMetrics(sales, sale => {
    const market = marketMap[sale.marketId];
    const region = sale.marketRegion || market?.region || sale.marketDepartment || market?.department || 'SIN REGIÓN';
    return { key: region, label: region, subtitle: 'Región' };
  });
}
function aggregateSalesByMarket(sales: Sale[], markets: Market[]) {
  const marketMap = Object.fromEntries(markets.map(market => [market.id, market]));
  return aggregateSalesMetrics(sales, sale => {
    const market = marketMap[sale.marketId];
    return { key: sale.marketId, label: market?.name || 'MERCADO NO IDENTIFICADO', subtitle: `${sale.marketRegion || market?.region || sale.marketDepartment || market?.department || 'SIN REGIÓN'} · ${sale.marketProvince || market?.province || sale.marketDistrict || market?.district || 'SIN CIUDAD'}` };
  });
}
function aggregateSalesByPromoter(sales: Sale[], users: AppUser[]) {
  const userMap = Object.fromEntries(users.map(user => [user.id, user]));
  return aggregateSalesMetrics(sales, sale => {
    const promoter = userMap[sale.promoterId];
    const role = sale.promoterRoleLabel || promoter?.roleLabel || sale.promoterRole || promoter?.role;
    return { key: sale.promoterId, label: promoter?.name || 'PROMOTOR NO IDENTIFICADO', subtitle: promoter ? `DNI ${promoter.dni} · Rol: ${role || 'ROL NO IDENTIFICADO'}` : `Rol: ${role || 'ROL NO IDENTIFICADO'}` };
  });
}
function saleMarketLocation(sale: Sale, markets: Market[]) {
  const market = markets.find(item => item.id === sale.marketId);
  return {
    region: sale.marketRegion || market?.region || 'SIN REGIÓN',
    department: sale.marketDepartment || market?.department || 'SIN DEPARTAMENTO',
    province: sale.marketProvince || market?.province || 'SIN PROVINCIA',
    district: sale.marketDistrict || market?.district || 'SIN DISTRITO',
  };
}
function saleMarketLocationText(sale: Sale, markets: Market[]) {
  const location = saleMarketLocation(sale, markets);
  return `${location.region} · ${location.department} · ${location.province} · ${location.district}`;
}
function enrichSaleMarketLocation(sale: Sale, markets: Market[]) {
  const market = markets.find(item => item.id === sale.marketId);
  if (!market) return sale;
  const marketRegion = sale.marketRegion || market.region || market.department;
  const marketDepartment = sale.marketDepartment || market.department;
  const marketProvince = sale.marketProvince || market.province;
  const marketDistrict = sale.marketDistrict || market.district;
  if (sale.marketRegion === marketRegion && sale.marketDepartment === marketDepartment && sale.marketProvince === marketProvince && sale.marketDistrict === marketDistrict) return sale;
  return { ...sale, marketRegion, marketDepartment, marketProvince, marketDistrict };
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
function movementLabel(kind: InventoryMovementKind, itemId?: RedemptionItemId, canjeProductId?: CanjeProductId) {
  const itemSuffix = canjeProductId ? ` · ${canjeProducts.find(product => product.id === canjeProductId)?.label || 'Canje'}` : itemId ? ` · ${redemptionLabel(itemId)}` : '';
  return `${kind === 'CANJE' ? 'Canje registrado' : kind === 'DEGUSTACION' ? 'Degustación declarada' : kind === 'AJUSTE_DEGUSTACION' ? 'Ajuste de degustación' : 'Ajuste de canjes'}${itemSuffix}`;
}
function movementAmount(movement: InventoryMovement) {
  if (movement.kind === 'CANJE' || movement.kind === 'DEGUSTACION') return -movement.quantity;
  return movement.quantity;
}
function redemptionLabel(itemId?: RedemptionItemId) {
  return redemptionItems.find(item => item.id === itemId)?.label || 'Premio';
}
function canjeProductLabel(canjeProductId?: CanjeProductId, fallback?: string) {
  return canjeProducts.find(product => product.id === canjeProductId)?.label || fallback || 'Canje';
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
function multiplyRedemptionRequirements(requirements: Partial<RedemptionStock>, count: number) {
  return redemptionItems.reduce((result, item) => ({ ...result, [item.id]: (requirements[item.id] || 0) * count }), {} as Partial<RedemptionStock>);
}
function bonusProductsFor(mode: 'UNIDADES' | 'PLANCHAS', total: number, planchas: number, stock: RedemptionStock) {
  const activeProducts = activeCanjeProducts(new Date(), stock);
  if (mode === 'UNIDADES') return total === 2 ? canjeProducts.filter(product => product.id === 'CANJE_AVENA_1') : [];
  if (planchas > 80) {
    const fixed = canjeProducts.find(product => product.id === 'CANJE_AVENA_144_SPAGHETTI_100');
    const seasonal = activeProducts.find(product => product.components.AVENA === 144);
    return [fixed, seasonal].filter((product, index, products) => Boolean(product) && products.findIndex(item => item?.id === product?.id) === index) as typeof canjeProducts;
  }
  if (planchas === 10) {
    const fixed = canjeProducts.find(product => product.id === 'CANJE_AVENA_24_SPAGHETTI_10');
    const seasonal = activeProducts.find(product => product.components.SPAGHETTI === 10 && product.id !== 'CANJE_AVENA_144_SPAGHETTI_100');
    return [fixed, seasonal].filter((product, index, products) => Boolean(product) && products.findIndex(item => item?.id === product?.id) === index) as typeof canjeProducts;
  }
  const productId = planchas === 4 ? 'CANJE_AVENA_12_SPAGHETTI_3' : planchas === 1 ? 'CANJE_AVENA_3_SPAGHETTI_1' : undefined;
  return activeProducts.filter(product => product.id === productId);
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
function Input({ value, onChange, placeholder, type = 'text', min, max, step, maxLength, autoComplete, readOnly = false, testId }: { value: string | number; onChange: (value: string) => void; placeholder?: string; type?: string; min?: number; max?: number; step?: number; maxLength?: number; autoComplete?: string; readOnly?: boolean; testId?: string }) {
  return <input className="input" value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} type={type} min={min} max={max} step={step} maxLength={maxLength} autoComplete={autoComplete} readOnly={readOnly} data-testid={testId} />;
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
function driveFileId(value: string) {
  const filePath = value.match(/drive\.google\.com\/file\/d\/([^/?]+)/i);
  if (filePath?.[1]) return filePath[1];
  try {
    const id = new URL(value).searchParams.get('id');
    return id || null;
  } catch {
    return null;
  }
}
function photoImageSource(value: string) {
  const id = driveFileId(value);
  return id ? `/api/evidence-photos/drive/${encodeURIComponent(id)}` : value;
}
function PhotoThumbnail({ label, src }: { label: string; src?: string }) {
  const isAvailable = Boolean(src && /^(https?:\/\/|\/|data:image\/|blob:)/.test(src));
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [src]);
  if (!src || !isAvailable) {
    return <span className="photo-thumbnail pending" title={src ? 'Foto pendiente de sincronización' : 'Sin foto'}><Camera /><small>{label}<br />Pendiente</small></span>;
  }
  if (imageFailed) {
    return <a className="photo-thumbnail pending" href={src} target="_blank" rel="noreferrer" title={`Abrir ${label} en su almacenamiento`}><Camera /><small>{label}<br />Abrir foto</small></a>;
  }
  return <a className="photo-thumbnail" href={src} target="_blank" rel="noreferrer" title={`Abrir ${label}`}><img src={photoImageSource(src)} alt={label} loading="lazy" onError={() => setImageFailed(true)} /><small>{label}</small></a>;
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
  const [dni, setDni] = useState(''); const [password, setPassword] = useState(''); const [loading, setLoading] = useState(false);
  const submit = async () => {
    setLoading(true);
    try {
      if (navigator.onLine) {
        const response = await fetch(APP_STORAGE_LOGIN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dni, password }) });
        const payload = await response.json() as { user?: AppUser; message?: string };
        if (!response.ok || !payload.user) { notify(payload.message || 'DNI o clave incorrectos', true); return; }
        const user = { ...payload.user, password };
        writeStore('bt-session', user); onLogin(user); return;
      }
      const user = users.find(item => item.dni === dni && item.password === password && item.status === 'ACTIVO') || null;
      if (!user) { notify('Sin conexión: usa una cuenta que ya haya ingresado en este dispositivo', true); return; }
      writeStore('bt-session', user); onLogin(user);
    } catch {
      notify('No se pudo validar el acceso con el servidor', true);
    } finally {
      setLoading(false);
    }
  };
  return <main className="login-shell">
    <section className="login-hero"><Logo compact /><div className="hero-copy"><span className="eyebrow">CAMPAÑA 2026</span><h1>Panetones Molitalia</h1><p>Ventas, clientes, dinámicas y evidencias en una sola aplicación.</p></div><div className="hero-foot"><span /> Captura segura para trabajo en campo</div></section>
    <section className="login-panel"><form className="login-card" onSubmit={event => { event.preventDefault(); submit(); }}><div className="mobile-logo"><Logo /></div><div className="login-heading"><span className="icon-disc"><ShieldCheck /></span><div><h2>Bienvenido</h2><p>Ingresa con tu DNI y clave.</p></div></div>
       <Field label="DNI"><Input value={dni} onChange={value => setDni(value.replace(/\D/g, ''))} placeholder="12345678" maxLength={8} autoComplete="username" testId="input-dni" /></Field>
       <Field label="Clave"><Input value={password} onChange={setPassword} placeholder="Ingresa tu clave" type="password" autoComplete="current-password" testId="input-password" /></Field>
        <Btn className="primary full" type="submit" disabled={loading} testId="button-login">{loading ? 'Validando...' : 'Ingresar'}</Btn>
      <div className="login-note"><Smartphone /> Instalable en iPhone y Android</div>
     </form></section>
  </main>;
}

function Shell({ user, logout, children }: { user: AppUser; logout: () => void; children: ReactNode }) {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  useEffect(() => { const update = () => setOnline(navigator.onLine); update(); window.addEventListener('online', update); window.addEventListener('offline', update); return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); }; }, []);
  return <div className="bt-app"><header className="topbar"><Logo compact /><div className="campaign"><small>Campaña</small><strong>Panetones Molitalia</strong></div><div className="top-user"><div className="top-user-info"><strong>{user.name}</strong><small>{user.roleLabel || user.role}</small></div><Btn variant="ghost" onClick={logout} testId="button-logout"><LogOut /> Salir</Btn></div></header>{!online && <div className="offline-bar" role="status" aria-live="polite" data-testid="status-offline"><WifiOff /> Sin conexión · cambios guardados en este dispositivo</div>}{online && <div className="offline-bar" role="status" aria-live="polite" data-testid="status-online"><Wifi /> Con conexión · aplicación lista para operar</div>}{children}</div>;
}

function Stat({ icon, label, value, note }: { icon: ReactNode; label: string; value: number; note: string }) {
  return <article className="stat" data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`}><span className="stat-icon">{icon}</span><div><p>{label}</p><strong>{value.toLocaleString('es-PE')}</strong><small>{note}</small></div></article>;
}
function DownloadCard({ title, detail, onClick }: { title: string; detail: string; onClick: () => void }) {
  return <article className="download-card"><span><Download /></span><div><strong>{title}</strong><small>{detail}</small></div><Btn variant="outline" onClick={onClick} testId={`button-download-${title.toLowerCase()}`}><Download /> Descargar</Btn></article>;
}

function NewUserModal({ markets, clients, onSave, close }: { markets: { value: string; label: string }[]; clients: Client[]; onSave: (user: AppUser) => void; close: () => void }) {
  const [dni, setDni] = useState(''); const [name, setName] = useState(''); const [marketId, setMarketId] = useState(''); const [clientId, setClientId] = useState(''); const [password, setPassword] = useState(''); const [role, setRole] = useState<Role>('PROMOTOR ROTATIVO');
  const save = () => {
    if (dni.length !== 8 || !name.trim() || password.length < 8 || (isZoneManagerRole(role) && !marketId) || (role === 'CLIENTE' && !clientId)) return;
    onSave({ id: `USR-${Date.now()}`, dni, name: name.trim(), role, roleLabel: role, marketId: isZoneManagerRole(role) ? marketId : undefined, clientId: role === 'CLIENTE' ? clientId : undefined, password, status: 'ACTIVO', ...(isPromoterRole(role) ? { tastingStock: 0, redemptionStock: emptyRedemptionStock() } : {}) }); close();
  };
  return <Modal title="Crear usuario" detail="Define únicamente su acceso y rol. El stock se asigna desde el módulo de Canjes." close={close}><div className="form-grid"><Field label="DNI *"><Input value={dni} onChange={value => setDni(value.replace(/\D/g, ''))} maxLength={8} testId="input-new-user-dni" /></Field><Field label="Nombre completo *"><Input value={name} onChange={setName} testId="input-new-user-name" /></Field><SelectField label="Rol *" value={role} onChange={value => setRole(value as Role)} items={['PROMOTOR', ...selectablePromoterRoles, 'COORDINADOR', 'SUPERVISOR', 'ANALISTA', 'TRADE', 'ADMIN', 'CLIENTE'].map(value => ({ value, label: value }))} />{isZoneManagerRole(role) && <SelectField label="Mercado asignado *" value={marketId} onChange={setMarketId} items={markets} />}{role === 'CLIENTE' && <SelectField label="Cliente vinculado *" value={clientId} onChange={setClientId} items={clients.filter(client => client.status === 'ACTIVO').map(client => ({ value: client.id, label: `${client.code} · ${client.name}` }))} placeholder="Seleccionar cliente" />}<Field label="Clave temporal *"><Input value={password} onChange={value => setPassword(value)} type="password" testId="input-new-user-password" /></Field></div><div className="modal-actions"><Btn variant="outline" onClick={close}>Cancelar</Btn><Btn onClick={save} testId="button-create-user">Crear usuario</Btn></div></Modal>;
}
function NewMarketModal({ onSave, close }: { onSave: (market: Market) => void | Promise<void>; close: () => void }) {
  const [name, setName] = useState(''); const [region, setRegion] = useState(''); const [department, setDepartment] = useState(''); const [province, setProvince] = useState(''); const [district, setDistrict] = useState('');
  const save = async () => { if (!name.trim() || !department.trim() || !province.trim() || !district.trim()) return; await onSave({ id: `MKT-${Date.now()}`, name: name.trim().toUpperCase(), region: region.trim().toUpperCase() || department.trim().toUpperCase(), department: department.trim().toUpperCase(), province: province.trim().toUpperCase(), district: district.trim().toUpperCase(), status: 'ACTIVO' }); close(); };
  return <Modal title="Crear mercado" detail="Ingresa manualmente un mercado para la campaña." close={close}><div className="form-grid"><Field label="Nombre del mercado *"><Input value={name} onChange={setName} testId="input-new-market-name" /></Field><Field label="Región"><Input value={region} onChange={setRegion} placeholder="LIMA" testId="input-new-market-region" /></Field><Field label="Departamento *"><Input value={department} onChange={setDepartment} testId="input-new-market-department" /></Field><Field label="Provincia *"><Input value={province} onChange={setProvince} testId="input-new-market-province" /></Field><Field label="Distrito *"><Input value={district} onChange={setDistrict} testId="input-new-market-district" /></Field></div><div className="modal-actions"><Btn variant="outline" onClick={close}>Cancelar</Btn><Btn onClick={save} testId="button-create-market">Guardar mercado</Btn></div></Modal>;
}
function NewClientModal({ markets, count, onSave, close }: { markets: { value: string; label: string }[]; count: number; onSave: (client: Client) => void | Promise<void>; close: () => void }) {
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [category, setCategory] = useState<ClientCategory>('MIXTO'); const [marketId, setMarketId] = useState('');
  const save = async () => { if (!name.trim() || !marketId) return; await onSave({ id: `${Date.now()}`, code: `CLI-${String(count + 1).padStart(6, '0')}`, name: name.trim(), phone: phone || undefined, category, marketId, status: 'ACTIVO' }); close(); };
  return <Modal title="Crear cliente" detail="El código y estado se generan automáticamente." close={close}><div className="form-grid"><Field label="Nombre del cliente *"><Input value={name} onChange={setName} testId="input-new-client-name" /></Field><Field label="Celular (opcional)"><Input value={phone} onChange={setPhone} testId="input-new-client-phone" /></Field><SelectField label="Categoría *" value={category} onChange={value => setCategory(value as ClientCategory)} items={[{ value: 'MIXTO', label: 'MIXTO' }, { value: 'CONFETI', label: 'CONFETI' }]} /><SelectField label="Mercado *" value={marketId} onChange={setMarketId} items={markets} /></div><div className="modal-actions"><Btn variant="outline" onClick={close}>Cancelar</Btn><Btn onClick={save} testId="button-create-client">Guardar cliente</Btn></div></Modal>;
}
function SaleEditModal({ sale, clients, promoter, onSave, close }: { sale: Sale; clients: Client[]; promoter?: AppUser; onSave: (sale: Sale, photos: { receipt: File | null; exchange: File | null }) => Promise<boolean>; close: () => void }) {
  const [clientId, setClientId] = useState(sale.clientId);
  const [amountSoles, setAmountSoles] = useState(String(sale.amountSoles));
  const [saleDate, setSaleDate] = useState(() => {
    const date = new Date(sale.date);
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  });
  const [comment, setComment] = useState(sale.comment || '');
  const originalCount = sale.bonus ? Math.max(1, Math.floor(Number(sale.redemptionCount) || 1)) : 0;
  const originalRequirements = sale.redemptionItems
    ? redemptionItems.reduce((result, item) => ({ ...result, [item.id]: Math.max(0, Number(sale.redemptionItems?.[item.id]) || 0) }), {} as RedemptionStock)
    : multiplyRedemptionRequirements(parseBonusItems(sale.bonus), originalCount);
  const currentStock = userRedemptionStock(promoter || { id: '', dni: '', name: '', role: 'PROMOTOR', status: 'ACTIVO' });
  const restoredStock = redemptionItems.reduce((result, item) => ({ ...result, [item.id]: currentStock[item.id] + (originalRequirements[item.id] || 0) }), {} as RedemptionStock);
  const availableCanjes = bonusProductsFor(sale.mode, sale.units, sale.planchas || 0, restoredStock);
  const [canjeProductId, setCanjeProductId] = useState<CanjeProductId | ''>(availableCanjes.find(product => product.label === sale.bonus)?.id || '');
  const [redemptionCount, setRedemptionCount] = useState(originalCount || 1);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [exchange, setExchange] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const marketClients = clients.filter(client => client.marketId === sale.marketId && (client.status === 'ACTIVO' || client.id === sale.clientId));
  const parsedAmount = Number(amountSoles);
  const parsedDate = new Date(saleDate);
  const selectedCanje = availableCanjes.find(product => product.id === canjeProductId);
  const newRequirements = selectedCanje ? multiplyRedemptionRequirements(parseBonusItems(selectedCanje.label), redemptionCount) : emptyRedemptionStock();
  const missingStock = requiredRedemptionEntries(newRequirements).find(([itemId, quantity]) => restoredStock[itemId] < quantity);
  const exchangeEvidenceReady = !selectedCanje || Boolean(exchange || sale.exchangePhoto);
  const save = async () => {
    if (!clientId || !Number.isFinite(parsedAmount) || parsedAmount <= 0 || Number.isNaN(parsedDate.getTime()) || missingStock || !exchangeEvidenceReady || saving) return;
    setSaving(true);
    try {
      const saved = await onSave({
        ...sale,
        clientId,
        amountSoles: parsedAmount,
        date: parsedDate.toISOString(),
        comment: comment.trim() || undefined,
        bonus: selectedCanje?.label,
        redemptionCount: selectedCanje ? redemptionCount : 0,
        redemptionItems: selectedCanje ? newRequirements : undefined,
        receiptPhoto: receipt ? `BOLETA - ${sale.id}.jpg` : sale.receiptPhoto,
        exchangePhoto: selectedCanje ? (exchange ? `${selectedCanje.label} - CLIENTE - ${sale.id}.jpg` : sale.exchangePhoto) : undefined,
      }, { receipt, exchange });
      if (saved) close();
    } finally {
      setSaving(false);
    }
  };
  return <Modal title="Editar venta" detail={`${sale.id} · Puedes corregir el canje y reemplazar sus evidencias.`} close={close}><div className="form-grid"><SelectField label="Cliente *" value={clientId} onChange={setClientId} items={marketClients.map(client => ({ value: client.id, label: `${client.code} · ${client.name}` }))} /><Field label="Importe total (S/) *"><Input type="number" value={amountSoles} onChange={setAmountSoles} min={0.01} step={0.01} testId="input-edit-sale-amount" /></Field><Field label="Fecha y hora de venta *"><Input type="datetime-local" value={saleDate} onChange={setSaleDate} testId="input-edit-sale-date" /></Field><SelectField label="Canje" value={canjeProductId} onChange={value => setCanjeProductId(value as CanjeProductId | '')} items={[{ value: '', label: 'Sin canje' }, ...availableCanjes.map(product => ({ value: product.id, label: product.label }))]} />{selectedCanje && <Field label="Número de canjes *"><select className="select" value={redemptionCount} onChange={event => setRedemptionCount(Number(event.target.value))} data-testid="select-edit-redemption-count"><option value={1}>1 canje</option><option value={2}>2 canjes</option><option value={3}>3 canjes</option></select></Field>}<Field label="Comentario" className="full-field"><textarea className="input textarea" value={comment} onChange={event => setComment(event.target.value)} maxLength={300} rows={3} data-testid="input-edit-sale-comment" /></Field></div>{missingStock && <div className="stock-warning"><PackageCheck /> Stock insuficiente de {redemptionLabel(missingStock[0])}. El canje anterior se devuelve antes de aplicar el nuevo.</div>}<div className="evidence-grid"><div><PhotoThumbnail label="Boleta actual" src={sale.receiptPhoto} /><PhotoField label="Reemplazar boleta" hint="Déjalo vacío para conservar la actual" file={receipt} setFile={setReceipt} /></div><div>{sale.exchangePhoto && <PhotoThumbnail label="Canje actual" src={sale.exchangePhoto} />}<PhotoField label="Reemplazar foto de canje" hint={selectedCanje ? 'Obligatoria si el canje no tenía evidencia' : 'No requerida sin canje'} file={exchange} setFile={setExchange} disabled={!selectedCanje} /></div></div><p className="modal-hint">Los productos y cantidades vendidas se conservan. El inventario personal del promotor se recalcula al guardar.</p><div className="modal-actions"><Btn variant="outline" onClick={close}>Cancelar</Btn><Btn disabled={!clientId || !Number.isFinite(parsedAmount) || parsedAmount <= 0 || Number.isNaN(parsedDate.getTime()) || Boolean(missingStock) || !exchangeEvidenceReady || saving} onClick={save} testId="button-save-sale-edit">{saving ? <RefreshCw className="spin" /> : <CheckCircle2 />}{saving ? 'Guardando...' : 'Guardar cambios'}</Btn></div></Modal>;
}
function NewCanjeModal({ users, user, onSave, close }: { users: AppUser[]; user: AppUser; onSave: (canje: InventoryMovement) => void | Promise<void>; close: () => void }) {
  const promoters = users.filter(current => !current.sheetArchived && current.status === 'ACTIVO' && isPromoterRole(current.role));
  const [promoterId, setPromoterId] = useState(''); const [itemId, setItemId] = useState<RedemptionItemId>('AVENA'); const [quantity, setQuantity] = useState('');
  const selectedPromoter = promoters.find(current => current.id === promoterId);
  const save = async () => { const parsed = Number(quantity); if (!selectedPromoter || !Number.isInteger(parsed) || parsed <= 0) return; await onSave({ id: `ABAST-CANJE-${Date.now()}`, marketId: selectedPromoter.marketId || `PERSONAL:${selectedPromoter.id}`, promoterId: selectedPromoter.id, kind: 'AJUSTE_CANJES', itemId, quantity: parsed, actorId: user.id, actorName: user.name, date: new Date().toISOString(), status: 'PENDIENTE' }); close(); };
  return <Modal title="Abastecer stock de canjes" detail="Carga avena, spaguetti, batea o mandil directamente al stock personal del promotor." close={close}><div className="form-grid"><SelectField label="Promotor *" value={promoterId} onChange={setPromoterId} items={promoters.map(current => ({ value: current.id, label: `${current.name} · DNI ${current.dni}` }))} placeholder="Seleccionar promotor" /><SelectField label="Artículo *" value={itemId} onChange={value => setItemId(value as RedemptionItemId)} items={redemptionItems.map(item => ({ value: item.id, label: item.label }))} /><Field label="Cantidad recibida *"><Input type="number" value={quantity} onChange={setQuantity} min={1} step={1} testId="input-new-canje-quantity" /></Field></div>{selectedPromoter && <p className="modal-hint">Stock actual: {redemptionStockText(userRedemptionStock(selectedPromoter))}</p>}<div className="modal-actions"><Btn variant="outline" onClick={close}>Cancelar</Btn><Btn disabled={!selectedPromoter || !Number.isInteger(Number(quantity)) || Number(quantity) <= 0} onClick={save} testId="button-create-canje">Cargar stock</Btn></div></Modal>;
}
function AdminCanjesModule({ canjes, marketMap, users, onCreate, onDelete, onCleanup, canCleanup, notify }: { canjes: AdminCanje[]; marketMap: Record<string, Market>; users: AppUser[]; onCreate: () => void; onDelete: (canje: AdminCanje) => void; onCleanup: () => void; canCleanup: boolean; notify: (message: string, error?: boolean) => void }) {
  const exportCanjes = () => {
    downloadCsv(`canjes-${new Date().toISOString().slice(0, 10)}.csv`, ['Fecha', 'Origen', 'Mercado', 'Producto', 'Cantidad', 'Responsable'], canjes.map(canje => [formatDate(canje.date), canje.source === 'sale' ? 'Venta' : 'Movimiento', marketMap[canje.marketId]?.name || 'Mercado', canjeProductLabel(canje.canjeProductId, canje.canjeProductLabel || canje.sale?.bonus || (canje.itemId ? redemptionLabel(canje.itemId) : undefined)), canje.quantity, canje.actorName]));
    notify('Reporte de canjes descargado');
  };
  return <section className="admin-module">
    <div className="admin-intro"><div><span className="eyebrow">GESTIÓN MANUAL</span><h2>Canjes</h2><p>Abastece el stock personal de los promotores y consulta los canjes asociados a ventas.</p></div><div className="page-actions"><Btn variant="outline" onClick={exportCanjes}><Download /> Descargar</Btn><Btn onClick={onCreate}><Plus /> Abastecer stock</Btn></div></div>
    {canCleanup && <div className="admin-warning"><Trash2 /><span><strong>Limpieza inicial</strong><small>Elimina todos los datos operativos y todos los usuarios excepto ANALISTA. Los precios se conservan.</small></span><Btn variant="danger" onClick={onCleanup} testId="button-cleanup-catalogs">Empezar desde cero</Btn></div>}
    <section className="panel"><div className="panel-header"><div><h2>{canjes.length} movimientos registrados</h2><p>Eliminar un abastecimiento revierte el stock cargado.</p></div></div><div className="panel-body">{canjes.length ? <div className="record-list">{canjes.map(canje => { const promoter = canje.promoterId ? users.find(current => current.id === canje.promoterId) : undefined; return <article className="record" key={`${canje.source}-${canje.canjeId}`}><span className="record-icon"><Gift /></span><div className="record-main"><strong>{canjeProductLabel(canje.canjeProductId, canje.canjeProductLabel || canje.sale?.bonus || (canje.itemId ? redemptionLabel(canje.itemId) : undefined))}</strong><small>{promoter ? `Stock de ${promoter.name}` : marketMap[canje.marketId]?.name || 'Mercado no identificado'} · {canje.quantity} unidad{canje.quantity === 1 ? '' : 'es'}</small><em>{canje.source === 'sale' ? 'Venta' : 'Abastecimiento'} · {canje.actorName} · {formatDate(canje.date)}</em></div><Btn variant="danger" onClick={() => onDelete(canje)} testId={`button-delete-canje-${canje.canjeId}`}><Trash2 /> Eliminar</Btn></article>; })}</div> : <Empty title="Aún no hay movimientos" detail="Abastece el stock personal de un promotor." />}</div></section>
  </section>;
}

function NewDegustacionModal({ markets, user, onSave, close }: { markets: { value: string; label: string }[]; user: AppUser; onSave: (degustacion: InventoryMovement) => void | Promise<void>; close: () => void }) {
  const [marketId, setMarketId] = useState(''); const [productId, setProductId] = useState<DegustacionProductId>('PANETON'); const [quantity, setQuantity] = useState('');
  const selectedProduct = degustacionProducts.find(product => product.id === productId) || degustacionProducts[0];
  const save = async () => { const parsed = Number(quantity); if (!marketId || !Number.isInteger(parsed) || parsed <= 0) return; await onSave({ id: `DEG-ABASTECIMIENTO-${Date.now()}`, marketId, kind: 'AJUSTE_DEGUSTACION', degustacionProductId: selectedProduct.id, degustacionProductLabel: selectedProduct.label, quantity: parsed, actorId: user.id, actorName: user.name, date: new Date().toISOString(), status: 'PENDIENTE' }); close(); };
  return <Modal title="Registrar degustación legacy" detail="Conserva un abastecimiento histórico asociado a un mercado; el stock operativo se configura por promotor." close={close}><div className="form-grid"><SelectField label="Mercado histórico *" value={marketId} onChange={setMarketId} items={markets} /><SelectField label="Producto *" value={productId} onChange={value => setProductId(value as DegustacionProductId)} items={degustacionProducts.map(product => ({ value: product.id, label: product.label }))} /><Field label="Cantidad *"><Input type="number" value={quantity} onChange={setQuantity} min={1} step={1} testId="input-new-degustacion-quantity" /></Field></div><div className="modal-actions"><Btn variant="outline" onClick={close}>Cancelar</Btn><Btn onClick={save} testId="button-create-degustacion">Guardar degustación</Btn></div></Modal>;
}
function AdminDegustacionesModule({ degustaciones, marketMap, onCreate, onDelete }: { degustaciones: AdminDegustacion[]; marketMap: Record<string, Market>; onCreate: () => void; onDelete: (degustacion: AdminDegustacion) => void }) {
  return <section className="admin-module">
    <div className="admin-intro"><div><span className="eyebrow">ABASTECIMIENTO</span><h2>Degustación</h2><p>Agrega panetones de degustación por mercado y actualiza el inventario automáticamente.</p></div><div className="page-actions"><Btn onClick={onCreate}><Plus /> Nueva degustación</Btn></div></div>
    <section className="panel"><div className="panel-header"><div><h2>{degustaciones.length} registros de degustación</h2><p>El stock se actualiza por la cantidad ingresada.</p></div></div><div className="panel-body">{degustaciones.length ? <div className="record-list">{degustaciones.map(degustacion => <article className="record" key={degustacion.degustacionId}><span className="record-icon"><PackageCheck /></span><div className="record-main"><strong>{degustacion.degustacionProductLabel || 'Panetón'}</strong><small>{marketMap[degustacion.marketId]?.name || 'Mercado no identificado'} · {degustacion.quantity} unidad{degustacion.quantity === 1 ? '' : 'es'}</small><em>{degustacion.actorName} · {formatDate(degustacion.date)}</em></div><Btn variant="danger" onClick={() => onDelete(degustacion)} testId={`button-delete-degustacion-${degustacion.degustacionId}`}><Trash2 /> Eliminar</Btn></article>)}</div> : <Empty title="Aún no hay degustaciones" detail="Puedes agregar panetones de degustación por mercado." />}</div></section>
  </section>;
}

function SessionCloseModal({ available, onConfirm, close }: { available: number; onConfirm: (tastingUsed: number, leads: number) => void; close: () => void }) {
  const [quantity, setQuantity] = useState('0'); const [leads, setLeads] = useState('0');
  const parsedQuantity = quantity === '' ? NaN : Number(quantity); const parsedLeads = leads === '' ? NaN : Number(leads);
  const valid = Number.isInteger(parsedQuantity) && parsedQuantity >= 0 && parsedQuantity <= available && Number.isInteger(parsedLeads) && parsedLeads >= 0;
  return <Modal title="Cierra tu jornada" detail="Antes de salir, registra tu degustación y los posibles Leads de hoy." close={close}>
    <div className="logout-declaration">
       <div className="stock-callout"><PackageCheck /><div><strong>{available} disponibles</strong><small>Tu stock personal de degustación</small></div></div>
      <div className="form-grid"><Field label="Panetones utilizados *"><Input type="number" value={quantity} onChange={value => setQuantity(value.replace(/\D/g, ''))} min={0} step={1} placeholder="0" testId="input-tasting-usage" /></Field><Field label="Posibles Leads *"><Input type="number" value={leads} onChange={value => setLeads(value.replace(/\D/g, ''))} min={0} step={1} placeholder="0" testId="input-session-leads" /></Field></div>
      {Number.isFinite(parsedQuantity) && parsedQuantity > available && <p className="modal-error">La cantidad ingresada supera el stock disponible ({available}).</p>}
       <p className="modal-hint">{available > 0 ? 'Si no utilizaste ninguno o no tuviste Leads, registra 0. La degustación se descontará de tu stock al cerrar la sesión.' : 'No tienes stock personal disponible. Registra 0 en degustación y Leads para cerrar la sesión.'}</p>
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
    downloadCsv(`movimientos-stock-${today}.csv`, ['Fecha', 'Mercado', 'Movimiento', 'Cantidad', 'Responsable', 'Estado'], movements.map(movement => [formatDate(movement.date), marketMap[movement.marketId]?.name || 'Mercado', movementLabel(movement.kind, movement.itemId, movement.canjeProductId), movementAmount(movement), movement.actorName, movement.status]));
    notify('Reporte de movimientos descargado');
  };
  const sortedMovements = [...movements].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  const levelClass = (value: number) => value === 0 ? 'empty' : value <= 5 ? 'low' : 'available';
  return <section className="inventory-module">
     <div className="inventory-overview"><div><span className="eyebrow">HISTÓRICO DE CAMPAÑA</span><h2>Canjes y degustaciones legacy</h2><p>Consulta el inventario histórico por mercado y revisa los consumos asociados a su ubicación.</p></div><div className="page-actions"><CsvImportButton label="Importar" onImport={onImportCsv} testId="button-import-inventory" /><CsvExampleButton onDownload={onDownloadExample} testId="button-example-inventory" /><Btn variant="outline" onClick={exportInventory}><Download /> Exportar inventario</Btn><Btn variant="outline" onClick={exportMovements}><Download /> Exportar movimientos</Btn></div></div>
    <div className="inventory-summary"><article><span className="inventory-summary-icon"><PackageCheck /></span><div><small>STOCK TOTAL DE DEGUSTACIÓN</small><strong>{totals.tasting}</strong><p>Panetones disponibles</p></div></article><article><span className="inventory-summary-icon accent"><Gift /></span><div><small>UNIDADES DE CANJE</small><strong>{totals.redemption}</strong><p>Premios disponibles</p></div></article><article><span className="inventory-summary-icon blue"><MapPin /></span><div><small>MERCADOS CONTROLADOS</small><strong>{markets.length}</strong><p>Con saldo independiente</p></div></article></div>
     <section className="panel"><div className="panel-header"><div><h2>Inventario histórico por mercado</h2><p>Estos saldos legacy no se distribuyen automáticamente a promotores; el stock operativo se administra en cada usuario.</p></div></div><div className="panel-body summary-table-wrap">{inventory.length ? <div className="stock-reconciliation-table inventory-stock-table"><div className="stock-reconciliation-row header"><span>Mercado legacy</span><span>Degustación</span>{redemptionItems.map(item => <span key={item.id}>{item.label}</span>)}</div>{inventory.map(stock => <div className="stock-reconciliation-row" key={stock.marketId}><div><strong>{marketMap[stock.marketId]?.name || 'Mercado no identificado'}</strong><small>{marketMap[stock.marketId]?.district || stock.marketId}</small></div><b className={`stock-level ${levelClass(stock.tastingStock)}`}>{stock.tastingStock}<small>histórico</small></b>{redemptionItems.map(item => <span className={`stock-level ${levelClass(stock.redemptionStock[item.id])}`} key={item.id}>{stock.redemptionStock[item.id]}<small>histórico</small></span>)}</div>)}</div> : <Empty title="Aún no hay inventario histórico" detail="El stock operativo de los promotores se configura desde sus usuarios." />}</div></section>
    <section className="inventory-history"><div className="panel-header"><div><h2>Movimientos recientes</h2><p>Canjes, degustaciones y ajustes hechos por el equipo.</p></div></div>{sortedMovements.length ? <div className="movement-list">{sortedMovements.map(movement => { const amount = movementAmount(movement); return <article className="movement-row" key={movement.id}><span className={`movement-icon ${amount < 0 ? 'consume' : 'adjust'}`}>{amount < 0 ? <PackageCheck /> : <Plus />}</span><div><strong>{movementLabel(movement.kind, movement.itemId, movement.canjeProductId)}</strong><small>{marketMap[movement.marketId]?.name || 'Mercado'} · {movement.actorName} · {formatDate(movement.date)}</small></div><span className={`movement-amount ${amount < 0 ? 'negative' : 'positive'}`}>{amount > 0 ? '+' : ''}{amount}</span><StatusPill status={movement.status} /></article>; })}</div> : <div className="inventory-empty"><PackageCheck /><h3>Aún no hay movimientos</h3><p>Los descuentos y ajustes de stock aparecerán aquí.</p></div>}</section>
  </section>;
}

function AssignmentModule({ markets, users, clients, assignments, setAssignments, setUsers, notify }: { markets: Market[]; users: AppUser[]; clients: Client[]; assignments: PromoterAssignment[]; setAssignments: (value: PromoterAssignment[]) => void; setUsers: (value: AppUser[]) => void; notify: (message: string, error?: boolean) => void }) {
  const promoters = users.filter(user => (isZoneManagerRole(user.role)) && user.status === 'ACTIVO');
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
  const assignmentFor = (promoterId: string) => {
    const promoter = promoters.find(item => item.id === promoterId);
    return promoter ? assignments.find(assignment => assignmentMatchesUser(assignment, promoter)) : undefined;
  };
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
  const saveAssignment = async () => {
    if (!selectedPromoterId) { notify('Selecciona un promotor o coordinador para asignar', true); return; }
    if (!selectedMarketIds.length) { notify('Selecciona al menos un mercado', true); return; }
    if (!selectedClientIds.length) { notify('Selecciona al menos un cliente', true); return; }
     const assignment: PromoterAssignment = { promoterId: selectedPromoterId, promoterDni: selectedPromoter?.dni, marketIds: selectedMarketIds, clientIds: selectedClientIds, updatedAt: new Date().toISOString() };
     const next = [...assignments.filter(item => !selectedPromoter || !assignmentMatchesUser(item, selectedPromoter)), assignment];
    setAssignments(next);
     writeStore('bt-promoter-assignments', next);
    setUsers(users.map(user => user.id === selectedPromoterId ? { ...user, marketId: selectedMarketIds[0] } : user));
     try {
        const response = await fetch(APP_STORAGE_ASSIGNMENTS, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assignment }) });
       if (!response.ok) throw new Error('No se pudo sincronizar');
       const payload = await response.json() as { assignments?: PromoterAssignment[] };
       if (Array.isArray(payload.assignments)) {
         const merged = mergeAssignments(next, payload.assignments);
         setAssignments(merged); writeStore('bt-promoter-assignments', merged);
       }
        notify(`Asignación sincronizada para ${selectedPromoter?.name || 'el usuario'}`);
     } catch {
       notify('Asignación guardada en este dispositivo, pero pendiente de sincronizar. Intenta guardar nuevamente.', true);
     }
  };
  const clearAssignment = async () => {
     if (!selectedPromoterId) { notify('Selecciona un promotor o coordinador para quitar su asignación', true); return; }
     const assignment: PromoterAssignment = { promoterId: selectedPromoterId, promoterDni: selectedPromoter?.dni, marketIds: [], clientIds: [], updatedAt: new Date().toISOString() };
     const next = [...assignments.filter(item => !selectedPromoter || !assignmentMatchesUser(item, selectedPromoter)), assignment];
    setAssignments(next);
     writeStore('bt-promoter-assignments', next);
    setUsers(users.map(user => user.id === selectedPromoterId ? { ...user, marketId: undefined } : user));
    setSelectedMarketIds([]); setSelectedClientIds([]);
     try {
        const response = await fetch(APP_STORAGE_ASSIGNMENTS, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assignment }) });
       if (!response.ok) throw new Error('No se pudo sincronizar');
       notify(`Asignación retirada para ${selectedPromoter?.name || 'el promotor'}`);
     } catch {
       notify('La asignación se retiró localmente, pero falta sincronizar el cambio.', true);
     }
  };
  return <section className="assignment-module">
     <div className="assignment-intro"><div><span className="eyebrow">COBERTURA DE CAMPO</span><h2>Asignar mercados y clientes</h2><p>Define exactamente qué puede visitar cada promotor. La asignación se guarda localmente y se sincroniza con la BBDD central.</p></div><div className="assignment-counter"><strong>{assignments.filter(assignment => assignment.marketIds.length > 0).length}</strong><small>promotores con asignación</small></div></div>
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

function SalesDashboard({ sales, markets, users, inventory, movements, onViewSales, onExport }: { sales: Sale[]; markets: Market[]; users: AppUser[]; inventory: MarketInventory[]; movements: InventoryMovement[]; onViewSales: () => void; onExport: () => void }) {
  const regionRows = useMemo(() => aggregateSalesByRegion(sales, markets), [sales, markets]);
  const marketRows = useMemo(() => aggregateSalesByMarket(sales, markets), [sales, markets]);
  const stockRows = useMemo(() => users.filter(user => isPromoterRole(user.role) && user.status === 'ACTIVO').map(promoter => ({ promoter, tastingStock: userTastingStock(promoter), redemptionStock: userRedemptionStock(promoter) })), [users]);
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
      <section className="panel"><div className="panel-header"><div><h2>Stock por promotor</h2><p>Existencias personales independientes de cada promotor. El mercado solo conserva la ubicación histórica de los movimientos.</p></div></div><div className="panel-body summary-table-wrap">{stockRows.length ? <div className="stock-reconciliation-table"><div className="stock-reconciliation-row header"><span>Promotor</span><span>Degustación personal</span>{redemptionItems.map(item => <span key={item.id}>{item.label}</span>)}</div>{stockRows.map(row => <div className="stock-reconciliation-row" key={row.promoter.id}><div><strong>{row.promoter.name}</strong><small>DNI {row.promoter.dni} · {row.promoter.roleLabel || row.promoter.role}</small></div><b>{row.tastingStock}<small>panetones</small></b>{redemptionItems.map(item => <span key={item.id}>{row.redemptionStock[item.id]}<small>unidades</small></span>)}</div>)}</div> : <Empty title="Sin promotores activos" detail="Los saldos personales aparecerán al crear promotores." />}</div></section>
    <div className="summary-sections">
      <section className="panel"><div className="panel-header"><div><h2>Mejores Promotores</h2><p>Ordenados por venta total en soles.</p></div></div><div className="panel-body">{promoterRows.length ? <div className="promoter-ranking">{promoterRows.slice(0, 5).map((row, index) => <div className="promoter-ranking-row" key={row.key}><span className="ranking-position">{index + 1}</span><div><strong>{row.label}</strong><small>{row.subtitle} · {row.units.toLocaleString('es-PE')} unidades · {formatKilos(row.kilos)}</small></div><b>{formatSoles(row.soles)}</b></div>)}</div> : <Empty title="Aún no hay promotores con ventas" detail="El ranking aparecerá con los primeros pedidos." />}</div></section>
      <section className="panel"><div className="panel-header"><div><h2>Detalle por Marcas</h2><p>Distribución de unidades vendidas por marca.</p></div></div><div className="panel-body brand-pie-layout">{brandRows.length ? <><div className="brand-pie" style={pieStyle} aria-label="Distribución de ventas por marca"><span>{totalBrandUnits.toLocaleString('es-PE')}<small>unidades</small></span></div><div className="brand-legend">{brandRows.map((row, index) => <div className="brand-legend-row" key={row.key}><span className="brand-swatch" style={{ background: brandColors[index % brandColors.length] }} /><div><strong>{row.label}</strong><small>{row.units.toLocaleString('es-PE')} unidades · {formatSoles(row.soles)}</small></div><b>{totalBrandUnits ? `${((row.units / totalBrandUnits) * 100).toFixed(1)}%` : '0%'}</b></div>)}</div></> : <Empty title="Sin detalle por marcas" detail="El pastel aparecerá al registrar ventas." />}</div></section>
    </div>
  </div>;
}

function CoordinatorApp({ user, markets, users, clients, sales, inventory, movements, assignments, notify }: { user: AppUser; markets: Market[]; users: AppUser[]; clients: Client[]; sales: Sale[]; inventory: MarketInventory[]; movements: InventoryMovement[]; assignments: PromoterAssignment[]; notify: (message: string, error?: boolean) => void }) {
  const [tab, setTab] = useState('inicio');
  const assignment = assignments.find(item => assignmentMatchesUser(item, user));
  const allowedMarketIds = new Set(assignment?.marketIds?.length ? assignment.marketIds : user.marketId ? [user.marketId] : []);
  const allowedMarkets = markets.filter(market => allowedMarketIds.has(market.id));
  const allowedClientIds = new Set(assignment?.clientIds?.length ? assignment.clientIds : clients.filter(client => allowedMarketIds.has(client.marketId)).map(client => client.id));
  const allowedClients = clients.filter(client => allowedMarketIds.has(client.marketId) && allowedClientIds.has(client.id));
  const userMarketIds = (current: AppUser) => {
    const currentAssignment = assignments.find(item => assignmentMatchesUser(item, current));
    return currentAssignment?.marketIds?.length ? currentAssignment.marketIds : current.marketId ? [current.marketId] : [];
  };
  const allowedUsers = users.filter(current => !current.sheetArchived && (current.id === user.id || userMarketIds(current).some(marketId => allowedMarketIds.has(marketId))));
  const allowedSales = sales.filter(sale => allowedMarketIds.has(sale.marketId) && allowedClientIds.has(sale.clientId));
  const allowedInventory = inventory.filter(stock => allowedMarketIds.has(stock.marketId));
  const allowedMovements = movements.filter(movement => allowedMarketIds.has(movement.marketId));
  const marketMap = Object.fromEntries(allowedMarkets.map(market => [market.id, market]));
  const allowedTabs = [['inicio', 'Resumen'], ['mercados', 'Mercados'], ['clientes', 'Clientes'], ['usuarios', 'Usuarios'], ['ventas', 'Ventas'], ['inventario', 'Inventario']];
  const exportSales = () => {
    downloadCsv(`ventas-coordinador-${new Date().toISOString().slice(0, 10)}.csv`, ['Código', 'Fecha', 'Promotor', 'Rol', 'Cliente', 'Mercado', 'Unidades', 'Total'], allowedSales.map(sale => {
      const promoter = users.find(current => current.id === sale.promoterId);
      return [sale.id, formatDate(sale.date), promoter?.name || 'No identificado', sale.promoterRoleLabel || promoter?.roleLabel || sale.promoterRole || promoter?.role || '', allowedClients.find(client => client.id === sale.clientId)?.name || '', marketMap[sale.marketId]?.name || '', sale.units, formatSoles(sale.amountSoles)];
    }));
    notify('Reporte de ventas de las zonas descargado');
  };
  return <main className="workspace">
    <div className="page-head"><div><span className="eyebrow">PANEL DE COORDINACIÓN</span><h1>Hola, {user.name}</h1><p>Consulta la información de tus mercados y clientes asignados.</p></div></div>
    <nav className="tabs" aria-label="Módulos">{allowedTabs.map(([value, label]) => <button key={value} className={`tab ${tab === value ? 'active' : ''}`} onClick={() => setTab(value)} data-testid={`tab-coordinator-${value}`}>{label}</button>)}</nav>
    {tab === 'inicio' && <SalesDashboard sales={allowedSales} markets={allowedMarkets} users={allowedUsers} inventory={allowedInventory} movements={allowedMovements} onViewSales={() => setTab('ventas')} onExport={exportSales} />}
    {tab === 'mercados' && <section className="panel"><div className="panel-header"><div><h2>Mercados asignados</h2><p>Solo se muestran las zonas asociadas a este coordinador.</p></div></div><div className="panel-body"><div className="data-table"><div className="table-row header"><span>Mercado</span><span>Región</span><span>Departamento</span><span>Provincia</span><span>Distrito</span></div>{allowedMarkets.length ? allowedMarkets.map(market => <div className="table-row" key={market.id}><span><strong>{market.name}</strong><small>{market.id}</small></span><span>{market.region || '—'}</span><span>{market.department}</span><span>{market.province}</span><span>{market.district}</span></div>) : <Empty title="Sin mercados asignados" detail="Solicita al Analista una asignación de zonas." />}</div></div></section>}
    {tab === 'clientes' && <section className="panel"><div className="panel-header"><div><h2>Clientes asignados</h2><p>Clientes activos dentro de tus mercados.</p></div></div><div className="panel-body"><div className="record-list">{allowedClients.length ? allowedClients.map(client => <article className="record" key={client.id}><span className="record-icon"><Store /></span><div className="record-main"><strong>{client.name}</strong><small>{client.code} · Categoría: {client.category || 'SIN CATEGORÍA'}</small><em><MapPin /> {marketMap[client.marketId]?.name || 'Mercado'}</em></div><StatusPill status={client.status} /></article>) : <Empty title="Sin clientes asignados" detail="No hay clientes registrados en tus zonas." />}</div></div></section>}
     {tab === 'usuarios' && <section className="panel"><div className="panel-header"><div><h2>Usuarios de tus zonas</h2><p>Promotores y coordinadores vinculados a los mercados asignados.</p></div></div><div className="panel-body"><div className="record-list">{allowedUsers.length ? allowedUsers.map(current => <article className="record" key={current.id}><span className="record-icon"><UserRound /></span><div className="record-main"><strong>{current.name}</strong><small>DNI {current.dni} · {current.roleLabel || current.role}</small>{isPromoterRole(current.role) && <small>Stock personal: {userTastingStock(current)} degustación · {redemptionStockText(userRedemptionStock(current))}</small>}<em><MapPin /> {marketMap[current.marketId || '']?.name || 'Mercado asignado'}</em></div><StatusPill status={current.status} /></article>) : <Empty title="Sin usuarios asignados" detail="No hay usuarios vinculados a tus zonas." />}</div></div></section>}
    {tab === 'ventas' && <section className="panel"><div className="panel-header"><div><h2>Ventas de tus zonas</h2><p>Registros asociados a los mercados y clientes asignados.</p></div><Btn variant="outline" onClick={exportSales}><Download /> Descargar</Btn></div><div className="panel-body">{allowedSales.length ? <div className="record-list">{allowedSales.map(sale => { const promoter = users.find(current => current.id === sale.promoterId); return <article className="record" key={sale.id}><span className="record-icon"><ShoppingBag /></span><div className="record-main"><strong>{allowedClients.find(client => client.id === sale.clientId)?.name || 'Cliente'}</strong><small>{promoter?.name || 'Promotor no identificado'} · Rol: {sale.promoterRoleLabel || promoter?.roleLabel || sale.promoterRole || promoter?.role || '—'}</small><em>{marketMap[sale.marketId]?.name || 'Mercado'} · {sale.units} unidades · {formatSoles(sale.amountSoles)} · {formatDate(sale.date)}</em><div className="record-photos"><PhotoThumbnail label="Boleta" src={sale.receiptPhoto} />{sale.exchangePhoto && <PhotoThumbnail label="Canje" src={sale.exchangePhoto} />}</div></div><StatusPill status={sale.status} /></article>; })}</div> : <Empty title="Sin ventas en tus zonas" detail="Los registros aparecerán cuando se registren ventas." />}</div></section>}
     {tab === 'inventario' && <section className="panel"><div className="panel-header"><div><h2>Stock de promotores</h2><p>Consulta las existencias personales independientes de los promotores de tus zonas.</p></div></div><div className="panel-body">{allowedUsers.filter(current => isPromoterRole(current.role)).length ? <div className="stock-reconciliation-table inventory-stock-table"><div className="stock-reconciliation-row header"><span>Promotor</span><span>Degustación personal</span>{redemptionItems.map(item => <span key={item.id}>{item.label}</span>)}</div>{allowedUsers.filter(current => isPromoterRole(current.role)).map(current => <div className="stock-reconciliation-row" key={current.id}><div><strong>{current.name}</strong><small>DNI {current.dni} · {current.roleLabel || current.role}</small></div><b>{userTastingStock(current)}<small>panetones</small></b>{redemptionItems.map(item => <span key={item.id}>{userRedemptionStock(current)[item.id]}<small>unidades</small></span>)}</div>)}</div> : <Empty title="Sin promotores asignados" detail="No hay promotores vinculados a tus zonas." />}</div></section>}
  </main>;
}

 function AnalystApp({ user, markets, setMarkets, users, setUsers, clients, setClients, sales, setSales, attendance, setAttendance, inventory, movements, assignments, setAssignments, setInventory, setMovements, closures, setClosures, notify }: { user: AppUser; markets: Market[]; setMarkets: (value: Market[]) => void; users: AppUser[]; setUsers: (value: AppUser[]) => void; clients: Client[]; setClients: (value: Client[]) => void; sales: Sale[]; setSales: (value: Sale[]) => void; attendance: Attendance[]; setAttendance: (value: Attendance[]) => void; inventory: MarketInventory[]; movements: InventoryMovement[]; assignments: PromoterAssignment[]; setAssignments: (value: PromoterAssignment[]) => void; setInventory: (value: MarketInventory[]) => void; setMovements: (value: InventoryMovement[]) => void; closures: SessionClosure[]; setClosures: (value: SessionClosure[]) => void; notify: (message: string, error?: boolean) => void }) {
   const [tab, setTab] = useState('inicio'); const [query, setQuery] = useState(''); const [modal, setModal] = useState<'user' | 'client' | 'market' | 'canje' | 'degustacion' | null>(null); const [editingSale, setEditingSale] = useState<Sale | null>(null); const [syncing, setSyncing] = useState(false);
    const initialUsersRefresh = useRef(false);
    const activeMarkets = markets.filter(market => market.status === 'ACTIVO'); const visibleUsers = users.filter(current => !current.sheetArchived); const marketMap = Object.fromEntries(markets.map(market => [market.id, market])); const marketAssignmentSummary = useMemo(() => Object.fromEntries(markets.map(market => [market.id, { clients: clients.filter(client => client.marketId === market.id && client.status === 'ACTIVO').length, promoters: users.filter(current => { if (current.sheetArchived || !isPromoterRole(current.role) || current.status !== 'ACTIVO') return false; const assignment = assignments.find(item => assignmentMatchesUser(item, current)); return assignment ? assignment.marketIds.includes(market.id) : current.marketId === market.id; }).length }])), [markets, clients, users, assignments]); const today = new Date().toISOString().slice(0, 10);
    const marketOptions = activeMarkets.map(market => ({ value: market.id, label: `${market.name} · ${market.region || market.department} · ${market.district}` }));
    useEffect(() => {
      if (user.role === 'COORDINADOR' || initialUsersRefresh.current || !navigator.onLine) return;
      initialUsersRefresh.current = true;
      void importUsersFromSheet();
    }, [user.role]);
    if (user.role === 'COORDINADOR') return <CoordinatorApp user={user} markets={markets} users={users} clients={clients} sales={sales} inventory={inventory} movements={movements} assignments={assignments} notify={notify} />;
     const exportSales = () => { downloadCsv(`ventas-${today}.csv`, ['Código venta', 'Fecha', 'Promotor', 'Rol promotor', 'Cliente', 'Mercado', 'Región', 'Departamento', 'Provincia', 'Distrito', 'Tipo', 'Marca / producto', 'Unidades por marca', 'Monto unitario por marca (S/)', 'Unidades totales', 'Peso (kg)', 'Ingreso total (S/)', 'Bonificación', 'Número de canjes', 'Comentario', 'Stock degustación del promotor', 'Stock AVENA del promotor', 'Stock SPAGHETTI del promotor', 'Stock BATEA del promotor', 'Stock MANDIL del promotor', 'Estado'], sales.map(sale => { const breakdown = saleExportBreakdown(sale); const promoter = users.find(user => user.id === sale.promoterId); const stock = userRedemptionStock(promoter || { id: '', dni: '', name: '', role: 'PROMOTOR', status: 'ACTIVO' }); const location = saleMarketLocation(sale, markets); return [sale.id, formatDate(sale.date), promoter?.name || 'PROMOTOR NO IDENTIFICADO', sale.promoterRoleLabel || promoter?.roleLabel || sale.promoterRole || promoter?.role || 'ROL NO IDENTIFICADO', clients.find(client => client.id === sale.clientId)?.name, marketMap[sale.marketId]?.name, location.region, location.department, location.province, location.district, sale.mode, breakdown.map(item => item.label).join(' | '), breakdown.map(item => item.units).join(' | '), breakdown.map(item => item.unitPrice.toFixed(2)).join(' | '), sale.units, (sale.weightKg ?? 0).toFixed(3), (sale.amountSoles ?? 0).toFixed(2), sale.bonus || 'Sin canje', sale.redemptionCount ?? (sale.bonus ? 1 : 0), sale.comment || '', userTastingStock(promoter || { id: '', dni: '', name: '', role: 'PROMOTOR', status: 'ACTIVO' }), stock.AVENA, stock.SPAGHETTI, stock.BATEA, stock.MANDIL, sale.status]; })); notify('Reporte de ventas con ubicación y stock por promotor descargado'); };
    const exportClients = () => { downloadCsv(`clientes-${today}.csv`, ['Código', 'Cliente', 'Celular', 'Categoría', 'Mercado', 'Distrito', 'Estado'], clients.map(client => [client.code, client.name, client.phone || '', client.category || '', marketMap[client.marketId]?.name, marketMap[client.marketId]?.district, client.status])); notify('Reporte de clientes descargado'); };
    const exportUsers = () => { downloadCsv(`usuarios-${today}.csv`, ['ID', 'DNI', 'Nombre', 'Rol', 'Mercado', 'Stock degustación', 'Stock AVENA', 'Stock SPAGHETTI', 'Stock BATEA', 'Stock MANDIL', 'Estado'], visibleUsers.map(user => { const stock = userRedemptionStock(user); return [user.id, user.dni, user.name, user.roleLabel || user.role, marketMap[user.marketId || '']?.name || '', userTastingStock(user), stock.AVENA, stock.SPAGHETTI, stock.BATEA, stock.MANDIL, user.status]; })); notify('Reporte de usuarios descargado'); };
     const exportAttendance = () => { downloadCsv(`marcaciones-${today}.csv`, ['Código', 'Tipo', 'Fecha', 'Promotor', 'Rol promotor', 'Tienda', 'Departamento', 'Foto', 'Estado'], attendance.map(item => { const promoter = users.find(user => user.id === item.promoterId); const market = marketMap[item.marketId]; return [item.id, item.type, formatDate(item.date), promoter?.name || 'PROMOTOR NO IDENTIFICADO', item.promoterRoleLabel || promoter?.roleLabel || item.promoterRole || promoter?.role || 'ROL NO IDENTIFICADO', clients.find(client => client.id === item.clientId)?.name, market?.department || 'DEPARTAMENTO NO IDENTIFICADO', item.photo, item.status]; })); notify('Marcaciones descargadas'); };
       const exportSummary = () => { const summaryRows = aggregateSalesByRegionCity(sales, markets); downloadCsv(`resumen-${today}.csv`, ['Región', 'Ciudad', 'Ventas (S/)', 'Ventas (unidades)', 'Venta (kg)', 'Pedidos'], summaryRows.map(row => [row.region, row.city, row.soles.toFixed(2), row.units, row.kilos.toFixed(3), row.salesCount])); notify('Resumen por región y ciudad descargado'); };
  const persistImportedSnapshot = async (snapshot: Partial<CloudSnapshot>) => {
    let revision = localStorage.getItem(CATALOG_REVISION_STORE_KEY) || undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(APP_STORAGE_SYNC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot, catalogRevision: revision }),
      });
      const payload = await response.json() as { message?: string; catalogRevision?: string | null };
      if (!response.ok) throw new Error(payload.message || 'No se pudo guardar la actualización');
      if (payload.catalogRevision) {
        localStorage.setItem(CATALOG_REVISION_STORE_KEY, payload.catalogRevision);
        if (payload.catalogRevision !== revision && attempt === 0) {
          revision = payload.catalogRevision;
          continue;
        }
      }
      return;
    }
  };
  const importMarkets = async () => {
    setSyncing(true);
    try {
      const response = await fetch(MARKETS_SHEET); if (!response.ok) throw new Error('No se pudo conectar');
      const rows = parseCsvText(await response.text()); if (rows.length < 2) throw new Error('La hoja no contiene encabezados y filas de mercados'); const headers = rows[0].map(normalizeCsvHeader); const column = (aliases: string[], fallback: number) => aliases.map(normalizeCsvHeader).map(alias => headers.indexOf(alias)).find(index => index >= 0) ?? fallback; const idIndex = column(['idmerc', 'id', 'codigo'], 0); const departmentIndex = column(['departamento'], 1); const provinceIndex = column(['provincia', 'ciudad'], 2); const districtIndex = column(['distrito'], 3); const nameIndex = column(['nombredelmercado', 'mercado', 'nombre'], 4); const statusIndex = column(['estado', 'status'], 5); const regionIndex = column(['region'], 6); const lookupDepartmentIndex = headers.lastIndexOf('departamento'); const lookupRegionIndex = headers.lastIndexOf('region'); const hasRegionLookup = lookupDepartmentIndex >= 0 && lookupRegionIndex >= 0 && (lookupDepartmentIndex !== departmentIndex || lookupRegionIndex !== regionIndex); const regionLookup = new Map<string, string>(); if (hasRegionLookup) rows.slice(1).forEach(cells => { const lookupDepartment = (cells[lookupDepartmentIndex] || '').trim(); const lookupRegion = (cells[lookupRegionIndex] || '').trim(); if (lookupDepartment && lookupRegion && normalizeCsvHeader(lookupDepartment) !== 'departamento') regionLookup.set(normalizeCsvHeader(lookupDepartment), lookupRegion.toUpperCase()); }); const aliases = new Map<string, string>(); const imported: Market[] = rows.slice(1).map((cells, index) => { const rawName = (cells[nameIndex] || '').trim(); if (!rawName) return null; const sourceId = (cells[idIndex] || `SHEET-${index + 1}`).trim(); const department = (cells[departmentIndex] || 'LIMA').trim().toUpperCase(); const province = (cells[provinceIndex] || 'LIMA').trim().toUpperCase(); const district = (cells[districtIndex] || 'LIMA').trim().toUpperCase(); const name = rawName.toUpperCase(); const rawRegion = (cells[regionIndex] || '').trim(); const normalizedRegion = normalizeCsvHeader(rawRegion); const region = rawRegion && !['activo', 'inactivo', 'region'].includes(normalizedRegion) ? rawRegion.toUpperCase() : regionLookup.get(normalizeCsvHeader(department)) || department; const existing = markets.find(market => market.id === sourceId || market.id === `SHEET-${index + 1}` || (market.name === name && market.district === district && market.province === province)); if (existing && existing.id !== sourceId) aliases.set(existing.id, sourceId); return { id: sourceId, department, region, province, district, name, status: csvStatus(cells[statusIndex] || 'ACTIVO') }; }).filter(Boolean) as Market[];
      if (!imported.length) throw new Error('La hoja no contiene mercados');
       const nextMarkets = [...markets];
       imported.forEach(importedMarket => {
         const aliasedId = Array.from(aliases.entries()).find(([, sourceId]) => sourceId === importedMarket.id)?.[0];
         const index = nextMarkets.findIndex(market => market.id === importedMarket.id || market.id === aliasedId);
         if (index >= 0) nextMarkets[index] = { ...nextMarkets[index], ...importedMarket, id: nextMarkets[index].id };
         else nextMarkets.push(importedMarket);
       });
       setMarkets(nextMarkets); writeStore('bt-markets', nextMarkets); await persistImportedSnapshot({ markets: nextMarkets }); notify(`${imported.length} mercados actualizados y guardados sin borrar información operativa`);
    } catch { notify('No se pudo importar la hoja. Los mercados locales siguen disponibles.', true); } finally { setSyncing(false); }
  };
  const mergeImportedUsers = async (records: Record<string, string>[], authoritative = false) => {
    const imported: AppUser[] = []; let skipped = 0; const importId = Date.now();
    records.forEach((record, index) => {
       const importedUser = importedUserFromRecord(record, index, markets);
       if (!importedUser) { skipped += 1; return; }
       imported.push({ ...importedUser, id: csvField(record, ['id', 'codigo', 'idusuario', 'idpromotor']) || `USR-IMP-${importId}-${index + 1}` });
    });
    if (!imported.length) throw new Error('No se encontraron filas válidas. Revisa DNI, nombre, rol y mercado para promotores.');
    if (authoritative && skipped) throw new Error(`La hoja tiene ${skipped} fila${skipped === 1 ? '' : 's'} inválida${skipped === 1 ? '' : 's'}. No se retiró ningún usuario.`);
    const repeatedDnis = imported.filter((item, index) => imported.findIndex(candidate => candidate.dni === item.dni) !== index).map(item => item.dni);
    if (repeatedDnis.length) throw new Error('La hoja contiene DNI repetidos. No se actualizó ningún usuario.');
    const next = [...users]; imported.forEach(item => { const index = next.findIndex(current => current.dni === item.dni); if (index >= 0) { const current = next[index]; next[index] = { ...current, ...item, id: current.id, ...(item.redemptionStock ? { redemptionStock: { ...userRedemptionStock(current), ...item.redemptionStock } } : {}) }; } else next.push(item); }); setUsers(next); writeStore('bt-users', next); await persistImportedSnapshot({ users: next });
    return `${imported.length} usuarios importados${skipped ? ` · ${skipped} filas omitidas` : ''}`;
  };
  const importUsers = async (file: File) => {
    setSyncing(true);
    try { notify(await mergeImportedUsers(parseCsvRecords(await file.text()))); } catch (error) { notify(`No se pudo importar usuarios: ${error instanceof Error ? error.message : 'formato inválido'}`, true); } finally { setSyncing(false); }
  };
  async function importUsersFromSheet() {
    setSyncing(true);
    try {
      const records = await fetchGoogleSheetRecords(USERS_SHEET_ID);
      const imported: AppUser[] = []; let skipped = 0; const importId = Date.now();
      records.forEach((record, index) => {
        const importedUser = importedUserFromRecord(record, index, markets);
        if (!importedUser) { skipped += 1; return; }
        const current = users.find(item => item.dni === importedUser.dni);
        imported.push({
          ...current,
          ...importedUser,
          id: current?.id || csvField(record, ['id', 'codigo', 'idusuario', 'idpromotor']) || `USR-IMP-${importId}-${index + 1}`,
          ...(importedUser.redemptionStock ? { redemptionStock: { ...userRedemptionStock(current || importedUser), ...importedUser.redemptionStock } } : {}),
          sheetArchived: false,
        });
      });
      if (!imported.length) throw new Error('No se encontraron filas válidas. No se retiró ningún usuario.');
      if (skipped) throw new Error(`La hoja tiene ${skipped} fila${skipped === 1 ? '' : 's'} inválida${skipped === 1 ? '' : 's'}. No se retiró ningún usuario.`);
      if (new Set(imported.map(item => item.dni)).size !== imported.length) throw new Error('La hoja contiene DNI repetidos. No se retiró ningún usuario.');
      const response = await fetch(`${APP_STORAGE_ADMIN}/users/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(localStorage.getItem(CATALOG_REVISION_STORE_KEY) ? { 'X-Catalog-Revision': localStorage.getItem(CATALOG_REVISION_STORE_KEY) as string } : {}) },
        body: JSON.stringify({ users: imported }),
      });
      const payload = await response.json() as { message?: string; snapshot?: Partial<CloudSnapshot> };
      if (!response.ok) throw new Error(payload.message || 'No se pudo guardar la actualización');
      const cloudUsers = Array.isArray(payload.snapshot?.users) ? payload.snapshot.users : imported;
      const nextUsers = cloudUsers.map(cloudUser => ({ ...cloudUser, password: users.find(item => item.dni === cloudUser.dni)?.password }));
      setUsers(nextUsers); writeStore('bt-users', nextUsers);
      const removed = nextUsers.filter(item => item.sheetArchived).length;
      notify(`${imported.length} usuarios vigentes sincronizados${removed ? ` · ${removed} persona${removed === 1 ? '' : 's'} retirada${removed === 1 ? '' : 's'} de la hoja archivada${removed === 1 ? '' : 's'}` : ''}`);
    } catch (error) { notify(`No se pudo actualizar usuarios desde Google Sheets: ${error instanceof Error ? error.message : 'hoja no disponible'}`, true); } finally { setSyncing(false); }
  }
  const mergeImportedClients = async (records: Record<string, string>[]) => {
    const imported: Client[] = []; let skipped = 0; const importId = Date.now();
    records.forEach((record, index) => {
      const name = csvField(record, ['cliente', 'nombre', 'nombrecliente', 'tienda', 'razonsocial', 'nombrecomercial']); const marketId = csvMarketId(csvField(record, ['marketid', 'idmercado', 'idmerc', 'mercado', 'market', 'nombremercado']), markets);
      if (!name || !marketId) { skipped += 1; return; }
      const code = csvField(record, ['codigo', 'code', 'codigocliente']) || `CLI-${String(clients.length + index + 1).padStart(6, '0')}`;
      const rawCategory = csvField(record, ['categoria', 'category']).trim().toUpperCase();
      imported.push({ id: csvField(record, ['id', 'idcliente']) || code, code, name, phone: csvField(record, ['celular', 'telefono', 'phone', 'movil']) || undefined, category: rawCategory === 'CONFETI' ? 'CONFETI' : 'MIXTO', marketId, status: csvStatus(csvField(record, ['estado', 'status'])) });
    });
    if (!imported.length) throw new Error('No se encontraron filas válidas. Revisa cliente y mercado.');
    const next = [...clients]; imported.forEach(item => { const index = next.findIndex(current => current.id === item.id || current.code === item.code); if (index >= 0) next[index] = { ...next[index], ...item }; else next.push(item); }); setClients(next); writeStore('bt-clients', next); await persistImportedSnapshot({ clients: next });
    return `${imported.length} clientes importados${skipped ? ` · ${skipped} filas omitidas` : ''}`;
  };
  const importClients = async (file: File) => {
    setSyncing(true);
    try { notify(await mergeImportedClients(parseCsvRecords(await file.text()))); } catch (error) { notify(`No se pudo importar clientes: ${error instanceof Error ? error.message : 'formato inválido'}`, true); } finally { setSyncing(false); }
  };
  const importClientsFromSheet = async () => {
    setSyncing(true);
    try { notify(await mergeImportedClients(await fetchGoogleSheetRecords(CLIENTS_SHEET_ID))); } catch (error) { notify(`No se pudo actualizar clientes desde Google Sheets: ${error instanceof Error ? error.message : 'hoja no disponible'}`, true); } finally { setSyncing(false); }
  };
  const importInventory = async (file: File) => {
    setSyncing(true);
    try {
      const records = parseCsvRecords(await file.text());
      const movementRecords = records.filter(record => csvField(record, ['tipo', 'tipomovimiento', 'movimiento']));
      if (movementRecords.length) {
        let importedCount = 0; let skipped = 0;
        for (const [index, record] of movementRecords.entries()) {
          const marketId = csvMarketId(csvField(record, ['marketid', 'idmercado', 'mercado', 'market']), markets);
          const type = normalizeCsvHeader(csvField(record, ['tipo', 'tipomovimiento', 'movimiento']));
          const quantity = Number(csvField(record, ['cantidad', 'unidades', 'stock']).replace(',', '.'));
          if (!marketId || !Number.isInteger(quantity) || quantity <= 0) { skipped += 1; continue; }
          if (type.includes('degust')) {
            await adminRequest('/degustaciones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ degustacion: { id: `DEG-IMPORT-${Date.now()}-${index}`, marketId, kind: 'AJUSTE_DEGUSTACION', degustacionProductId: 'PANETON', degustacionProductLabel: 'Panetón', quantity, actorId: user.id, actorName: user.name, date: new Date().toISOString(), status: 'PENDIENTE' } }) });
            importedCount += 1;
            continue;
          }
          if (type.includes('canje')) {
            const rawProduct = csvField(record, ['producto', 'canje', 'tipocanje', 'productoid']);
            const product = activeCanjeProducts().find(item => normalizeCsvHeader(item.id) === normalizeCsvHeader(rawProduct) || normalizeCsvHeader(item.label) === normalizeCsvHeader(rawProduct));
            if (!product) { skipped += 1; continue; }
            await adminRequest('/canjes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ canje: { id: `CANJE-IMPORT-${Date.now()}-${index}`, marketId, kind: 'AJUSTE_CANJES', canjeProductId: product.id, canjeProductLabel: product.label, canjeComponents: product.components, quantity, actorId: user.id, actorName: user.name, date: new Date().toISOString(), status: 'PENDIENTE' } }) });
            importedCount += 1;
            continue;
          }
          skipped += 1;
        }
        if (!importedCount) throw new Error('No se encontraron filas válidas. Usa Tipo DEGUSTACION o CANJE y un producto válido.');
        notify(`${importedCount} abastecimientos masivos importados${skipped ? ` · ${skipped} filas omitidas` : ''}`);
        return;
      }
      const imported: { marketId: string; stock: MarketInventory }[] = []; let skipped = 0; const importId = Date.now();
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
        const hasTastingLedger = movements.some(movement => movement.marketId === marketId && (movement.kind === 'AJUSTE_DEGUSTACION' || movement.kind === 'DEGUSTACION'));
        addMovement('AJUSTE_DEGUSTACION', stock.tastingStock - (hasTastingLedger ? current.tastingStock : 0));
        redemptionItems.forEach(item => {
          const hasItemLedger = movements.some(movement => movement.marketId === marketId && (movement.kind === 'AJUSTE_CANJES' || movement.kind === 'CANJE') && (movement.itemId === item.id || signedMovementComponentQuantity(movement, item.id) !== 0));
          addMovement('AJUSTE_CANJES', stock.redemptionStock[item.id] - (hasItemLedger ? current.redemptionStock[item.id] : 0), item.id);
        });
      });
      setInventory(nextInventory); setMovements(newMovements); writeStore('bt-inventory', nextInventory); writeStore('bt-inventory-movements', newMovements); await persistImportedSnapshot({ inventory: nextInventory, movements: newMovements }); notify(`${imported.length} stocks de canjes y degustación importados y guardados${skipped ? ` · ${skipped} filas omitidas` : ''}`);
    } catch (error) { notify(`No se pudo importar stock: ${error instanceof Error ? error.message : 'formato inválido'}`, true); } finally { setSyncing(false); }
  };
  const downloadUsersExample = () => {
    const market = activeMarkets[0] || markets[0];
     downloadCsv('ejemplo-usuarios.csv', ['DNI', 'Nombre', 'Rol', 'Mercado', 'Estado'], [['87654322', 'Promotor Ejemplo', 'PROMOTOR', market?.name || 'MERCADO MODELO', 'ACTIVO']]);
    notify('Ejemplo de usuarios descargado');
  };
  const downloadClientsExample = () => {
    const market = activeMarkets[0] || markets[0];
    downloadCsv('ejemplo-clientes.csv', ['Código', 'Cliente', 'Celular', 'Categoría', 'Mercado', 'Estado'], [['CLI-EJEMPLO-001', 'Bodega Ejemplo', '999888777', 'MIXTO', market?.name || 'MERCADO MODELO', 'ACTIVO']]);
    notify('Ejemplo de clientes descargado');
  };
  const downloadInventoryExample = () => {
    const market = activeMarkets[0] || markets[0];
    downloadCsv('ejemplo-importacion-canjes-degustaciones.csv', ['Mercado', 'Tipo', 'Producto', 'Cantidad'], [
      [market?.name || 'MERCADO MODELO', 'DEGUSTACION', 'PANETON', 20],
      [market?.name || 'MERCADO MODELO', 'CANJE', 'CANJE_AVENA_2', 10],
    ]);
    notify('Ejemplo de canjes y degustación descargado');
  };
    const applyAdminSnapshot = (snapshot: Partial<CloudSnapshot> | undefined, removedSaleId?: string) => {
     if (!snapshot) return;
      if (Array.isArray(snapshot.markets)) { setMarkets(snapshot.markets); writeStore('bt-markets', snapshot.markets); }
     if (Array.isArray(snapshot.users)) {
       const localUsers = users;
        const nextUsers = snapshot.users.map(cloudUser => {
         const localUser = localUsers.find(item => item.id === cloudUser.id || item.dni === cloudUser.dni);
         return { ...cloudUser, password: localUser?.password };
        });
        setUsers(nextUsers); writeStore('bt-users', nextUsers);
     }
      if (Array.isArray(snapshot.clients)) { setClients(snapshot.clients); writeStore('bt-clients', snapshot.clients); }
       if (Array.isArray(snapshot.sales)) {
         const nextSales = mergeSales(sales, snapshot.sales).filter(sale => sale.id !== removedSaleId);
         setSales(nextSales);
         writeStore('bt-sales', nextSales);
       }
      if (Array.isArray(snapshot.attendance)) { setAttendance(snapshot.attendance); writeStore('bt-attendance', snapshot.attendance); }
      if (Array.isArray(snapshot.inventory)) { const nextInventory = reconcileInventory(snapshot.inventory, Array.isArray(snapshot.movements) ? snapshot.movements : movements); setInventory(nextInventory); writeStore('bt-inventory', nextInventory); }
      if (Array.isArray(snapshot.movements)) { setMovements(snapshot.movements); writeStore('bt-inventory-movements', snapshot.movements); }
      if (Array.isArray(snapshot.assignments)) { setAssignments(snapshot.assignments); writeStore('bt-promoter-assignments', snapshot.assignments); }
      if (Array.isArray(snapshot.closures)) { setClosures(snapshot.closures); writeStore('bt-session-closures', snapshot.closures); }
   };
   const adminRequest = async (path: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const catalogRevision = localStorage.getItem(CATALOG_REVISION_STORE_KEY);
      if (catalogRevision) headers.set('X-Catalog-Revision', catalogRevision);
      const response = await fetch(`${APP_STORAGE_ADMIN}${path}`, { ...init, headers });
     const payload = await response.json() as { message?: string; catalogRevision?: string | null; snapshot?: Partial<CloudSnapshot> };
     if (!response.ok) throw new Error(payload.message || 'No se pudo guardar el cambio');
     if (payload.catalogRevision) localStorage.setItem(CATALOG_REVISION_STORE_KEY, payload.catalogRevision);
      const saleDeletePrefix = '/sales/';
      const removedSaleId = init?.method === 'DELETE' && path.startsWith(saleDeletePrefix)
        ? decodeURIComponent(path.slice(saleDeletePrefix.length))
        : undefined;
      applyAdminSnapshot(payload.snapshot, removedSaleId);
     return payload;
   };
   const saveUser = (newUser: AppUser) => { const next = [...users, newUser]; setUsers(next); writeStore('bt-users', next); setModal(null); notify('Usuario creado con clave temporal'); };
   const saveMarket = async (market: Market) => { try { await adminRequest('/markets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ market }) }); writeStore('bt-markets', [...markets, market]); setModal(null); notify('Mercado creado como ACTIVO'); } catch (error) { notify(error instanceof Error ? error.message : 'No se pudo crear el mercado', true); } };
   const deleteMarket = async (market: Market) => { if (!window.confirm(`¿Eliminar definitivamente ${market.name} y sus clientes asociados?`)) return; try { await adminRequest(`/markets/${encodeURIComponent(market.id)}`, { method: 'DELETE' }); notify(`Mercado eliminado: ${market.name}`); } catch (error) { notify(error instanceof Error ? error.message : 'No se pudo eliminar el mercado', true); } };
   const saveClient = async (client: Client) => { try { await adminRequest('/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client }) }); notify('Cliente creado como ACTIVO'); } catch (error) { notify(error instanceof Error ? error.message : 'No se pudo crear el cliente', true); } };
   const deleteClient = async (client: Client) => { if (!window.confirm(`¿Eliminar definitivamente al cliente ${client.name}?`)) return; try { await adminRequest(`/clients/${encodeURIComponent(client.id)}`, { method: 'DELETE' }); notify(`Cliente eliminado: ${client.name}`); } catch (error) { notify(error instanceof Error ? error.message : 'No se pudo eliminar el cliente', true); } };
     const saveSaleEdit = async (sale: Sale, photos: { receipt: File | null; exchange: File | null }) => { try { await adminRequest(`/sales/${encodeURIComponent(sale.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sale }) }); const client = clients.find(item => item.id === sale.clientId); const market = markets.find(item => item.id === sale.marketId); const context = { clientName: client?.name || client?.code || 'CLIENTE NO IDENTIFICADO', marketName: market?.name || 'MERCADO NO IDENTIFICADO', recordType: 'VENTA EDITADA' }; const queueEditedPhoto = (file: File, field: 'receiptPhoto' | 'exchangePhoto') => void queuePhotoUpload(file, 'sale', sale.id, field, context).catch(() => notify('La venta se actualizó, pero no se pudo guardar la foto en la cola del dispositivo.', true)); if (photos.receipt) queueEditedPhoto(photos.receipt, 'receiptPhoto'); if (sale.bonus && photos.exchange) queueEditedPhoto(photos.exchange, 'exchangePhoto'); notify(`Venta actualizada: ${sale.id}. Las fotos nuevas quedaron en cola de subida.`); return true; } catch (error) { notify(error instanceof Error ? error.message : 'No se pudo editar la venta', true); return false; } };
    const deleteSale = async (sale: Sale) => { if (!window.confirm(`¿Eliminar definitivamente la venta ${sale.id}? Esta acción también devolverá al inventario los canjes asociados y no se puede deshacer.`)) return; try { await adminRequest(`/sales/${encodeURIComponent(sale.id)}`, { method: 'DELETE' }); if (editingSale?.id === sale.id) setEditingSale(null); notify(`Venta eliminada: ${sale.id}`); } catch (error) { notify(error instanceof Error ? error.message : 'No se pudo eliminar la venta', true); } };
    const saveCanje = async (canje: InventoryMovement) => { try { await adminRequest('/canjes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ canje }) }); notify('Stock personal cargado correctamente'); } catch (error) { notify(error instanceof Error ? error.message : 'No se pudo cargar el stock', true); } };
   const saveDegustacion = async (degustacion: InventoryMovement) => { try { await adminRequest('/degustaciones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ degustacion }) }); notify('Degustación registrada e inventario actualizado'); } catch (error) { notify(error instanceof Error ? error.message : 'No se pudo crear la degustación', true); } };
   const deleteCanje = async (canje: AdminCanje) => { if (!window.confirm('¿Eliminar definitivamente este canje?')) return; try { await adminRequest(`/canjes/${canje.source}/${encodeURIComponent(canje.canjeId)}`, { method: 'DELETE' }); notify('Canje eliminado'); } catch (error) { notify(error instanceof Error ? error.message : 'No se pudo eliminar el canje', true); } };
     const deleteDegustacion = async (degustacion: AdminDegustacion) => { if (!window.confirm('¿Eliminar definitivamente esta degustación? El stock se revertirá.')) return; try { await adminRequest(`/degustaciones/${degustacion.source}/${encodeURIComponent(degustacion.degustacionId)}`, { method: 'DELETE' }); notify('Degustación eliminada e inventario revertido'); } catch (error) { notify(error instanceof Error ? error.message : 'No se pudo eliminar la degustación', true); } };
     const cleanupCatalogs = async () => { if (!window.confirm('Se eliminarán definitivamente todos los mercados, clientes, ventas, marcaciones, inventario, canjes, asignaciones, cierres y usuarios que no sean ANALISTA. Los precios y el usuario ANALISTA se conservarán. ¿Empezar desde cero?')) return; try { await adminRequest('/cleanup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmation: 'LIMPIAR_MERCADOS_CLIENTES_CANJES' }) }); localStorage.removeItem(DEFAULT_STOCK_SEED_KEY); notify('Marcaciones, inventario y demás datos operativos eliminados.'); } catch (error) { notify(error instanceof Error ? error.message : 'No se pudo limpiar la información', true); } };
  const filteredClients = clients.filter(client => `${client.name} ${client.code} ${marketMap[client.marketId]?.name || ''}`.toLowerCase().includes(query.toLowerCase()));
   const adminCanjes: AdminCanje[] = [
      ...movements.filter(movement => movement.kind === 'CANJE' || (movement.kind === 'AJUSTE_CANJES' && (movement.canjeProductId || (movement.promoterId && movement.itemId)))).map(movement => ({ ...movement, source: 'movement' as const, canjeId: movement.id })),
     ...sales.filter(sale => (sale.mode as string) === 'CANJE').map(sale => ({ id: sale.id, marketId: sale.marketId, kind: 'CANJE' as const, itemId: undefined, quantity: sale.redemptionCount || 1, actorId: sale.promoterId, actorName: users.find(current => current.id === sale.promoterId)?.name || 'Promotor', date: sale.date, status: sale.status, source: 'sale' as const, canjeId: sale.id, sale })),
   ];
   const adminDegustaciones: AdminDegustacion[] = movements.filter(movement => movement.kind === 'AJUSTE_DEGUSTACION' && movement.degustacionProductId).map(movement => ({ ...movement, source: 'movement' as const, degustacionId: movement.id }));
     const tabs = [['inicio', 'Resumen'], ['mercados', 'Mercados'], ['usuarios', 'Usuarios'], ['clientes', 'Clientes'], ['canjes', 'Canjes'], ['degustacion', 'Degustación'], ['asignaciones', 'Asignaciones'], ['ventas', 'Ventas'], ['marcaciones', 'Marcaciones'], ['inventario', 'Inventario']];
  return <main className="workspace">
    <div className="page-head"><div><span className="eyebrow">PANEL DE CONTROL</span><h1>Hola, analista</h1><p>Supervisa el pulso de la campaña desde un solo lugar.</p></div></div>
    <nav className="tabs" aria-label="Módulos">{tabs.map(([value, label]) => <button key={value} className={`tab ${tab === value ? 'active' : ''}`} onClick={() => setTab(value)} data-testid={`tab-${value}`}>{label}</button>)}</nav>
      {tab === 'inicio' && <SalesDashboard sales={sales} markets={markets} users={users} inventory={inventory} movements={movements} onViewSales={() => setTab('ventas')} onExport={exportSummary} />}
      {tab === 'mercados' && <section className="panel"><div className="panel-header"><div><h2>Mercados</h2><p>Catálogo sincronizado con Google Sheets o ingresado manualmente.</p></div><div className="panel-actions"><Btn variant="outline" onClick={importMarkets} disabled={syncing} testId="button-refresh-markets"><RefreshCw /> Actualizar hoja</Btn><Btn onClick={() => setModal('market')} testId="button-new-market"><Plus /> Nuevo mercado</Btn></div></div><div className="panel-body"><div className="data-table"><div className="table-row header"><span>Mercado</span><span>Región</span><span>Departamento</span><span>Provincia</span><span>Distrito</span><span>Clientes</span><span>Promotores</span><span>Acciones</span></div>{markets.map(market => <div className="table-row" key={market.id}><span><strong>{market.name}</strong><small>{market.id}</small></span><span>{market.region || '—'}</span><span>{market.department}</span><span>{market.province}</span><span>{market.district}</span><span>{marketAssignmentSummary[market.id]?.clients || 0}</span><span>{marketAssignmentSummary[market.id]?.promoters || 0}</span><Btn variant="danger" onClick={() => deleteMarket(market)} testId={`button-delete-market-${market.id}`}><Trash2 /></Btn></div>)}</div></div></section>}
        {tab === 'usuarios' && <section className="panel"><div className="panel-header"><div><h2>Usuarios</h2><p>Sincroniza la hoja de Google Sheets o importa un CSV.</p></div><div className="panel-actions"><Btn variant="outline" onClick={importUsersFromSheet} disabled={syncing} testId="button-refresh-users"><RefreshCw /> Actualizar hoja</Btn><CsvImportButton label="Importar usuarios" onImport={importUsers} testId="button-import-users" /><CsvExampleButton onDownload={downloadUsersExample} testId="button-example-users" /><Btn onClick={() => setModal('user')} testId="button-new-user"><Plus /> Nuevo usuario</Btn></div></div><div className="panel-body"><div className="import-hint">Google Sheets define identidad, acceso, rol y estado. El stock se carga exclusivamente desde Canjes y no se modifica al sincronizar usuarios.</div><div className="record-list">{visibleUsers.map(user => <article className="record" key={user.id}><span className="record-icon"><UserRound /></span><div className="record-main"><strong>{user.name}</strong><small>DNI {user.dni} · {user.role}</small>{isPromoterRole(user.role) && <small>Stock personal: {userTastingStock(user)} degustación · {redemptionStockText(userRedemptionStock(user))}</small>}{user.marketId && <em><MapPin /> {marketMap[user.marketId]?.name || 'Mercado asignado'}</em>}{user.clientId && <em><Store /> Cliente vinculado</em>}</div><StatusPill status={user.status} /></article>)}</div></div></section>}
      {tab === 'clientes' && <section className="panel"><div className="panel-header"><div><h2>Clientes</h2><p>Importa, ingresa y elimina clientes manualmente.</p></div><div className="panel-actions"><Btn variant="outline" onClick={importClientsFromSheet} disabled={syncing} testId="button-refresh-clients"><RefreshCw /> Actualizar hoja</Btn><CsvImportButton label="Importar clientes" onImport={importClients} testId="button-import-clients" /><CsvExampleButton onDownload={downloadClientsExample} testId="button-example-clients" /><Btn onClick={() => setModal('client')} testId="button-new-client"><Plus /> Nuevo cliente</Btn></div></div><div className="panel-body"><div className="import-hint">Origen conectado: Google Sheets · También puedes crear y eliminar desde esta pantalla.</div><div className="search-row"><div className="search-wrap"><Search /><Input value={query} onChange={setQuery} placeholder="Buscar cliente, código o mercado" testId="input-search-clients" /></div></div><div className="record-list">{filteredClients.length ? filteredClients.map(client => <article className="record" key={client.id}><span className="record-icon"><Store /></span><div className="record-main"><strong>{client.name}</strong><small>{client.code}{client.phone ? ` · ${client.phone}` : ''} · Categoría: {client.category || 'SIN CATEGORÍA'}</small><em><MapPin /> {marketMap[client.marketId]?.name}</em></div><StatusPill status={client.status} /><Btn variant="danger" onClick={() => deleteClient(client)} testId={`button-delete-client-${client.id}`}><Trash2 /></Btn></article>) : <Empty title="No hay coincidencias" detail="Prueba con otro nombre, código o mercado." />}</div></div></section>}
        {tab === 'canjes' && <AdminCanjesModule canjes={adminCanjes} marketMap={marketMap} users={users} onCreate={() => setModal('canje')} onDelete={deleteCanje} onCleanup={cleanupCatalogs} canCleanup={user.role === 'ADMIN'} notify={notify} />}
      {tab === 'degustacion' && <AdminDegustacionesModule degustaciones={adminDegustaciones} marketMap={marketMap} onCreate={() => setModal('degustacion')} onDelete={deleteDegustacion} />}
      {tab === 'asignaciones' && <AssignmentModule markets={markets} users={users} clients={clients} assignments={assignments} setAssignments={setAssignments} setUsers={setUsers} notify={notify} />}
        {tab === 'ventas' && <section className="panel"><div className="panel-header"><div><h2>Ventas y evidencias</h2><p>Seguimiento de registros por promotor, ubicación y stock personal actualizado.</p></div><Btn variant="outline" onClick={exportSales}><Download /> Descargar</Btn></div><div className="panel-body">{sales.length ? <div className="record-list">{sales.map(sale => { const promoter = users.find(item => item.id === sale.promoterId); const stock = userRedemptionStock(promoter || { id: '', dni: '', name: '', role: 'PROMOTOR', status: 'ACTIVO' }); return <article className="record sale-admin-record" key={sale.id}><span className="record-icon"><ShoppingBag /></span><div className="record-main"><strong>{clients.find(client => client.id === sale.clientId)?.name || 'Tienda'}</strong><small>Promotor: {promoter?.name || 'No identificado'} · DNI {promoter?.dni || '—'} · Rol: {sale.promoterRoleLabel || promoter?.roleLabel || sale.promoterRole || promoter?.role || 'Rol no identificado'} · {marketMap[sale.marketId]?.name || 'Mercado no identificado'}</small><small><MapPin /> {saleMarketLocationText(sale, markets)}</small><small>{sale.id} · {sale.units} unidades · {sale.mode} · {formatSoles(sale.amountSoles)}</small><em><Gift /> {sale.bonus ? `${sale.redemptionCount ?? 1} canje${(sale.redemptionCount ?? 1) === 1 ? '' : 's'} · ${sale.bonus}` : 'Sin canje'} · {formatDate(sale.date)}</em><em><PackageCheck /> Stock del promotor: {userTastingStock(promoter || { id: '', dni: '', name: '', role: 'PROMOTOR', status: 'ACTIVO' })} degustación · {sumRedemptionStock(stock)} canjes ({redemptionStockText(stock)})</em>{sale.comment && <em>Comentario: {sale.comment}</em>}<div className="record-photos"><PhotoThumbnail label="Boleta" src={sale.receiptPhoto} />{sale.exchangePhoto && <PhotoThumbnail label="Canje" src={sale.exchangePhoto} />}</div></div><div className="sale-admin-actions"><StatusPill status={sale.status} /><Btn variant="outline" onClick={() => setEditingSale(sale)} testId={`button-edit-sale-${sale.id}`}><Pencil /> Editar</Btn><Btn variant="danger" onClick={() => deleteSale(sale)} testId={`button-delete-sale-${sale.id}`}><Trash2 /> Eliminar</Btn></div></article>; })}</div> : <Empty />}</div></section>}
       {tab === 'marcaciones' && <section className="panel"><div className="panel-header"><div><h2>Marcaciones de asistencia</h2><p>Entradas y salidas registradas por los promotores.</p></div><Btn variant="outline" onClick={exportAttendance}><Download /> Descargar</Btn></div><div className="panel-body">{attendance.length ? <div className="record-list">{attendance.map(item => { const promoter = users.find(user => user.id === item.promoterId); const market = marketMap[item.marketId]; return <article className="record" key={item.id}><span className="record-icon"><Clock3 /></span><div className="record-main"><strong>{clients.find(client => client.id === item.clientId)?.name || 'Tienda'}</strong><small>{promoter?.name || 'Promotor no identificado'} · Rol: {item.promoterRole || promoter?.role || 'Rol no identificado'} · {formatDate(item.date)}</small><small><MapPin /> Departamento: {market?.department || 'No identificado'}</small><em><Camera /> {item.photo}</em><div className="record-photos"><PhotoThumbnail label={item.type === 'ENTRADA' ? 'Entrada' : 'Salida'} src={item.photo} /></div></div><span className={`status ${item.type === 'ENTRADA' ? 'active' : 'pending'}`}>{item.type}</span></article>; })}</div> : <Empty title="Aún no hay marcaciones" detail="Las entradas y salidas aparecerán aquí." />}</div></section>}
      {tab === 'inventario' && <InventoryModule markets={markets} inventory={inventory} movements={movements} notify={notify} onImportCsv={importInventory} onDownloadExample={downloadInventoryExample} />}
     {modal === 'user' && <NewUserModal markets={marketOptions} clients={clients} onSave={saveUser} close={() => setModal(null)} />}
     {modal === 'market' && <NewMarketModal onSave={saveMarket} close={() => setModal(null)} />}
    {modal === 'client' && <NewClientModal markets={marketOptions} count={clients.length} onSave={saveClient} close={() => setModal(null)} />}
       {editingSale && <SaleEditModal sale={editingSale} clients={clients} promoter={users.find(item => item.id === editingSale.promoterId)} onSave={saveSaleEdit} close={() => setEditingSale(null)} />}
       {modal === 'canje' && <NewCanjeModal users={visibleUsers} user={user} onSave={saveCanje} close={() => setModal(null)} />}
     {modal === 'degustacion' && <NewDegustacionModal markets={marketOptions} user={user} onSave={saveDegustacion} close={() => setModal(null)} />}
  </main>;
}

function PromoterNav({ active, onChange }: { active: 'MARCACIONES' | 'VENTAS'; onChange: (value: 'MARCACIONES' | 'VENTAS') => void }) {
  return <aside className="promoter-nav"><p className="nav-label">TAREAS DIARIAS</p><button className={active === 'MARCACIONES' ? 'active' : ''} onClick={() => onChange('MARCACIONES')} data-testid="nav-marcaciones"><Clock3 /> Marcaciones</button><button className={active === 'VENTAS' ? 'active' : ''} onClick={() => onChange('VENTAS')} data-testid="nav-ventas"><ShoppingBag /> Ventas</button></aside>;
}
function PromoterApp({ user, markets, clients, assignments, productPrices, sales, setSales, attendance, setAttendance, inventory, setInventory, movements, setMovements, notify, onSessionSelection, onUpdateUser, enqueueEvidencePhoto }: { user: AppUser; markets: Market[]; clients: Client[]; assignments: PromoterAssignment[]; productPrices: ProductPrice[]; sales: Sale[]; setSales: (value: Sale[]) => void; attendance: Attendance[]; setAttendance: (value: Attendance[]) => void; inventory: MarketInventory[]; setInventory: (value: MarketInventory[]) => void; movements: InventoryMovement[]; setMovements: (value: InventoryMovement[]) => void; notify: (message: string, error?: boolean) => void; onSessionSelection: (selection: { marketId: string; clientId: string }) => void; onUpdateUser: (user: AppUser) => void; enqueueEvidencePhoto: (file: File, entityType: PendingPhotoUpload['entityType'], entityId: string, field: PendingPhotoUpload['field'], context: PhotoUploadContext) => void }) {
     const promoterAssignment = assignments.find(assignment => assignmentMatchesUser(assignment, user)); const assignedMarketIds = promoterAssignment ? promoterAssignment.marketIds : user.marketId ? [user.marketId] : []; const selectableMarkets = markets.filter(market => market.status === 'ACTIVO' && assignedMarketIds.includes(market.id)); const [selectedMarketId, setSelectedMarketId] = useState(''); const [selectedClientId, setSelectedClientId] = useState(''); const [module, setModule] = useState<'MARCACIONES' | 'VENTAS'>('MARCACIONES'); const [view, setView] = useState<'LISTA' | 'NUEVA'>('LISTA');
     const available = clients.filter(client => client.marketId === selectedMarketId && client.status === 'ACTIVO' && (!promoterAssignment || promoterAssignment.clientIds.includes(client.id))); const selectedMarket = selectableMarkets.find(market => market.id === selectedMarketId);
       const [clientId, setClientId] = useState(''); const [mode, setMode] = useState<'UNIDADES' | 'PLANCHAS'>('UNIDADES'); const [sku, setSku] = useState(products[0].sku); const [unitQtyInput, setUnitQtyInput] = useState('1'); const [unitPriceSoles, setUnitPriceSoles] = useState(''); const [brandPrices, setBrandPrices] = useState({ TODINNO: '', COSTA: '', PASQUALINO: '' }); const [planchasInput, setPlanchasInput] = useState('1'); const [mixInputs, setMixInputs] = useState({ TODINNO: '0', COSTA: '0', PASQUALINO: '0' }); const [selectedBonusProductId, setSelectedBonusProductId] = useState<CanjeProductId | ''>(''); const [redemptionCount, setRedemptionCount] = useState(1); const [comment, setComment] = useState(''); const [receipt, setReceipt] = useState<File | null>(null); const [exchange, setExchange] = useState<File | null>(null);
     const [markClientId, setMarkClientId] = useState(''); const [markType, setMarkType] = useState<'ENTRADA' | 'SALIDA'>('ENTRADA'); const [markPhoto, setMarkPhoto] = useState<File | null>(null); const [search, setSearch] = useState(''); const [modeFilter, setModeFilter] = useState<'TODO' | 'UNIDADES' | 'PLANCHAS'>('TODO');
      const priceBySku = useMemo(() => Object.fromEntries(productPrices.map(price => [price.sku, price])), [productPrices]);
      useEffect(() => {
        const price = priceBySku[sku]?.unitPrice;
        setUnitPriceSoles(price ? String(price) : '');
      }, [sku, priceBySku]);
      useEffect(() => {
        setBrandPrices({
          TODINNO: String(priceBySku[planchaProducts.TODINNO.sku]?.unitPrice || ''),
          COSTA: String(priceBySku[planchaProducts.COSTA.sku]?.unitPrice || ''),
          PASQUALINO: String(priceBySku[planchaProducts.PASQUALINO.sku]?.unitPrice || ''),
        });
      }, [priceBySku]);
     useEffect(() => { setClientId(selectedClientId); setMarkClientId(selectedClientId); onSessionSelection({ marketId: selectedMarketId, clientId: selectedClientId }); }, [selectedMarketId, selectedClientId]);
     const unitQty = Number(unitQtyInput) || 0; const planchas = Number(planchasInput) || 0; const mix = { TODINNO: Number(mixInputs.TODINNO) || 0, COSTA: Number(mixInputs.COSTA) || 0, PASQUALINO: Number(mixInputs.PASQUALINO) || 0 }; const selectedProduct = products.find(product => product.sku === sku) || products[0]; const brandUnitPrices = Object.fromEntries(Object.keys(planchaProducts).map(brand => [brand, parseSoles(brandPrices[brand as keyof typeof brandPrices])])) as Record<string, number>; const promoterStock = userRedemptionStock(user); const redemptionTotal = sumRedemptionStock(promoterStock); const totalMix = mix.TODINNO + mix.COSTA + mix.PASQUALINO; const total = mode === 'UNIDADES' ? unitQty : totalMix; const unitPrice = parseSoles(unitPriceSoles); const saleAmount = mode === 'UNIDADES' ? unitQty * unitPrice : Object.entries(mix).reduce((sum, [brand, quantity]) => sum + quantity * (brandUnitPrices[brand] || 0), 0); const orderWeightKg = mode === 'UNIDADES' ? unitQty * selectedProduct.weightKg : Object.entries(mix).reduce((sum, [brand, quantity]) => sum + quantity * (planchaProducts[brand as keyof typeof planchaProducts]?.weightKg || 0), 0); const weightPerPlanchaKg = mode === 'PLANCHAS' && planchas > 0 ? orderWeightKg / planchas : 0; const pricesValid = mode === 'UNIDADES' ? unitPrice > 0 : Object.entries(mix).filter(([, quantity]) => quantity > 0).every(([brand]) => (brandUnitPrices[brand] || 0) > 0); const bonusProducts = bonusProductsFor(mode, total, planchas, promoterStock); const selectedBonusProduct = bonusProducts.find(product => product.id === selectedBonusProductId) || bonusProducts[0]; const bonus = selectedBonusProduct?.label; const canjeCount = bonus ? redemptionCount : 0; const requiredRedemptions = multiplyRedemptionRequirements(parseBonusItems(bonus), canjeCount); const missingRedemption = requiredRedemptionEntries(requiredRedemptions).find(([itemId, quantity]) => promoterStock[itemId] < quantity); const exceptionNeedsComment = Boolean(bonus && canjeCount === 3 && !comment.trim()); const validMix = mode === 'UNIDADES' || totalMix === planchas * 6; const saleFormValid = Boolean(clientId && receipt && pricesValid && Number.isFinite(saleAmount) && saleAmount > 0 && validMix && (!bonus || (exchange && !missingRedemption && !exceptionNeedsComment)) && !(mode === 'PLANCHAS' && planchas > 80));
    const mineSales = sales.filter(sale => sale.promoterId === user.id); const mineAttendance = attendance.filter(item => item.promoterId === user.id); const today = new Date().toISOString().slice(0, 10); const todayAttendanceFor = (id: string) => mineAttendance.filter(item => item.clientId === id && item.date.slice(0, 10) === today); const latestAttendanceFor = (id: string) => todayAttendanceFor(id).sort((first, second) => new Date(second.date).getTime() - new Date(first.date).getTime())[0]; const exitedToday = (id: string) => todayAttendanceFor(id).some(item => item.type === 'SALIDA'); const sellingClients = available.filter(client => latestAttendanceFor(client.id)?.type === 'ENTRADA' && !exitedToday(client.id)); const canSellForSelectedClient = Boolean(clientId && latestAttendanceFor(clientId)?.type === 'ENTRADA' && !exitedToday(clientId)); const canConfirm = Boolean(canSellForSelectedClient && saleFormValid); const filteredSales = mineSales.filter(sale => (modeFilter === 'TODO' || sale.mode === modeFilter) && `${sale.id} ${clients.find(client => client.id === sale.clientId)?.name || ''} ${sale.bonus || ''} ${sale.comment || ''}`.toLowerCase().includes(search.toLowerCase())); const filteredAttendance = mineAttendance.filter(item => `${clients.find(client => client.id === item.clientId)?.name || ''} ${item.type}`.toLowerCase().includes(search.toLowerCase()));
  const saveSale = () => {
        if (!selectedMarket) { notify('Selecciona un mercado válido antes de registrar la venta.', true); return; }
       if (!canSellForSelectedClient) { notify(exitedToday(clientId) ? 'Este cliente quedó cerrado por hoy después de registrar la salida. Podrás vender nuevamente mañana.' : 'Debes registrar una entrada activa en este cliente antes de registrar una venta.', true); return; }
       if (!pricesValid) { notify(mode === 'UNIDADES' ? 'Ingresa un precio unitario mayor a S/ 0.00.' : 'Ingresa el precio unitario de cada marca utilizada.', true); return; }
       if (!canConfirm) { notify(mode === 'PLANCHAS' && planchas > 80 ? 'Requiere autorización previa de Trade' : exceptionNeedsComment ? 'Para registrar 3 canjes, agrega el comentario de la excepción.' : bonus && missingRedemption ? `Stock insuficiente de ${redemptionLabel(missingRedemption[0])} para este canje` : Number.isFinite(saleAmount) && saleAmount > 0 ? 'Completa venta y evidencias' : 'Ingresa un precio unitario mayor a S/ 0.00', true); return; }
         const id = `VTA-${new Date().getFullYear()}-${crypto.randomUUID()}`; const now = new Date().toISOString(); const sale: Sale = { id, promoterId: user.id, promoterRole: user.role, promoterRoleLabel: user.roleLabel || user.role, clientId, marketId: selectedMarketId, marketRegion: selectedMarket.region || selectedMarket.department, marketDepartment: selectedMarket.department, marketProvince: selectedMarket.province, marketDistrict: selectedMarket.district, mode, units: total, amountSoles: saleAmount, weightKg: orderWeightKg, unitPrices: mode === 'UNIDADES' ? { [selectedProduct.sku]: unitPrice } : brandUnitPrices, planchas: mode === 'PLANCHAS' ? planchas : undefined, mix: mode === 'PLANCHAS' ? mix : { [selectedProduct.brand]: unitQty }, bonus, redemptionCount: canjeCount, redemptionItems: bonus ? requiredRedemptions : undefined, comment: comment.trim() || undefined, receiptPhoto: `BOLETA - ${id}.jpg`, exchangePhoto: bonus ? `${bonus} - CLIENTE - ${id}.jpg` : undefined, date: now, updatedAt: now, status: 'PENDIENTE' };
      const next = [sale, ...sales]; setSales(next); writeStore('bt-sales', next);
      const saleClient = clients.find(client => client.id === clientId);
      const photoContext = { clientName: saleClient?.name || saleClient?.code || 'CLIENTE NO IDENTIFICADO', marketName: selectedMarket.name, recordType: 'VENTA' };
      if (receipt) enqueueEvidencePhoto(receipt, 'sale', id, 'receiptPhoto', photoContext);
      if (bonus && exchange) enqueueEvidencePhoto(exchange, 'sale', id, 'exchangePhoto', photoContext);
       if (bonus) {
         const nextPromoterStock = requiredRedemptionEntries(requiredRedemptions).reduce((nextStock, [itemId, quantity]) => ({ ...nextStock, [itemId]: nextStock[itemId] - quantity }), { ...promoterStock });
         onUpdateUser(withUserStock(user, userTastingStock(user), nextPromoterStock));
       const currentMovements = readStore<InventoryMovement[]>('bt-inventory-movements', []);
         const canjeMovements = requiredRedemptionEntries(requiredRedemptions).map(([itemId, quantity]) => ({ id: `CAN-${id}-${itemId}`, marketId: selectedMarketId, kind: 'CANJE' as const, itemId, quantity, actorId: user.id, actorName: user.name, promoterId: user.id, date: now, status: syncStatus() }));
        const nextMovements = [...canjeMovements, ...currentMovements];
        setMovements(nextMovements); writeStore('bt-inventory-movements', nextMovements);
     }
       setUnitPriceSoles(String(priceBySku[sku]?.unitPrice || '')); setBrandPrices({ TODINNO: String(priceBySku[planchaProducts.TODINNO.sku]?.unitPrice || ''), COSTA: String(priceBySku[planchaProducts.COSTA.sku]?.unitPrice || ''), PASQUALINO: String(priceBySku[planchaProducts.PASQUALINO.sku]?.unitPrice || '') }); setRedemptionCount(1); setComment(''); setReceipt(null); setExchange(null); setView('LISTA'); notify(bonus ? `${canjeCount} canje${canjeCount === 1 ? '' : 's'} registrado${canjeCount === 1 ? '' : 's'}. Stock actualizado.` : 'Venta sin canje registrada');
  };
    const finalizeAttendance = (tastingUsed = 0) => {
      const stock = userTastingStock(user);
      if (tastingUsed > stock) { notify(`Solo tienes ${stock} panetones de degustación disponibles`, true); return; }
      const now = new Date(); const id = `MAR-${now.getFullYear()}-${String(attendance.length + 1).padStart(6, '0')}`; const type = markType; const item: Attendance = { id, promoterId: user.id, promoterRole: user.role, promoterRoleLabel: user.roleLabel || user.role, clientId: markClientId, marketId: selectedMarketId, type, photo: `${type} - ${available.find(client => client.id === markClientId)?.name || 'TIENDA'} - ${id}.jpg`, date: now.toISOString(), status: syncStatus() };
      const next = [item, ...attendance]; setAttendance(next); writeStore('bt-attendance', next);
      const attendanceClient = clients.find(client => client.id === markClientId);
      if (markPhoto) enqueueEvidencePhoto(markPhoto, 'attendance', id, 'photo', { clientName: attendanceClient?.name || attendanceClient?.code || 'CLIENTE NO IDENTIFICADO', marketName: selectedMarket?.name || 'MERCADO NO IDENTIFICADO', recordType: `ASISTENCIA ${type}` });
     if (type === 'SALIDA') {
        const movement: InventoryMovement = { id: `DEG-${id}`, marketId: selectedMarketId, kind: 'DEGUSTACION', quantity: tastingUsed, actorId: user.id, actorName: user.name, promoterId: user.id, date: now.toISOString(), status: syncStatus() };
       const nextMovements = [movement, ...movements];
        onUpdateUser(withUserStock(user, stock - tastingUsed, userRedemptionStock(user))); setMovements(nextMovements); writeStore('bt-inventory-movements', nextMovements);
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
       <div className="promoter-head"><div><span className="crumb">INICIO / PROCESAMIENTO DE PEDIDOS / {module === 'VENTAS' ? 'VENTAS' : 'TURNOS Y ASISTENCIAS'}</span><h1>{module === 'VENTAS' ? (view === 'LISTA' ? <>Mis ventas <small>{mineSales.length} registros</small></> : 'Añadir venta') : (view === 'LISTA' ? 'Registros de marcación' : 'Añadir registro de marcación')}</h1><p>{selectedMarket.name} · {user.name} · Rol: {user.roleLabel || user.role}</p></div>{view === 'LISTA' && <Btn onClick={() => setView('NUEVA')} testId={`button-new-${module.toLowerCase()}`}><Plus /> Nueva {module === 'VENTAS' ? 'venta' : 'marcación'}</Btn>}</div>
        <div className="market-banner"><span className="market-pin"><MapPin /></span><div><small>MERCADO SELECCIONADO</small><strong>{selectedMarket.name}</strong><p>{selectedMarket.district} · {selectedMarket.province} · {selectedMarket.department}</p></div><div className="market-stock-mini"><span>Mis premios <strong>{redemptionTotal}</strong></span><span>Mi degustación <strong>{userTastingStock(user)}</strong></span></div><StatusPill status="ACTIVO" /></div>
     {module === 'VENTAS' && view === 'LISTA' && <div className="filters"><section className="dark-panel"><div className="dark-search"><Search /><Input value={search} onChange={setSearch} placeholder="Escribe para buscar" testId="input-search-sales" /></div>{filteredSales.length ? <div className="sale-table"><div className="sale-row header"><span>Ticket</span><span>Compra</span><span>Totales</span><span>Tienda y ubicación</span><span>Promotor</span><span>Fecha y hora</span></div>{filteredSales.map(sale => <div className="sale-row" key={sale.id}><span><em className="ticket">{sale.id}</em></span><span className="product-cell"><PackageCheck /><span><strong>{sale.mode === 'PLANCHAS' ? `${sale.planchas} plancha(s) · Mix de marcas` : `${sale.units} unidad(es)`}</strong><small>{sale.bonus ? `${sale.redemptionCount ?? 1} canje${(sale.redemptionCount ?? 1) === 1 ? '' : 's'} · ${sale.bonus}` : 'Venta sin canje'}{sale.comment ? ` · ${sale.comment}` : ''}</small></span></span><span><strong>{sale.units} und.</strong><small>{sale.mode} · {formatKilos(sale.weightKg)}</small></span><span className="store-cell"><Store /><span><strong>{clients.find(client => client.id === sale.clientId)?.name}</strong><small>{selectedMarket.name}</small><small>{saleMarketLocationText(sale, markets)}</small></span></span><span><strong>{user.name}</strong><small>Rol: {user.roleLabel || user.role}</small></span><span><strong>{formatDate(sale.date)}</strong><small>{sale.status}</small></span></div>)}</div> : <div className="dark-empty"><ShoppingBag /><h3>Aún no hay ventas</h3><p>Registra tu primera venta en este mercado.</p><Btn onClick={() => setView('NUEVA')}><Plus /> Nueva venta</Btn></div>}</section><aside className="filter-bar"><h3>Filtros</h3><label>Tipo de venta</label><div className="filter-switch">{(['TODO', 'UNIDADES', 'PLANCHAS'] as const).map(value => <button className={modeFilter === value ? 'active' : ''} key={value} onClick={() => setModeFilter(value)} data-testid={`filter-${value.toLowerCase()}`}>{value === 'TODO' ? 'Todo' : value.charAt(0) + value.slice(1).toLowerCase()}</button>)}</div><label>Buscar tienda o ticket</label><Input value={search} onChange={setSearch} placeholder="Escribe para buscar" /></aside></div>}
      {module === 'MARCACIONES' && view === 'LISTA' && <section className="dark-panel"><div className="dark-search"><Search /><Input value={search} onChange={setSearch} placeholder="Escribe para buscar" testId="input-search-attendance" /></div>{filteredAttendance.length ? <div className="mark-table"><div className="mark-row header"><span>Tienda</span><span>Departamento</span><span>Promotor</span><span>Evento</span><span>Fecha y hora</span><span>Evidencia</span></div>{filteredAttendance.map(item => { const market = markets.find(current => current.id === item.marketId); return <div className="mark-row" key={item.id}><span className="store-cell"><Store /><span><strong>{clients.find(client => client.id === item.clientId)?.name || 'Tienda'}</strong><small>{clients.find(client => client.id === item.clientId)?.code}</small></span></span><span><strong>{market?.department || 'No identificado'}</strong><small>{market?.name || 'Mercado no identificado'}</small></span><span><strong>{user.name}</strong><small>Rol: {user.roleLabel || user.role}</small></span><span><StatusPill status={item.type === 'ENTRADA' ? 'ACTIVO' : 'PENDIENTE'} /></span><span><strong>{formatDate(item.date)}</strong><small>{item.status}</small></span><span className="evidence-cell"><Camera /><small>Foto</small></span></div>; })}</div> : <div className="dark-empty"><Clock3 /><h3>Aún no hay marcaciones</h3><p>Registra tu primera entrada en una tienda.</p><Btn onClick={() => setView('NUEVA')}><Plus /> Nueva marcación</Btn></div>}</section>}
    {view === 'NUEVA' && module === 'MARCACIONES' && <section className="dark-form"><div className="form-section-title">Información</div><div className="dark-form-body"><SelectField label="Tienda *" value={markClientId} onChange={setMarkClientId} items={available.map(client => ({ value: client.id, label: `${client.code} · ${client.name}` }))} /><SelectField label="Evento *" value={markType} onChange={value => setMarkType(value as 'ENTRADA' | 'SALIDA')} items={[{ value: 'ENTRADA', label: 'Entrada' }, { value: 'SALIDA', label: 'Salida' }]} /><PhotoField label="Foto *" hint="Foto del promotor realizando la marcación" file={markPhoto} setFile={setMarkPhoto} /></div><div className="dark-actions"><Btn variant="outline" onClick={() => setView('LISTA')}>Cancelar</Btn><Btn disabled={!markClientId || !markPhoto} onClick={saveAttendance} testId="button-save-attendance"><CheckCircle2 /> Guardar marcación</Btn></div></section>}
     {view === 'NUEVA' && module === 'VENTAS' && <section className="sale-layout"><section className="sale-form"><span className="eyebrow">INFORMACIÓN</span><h2>Registrar venta</h2><p>Completa la compra para evaluar el canje.</p><div className={`attendance-gate ${sellingClients.length ? 'ready' : 'blocked'}`}><Clock3 /><span>{sellingClients.length ? 'Venta habilitada para clientes con Entrada activa.' : 'Debes marcar Entrada en el cliente antes de registrar una venta.'}</span></div><SelectField label="Cliente *" value={clientId} onChange={setClientId} items={sellingClients.map(client => ({ value: client.id, label: `${client.code} · ${client.name}` }))} placeholder={sellingClients.length ? 'Seleccionar cliente con Entrada activa' : 'Sin clientes con Entrada activa'} /><Field label="Tipo de ingreso"><div className="mode-switch"><button className={mode === 'UNIDADES' ? 'selected' : ''} onClick={() => setMode('UNIDADES')} data-testid="button-mode-unidades"><ShoppingBag /> Unidades</button><button className={mode === 'PLANCHAS' ? 'selected' : ''} onClick={() => setMode('PLANCHAS')} data-testid="button-mode-planchas"><PackageCheck /> Planchas</button></div></Field>{mode === 'UNIDADES' ? <div className="form-grid"><SelectField label="Panetón / marca" value={sku} onChange={setSku} items={products.map(product => ({ value: product.sku, label: `${product.brand} · ${product.name} · ${formatKilos(product.weightKg)}` }))} /><Field label="Unidades (máximo 2)"><Input type="number" value={unitQtyInput} onChange={value => setUnitQtyInput(value === '' ? '' : String(Math.max(1, Math.min(2, Math.trunc(Number(value))))))} min={1} max={2} testId="input-sale-units" /></Field><Field label="Precio unitario (S/) *" className="full-field"><Input type="number" value={unitPriceSoles} onChange={setUnitPriceSoles} min={0.01} step={0.01} placeholder="0.00" testId="input-unit-price" /></Field></div> : <div className="plancha-box"><Field label="Cantidad de planchas"><Input type="number" value={planchasInput} onChange={value => setPlanchasInput(value === '' ? '' : String(Math.max(1, Math.trunc(Number(value)))))} min={1} testId="input-sale-planchas" /></Field><p className="formula">Total requerido: <strong>{planchas * 6} unidades</strong> · cada marca puede iniciar en 0 · {formatKilos(weightPerPlanchaKg)} por plancha</p><div className="brand-mix">{Object.entries(mixInputs).map(([brand, quantity]) => <Field label={brand} key={brand}><Input type="number" value={quantity} onChange={value => setMixInputs({ ...mixInputs, [brand]: value === '' ? '' : String(Math.max(0, Math.trunc(Number(value)))) })} min={0} /></Field>)}</div><div className="brand-prices">{Object.entries(mix).map(([brand]) => <Field label={`${brand} · precio unitario (S/) *`} key={`price-${brand}`}><Input type="number" value={brandPrices[brand as keyof typeof brandPrices]} onChange={value => setBrandPrices({ ...brandPrices, [brand]: value })} min={0.01} step={0.01} placeholder="0.00" testId={`input-price-${brand.toLowerCase()}`} /></Field>)}</div><div className={`mix-status ${validMix ? 'valid' : 'invalid'}`}>{validMix ? <><CheckCircle2 /> Mix válido: {totalMix} unidades</> : <>Debes sumar {planchas * 6} unidades entre las marcas utilizadas.</>}</div></div>}<div className="order-total"><span>Total calculado</span><strong>{formatSoles(saleAmount)}</strong><small>{mode === 'PLANCHAS' ? `${formatKilos(orderWeightKg)} total · ${formatKilos(weightPerPlanchaKg)} por plancha` : `${formatKilos(orderWeightKg)} de producto`}</small></div><div className={`bonus-box ${bonus ? 'active' : ''}`}><Gift /><div><small>{bonus ? 'CANJE ACTIVADO' : 'SIN CANJE'}</small><strong>{bonus || 'La compra aún no activa una bonificación'}</strong>{bonus && <small>{requiredRedemptionEntries(requiredRedemptions).map(([itemId, quantity]) => `${quantity} ${redemptionLabel(itemId)}`).join(' · ')} · ${redemptionTotal} disponibles</small>}</div></div>{bonus && mode === 'PLANCHAS' && (planchas === 10 || planchas > 80) && <Field label="Dinámica de canje *"><select className="select" value={selectedBonusProduct?.id || ''} onChange={event => setSelectedBonusProductId(event.target.value as CanjeProductId)} data-testid="select-canje-dinamica">{bonusProducts.map(product => <option value={product.id} key={product.id}>{product.label}</option>)}</select></Field>}{bonus && <Field label="Número de canjes utilizados *"><select className="select" value={redemptionCount} onChange={event => setRedemptionCount(Number(event.target.value))} data-testid="select-redemption-count"><option value={1}>1 canje</option><option value={2}>2 canjes</option><option value={3}>3 canjes (excepción)</option></select></Field>}{bonus && missingRedemption && <div className="stock-warning"><PackageCheck /> No hay stock suficiente de {redemptionLabel(missingRedemption[0])} para este canje.</div>}{bonus && canjeCount === 3 && <p className={`sale-form-note ${exceptionNeedsComment ? 'error' : ''}`}>{exceptionNeedsComment ? 'Agrega un comentario para justificar la excepción de 3 canjes.' : 'Excepción de 3 canjes registrada con comentario.'}</p>}<Field label="Comentario (opcional)"><textarea className="input textarea" value={comment} onChange={event => setComment(event.target.value)} placeholder="Agrega una observación de la visita o venta" maxLength={300} rows={3} data-testid="input-sale-comment" /></Field>{mode === 'PLANCHAS' && planchas > 80 && <div className="trade-warning"><ShieldCheck /> Requiere autorización previa de Trade.</div>}<div className="evidence-grid"><PhotoField label="Foto de boleta *" hint="Obligatoria para toda venta" file={receipt} setFile={setReceipt} /><PhotoField label="Cliente con canje" hint={bonus ? 'Obligatoria para este canje' : 'No requerida sin canje'} file={exchange} setFile={setExchange} disabled={!bonus} /></div><div className="form-actions"><Btn variant="outline" onClick={() => setView('LISTA')}>Cancelar</Btn><Btn disabled={!canConfirm} onClick={saveSale} testId="button-save-sale"><CheckCircle2 /> Guardar venta</Btn></div></section><aside className="recent"><h3>Resumen del registro</h3><p>Validación de compra, precio y peso.</p><div className="check-list"><p className="check"><Check /> Cliente con Entrada activa</p><p className="check"><Check /> {total} unidades registradas</p><p className="check"><Check /> Total: {formatSoles(Number.isFinite(saleAmount) ? saleAmount : 0)}</p><p className="check"><Check /> Peso: {formatKilos(orderWeightKg)}</p><p className="check"><Gift /> {bonus ? `${canjeCount} canje${canjeCount === 1 ? '' : 's'} · ${bonus}` : 'Sin canje'}</p></div></aside></section>}
    </div></div></main>;
}

function ClientApp({ user, clients, sales, markets }: { user: AppUser; clients: Client[]; sales: Sale[]; markets: Market[] }) {
  const client = clients.find(item => item.id === user.clientId || item.code === user.clientId);
  const market = client ? markets.find(item => item.id === client.marketId) : undefined;
  const clientSales = client ? sales.filter(sale => sale.clientId === client.id).sort((first, second) => second.date.localeCompare(first.date)) : [];
  const totalUnits = clientSales.reduce((sum, sale) => sum + (Number(sale.units) || 0), 0);
  const totalSoles = clientSales.reduce((sum, sale) => sum + (Number(sale.amountSoles) || 0), 0);

  return <main className="client-page"><div className="client-content"><div className="client-heading"><div><span className="eyebrow">PORTAL CLIENTE</span><h1>Hola, {user.name}</h1><p>Consulta la información registrada de tu tienda.</p></div><span className="client-badge"><UserRound /> CLIENTE</span></div>{client ? <><section className="client-profile panel"><div className="panel-header"><div><h2>{client.name}</h2><p>{client.code}{market ? ` · ${market.name}` : ''}</p></div><StatusPill status={client.status} /></div><div className="panel-body client-profile-grid"><div><small>CELULAR</small><strong>{client.phone || 'No registrado'}</strong></div><div><small>MERCADO</small><strong>{market?.name || 'No identificado'}</strong></div><div><small>DISTRITO</small><strong>{market?.district || 'No identificado'}</strong></div></div></section><div className="client-stats"><article><ShoppingBag /><div><small>COMPRAS REGISTRADAS</small><strong>{clientSales.length}</strong></div></article><article><PackageCheck /><div><small>UNIDADES</small><strong>{totalUnits.toLocaleString('es-PE')}</strong></div></article><article><CheckCircle2 /><div><small>TOTAL ACUMULADO</small><strong>{formatSoles(totalSoles)}</strong></div></article></div><section className="panel"><div className="panel-header"><div><h2>Historial de compras</h2><p>Registro de ventas asociadas a tu tienda.</p></div></div><div className="panel-body">{clientSales.length ? <div className="client-sales-list">{clientSales.map(sale => <article className="client-sale-row" key={sale.id}><div><strong>{sale.id}</strong><small>{formatDate(sale.date)} · {sale.mode === 'PLANCHAS' ? `${sale.planchas || 0} plancha(s)` : `${sale.units} unidad(es)`}</small></div><strong>{formatSoles(sale.amountSoles)}</strong></article>)}</div> : <Empty title="Aún no hay compras registradas" detail="Cuando se registre una compra para tu tienda aparecerá aquí." />}</div></section></> : <section className="panel client-unlinked"><div className="panel-body"><UserRound /><h2>Cuenta creada, falta vincular tu tienda</h2><p>Tu acceso ya está habilitado, pero el usuario todavía no está asociado a un cliente de la campaña. Agrega su ID o código de cliente en la hoja de usuarios y pulsa “Actualizar hoja”.</p></div></section>}</div></main>;
}

export default function App() {
   clearTestDataOnce();
   clearCatalogDataOnce();
   keepAnalystUsersOnce();
     const [user, setUser] = useState<AppUser | null>(() => readStore<AppUser | null>('bt-session', null)); const [markets, setMarkets] = useState<Market[]>(() => readStore('bt-markets', [])); const [users, setUsers] = useState<AppUser[]>(() => readStore('bt-users', [])); const [clients, setClients] = useState<Client[]>(() => readStore('bt-clients', [])); const [productPrices, setProductPrices] = useState<ProductPrice[]>(() => readStore(PRODUCT_PRICES_STORE_KEY, [])); const [sales, setSales] = useState<Sale[]>(() => readStore('bt-sales', [])); const [attendance, setAttendance] = useState<Attendance[]>(() => readStore('bt-attendance', [])); const [inventory, setInventory] = useState<MarketInventory[]>(() => reconcileInventory(readStore<MarketInventory[]>('bt-inventory', []), readStore<InventoryMovement[]>('bt-inventory-movements', []))); const [movements, setMovements] = useState<InventoryMovement[]>(() => readStore('bt-inventory-movements', [])); const [assignments, setAssignments] = useState<PromoterAssignment[]>(() => readStore('bt-promoter-assignments', [])); const [closures, setClosures] = useState<SessionClosure[]>(() => readStore('bt-session-closures', [])); const [referencesReady, setReferencesReady] = useState(false); const [cloudReady, setCloudReady] = useState(false); const [cloudSyncTick, setCloudSyncTick] = useState(0); const [toast, setToast] = useState<Toast | null>(null); const [sessionClosePrompt, setSessionClosePrompt] = useState(false); const [promoterSession, setPromoterSession] = useState({ marketId: '', clientId: '' }); const photoUploadRunning = useRef(false);
    const notify = (message: string, error = false) => setToast({ message, error });
      const photoUploadErrorShown = useRef(false);
      const photoContextRef = useRef({ sales, attendance, clients, markets });
      photoContextRef.current = { sales, attendance, clients, markets };
     const applyUploadedPhoto = (upload: PendingPhotoUpload, url: string) => {
       if (upload.entityType === 'sale') {
         setSales(current => {
           const next = current.map(sale => sale.id === upload.entityId ? (upload.field === 'exchangePhoto' ? { ...sale, exchangePhoto: url } : { ...sale, receiptPhoto: url }) : sale);
           writeStore('bt-sales', next);
           return next;
         });
       } else {
         setAttendance(current => {
           const next = current.map(item => item.id === upload.entityId ? { ...item, photo: url } : item);
           writeStore('bt-attendance', next);
           return next;
         });
       }
     };
     const flushEvidencePhotos = async () => {
       if (photoUploadRunning.current || !navigator.onLine) return;
       photoUploadRunning.current = true;
       try {
         for (const upload of await pendingPhotoUploads()) {
           try {
              const current = photoContextRef.current;
              const record = upload.entityType === 'sale'
                ? current.sales.find(item => item.id === upload.entityId)
                : current.attendance.find(item => item.id === upload.entityId);
              const client = record ? current.clients.find(item => item.id === record.clientId) : undefined;
              const market = record ? current.markets.find(item => item.id === record.marketId) : undefined;
              const enrichedUpload = {
                ...upload,
                clientName: upload.clientName || client?.name || client?.code,
                marketName: upload.marketName || market?.name,
                recordType: upload.recordType || (upload.entityType === 'sale' ? 'VENTA' : `ASISTENCIA ${record && 'type' in record ? record.type : ''}`.trim()),
              };
              const saved = await uploadPhoto(enrichedUpload);
              applyUploadedPhoto(enrichedUpload, saved.url);
             await removePhotoUpload(upload.id);
              photoUploadErrorShown.current = false;
            } catch (error) {
              if (!photoUploadErrorShown.current) {
                notify(error instanceof Error ? `Foto pendiente: ${error.message}` : 'Foto pendiente: no se pudo subir a Google Drive.', true);
                photoUploadErrorShown.current = true;
              }
             break;
           }
         }
       } finally {
         photoUploadRunning.current = false;
       }
     };
      const enqueueEvidencePhoto = (file: File, entityType: PendingPhotoUpload['entityType'], entityId: string, field: PendingPhotoUpload['field'], context: PhotoUploadContext) => {
        void queuePhotoUpload(file, entityType, entityId, field, context).then(flushEvidencePhotos).catch(() => notify('No se pudo guardar la foto en la cola del dispositivo.', true));
     };
     useEffect(() => {
       setReferencesReady(true);
     }, []);
    useEffect(() => {
       if (!referencesReady) return;
      let cancelled = false;
      const hydrateCloudStorage = async () => {
        try {
           const response = await fetch(APP_STORAGE_READ);
          if (!response.ok) throw new Error('Sincronización inicial no disponible');
           const payload = await response.json() as { catalogRevision?: string | null; snapshot?: Partial<CloudSnapshot> };
          if (cancelled || !payload.snapshot) return;
           if (payload.catalogRevision) localStorage.setItem(CATALOG_REVISION_STORE_KEY, payload.catalogRevision);
          const snapshot = payload.snapshot;
          const localUsers = readStore<AppUser[]>('bt-users', []);
          const nextMarkets = Array.isArray(snapshot.markets) ? snapshot.markets : [];
           const nextUsers = mergeUsersByDni([], (Array.isArray(snapshot.users) ? snapshot.users : []).map(cloudUser => {
             const localUser = localUsers.find(item => item.id === cloudUser.id || item.dni === cloudUser.dni);
             return { ...cloudUser, password: localUser?.password };
           }));
          const nextClients = Array.isArray(snapshot.clients) ? snapshot.clients : [];
        const cloudSales = Array.isArray(snapshot.sales) ? snapshot.sales : [];
        const localSales = readStore<Sale[]>('bt-sales', []);
        const nextSales = mergeSales(localSales, cloudSales).map(sale => enrichSaleMarketLocation(sale, nextMarkets));
          const nextAttendance = Array.isArray(snapshot.attendance) ? snapshot.attendance : [];
          const nextMovements = Array.isArray(snapshot.movements) ? snapshot.movements : [];
           const nextInventory = reconcileInventory(Array.isArray(snapshot.inventory) ? snapshot.inventory : [], nextMovements);
          const nextAssignments = Array.isArray(snapshot.assignments) ? snapshot.assignments : [];
          const nextClosures = Array.isArray(snapshot.closures) ? snapshot.closures : [];
           const nextProductPrices = Array.isArray(snapshot.productPrices) ? snapshot.productPrices : productPrices;
        setMarkets(nextMarkets); setUsers(nextUsers); setClients(nextClients); setSales(nextSales); setAttendance(nextAttendance); setInventory(nextInventory); setMovements(nextMovements); setAssignments(nextAssignments); setClosures(nextClosures);
           setProductPrices(nextProductPrices);
           writeStore('bt-markets', nextMarkets); writeStore('bt-users', nextUsers); writeStore('bt-clients', nextClients); writeStore('bt-sales', nextSales); writeStore('bt-attendance', nextAttendance); writeStore('bt-inventory', nextInventory); writeStore('bt-inventory-movements', nextMovements); writeStore('bt-promoter-assignments', nextAssignments); writeStore('bt-session-closures', nextClosures); writeStore(PRODUCT_PRICES_STORE_KEY, nextProductPrices);
        } catch {
          // La operación continúa en localStorage y se reintentará al volver a estar en línea.
        } finally {
          if (!cancelled) setCloudReady(true);
        }
      };
      void hydrateCloudStorage();
      return () => { cancelled = true; };
     }, [referencesReady]);
     useEffect(() => {
       if (!referencesReady) return;
       let cancelled = false;
       const refreshAssignments = async () => {
         if (!navigator.onLine) return;
         try {
            const response = await fetch(APP_STORAGE_ASSIGNMENTS);
           if (!response.ok) throw new Error('Asignaciones no disponibles');
           const payload = await response.json() as { assignments?: PromoterAssignment[] };
           if (cancelled || !Array.isArray(payload.assignments)) return;
           setAssignments(current => {
             const next = mergeAssignments(current, payload.assignments || []);
             writeStore('bt-promoter-assignments', next);
             return next;
           });
         } catch {
           // Se conserva la última asignación local válida.
         }
       };
       void refreshAssignments();
       const interval = window.setInterval(refreshAssignments, 15_000);
       window.addEventListener('online', refreshAssignments);
       return () => {
         cancelled = true;
         window.clearInterval(interval);
         window.removeEventListener('online', refreshAssignments);
       };
     }, [referencesReady]);
    useEffect(() => {
      if (!cloudReady) return;
      const timeout = window.setTimeout(() => {
        const snapshot: CloudSnapshot = {
          markets,
          users: users.map(({ password: _password, ...currentUser }) => currentUser),
          clients,
          sales,
          attendance,
          inventory,
          movements,
          assignments,
          closures,
           productPrices,
        };
          void fetch(APP_STORAGE_SYNC, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ snapshot, catalogRevision: localStorage.getItem(CATALOG_REVISION_STORE_KEY) || undefined }),
         }).then(async response => {
           if (!response.ok) return;
           const payload = await response.json() as { snapshot?: Partial<CloudSnapshot> };
           if (!Array.isArray(payload.snapshot?.sales)) return;
           setSales(current => {
             const nextSales = mergeSales(current, payload.snapshot?.sales || []);
             if (JSON.stringify(nextSales) === JSON.stringify(current)) return current;
             writeStore('bt-sales', nextSales);
             return nextSales;
           });
         }).catch(() => undefined);
      }, 1500);
      return () => window.clearTimeout(timeout);
     }, [cloudReady, cloudSyncTick, markets, users, clients, productPrices, sales, attendance, inventory, movements, assignments, closures]);
    useEffect(() => {
       const retry = () => {
         setCloudSyncTick(value => value + 1);
         void flushEvidencePhotos();
       };
       void flushEvidencePhotos();
        const interval = window.setInterval(flushEvidencePhotos, 30_000);
      window.addEventListener('online', retry);
       return () => {
         window.clearInterval(interval);
         window.removeEventListener('online', retry);
       };
    }, []);
  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => undefined);
  }, []);
    useEffect(() => {
      if (!markets.length) return;
      setSales(current => {
        let changed = false;
        const next = current.map(sale => {
          const enriched = enrichSaleMarketLocation(sale, markets);
          if (enriched !== sale) changed = true;
          return enriched;
        });
        if (!changed) return current;
        writeStore('bt-sales', next);
        return next;
      });
    }, [markets]);
    useEffect(() => { writeStore('bt-markets', markets); }, [markets]); useEffect(() => { writeStore('bt-users', users); }, [users]); useEffect(() => { writeStore('bt-clients', clients); }, [clients]); useEffect(() => { writeStore('bt-sales', sales); }, [sales]); useEffect(() => { writeStore('bt-attendance', attendance); }, [attendance]); useEffect(() => { writeStore('bt-inventory', inventory); }, [inventory]); useEffect(() => { writeStore('bt-inventory-movements', movements); }, [movements]); useEffect(() => { writeStore('bt-promoter-assignments', assignments); }, [assignments]); useEffect(() => { writeStore('bt-session-closures', closures); }, [closures]);
    const completeLogin = (authenticated: AppUser) => {
      setUser(authenticated);
      setUsers(current => {
        const next = mergeUsersByDni(current, [authenticated]);
        writeStore('bt-users', next);
        return next;
      });
    };
     const updatePromoterUser = (updated: AppUser) => {
       setUsers(current => {
         const next = current.map(item => item.id === updated.id || item.dni === updated.dni ? { ...item, ...updated } : item);
         writeStore('bt-users', next);
         return next;
       });
       setUser(current => current && (current.id === updated.id || current.dni === updated.dni) ? { ...current, ...updated } : current);
     };
    const activeUser = useMemo(() => user ? users.find(item => item.dni === user.dni) || user : null, [user, users]);
   const logoutImmediately = () => { localStorage.removeItem('bt-session'); setSessionClosePrompt(false); setPromoterSession({ marketId: '', clientId: '' }); setUser(null); };
    const requestLogout = () => {
       if (activeUser && isPromoterRole(activeUser.role)) {
         const assignment = assignments.find(item => assignmentMatchesUser(item, activeUser));
         const assignedMarketIds = assignment ? assignment.marketIds : activeUser.marketId ? [activeUser.marketId] : [];
         if (!assignedMarketIds.length) {
           logoutImmediately();
           return;
         }
        const today = new Date().toISOString().slice(0, 10);
        const hasAttendanceToday = attendance.some(item => item.promoterId === activeUser.id && item.date.slice(0, 10) === today);
        if (!hasAttendanceToday) {
          logoutImmediately();
          return;
        }
        setSessionClosePrompt(true);
        return;
      }
      logoutImmediately();
    };
    const completePromoterLogout = (tastingUsed: number, leads: number) => {
     if (!activeUser) return;
      const marketId = promoterSession.marketId || activeUser.marketId || ''; const clientId = promoterSession.clientId || undefined; const stock = userTastingStock(activeUser);
      if (tastingUsed > stock) { notify(`Solo tienes ${stock} panetones de degustación disponibles`, true); return; }
       const now = new Date().toISOString();
       const nextMovements = tastingUsed > 0 && marketId ? [{ id: `DEG-CIERRE-${activeUser.id}-${Date.now()}`, marketId, kind: 'DEGUSTACION' as const, quantity: tastingUsed, actorId: activeUser.id, actorName: activeUser.name, promoterId: activeUser.id, date: now, status: syncStatus() }, ...movements] : movements;
      const closure: SessionClosure = { id: `CIERRE-${new Date().getFullYear()}-${String(closures.length + 1).padStart(6, '0')}`, promoterId: activeUser.id, promoterRole: activeUser.role, promoterRoleLabel: activeUser.roleLabel || activeUser.role, marketId, clientId, tastingUsed, leads, date: now, status: syncStatus() };
      const nextClosures = [closure, ...closures]; setClosures(nextClosures); writeStore('bt-session-closures', nextClosures);
      if (tastingUsed > 0) updatePromoterUser(withUserStock(activeUser, stock - tastingUsed, userRedemptionStock(activeUser)));
      setMovements(nextMovements); writeStore('bt-inventory-movements', nextMovements); logoutImmediately();
   };
    const logoutStock = userTastingStock(activeUser || { id: '', dni: '', name: '', role: 'PROMOTOR', status: 'ACTIVO' });
        return <>{activeUser ? <><Shell user={activeUser} logout={requestLogout}>{isPromoterRole(activeUser.role) ? <PromoterApp user={activeUser} markets={markets} clients={clients} assignments={assignments} productPrices={productPrices} sales={sales} setSales={setSales} attendance={attendance} setAttendance={setAttendance} inventory={inventory} setInventory={setInventory} movements={movements} setMovements={setMovements} notify={notify} onSessionSelection={setPromoterSession} onUpdateUser={updatePromoterUser} enqueueEvidencePhoto={enqueueEvidencePhoto} /> : activeUser.role === 'CLIENTE' ? <ClientApp user={activeUser} clients={clients} sales={sales} markets={markets} /> : <AnalystApp user={activeUser} markets={markets} setMarkets={setMarkets} users={users} setUsers={setUsers} clients={clients} setClients={setClients} sales={sales} setSales={setSales} attendance={attendance} setAttendance={setAttendance} inventory={inventory} movements={movements} assignments={assignments} setAssignments={setAssignments} setInventory={setInventory} setMovements={setMovements} closures={closures} setClosures={setClosures} notify={notify} />}</Shell>{sessionClosePrompt && isPromoterRole(activeUser.role) && <SessionCloseModal available={logoutStock} onConfirm={completePromoterLogout} close={() => setSessionClosePrompt(false)} />}</> : referencesReady || users.length ? <Login users={users} onLogin={completeLogin} notify={notify} /> : <main className="login-shell"><section className="login-panel"><div className="login-card"><div className="mobile-logo"><Logo /></div><div className="login-heading"><span className="icon-disc"><RefreshCw /></span><div><h2>Cargando acceso</h2><p>Estamos conectando con el servidor.</p></div></div></div></section></main>}<ToastView toast={toast} clear={() => setToast(null)} /></>;
}