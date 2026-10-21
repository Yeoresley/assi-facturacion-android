import { Router, type IRouter } from "express";
import healthRouter from "./health";
import billingRouter from "./billing";
import versatRouter from "./versat";
import legalDocumentsRouter from "./legal-documents";
import settlementsRouter from "./settlements";

const router: IRouter = Router();

router.use(healthRouter);
router.use(billingRouter);
router.use(versatRouter);
router.use(legalDocumentsRouter);
router.use(settlementsRouter);

export default router;
