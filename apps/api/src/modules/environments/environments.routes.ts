import { Router } from "express";
import { EnvironmentsService } from "./environments.service.js";
import { createEnvironmentSchema, syncFilesSchema } from "./environment.dtos.js";
import { EnvironmentSource, PullRequestRef } from "./environment.dtos.js";


export function createEnvironmentRouter(): Router {
  const router = Router();
  const service = new EnvironmentsService();

  router.post("/", async (req, res, next) => {
    try {
      const parsed = createEnvironmentSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }

      const record = await service.create(parsed.data, service.toOwner(req.user!));
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

  router.get("/:key/logs", async (req, res, next) => {
    try {
      const page = parseInt(req.query.page as string || "0");
      const perPage = parseInt(req.query.perPage as string || "50");

      return res.json(await service.getLogs(req.params.key, page, perPage));
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

  router.post("/:key/resume", async (req, res, next) => {
    try {
      return res.json(await service.resume(req.params.key, req.user!));
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

  router.post("/:key/sync-files", async (req, res, next) => {
    try {
      const parsed = syncFilesSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }

      return res.json(await service.syncFiles(req.params.key, parsed.data));
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

  router.post("/github/webhook", async (req, res, next) => {
    try {
      const event = req.header("X-GitHub-Event");

      if (event !== "pull_request") {
        return res.status(204).send();
      }

      const payload = req.body;

      const action = payload.action;
      const pr = payload.pull_request;

      const pullRequest: PullRequestRef = {
        title: pr.title,
        url: pr.html_url,
      };

      const source: EnvironmentSource = {
        branch: pr.head.ref,
        commit: pr.head.sha,
      };

      if (action === "opened" || action === "reopened" || action === "synchronize") {
        return res.status(201).json(
          await service.replacePullRequestEnvironment(
            pullRequest,
            source,
          )
        );
      }

      if (action === "closed") {
        await service.deletePullRequestEnvironments(
          pullRequest,
        );

        return res.status(204).send();
      }

      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
