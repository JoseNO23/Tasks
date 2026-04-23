import { Router } from "express";
import { AppError } from "../utils/errors.js";

function asyncHandler(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

export function createApiRouter(service) {
  const router = Router();

  router.get(
    "/map",
    asyncHandler(async (_req, res) => {
      res.json({ data: await service.getWorkspace() });
    }),
  );

  router.get(
    "/export",
    asyncHandler(async (_req, res) => {
      const snapshot = await service.exportSnapshot();
      res.setHeader("Content-Disposition", 'attachment; filename="tasks-export.json"');
      res.json(snapshot);
    }),
  );

  router.post(
    "/import",
    asyncHandler(async (req, res) => {
      res.json({ data: await service.importSnapshot(req.body) });
    }),
  );

  router.post(
    "/phases",
    asyncHandler(async (req, res) => {
      res.status(201).json({ data: await service.createPhase(req.body) });
    }),
  );

  router.patch(
    "/phases/:phaseId",
    asyncHandler(async (req, res) => {
      res.json({ data: await service.updatePhase(req.params.phaseId, req.body) });
    }),
  );

  router.post(
    "/phases/:phaseId/move",
    asyncHandler(async (req, res) => {
      res.json({ data: await service.movePhase(req.params.phaseId, req.body.direction) });
    }),
  );

  router.delete(
    "/phases/:phaseId",
    asyncHandler(async (req, res) => {
      res.json({ data: await service.deletePhase(req.params.phaseId) });
    }),
  );

  router.post(
    "/categories",
    asyncHandler(async (req, res) => {
      res.status(201).json({ data: await service.createCategory(req.body) });
    }),
  );

  router.patch(
    "/categories/:categoryId",
    asyncHandler(async (req, res) => {
      res.json({ data: await service.updateCategory(req.params.categoryId, req.body) });
    }),
  );

  router.post(
    "/categories/:categoryId/move",
    asyncHandler(async (req, res) => {
      res.json({ data: await service.moveCategory(req.params.categoryId, req.body.direction) });
    }),
  );

  router.delete(
    "/categories/:categoryId",
    asyncHandler(async (req, res) => {
      res.json({ data: await service.deleteCategory(req.params.categoryId) });
    }),
  );

  router.post(
    "/assignees",
    asyncHandler(async (req, res) => {
      res.status(201).json({ data: await service.createAssignee(req.body) });
    }),
  );

  router.patch(
    "/assignees/:assigneeId",
    asyncHandler(async (req, res) => {
      res.json({ data: await service.updateAssignee(req.params.assigneeId, req.body) });
    }),
  );

  router.delete(
    "/assignees/:assigneeId",
    asyncHandler(async (req, res) => {
      res.json({ data: await service.deleteAssignee(req.params.assigneeId) });
    }),
  );

  router.post(
    "/tasks",
    asyncHandler(async (req, res) => {
      res.status(201).json({ data: await service.createTask(req.body) });
    }),
  );

  router.patch(
    "/tasks/:taskId",
    asyncHandler(async (req, res) => {
      res.json({ data: await service.updateTask(req.params.taskId, req.body) });
    }),
  );

  router.post(
    "/tasks/:taskId/status",
    asyncHandler(async (req, res) => {
      res.json({ data: await service.setTaskStatus(req.params.taskId, req.body.status) });
    }),
  );

  router.delete(
    "/tasks/:taskId",
    asyncHandler(async (req, res) => {
      res.json({ data: await service.deleteTask(req.params.taskId, req.query.strategy) });
    }),
  );

  router.use((error, _req, res, _next) => {
    if (error instanceof AppError) {
      res.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      });
      return;
    }

    console.error(error);
    res.status(500).json({
      error: {
        code: "internal_error",
        message: "Unexpected server error.",
      },
    });
  });

  return router;
}
