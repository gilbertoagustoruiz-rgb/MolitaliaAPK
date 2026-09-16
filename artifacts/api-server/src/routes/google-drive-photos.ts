import { randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { raw, Router, type IRouter } from "express";

const router: IRouter = Router();
const allowedTypes = new Map([
  ["image/jpeg", ".jpg"], ["image/png", ".png"], ["image/webp", ".webp"],
  ["image/heic", ".heic"], ["image/heif", ".heif"],
]);

function spacesConfig() {
  const region = process.env.SPACES_REGION || "";
  const bucket = process.env.SPACES_BUCKET || "";
  const accessKeyId = process.env.SPACES_ACCESS_KEY_ID || "";
  const secretAccessKey = process.env.SPACES_SECRET_ACCESS_KEY || "";
  if (!region || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("DigitalOcean Spaces no está configurado.");
  }
  return {
    bucket,
    client: new S3Client({
      endpoint: process.env.SPACES_ENDPOINT || `https://${region}.digitaloceanspaces.com`,
      region: "us-east-1",
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
}

function safePart(value: string, fallback: string) {
  return decodeURIComponent(value || fallback).normalize("NFKD")
    .replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
    .slice(0, 80) || fallback;
}

router.post("/evidence-photos", raw({ type: ["image/*", "application/octet-stream"], limit: "5mb" }), async (req, res) => {
  try {
    const contentType = String(req.headers["content-type"] || "").split(";")[0];
    const extension = allowedTypes.get(contentType);
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
    if (!extension) { res.status(415).json({ message: "Formato de imagen no permitido." }); return; }
    if (!body.length) { res.status(400).json({ message: "La fotografía está vacía." }); return; }
    const recordId = safePart(String(req.headers["x-record-id"] || ""), "registro");
    const evidenceType = safePart(String(req.headers["x-evidence-type"] || ""), "evidencia");
    const date = new Date();
    const key = `evidence/${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${Date.now()}-${recordId}-${evidenceType}-${randomUUID()}${extension}`;
    const { bucket, client } = spacesConfig();
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, CacheControl: "private, max-age=3600" }));
    const token = Buffer.from(key).toString("base64url");
    const photoPath = `/api/evidence-photos/storage/${token}`;
    const protocol = String(req.headers["x-forwarded-proto"] || req.protocol).split(",")[0].trim();
    const host = req.get("host");
    res.status(201).json({ id: token, name: key.split("/").pop(), mimeType: contentType,
      url: host ? `${protocol}://${host}${photoPath}` : photoPath, storage: "digitalocean-spaces" });
  } catch (error) {
    req.log.error({ err: error }, "No se pudo guardar la fotografía en DigitalOcean Spaces");
    res.status(500).json({ message: error instanceof Error ? error.message : "No se pudo guardar la fotografía." });
  }
});

router.get("/evidence-photos/storage/:token", async (req, res) => {
  try {
    const key = Buffer.from(req.params.token, "base64url").toString("utf8");
    if (!key.startsWith("evidence/") || key.includes("..")) { res.status(400).json({ message: "Ruta de fotografía inválida." }); return; }
    const { bucket, client } = spacesConfig();
    const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!object.Body) { res.status(404).json({ message: "Fotografía no encontrada." }); return; }
    res.setHeader("Content-Type", object.ContentType || "image/jpeg");
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Cache-Control", "private, max-age=3600");
    const bytes = await object.Body.transformToByteArray();
    res.send(Buffer.from(bytes));
  } catch (error: any) {
    if (error?.name === "NoSuchKey") { res.status(404).json({ message: "Fotografía no encontrada." }); return; }
    req.log.error({ err: error }, "No se pudo recuperar la fotografía de DigitalOcean Spaces");
    res.status(500).json({ message: "No se pudo recuperar la fotografía." });
  }
});

// Compatibility viewer for evidence captured before the move to DigitalOcean.
// New uploads never use this endpoint; they are stored in Spaces above.
router.get("/evidence-photos/drive/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "");
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(id)) {
      res.status(400).json({ message: "Identificador de fotografía inválido." });
      return;
    }
    const response = await fetch(`https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=view&confirm=t`);
    if (!response.ok) {
      res.status(response.status === 404 ? 404 : 502).json({ message: "No se pudo recuperar la fotografía antigua." });
      return;
    }
    const contentType = response.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) {
      res.status(502).json({ message: "La fotografía antigua no está disponible públicamente." });
      return;
    }
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    req.log.error({ err: error }, "No se pudo mostrar la fotografía antigua de Google Drive");
    res.status(500).json({ message: "No se pudo mostrar la fotografía antigua." });
  }
});

export default router;
