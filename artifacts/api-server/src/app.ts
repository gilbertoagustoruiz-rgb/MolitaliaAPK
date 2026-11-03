import express, { type Express } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import compression from "compression";
import { bumpDataVersion } from "./lib/read-cache";
import {
  clearSessionUserCache,
  setRequestSession,
  verifySessionToken,
} from "./lib/session";
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
app.use(cors({ exposedHeaders: ["X-Session-Token"] }));
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
    const afterWrite = () => {
      bumpDataVersion();
      // Un cambio de clave, estado o rol revoca los pases al instante.
      clearSessionUserCache();
    };
    res.on("finish", afterWrite);
    res.on("close", afterWrite);
  }
  next();
});
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

// Sesión: identifica al usuario por su pase firmado (Authorization: Bearer ...).
// AUTH_MODE=enforce rechaza las peticiones sin pase válido en las rutas de datos.
// Por defecto ("warn") las acepta y las registra, para que ningún celular con una
// versión anterior de la app abierta se quede sin poder enviar sus pendientes.
const authMode = process.env.AUTH_MODE === "enforce" ? "enforce" : "warn";
logger.info({ authMode }, "Modo de sesiones");
const lastWarned = new Map<string, number>();
const isProtectedPath = (req: express.Request) =>
  (req.path.startsWith("/app-storage") && req.path !== "/app-storage/login") ||
  (req.path === "/evidence-photos" && req.method === "POST");

app.use("/api", async (req, res, next) => {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  let valid = false;
  if (token) {
    try {
      const session = await verifySessionToken(token);
      if (session) {
        valid = true;
        setRequestSession(req, session.user);
        if (session.renewedToken) res.setHeader("X-Session-Token", session.renewedToken);
      }
    } catch (error) {
      req.log.error({ err: error }, "No se pudo verificar la sesión");
    }
  }
  if (valid || req.method === "OPTIONS" || !isProtectedPath(req)) return next();
  if (authMode === "enforce") {
    res.status(401).json({
      code: token ? "SESSION_INVALID" : "SESSION_REQUIRED",
      message: "Tu sesión venció. Ingresa de nuevo con tu DNI y clave.",
    });
    return;
  }
  // Modo aviso: se permite y se registra (como máximo una vez por minuto por ruta).
  const key = `${req.method} ${req.path.replace(/\/[^/]*\d[^/]*$/, "/:id")}`;
  const now = Date.now();
  if ((lastWarned.get(key) || 0) < now - 60_000) {
    lastWarned.set(key, now);
    req.log.warn({ route: key, hadToken: Boolean(token) }, "Petición sin sesión (permitida en modo aviso)");
  }
  next();
});

app.use("/api", router);

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const staticDir = process.env.STATIC_DIR
  || path.resolve(moduleDir, "../../below-trade-panetones/dist/public");
app.use(express.static(staticDir));
app.get("/{*path}", (_req, res) => res.sendFile(path.join(staticDir, "index.html")));

export default app;
