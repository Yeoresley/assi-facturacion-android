import { Router, type IRouter } from "express";
import healthRouter from "./health";
import billingRouter from "./billing";
import versatRouter from "./versat";
import legalDocumentsRouter from "./legal-documents";

const router: IRouter = Router();

router.use(healthRouter);
router.use(billingRouter);
router.use(versatRouter);
router.use(legalDocumentsRouter);

export default router;
