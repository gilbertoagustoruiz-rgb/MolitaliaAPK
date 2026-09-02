import { Router, type IRouter } from "express";
import { ReplitConnectors } from "@replit/connectors-sdk";

const router: IRouter = Router();
const sheetIdPattern = /^[a-zA-Z0-9_-]{20,}$/;

type SheetMetadata = {
  sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
};

type SheetValues = {
  values?: unknown[][];
};

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

async function fetchAuthenticatedSheetCsv(sheetId: string, gid: string) {
  const connectors = new ReplitConnectors();
  const metadataResponse = await connectors.proxy(
    "google-sheet",
    `/v4/spreadsheets/${sheetId}?fields=sheets.properties`,
    { method: "GET" },
  );

  if (!metadataResponse.ok) {
    throw new Error(`Google Sheets API metadata ${metadataResponse.status}`);
  }

  const metadata = (await metadataResponse.json()) as SheetMetadata;
  const selectedSheet =
    metadata.sheets?.find(
      (sheet) => String(sheet.properties?.sheetId ?? "") === gid,
    ) ?? metadata.sheets?.[0];
  const title = selectedSheet?.properties?.title;

  if (!title) {
    throw new Error("La hoja no contiene una pestaña disponible.");
  }

  const escapedTitle = title.replace(/'/g, "''");
  const range = encodeURIComponent(`'${escapedTitle}'`);
  const valuesResponse = await connectors.proxy(
    "google-sheet",
    `/v4/spreadsheets/${sheetId}/values/${range}?valueRenderOption=FORMATTED_VALUE`,
    { method: "GET" },
  );

  if (!valuesResponse.ok) {
    throw new Error(`Google Sheets API valores ${valuesResponse.status}`);
  }

  const data = (await valuesResponse.json()) as SheetValues;
  return (data.values ?? [])
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}

router.get("/google-sheets/:sheetId", async (req, res) => {
  const sheetId = req.params.sheetId;
  const requestedGid = typeof req.query.gid === "string" ? req.query.gid : "0";
  const gid = /^\d+$/.test(requestedGid) ? requestedGid : "0";

  if (!sheetIdPattern.test(sheetId)) {
    res.status(400).json({ message: "ID de Google Sheets inválido." });
    return;
  }

  const urls = [
    `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`,
    `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`,
  ];
  const statuses: number[] = [];

  try {
    try {
      const csv = await fetchAuthenticatedSheetCsv(sheetId, gid);
      res.type("text/csv").send(csv);
      return;
    } catch {
      // Conserva compatibilidad con hojas públicas si la conexión autenticada
      // no tiene acceso a uno de los archivos históricos.
    }

    for (const url of urls) {
      const response = await fetch(url);
      if (response.ok) {
        res.type("text/csv").send(await response.text());
        return;
      }
      statuses.push(response.status);
    }

    if (statuses.some(status => status === 401 || status === 403)) {
      res.status(502).json({ message: "Google Sheets requiere acceso de lectura público. Comparte la hoja como «Cualquier persona con el enlace» y permiso «Lector»." });
      return;
    }
    res.status(502).json({ message: `Google Sheets no está disponible (${statuses.join(", ")}).` });
  } catch {
    res.status(502).json({ message: "No se pudo conectar con Google Sheets desde el servidor." });
  }
});

export default router;