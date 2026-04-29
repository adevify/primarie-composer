import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../../config/env.js";

export class SeedService {
  async copySeed(seedName: string, destinationPath: string): Promise<void> {
    const sourcePath = path.join(env.SEEDS_DIR, seedName);

    const sourceStat = await fs.stat(sourcePath).catch(() => null);
    if (!sourceStat?.isDirectory()) {
      throw new Error(`Seed folder not found: ${sourcePath}`);
    }

    await fs.mkdir(destinationPath, { recursive: true });
    await fs.cp(sourcePath, destinationPath, { recursive: true, force: true, errorOnExist: false });
  }
}
