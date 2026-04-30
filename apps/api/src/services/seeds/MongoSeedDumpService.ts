import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../../config/env.js";

export class MongoSeedDumpService {
  async createDump(seedName: string, destinationPath: string): Promise<void> {
    const sourcePath = path.join(env.SEEDS_DIR, seedName);
    const sourceStat = await fs.stat(sourcePath).catch(() => null);
    if (!sourceStat?.isDirectory()) {
      throw new Error(`Seed folder not found: ${sourcePath}`);
    }

    await fs.rm(destinationPath, { recursive: true, force: true });
    await fs.mkdir(destinationPath, { recursive: true });

    const entries = await fs.readdir(sourcePath, { withFileTypes: true });
    const jsonFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => entry.name);

    for (const fileName of jsonFiles) {
      await fs.copyFile(path.join(sourcePath, fileName), path.join(destinationPath, fileName));
    }

    await fs.writeFile(path.join(destinationPath, "seed-data.js"), await this.buildSeedScript(sourcePath, jsonFiles), "utf8");
  }

  private async buildSeedScript(sourcePath: string, jsonFiles: string[]): Promise<string> {
    const importLines = await Promise.all(jsonFiles.map(async (fileName) => {
      const collection = path.basename(fileName, ".json");
      const rawJson = await fs.readFile(path.join(sourcePath, fileName), "utf8");
      return [
        `(() => {`,
        `  const data = ${rawJson.trim()};`,
        `  const collection = db.getCollection(${JSON.stringify(collection)});`,
        `  if (Array.isArray(data)) {`,
        `    if (data.length > 0) collection.insertMany(data);`,
        `  } else {`,
        `    collection.insertOne(data);`,
        `  }`,
        `})();`
      ].join("\n");
    }));

    return [...importLines, ""].join("\n");
  }
}
