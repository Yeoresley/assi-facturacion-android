import { Router, type IRouter } from "express";
import healthRouter from "./health";
import billingRouter from "./billing";
import versatRouter from "./versat";

const router: IRouter = Router();

router.use(healthRouter);
router.use(billingRouter);
router.use(versatRouter);

export default router;
