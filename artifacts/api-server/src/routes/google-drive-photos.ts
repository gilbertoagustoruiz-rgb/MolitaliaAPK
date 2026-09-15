import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { raw, Router, type IRouter } from "express";

const router: IRouter = Router();
const allowedTypes = new Map([
  ["image/jpeg", ".jpg"], ["image/png", ".png"], ["image/webp", ".webp"],
  ["image/heic", ".heic"], ["image/heif", ".heif"],
]);

function storageDir() {
  return process.env.PHOTO_STORAGE_DIR || "/var/data/molitalia/photos";
}

function safePart(value: string, fallback: string) {
  return decodeURIComponent(value || fallback).normalize("NFKD")
    .replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
    .slice(0, 80) || fallback;
}

router.post(
  "/evidence-photos",
  raw({ type: ["image/*", "application/octet-stream"], limit: "12mb" }),
  async (req, res) => {
    try {
      const contentType = String(req.headers["content-type"] || "").split(";")[0];
      const extension = allowedTypes.get(contentType);
      const recordId = safePart(String(req.headers["x-record-id"] || ""), "registro");
      const evidenceType = safePart(String(req.headers["x-evidence-type"] || ""), "evidencia");
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
      if (!extension) { res.status(415).json({ message: "Formato de imagen no permitido." }); return; }
      if (!body.length) { res.status(400).json({ message: "La fotografía está vacía." }); return; }

      await mkdir(storageDir(), { recursive: true });
      const token = `${Date.now()}-${recordId}-${evidenceType}-${randomUUID()}${extension}`;
      const destination = path.join(storageDir(), token);
      const temporary = `${destination}.tmp`;
      await writeFile(temporary, body, { flag: "wx" });
      await rename(temporary, destination);
      const photoPath = `/api/evidence-photos/storage/${encodeURIComponent(token)}`;
      const protocol = String(req.headers["x-forwarded-proto"] || req.protocol).split(",")[0].trim();
      const host = req.get("host");
      res.status(201).json({ id: token, name: token, mimeType: contentType,
        url: host ? `${protocol}://${host}${photoPath}` : photoPath, storage: "render-disk" });
    } catch (error) {
      req.log.error({ err: error }, "No se pudo guardar la fotografía en el disco persistente");
      res.status(500).json({ message: "No se pudo guardar la fotografía en Render." });
    }
  },
);

router.get("/evidence-photos/storage/:token", async (req, res) => {
  try {
    const token = path.basename(req.params.token);
    if (token !== req.params.token || !/^[\w.-]+$/.test(token)) {
      res.status(400).json({ message: "Ruta de fotografía inválida." }); return;
    }
    const extension = path.extname(token).toLowerCase();
    const contentType = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp"
      : extension === ".heic" ? "image/heic" : extension === ".heif" ? "image/heif" : "image/jpeg";
    const body = await readFile(path.join(storageDir(), token));
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(body);
  } catch (error: any) {
    if (error?.code === "ENOENT") { res.status(404).json({ message: "Fotografía no encontrada." }); return; }
    req.log.error({ err: error }, "No se pudo recuperar la fotografía de Render");
    res.status(500).json({ message: "No se pudo recuperar la fotografía." });
  }
});

export default router;
