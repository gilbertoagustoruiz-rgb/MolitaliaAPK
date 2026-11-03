import app from "./app";
import { logger } from "./lib/logger";
import {
  ensureDatabaseSchema,
  ensurePerformanceIndexes,
} from "@workspace/db/init";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

await ensureDatabaseSchema();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // En segundo plano: no retrasa el arranque ni bloquea tablas.
  void ensurePerformanceIndexes((message, error) =>
    error ? logger.error({ err: error }, message) : logger.info(message),
  );
});
