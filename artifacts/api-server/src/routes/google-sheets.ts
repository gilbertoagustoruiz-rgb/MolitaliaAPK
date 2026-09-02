import { Router, type IRouter } from "express";

const router: IRouter = Router();
const sheetIdPattern = /^[a-zA-Z0-9_-]{20,}$/;

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