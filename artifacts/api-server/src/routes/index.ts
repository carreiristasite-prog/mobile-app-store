import { Router, type IRouter } from "express";
import { apiReadiness } from "../services/readiness-runtime";
import { createHealthRouter } from "./health";
import v1Router from "./v1";

const router: IRouter = Router();

router.use(createHealthRouter(apiReadiness));
router.use("/v1", v1Router);

export default router;
