import { ReplitConnectors } from "@replit/connectors-sdk";
import { Router, type IRouter } from "express";

const router: IRouter = Router();
const spreadsheetId = "1kW58oEdQ9wP-SFG8lYZlabvirqU_md5UdkOs7YeIZMM";

const collections = {
  markets: { sheet: "MERCADOS", key: "id" },
  users: { sheet: "USUARIOS", key: "id" },
  clients: { sheet: "CLIENTES", key: "id" },
  sales: { sheet: "VENTAS", key: "id" },
  attendance: { sheet: "MARCACIONES", key: "id" },
  inventory: { sheet: "INVENTARIO", key: "marketId" },
  movements: { sheet: "MOVIMIENTOS_STOCK", key: "id" },
  assignments: { sheet: "ASIGNACIONES", key: "promoterId" },
  closures: { sheet: "CIERRES_JORNADA", key: "id" },
} as const;

type CollectionName = keyof typeof collections;
type StoredRecord = Record<string, unknown>;
type StorageSnapshot = Record<CollectionName, StoredRecord[]>;

function emptySnapshot(): StorageSnapshot {
  return {
    markets: [],
    users: [],
    clients: [],
    sales: [],
    attendance: [],
    inventory: [],
    movements: [],
    assignments: [],
    closures: [],
  };
}

function quoteSheet(title: string) {
  return `'${title.replace(/'/g, "''")}'`;
}

