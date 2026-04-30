import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";

export type AuthenticatedUser = {
  email: string;
  name: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export function authenticateJwt(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

  if (!token) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    if (typeof payload === "object") {
      req.user = {
        email: typeof payload.email === "string" ? payload.email : "[EMAIL_ADDRESS]",
        name: typeof payload.name === "string" ? payload.name : "Electron operator"
      };
    }
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
