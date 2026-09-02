import { Router, type IRouter } from "express";
import healthRouter from "./health";
import googleSheetsRouter from "./google-sheets";
import googleSheetsStorageRouter from "./google-sheets-storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(googleSheetsRouter);
router.use(googleSheetsStorageRouter);

export default router;