async function proxyJson<T>(
  connectors: ReplitConnectors,
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
) {
  const response = await connectors.proxy("google-sheet", path, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Google Sheets ${response.status}: ${text.slice(0, 500)}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

async function ensureSheets(connectors: ReplitConnectors) {
  const metadata = await proxyJson<{
    sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
  }>(
    connectors,
    `/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`,
  );
  const existing = metadata.sheets ?? [];
  const titles = new Set(
    existing.map((sheet) => sheet.properties?.title).filter(Boolean),
  );
  const required = [
    "METADATA",
    ...Object.values(collections).map((collection) => collection.sheet),
  ];
  const requests: StoredRecord[] = [];

  if (!titles.has("METADATA") && existing[0]?.properties?.sheetId != null) {
    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId: existing[0].properties.sheetId,
          title: "METADATA",
        },
        fields: "title",
      },
    });
    titles.add("METADATA");
  }

  required.forEach((title) => {
    if (!titles.has(title)) {
      requests.push({ addSheet: { properties: { title } } });
    }
  });

  if (requests.length) {
    await proxyJson(
      connectors,
      `/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requests }),
      },
    );
  }
}

async function readSnapshot(connectors: ReplitConnectors) {
  await ensureSheets(connectors);
  const query = Object.values(collections)
    .map(
      (collection) =>
        `ranges=${encodeURIComponent(`${quoteSheet(collection.sheet)}!A2:B`)}`,
    )
    .join("&");
  const response = await proxyJson<{
    valueRanges?: Array<{ values?: unknown[][] }>;
  }>(
    connectors,
    `/v4/spreadsheets/${spreadsheetId}/values:batchGet?${query}`,
  );
  const snapshot = emptySnapshot();

  (Object.keys(collections) as CollectionName[]).forEach((name, index) => {
    const rows = response.valueRanges?.[index]?.values ?? [];
    snapshot[name] = rows.flatMap((row) => {
      const raw = typeof row[1] === "string" ? row[1] : "";
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? [parsed] : [];
      } catch {
        return [];
      }
    });
  });

  return snapshot;
}

function mergeCollection(
  current: StoredRecord[],
  incoming: StoredRecord[],
  keyName: string,
) {
  const merged = new Map<string, StoredRecord>();
  current.forEach((record) => {
    const key = String(record[keyName] ?? "");
    if (key) merged.set(key, record);
  });
  incoming.forEach((record) => {
    const key = String(record[keyName] ?? "");
    if (!key) return;
    const previous = merged.get(key);
    const previousDate = String(
      previous?.updatedAt ?? previous?.date ?? "",
    );
    const incomingDate = String(record.updatedAt ?? record.date ?? "");
    if (!previous || !previousDate || !incomingDate || incomingDate >= previousDate) {
      merged.set(key, { ...previous, ...record });
    }
  });
  return Array.from(merged.values());
}

function mergeSnapshots(
  current: StorageSnapshot,
  incoming: Partial<StorageSnapshot>,
) {
  const merged = emptySnapshot();
  (Object.keys(collections) as CollectionName[]).forEach((name) => {
    merged[name] = mergeCollection(
      current[name],
      Array.isArray(incoming[name]) ? incoming[name] : [],
      collections[name].key,
    );
  });
  const clientsByCode = new Map<string, StoredRecord[]>();
  merged.clients.forEach((client) => {
    const key = String(client.code ?? client.id ?? "").trim();
    if (key) clientsByCode.set(key, [...(clientsByCode.get(key) ?? []), client]);
  });
  const aliases = new Map<string, string>();
  merged.clients = Array.from(clientsByCode.entries()).map(([code, clients]) => {
    const canonical = clients.find((client) => String(client.id) === code) ?? clients[clients.length - 1];
    clients.forEach((client) => aliases.set(String(client.id), String(canonical.id)));
    return canonical;
  });
  const remap = (value: unknown) => aliases.get(String(value ?? "")) ?? value;
  merged.sales = merged.sales.map((record) => ({ ...record, clientId: remap(record.clientId) }));
  merged.attendance = merged.attendance.map((record) => ({ ...record, clientId: remap(record.clientId) }));
  merged.assignments = merged.assignments.map((record) => ({
    ...record,
    clientIds: Array.isArray(record.clientIds)
      ? Array.from(new Set(record.clientIds.map(remap)))
      : [],
  }));
  merged.closures = merged.closures.map((record) => ({ ...record, clientId: remap(record.clientId) }));
  return merged;
}

async function writeSnapshot(
  connectors: ReplitConnectors,
  snapshot: StorageSnapshot,
) {
  const ranges = Object.values(collections).map(
    (collection) => `${quoteSheet(collection.sheet)}!A:B`,
  );
  ranges.push(`${quoteSheet("METADATA")}!A:B`);
  await proxyJson(
    connectors,
    `/v4/spreadsheets/${spreadsheetId}/values:batchClear`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ranges }),
    },
  );

  const data = (Object.keys(collections) as CollectionName[]).map((name) => {
    const collection = collections[name];
    return {
      range: `${quoteSheet(collection.sheet)}!A1`,
      majorDimension: "ROWS",
      values: [
        ["ID", "JSON"],
        ...snapshot[name].map((record) => [
          String(record[collection.key] ?? ""),
          JSON.stringify(record),
        ]),
      ],
    };
  });
  data.push({
    range: `${quoteSheet("METADATA")}!A1`,
    majorDimension: "ROWS",
    values: [
      ["CLAVE", "VALOR"],
      ["ultimaSincronizacion", new Date().toISOString()],
      ["version", "1"],
    ],
  });

  await proxyJson(
    connectors,
    `/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ valueInputOption: "RAW", data }),
    },
  );
}

let syncQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(operation: () => Promise<T>) {
  const result = syncQueue.then(operation, operation);
  syncQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

router.get("/google-sheets-storage", async (_req, res) => {
  try {
    const snapshot = await serialized(() =>
      readSnapshot(new ReplitConnectors()),
    );
    res.json({ spreadsheetId, snapshot });
  } catch (error) {
    res.status(502).json({
      message:
        error instanceof Error
          ? error.message
          : "No se pudo leer el almacenamiento de Google Sheets.",
    });
  }
});

router.post("/google-sheets-storage/sync", async (req, res) => {
  try {
    const incoming =
      req.body?.snapshot && typeof req.body.snapshot === "object"
        ? (req.body.snapshot as Partial<StorageSnapshot>)
        : {};
    const snapshot = await serialized(async () => {
      const connectors = new ReplitConnectors();
      const current = await readSnapshot(connectors);
      const merged = mergeSnapshots(current, incoming);
      await writeSnapshot(connectors, merged);
      return merged;
    });
    res.json({ spreadsheetId, syncedAt: new Date().toISOString(), snapshot });
  } catch (error) {
    res.status(502).json({
      message:
        error instanceof Error
          ? error.message
          : "No se pudo sincronizar el almacenamiento con Google Sheets.",
    });
  }
});

export default router;