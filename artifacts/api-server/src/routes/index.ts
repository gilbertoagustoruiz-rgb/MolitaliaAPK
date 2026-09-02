import { Router, type IRouter } from "express";
import healthRouter from "./health";
import googleSheetsRouter from "./google-sheets";

const router: IRouter = Router();

router.use(healthRouter);
router.use(googleSheetsRouter);

export default router;
