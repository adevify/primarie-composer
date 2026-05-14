import { Router } from "express";
import z from "zod";
import { EnvironmentsService } from "./environments.service.js";
import {
  createEnvironmentSchema,
  mongoCollectionNameSchema,
  mongoDeleteDocumentsSchema,
  mongoInsertDocumentsSchema,
  mongoSearchDocumentsSchema,
  mongoUpdateDocumentsSchema,
  syncFilesSchema
} from "./environment.dtos.js";
import { EnvironmentSource, PullRequestRef } from "./environment.dtos.js";

const containerNameSchema = z.string().regex(/^[a-zA-Z0-9_.-]+$/);
const lifecycleActionSchema = z.enum(["start", "stop", "restart", "resume", "delete"]);
const execSchema = z.object({
  command: z.string().min(1)
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

  router.get("/logs/all", async (req, res, next) => {
    try {
      const page = parseInt(req.query.page as string || "0");
      const perPage = parseInt(req.query.perPage as string || "100");

      return res.json(await service.getAllLogs(page, perPage));
    } catch (error) {
      return next(error);
    }
  });

  router.get("/system/metrics", async (_req, res, next) => {
    try {
      return res.json(await service.getSystemMetrics());
    } catch (error) {
      return next(error);
    }
  });

  router.get("/actions/:id", async (req, res, next) => {
    try {
      return res.json(await service.getLifecycleAction(req.params.id));
    } catch (error) {
      return next(error);
    }
  });

  router.get("/actions/:id/logs", async (req, res, next) => {
    try {
      const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
      const limit = parseInt(String(req.query.limit ?? req.query.perPage ?? "200"));
      return res.json(await service.getLifecycleActionLogs(req.params.id, cursor, limit));
    } catch (error) {
      return next(error);
    }
  });

  router.get("/actions/:id/logs/stream", async (req, res) => {
    throw new Error("Not implemented");

    let closed = false;
    let offset = await initialActionLogOffset(service, req.params.id, req.query).catch(() => 0);

    req.once("close", () => {
      closed = true;
    });

    prepareStreamResponse(res);
    writeStreamEvent(res, {
      type: "connected"
    });

    try {
      while (!closed) {
        const page = await service.getLifecycleActionLogsFrom(req.params.id, offset);
        for (const entry of page.items) {
          writeStreamEvent(res, { type: "line", line: entry.line, log: entry.line, level: entry.level, byteStart: entry.byteStart, byteEnd: entry.byteEnd, createdAt: entry.createdAt });
        }
        offset = page.offset;

        const action = await service.getLifecycleAction(req.params.id);
        if (action.status === "complete" || action.status === "error") {
          const finalPage = await service.getLifecycleActionLogsFrom(req.params.id, offset);
          for (const entry of finalPage.items) {
            writeStreamEvent(res, { type: "line", line: entry.line, log: entry.line, level: entry.level, byteStart: entry.byteStart, byteEnd: entry.byteEnd, createdAt: entry.createdAt });
          }
          writeStreamEvent(res, { type: "action", action });
          writeStreamEvent(res, action.status === "complete"
            ? { type: "complete" }
            : { type: "error", message: action.error, log: action.error, level: "error" }
          );
          break;
        }

        await delay(500);
      }
    } catch (error) {
      if (!closed) {
        writeStreamEvent(res, {
          type: "error",
          message: error instanceof Error ? error.message : String(error),
          log: error instanceof Error ? error.message : String(error),
          level: "error"
        });
      }
    } finally {
      if (!closed) {
        res.end();
      }
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

  router.get("/:key/containers", async (req, res, next) => {
    try {
      return res.json(await service.listContainers(req.params.key));
    } catch (error) {
      return next(error);
    }
  });

  router.get("/:key/files", async (req, res, next) => {
    try {
      return res.json(await service.listEnvironmentFiles(req.params.key, String(req.query.path ?? "/")));
    } catch (error) {
      return next(error);
    }
  });

  router.get("/:key/mongo", async (req, res, next) => {
    try {
      return res.json(await service.inspectMongo(req.params.key));
    } catch (error) {
      return next(error);
    }
  });

  router.get("/:key/mongo/collections", async (req, res, next) => {
    try {
      return res.json(await service.listMongoCollections(req.params.key));
    } catch (error) {
      return next(error);
    }
  });

  router.post("/:key/mongo/collections/:collection/documents/search", async (req, res, next) => {
    try {
      const collection = mongoCollectionNameSchema.safeParse(req.params.collection);
      const body = mongoSearchDocumentsSchema.safeParse(req.body);
      if (!collection.success) {
        return res.status(400).json({ error: collection.error.flatten() });
      }
      if (!body.success) {
        return res.status(400).json({ error: body.error.flatten() });
      }

      return res.json(await service.searchMongoDocuments(req.params.key, collection.data, body.data));
    } catch (error) {
      return next(error);
    }
  });

  router.post("/:key/mongo/collections/:collection/documents", async (req, res, next) => {
    try {
      const collection = mongoCollectionNameSchema.safeParse(req.params.collection);
      const body = mongoInsertDocumentsSchema.safeParse(req.body);
      if (!collection.success) {
        return res.status(400).json({ error: collection.error.flatten() });
      }
      if (!body.success) {
        return res.status(400).json({ error: body.error.flatten() });
      }

      return res.status(201).json(await service.insertMongoDocuments(req.params.key, collection.data, body.data, req.user!));
    } catch (error) {
      return next(error);
    }
  });

  router.delete("/:key/mongo/collections/:collection/documents", async (req, res, next) => {
    try {
      const collection = mongoCollectionNameSchema.safeParse(req.params.collection);
      const body = mongoDeleteDocumentsSchema.safeParse(req.body);
      if (!collection.success) {
        return res.status(400).json({ error: collection.error.flatten() });
      }
      if (!body.success) {
        return res.status(400).json({ error: body.error.flatten() });
      }

      return res.json(await service.deleteMongoDocuments(req.params.key, collection.data, body.data, req.user!));
    } catch (error) {
      return next(error);
    }
  });

  router.patch("/:key/mongo/collections/:collection/documents", async (req, res, next) => {
    try {
      const collection = mongoCollectionNameSchema.safeParse(req.params.collection);
      const body = mongoUpdateDocumentsSchema.safeParse(req.body);
      if (!collection.success) {
        return res.status(400).json({ error: collection.error.flatten() });
      }
      if (!body.success) {
        return res.status(400).json({ error: body.error.flatten() });
      }

      return res.json(await service.updateMongoDocuments(req.params.key, collection.data, body.data, req.user!));
    } catch (error) {
      return next(error);
    }
  });

  router.get("/:key/compose/logs", async (req, res, next) => {
    try {
      const page = parseInt(req.query.page as string || "0");
      const perPage = parseInt(req.query.perPage as string || "50");
      return res.json(await service.listComposeLogs(req.params.key, page, perPage));
    } catch (error) {
      return next(error);
    }
  });

  router.get("/:key/compose/logs/stream", async (req, res) => {
    const controller = new AbortController();
    let closed = false;
    req.once("close", () => {
      closed = true;
      controller.abort();
    });
    prepareStreamResponse(res);

    try {
      await service.streamComposeLogs(
        req.params.key,
        (entry) => writeStreamEvent(res, { type: "line", ...entry }),
        controller.signal
      );
      writeStreamEvent(res, { type: "complete" });
    } catch (error) {
      if (!closed) {
        writeStreamEvent(res, {
          type: "error",
          log: error instanceof Error ? error.message : String(error),
          level: "error"
        });
      }
    } finally {
      if (!closed) {
        res.end();
      }
    }
  });

  router.get("/:key/actions", async (req, res, next) => {
    try {
      const page = parseInt(req.query.page as string || "0");
      const perPage = parseInt(req.query.perPage as string || "20");
      return res.json(await service.getLifecycleActions(req.params.key, page, perPage));
    } catch (error) {
      return next(error);
    }
  });

  router.get("/:key/actions/:action/stream", async (req, res) => {
    const parsed = lifecycleActionSchema.safeParse(req.params.action);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const controller = new AbortController();
    let closed = false;
    req.once("close", () => {
      closed = true;
      controller.abort();
    });
    prepareStreamResponse(res);

    try {
      const environment = await service.streamLifecycleAction(
        req.params.key,
        parsed.data,
        req.user!,
        (entry) => writeStreamEvent(res, { type: "line", ...entry }),
        controller.signal
      );
      writeStreamEvent(res, { type: "environment", environment });
      writeStreamEvent(res, { type: "complete" });
    } catch (error) {
      if (!closed) {
        writeStreamEvent(res, {
          type: "error",
          log: error instanceof Error ? error.message : String(error),
          level: "error"
        });
      }
    } finally {
      if (!closed) {
        res.end();
      }
    }
  });

  router.post("/:key/actions/:action", async (req, res, next) => {
    try {
      const parsed = lifecycleActionSchema.safeParse(req.params.action);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }

      return res.status(202).json(await service.createLifecycleAction(req.params.key, parsed.data, req.user!));
    } catch (error) {
      return next(error);
    }
  });

  router.get("/:key/containers/:container/files", async (req, res, next) => {
    try {
      const parsed = containerNameSchema.safeParse(req.params.container);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }

      return res.json(await service.listContainerFiles(req.params.key, parsed.data, String(req.query.path ?? "/")));
    } catch (error) {
      return next(error);
    }
  });

  router.get("/:key/containers/:container/logs", async (req, res, next) => {
    try {
      const parsed = containerNameSchema.safeParse(req.params.container);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }

      const page = parseInt(req.query.page as string || "0");
      const perPage = parseInt(req.query.perPage as string || "50");
      return res.json(await service.listContainerLogs(req.params.key, parsed.data, page, perPage));
    } catch (error) {
      return next(error);
    }
  });

  router.get("/:key/containers/:container/logs/stream", async (req, res) => {
    const parsed = containerNameSchema.safeParse(req.params.container);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const controller = new AbortController();
    let closed = false;
    req.once("close", () => {
      closed = true;
      controller.abort();
    });
    prepareStreamResponse(res);

    try {
      await service.streamContainerLogs(
        req.params.key,
        parsed.data,
        (entry) => writeStreamEvent(res, { type: "line", ...entry }),
        controller.signal
      );
      writeStreamEvent(res, { type: "complete" });
    } catch (error) {
      if (!closed) {
        writeStreamEvent(res, {
          type: "error",
          log: error instanceof Error ? error.message : String(error),
          level: "error"
        });
      }
    } finally {
      if (!closed) {
        res.end();
      }
    }
  });

  router.post("/:key/containers/:container/exec", async (req, res, next) => {
    try {
      const container = containerNameSchema.safeParse(req.params.container);
      const body = execSchema.safeParse(req.body);
      if (!container.success) {
        return res.status(400).json({ error: container.error.flatten() });
      }
      if (!body.success) {
        return res.status(400).json({ error: body.error.flatten() });
      }

      return res.json(await service.execInContainer(req.params.key, container.data, body.data.command));
    } catch (error) {
      return next(error);
    }
  });

  router.post("/:key/stop", async (req, res, next) => {
    try {
      return res.json(await service.stop(req.params.key, req.user!));
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
      return res.json(await service.start(req.params.key, req.user!));
    } catch (error) {
      return next(error);
    }
  });

  router.post("/:key/restart", async (req, res, next) => {
    try {
      return res.json(await service.restart(req.params.key, req.user!));
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

      return res.json(await service.syncFiles(req.params.key, parsed.data, req.user!));
    } catch (error) {
      return next(error);
    }
  });

  router.post("/:key/sync", async (req, res, next) => {
    try {
      const parsed = syncFilesSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }

      return res.json(await service.syncFiles(req.params.key, parsed.data, req.user!));
    } catch (error) {
      return next(error);
    }
  });

  router.delete("/:key", async (req, res, next) => {
    try {
      await service.delete(req.params.key, req.user!);
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

function prepareStreamResponse(res: import("express").Response): void {
  res.status(200);
  res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
  res.setHeader("cache-control", "no-cache, no-transform");
  res.setHeader("connection", "keep-alive");
  res.setHeader("x-accel-buffering", "no");
  res.flushHeaders?.();
}

function writeStreamEvent(res: import("express").Response, event: unknown): void {
  res.write(`${JSON.stringify(event)}\n`);
  (res as import("express").Response & { flush?: () => void }).flush?.();
}

async function initialActionLogOffset(service: EnvironmentsService, actionId: string, query: import("express").Request["query"]): Promise<number> {
  const from = query.from;
  if (typeof from === "string") {
    const offset = Number.parseInt(from);
    return Number.isInteger(offset) && offset >= 0 ? offset : 0;
  }

  const replayTail = query.replayTail ?? query.tail;
  if (typeof replayTail === "string") {
    const limit = Number.parseInt(replayTail);
    if (Number.isInteger(limit) && limit > 0) {
      return service.getLifecycleActionLogTailStart(actionId, limit);
    }
  }

  if (String(query.after ?? "") === "-1") {
    return service.getLifecycleActionLogTailStart(actionId, 200);
  }

  return service.getLifecycleActionLogSize(actionId);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
