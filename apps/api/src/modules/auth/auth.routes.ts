import { Router } from "express";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import { z } from "zod";
import { env } from "../../config/env.js";

const loginSchema = z.object({
  accessKey: z.string().min(1)
});

export function createAuthRouter(): Router {
  const router = Router();

  router.post(
    "/login",
    rateLimit({
      windowMs: 60_000,
      limit: 10,
      standardHeaders: true,
      legacyHeaders: false
    }),
    (req, res) => {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }

      if (parsed.data.accessKey !== env.ELECTRON_ACCESS_KEY) {
        return res.status(401).json({ error: "Invalid access key" });
      }

      const token = jwt.sign({ sub: "electron-app", scope: "environment:write" }, env.JWT_SECRET, {
        expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"]
      });

      return res.json({ accessToken: token, tokenType: "Bearer", expiresIn: env.JWT_EXPIRES_IN });
    }
  );

  return router;
}
