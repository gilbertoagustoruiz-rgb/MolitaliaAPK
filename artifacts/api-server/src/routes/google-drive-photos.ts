import { ReplitConnectors } from "@replit/connectors-sdk";
import { raw, Router, type IRouter } from "express";

const router: IRouter = Router();
const photosFolderId = "1nFFXODky2kHRHTa8R7hKkPAz65pukFa1";
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

function safeFileName(value: string) {
  const decoded = decodeURIComponent(value || "evidencia.jpg");
  return decoded
    .normalize("NFKD")
    .replace(/[^\w.\- ()]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 160);
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
      const fileName = `${recordId} - ${evidenceType} - ${timestamp} - ${originalName}`;
      const boundary = `below-trade-${Date.now().toString(36)}`;
      const metadata = {
        name: fileName,
        parents: [photosFolderId],
        appProperties: { recordId, evidenceType },
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
        throw new Error(`Google Drive ${response.status}: ${text.slice(0, 500)}`);
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
      });
    } catch (error) {
      res.status(502).json({
        message:
          error instanceof Error
            ? error.message
            : "No se pudo guardar la fotografía en Google Drive.",
      });
    }
  },
);

export default router;