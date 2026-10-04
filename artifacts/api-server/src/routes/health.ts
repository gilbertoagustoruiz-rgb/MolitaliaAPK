import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      status: "ok",
      database: "ok",
      storage: "digitalocean-postgresql",
      revision:
        process.env.SOURCE_COMMIT ||
        process.env.GIT_COMMIT_SHA ||
        process.env.COMMIT_SHA ||
        null,
      checkedAt: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({
      status: "error",
      database: "unavailable",
      checkedAt: new Date().toISOString(),
    });
  }
});

export default router;
