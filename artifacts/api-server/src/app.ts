import express, { type Express } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import compression from "compression";
import { bumpDataVersion } from "./lib/read-cache";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
// Comprime las respuestas JSON (snapshot, catálogos, historial): menos datos
// móviles y respuestas más rápidas en señal débil. Las fotos ya vienen
// comprimidas y se dejan pasar sin recomprimir.
app.use(
  compression({
    filter: (req, res) =>
      !String(res.getHeader("Content-Type") || "").startsWith("image/") &&
      compression.filter(req, res),
  }),
);
// Cualquier escritura invalida la caché de lecturas cuando la respuesta termina
// (después del COMMIT). Subir una foto o iniciar sesión no toca estas tablas.
app.use("/api", (req, res, next) => {
  if (
    req.method !== "GET" &&
    req.method !== "HEAD" &&
    req.method !== "OPTIONS" &&
    !req.path.startsWith("/evidence-photos") &&
    req.path !== "/app-storage/login" &&
    req.path !== "/app-storage/verify-ids"
  ) {
    res.on("finish", bumpDataVersion);
    res.on("close", bumpDataVersion);
  }
  next();
});
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const staticDir = process.env.STATIC_DIR
  || path.resolve(moduleDir, "../../below-trade-panetones/dist/public");
app.use(express.static(staticDir));
app.get("/{*path}", (_req, res) => res.sendFile(path.join(staticDir, "index.html")));

export default app;
