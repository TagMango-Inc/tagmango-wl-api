import { Hono } from "hono";

const router = new Hono();

router.get("/", ...getAllFormsHandler);

router.get("/:hostId", ...getFormByHostIdHandler);
router.post("/:hostId/request", ...createFormRequestHandler);

router.patch("/:formId", ...patchFormByIdHandler);
router.delete("/:formId", ...deleteFormByIdHandler);

router.patch("/:formId/approve", ...approveFormHandler);
router.patch("/:formId/reject", ...rejectFormHandler);

router.patch("/:formId/mark-deployed", ...markFormDeployedHandler);

export default router;
