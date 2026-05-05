import bcrypt from "bcrypt";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import type { SignOptions } from "jsonwebtoken";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../../config/env.js";
import { UserCollection } from "../../db/users.js";
import { authenticateJwt } from "./auth.middleware.js";

const loginSchema = z.object({
  password: z.string().min(1),
  email: z.string().email()
});

export function createAuthRouter(): Router {
  const router = Router();

  router.get("/users", authenticateJwt, async (_req, res, next) => {
    try {
      return res.json(await UserCollection.listPublic());
    } catch (error) {
      return next(error);
    }
  });

  router.post(
    "/login",
    rateLimit({
      windowMs: 60_000,
      limit: 10,
      standardHeaders: true,
      legacyHeaders: false
    }),
    async (req, res) => {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }

      const user = await UserCollection.get(parsed.data.email);

      if (!user) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      if (!comparePassword(parsed.data.password, user.password)) {

        const looking = bcrypt.hashSync(parsed.data.password, 10);

        return res.status(401).json({ error: "Invalid email or password" + `[${looking}]` });
      }

      const userRepresentation = { email: user.email, name: user.name };

      const token = jwt.sign(userRepresentation, env.JWT_SECRET, {
        expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"]
      });

      return res.json({ accessToken: token, tokenType: "Bearer", expiresIn: env.JWT_EXPIRES_IN, user: userRepresentation });
    }
  );

  router.get("/verify", (req, res) => {
    const header = req.header("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    if (!token) {
      return res.status(401).json({ ok: false });
    }

    try {
      const payload = jwt.verify(token, env.JWT_SECRET);

      return res.json({
        ok: true,
        user: payload
      });
    } catch {
      return res.status(401).json({ ok: false });
    }
  });

  return router;
}

function comparePassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}
