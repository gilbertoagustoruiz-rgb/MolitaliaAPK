/**
 * Caché de lecturas pesadas, segura frente a escrituras.
 *
 * - Toda escritura (POST/PUT/PATCH/DELETE a la API) incrementa `dataVersion`
 *   cuando la respuesta termina, es decir, después del COMMIT. Una entrada
 *   guardada con una versión anterior deja de ser válida en ese instante.
 * - Una lectura solo se guarda si ninguna escritura terminó mientras se
 *   calculaba; si no, se devuelve igual (está fresca) pero no se guarda.
 * - El vencimiento corto (ttlMs) acota la antigüedad máxima ante escrituras
 *   hechas fuera de este proceso (scripts, otra instancia del servidor).
 * - Pedidos simultáneos de la misma clave comparten una sola consulta.
 *
 * No guarda nada en disco ni en la base: solo evita repetir la misma lectura.
 */

let dataVersion = 0;

export function bumpDataVersion() {
  dataVersion += 1;
}

type Entry = { version: number; expiresAt: number; body: string };

const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<string>>();
const MAX_ENTRIES = 300;

export async function cachedJson(
  key: string,
  ttlMs: number,
  produce: () => Promise<unknown>,
): Promise<string> {
  const now = Date.now();
  const hit = entries.get(key);
  if (hit && hit.version === dataVersion && hit.expiresAt > now) return hit.body;

  const startVersion = dataVersion;
  const inflightKey = `${startVersion}:${key}`;
  const pending = inflight.get(inflightKey);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const body = JSON.stringify(await produce());
      if (startVersion === dataVersion) {
        if (entries.size >= MAX_ENTRIES) entries.clear();
        entries.set(key, { version: startVersion, expiresAt: now + ttlMs, body });
      }
      return body;
    } finally {
      inflight.delete(inflightKey);
    }
  })();
  inflight.set(inflightKey, promise);
  return promise;
}
