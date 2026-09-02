import { Router, type IRouter } from "express";
import healthRouter from "./health";
import googleSheetsRouter from "./google-sheets";
import googleSheetsStorageRouter from "./google-sheets-storage";
import googleDrivePhotosRouter from "./google-drive-photos";

const router: IRouter = Router();

router.use(healthRouter);
router.use(googleSheetsRouter);
router.use(googleSheetsStorageRouter);
router.use(googleDrivePhotosRouter);

export default router;
