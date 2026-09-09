import { ReplitConnectors } from "@replit/connectors-sdk";
import { raw, Router, type IRouter } from "express";

const router: IRouter = Router();
const photosFolderId = "1nFFXODky2kHRHTa8R7hKkPAz65pukFa1";
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const replitSidecarEndpoint = "http://127.0.0.1:1106";

function safeFileName(value: string) {
  const decoded = decodeURIComponent(value || "evidencia.jpg");
  return decoded
    .normalize("NFKD")
    .replace(/[^\w.\- ()]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 160);
}

function safeMetadataValue(value: string, fallback: string) {
  const decoded = decodeURIComponent(value || fallback);
  return decoded
    .normalize("NFKD")
    .replace(/[^\w.\- ()]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || fallback;
}

function privateStorageLocation() {
  const privateObjectDir = process.env.PRIVATE_OBJECT_DIR || "";
  const parts = privateObjectDir.replace(/^\/+/, "").split("/").filter(Boolean);
  const bucketName = parts.shift();
  if (!bucketName || !parts.length) {
    throw new Error("App Storage no está configurado para evidencias.");
  }
  return { bucketName, prefix: parts.join("/") };
}

async function signedObjectUrl(bucketName: string, objectName: string, method: "GET" | "PUT") {
  const response = await fetch(`${replitSidecarEndpoint}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectName,
      method,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`App Storage no pudo autorizar el archivo (${response.status}).`);
  }
  const payload = await response.json() as { signed_url?: string };
  if (!payload.signed_url) {
    throw new Error("App Storage no devolvió una URL de almacenamiento.");
  }
  return payload.signed_url;
}

async function saveEvidenceToAppStorage(fileName: string, contentType: string, body: Buffer) {
  const { bucketName, prefix } = privateStorageLocation();
  const objectName = `${prefix}/evidence/${fileName}`;
  const uploadUrl = await signedObjectUrl(bucketName, objectName, "PUT");
  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body,
    signal: AbortSignal.timeout(60_000),
  });
  if (!uploadResponse.ok) {
    throw new Error(`App Storage rechazó la fotografía (${uploadResponse.status}).`);
  }
  return Buffer.from(objectName).toString("base64url");
}

router.post(
  "/evidence-photos",
  raw({ type: ["image/*", "application/octet-stream"], limit: "12mb" }),
  async (req, res) => {
    try {
      const contentType = String(req.headers["content-type"] || "").split(";")[0];
      const recordId = String(req.headers["x-record-id"] || "").trim();
      const evidenceType = String(req.headers["x-evidence-type"] || "").trim();
      const originalName = safeFileName(String(req.headers["x-file-name"] || ""));
      const clientName = safeMetadataValue(String(req.headers["x-client-name"] || ""), "CLIENTE NO IDENTIFICADO");
      const marketName = safeMetadataValue(String(req.headers["x-market-name"] || ""), "MERCADO NO IDENTIFICADO");
      const recordType = safeMetadataValue(String(req.headers["x-record-type"] || ""), "EVIDENCIA");
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);

      if (!allowedTypes.has(contentType)) {
        res.status(415).json({ message: "Formato de imagen no permitido." });
        return;
      }
      if (!recordId || !evidenceType || !body.length) {
        res.status(400).json({ message: "La evidencia no contiene todos los datos requeridos." });
        return;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const fileName = `${recordType} - ${marketName} - ${clientName} - ${recordId} - ${evidenceType} - ${timestamp} - ${originalName}`;
      try {
        const boundary = `below-trade-${Date.now().toString(36)}`;
        const metadata = {
          name: fileName,
          parents: [photosFolderId],
          description: `Cliente: ${clientName}\nMercado: ${marketName}\nRegistro: ${recordType}\nCódigo: ${recordId}\nEvidencia: ${evidenceType}`,
          appProperties: { recordId, evidenceType, clientName, marketName, recordType },
        };
        const prefix = Buffer.from(
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
            `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
        );
        const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
        const multipartBody = Buffer.concat([prefix, body, suffix]);
        const connectors = new ReplitConnectors();
        const response = await connectors.proxy(
          "google-drive",
          "/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,webContentLink,parents",
          {
            method: "POST",
            headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
            body: multipartBody,
          },
        );

        const text = await response.text();
        if (!response.ok) {
          req.log.warn({ driveStatus: response.status, driveResponse: text.slice(0, 500), recordId }, "Google Drive rechazó la evidencia; se usará App Storage");
          throw new Error(`Google Drive ${response.status}`);
        }
        const file = JSON.parse(text) as {
          id: string;
          name: string;
          mimeType: string;
          webViewLink?: string;
          webContentLink?: string;
        };
        res.status(201).json({
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          url: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
          downloadUrl: file.webContentLink,
          storage: "google-drive",
        });
        return;
      } catch (driveError) {
        req.log.warn({ err: driveError, recordId }, "La evidencia continuará en App Storage");
      }

      const storageToken = await saveEvidenceToAppStorage(fileName, contentType, body);
      const storagePath = `/api/evidence-photos/storage/${storageToken}`;
      const forwardedProtocol = String(req.headers["x-forwarded-proto"] || req.protocol).split(",")[0].trim();
      const host = req.get("host");
      res.status(201).json({
        id: storageToken,
        name: fileName,
        mimeType: contentType,
        url: host ? `${forwardedProtocol}://${host}${storagePath}` : storagePath,
        storage: "app-storage",
      });
    } catch (error) {
      req.log.error({ err: error }, "No se pudo guardar la fotografía en almacenamiento persistente");
      res.status(502).json({
        message:
          error instanceof Error
            ? error.message
            : "No se pudo guardar la fotografía.",
      });
    }
  },
);

router.get("/evidence-photos/storage/:token", async (req, res) => {
  try {
    const objectName = Buffer.from(req.params.token, "base64url").toString("utf8");
    const { bucketName, prefix } = privateStorageLocation();
    if (!objectName.startsWith(`${prefix}/evidence/`)) {
      res.status(400).json({ message: "Ruta de evidencia inválida." });
      return;
    }
    const downloadUrl = await signedObjectUrl(bucketName, objectName, "GET");
    const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) {
      res.status(response.status === 404 ? 404 : 502).json({ message: "No se pudo recuperar la fotografía." });
      return;
    }
    res.status(200);
    res.setHeader("Content-Type", response.headers.get("content-type") || "application/octet-stream");
    res.setHeader("Cache-Control", "private, max-age=3600");
    const contentLength = response.headers.get("content-length");
    if (contentLength) res.setHeader("Content-Length", contentLength);
    res.send(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    req.log.error({ err: error }, "No se pudo recuperar la evidencia de App Storage");
    res.status(500).json({ message: "No se pudo recuperar la fotografía." });
  }
});

export default router;