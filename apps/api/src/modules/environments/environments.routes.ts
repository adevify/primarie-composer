import { Router } from "express";
import { z } from "zod";
import { EnvironmentsService } from "./environments.service.js";

const keySchema = z.string().regex(/^[a-z0-9]{4,12}$/);

const createEnvironmentSchema = z.object({
  key: keySchema.optional(),
  seed: z.string().regex(/^[a-zA-Z0-9_-]+$/).default("default"),
  tenants: z.array(z.string().regex(/^[a-z0-9-]+$/)).default([])
});

export function createEnvironmentRouter(): Router {
  const router = Router();
  const service = new EnvironmentsService();

  router.post("/", async (req, res, next) => {
    try {
      const parsed = createEnvironmentSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }

      const record = await service.create(parsed.data);
      return res.status(201).json(record);
    } catch (error) {
      return next(error);
    }
  });

  router.get("/", async (_req, res, next) => {
    try {
      return res.json(await service.list());
    } catch (error) {
      return next(error);
    }
  });

  router.get("/:key", async (req, res, next) => {
    try {
      return res.json(await service.get(req.params.key));
    } catch (error) {
      return next(error);
    }
  });

  router.post("/:key/stop", async (req, res, next) => {
    try {
      return res.json(await service.stop(req.params.key));
    } catch (error) {
      return next(error);
    }
  });

  router.post("/:key/start", async (req, res, next) => {
    try {
      return res.json(await service.start(req.params.key));
    } catch (error) {
      return next(error);
    }
  });

  router.post("/:key/restart", async (req, res, next) => {
    try {
      return res.json(await service.restart(req.params.key));
    } catch (error) {
      return next(error);
    }
  });

  router.delete("/:key", async (req, res, next) => {
    try {
      await service.delete(req.params.key);
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
