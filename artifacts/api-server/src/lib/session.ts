/**
 * Sesiones firmadas ("pase") para que el servidor sepa quién hace cada petición.
 *
 * - Se emite al iniciar sesión con DNI y clave. El celular lo envía solo, en el
 *   encabezado Authorization, en cada petición: el usuario no vuelve a escribir
 *   su clave.
 * - Vencimiento deslizante: 30 días sin uso para promotores, 7 días para el resto.
 *   Mientras la app se use, el servidor devuelve un pase renovado
 *   (encabezado X-Session-Token).
 * - Queda revocado al instante (máx. 30 s) si un admin cambia la clave, desactiva
 *   al usuario o le cambia el rol: el pase lleva una huella de esos datos.
 * - El secreto de firma se guarda en app_metadata para que un reinicio o
 *   despliegue no cierre la sesión de todos. Puede fijarse con SESSION_SECRET.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { pool } from "@workspace/db";

export type SessionUser = {
  id: string;
  dni: string;
  role: string;
  status: string;
  data: Record<string, unknown>;
};

type TokenPayload = { u: string; r: string; v: string; e: number };

const DAY_MS = 24 * 60 * 60 * 1000;
const PROMOTER_ROLES = new Set(["PROMOTOR", "PROMOTOR PERMANENTE", "PROMOTOR ROTATIVO"]);
// Si el pase se emitió hace más de esto, se envía uno renovado.
const RENEW_AFTER_MS = 12 * 60 * 60 * 1000;
const USER_CACHE_MS = 30_000;

let secretPromise: Promise<Buffer> | null = null;

async function loadSecret(): Promise<Buffer> {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 32) return Buffer.from(fromEnv, "utf8");
  // Solo escribe una fila de configuración propia; ningún dato de negocio.
  await pool.query(
    `INSERT INTO app_metadata (key,value) VALUES ('session_secret',$1)
     ON CONFLICT (key) DO NOTHING`,
    [randomBytes(48).toString("base64url")],
  );
  const stored = await pool.query(
    "SELECT value FROM app_metadata WHERE key='session_secret' LIMIT 1",
  );
  return Buffer.from(String(stored.rows[0]?.value || ""), "utf8");
}

function secret() {
  if (!secretPromise) {
    secretPromise = loadSecret().catch((error) => {
      secretPromise = null;
      throw error;
    });
  }
  return secretPromise;
}

export function sessionTtlMs(role: string) {
  return (PROMOTER_ROLES.has(String(role).toUpperCase()) ? 30 : 7) * DAY_MS;
}

// Huella de lo que, si cambia, debe invalidar los pases emitidos.
function userFingerprint(row: { password_hash?: unknown; status?: unknown; role?: unknown }) {
  return createHash("sha256")
    .update(`${row.password_hash || ""}|${row.status || ""}|${row.role || ""}`)
    .digest("base64url")
    .slice(0, 22);
}

async function sign(payload: TokenPayload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", await secret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export async function issueSessionToken(row: {
  id: unknown;
  role?: unknown;
  status?: unknown;
  password_hash?: unknown;
  data?: unknown;
}) {
  const data = (row.data && typeof row.data === "object" ? row.data : {}) as Record<string, unknown>;
  const role = String(row.role || data.role || "");
  return sign({
    u: String(row.id),
    r: role,
    v: userFingerprint({ ...row, role: row.role ?? data.role }),
    e: Date.now() + sessionTtlMs(role),
  });
}

const userCache = new Map<string, { at: number; row: Record<string, unknown> | null }>();

async function loadUser(id: string) {
  const cached = userCache.get(id);
  if (cached && Date.now() - cached.at < USER_CACHE_MS) return cached.row;
  const result = await pool.query(
    "SELECT id,dni,role,status,password_hash,data FROM users WHERE id=$1 LIMIT 1",
    [id],
  );
  const row = result.rows[0] || null;
  if (userCache.size > 5000) userCache.clear();
  userCache.set(id, { at: Date.now(), row });
  return row;
}

export type VerifiedSession = { user: SessionUser; renewedToken: string | null };

/** Devuelve la sesión si el pase es válido, vigente y no fue revocado. */
export async function verifySessionToken(token: string): Promise<VerifiedSession | null> {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = createHmac("sha256", await secret()).update(body).digest();
  let given: Buffer;
  try {
    given = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload?.u || typeof payload.e !== "number" || payload.e <= Date.now()) return null;
  const row = await loadUser(String(payload.u));
  if (!row || row.status !== "ACTIVO" || !row.password_hash) return null;
  const data = (row.data && typeof row.data === "object" ? row.data : {}) as Record<string, unknown>;
  const role = String(row.role || data.role || "");
  if (userFingerprint({ ...row, role: row.role ?? data.role }) !== payload.v) return null;
  const issuedAt = payload.e - sessionTtlMs(payload.r);
  const renewedToken = Date.now() - issuedAt > RENEW_AFTER_MS ? await issueSessionToken(row) : null;
  return {
    user: { id: String(row.id), dni: String(row.dni || ""), role, status: String(row.status), data },
    renewedToken,
  };
}

/** Olvida los usuarios en caché: tras cualquier escritura, para que un cambio de
 * clave, estado o rol revoque los pases de inmediato. */
export function clearSessionUserCache() {
  userCache.clear();
}

// Sesión verificada de cada petición (la asigna el middleware de app.ts).
const requestSessions = new WeakMap<object, SessionUser>();
export function setRequestSession(req: object, user: SessionUser) {
  requestSessions.set(req, user);
}
export function sessionOf(req: object): SessionUser | null {
  return requestSessions.get(req) || null;
}
