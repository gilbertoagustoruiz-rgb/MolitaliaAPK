import { Router, type IRouter } from "express";
import healthRouter from "./health";
import googleDrivePhotosRouter from "./google-drive-photos";
import appStorageRouter from "./app-storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(googleDrivePhotosRouter);
router.use(appStorageRouter);

export default router;
