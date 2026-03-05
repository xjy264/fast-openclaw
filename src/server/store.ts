import fs from "node:fs/promises";
import path from "node:path";
import type { DataStoreSchema } from "./types.js";

const defaultData: DataStoreSchema = {
  licenses: []
};

export class JsonStore {
  private readonly filePath: string;
  private pending: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async read(): Promise<DataStoreSchema> {
    try {
      const content = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(content) as DataStoreSchema;
      if (!parsed.licenses || !Array.isArray(parsed.licenses)) {
        return structuredClone(defaultData);
      }
      return parsed;
    } catch {
      return structuredClone(defaultData);
    }
  }

  async write(next: DataStoreSchema): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  }

  async withWrite<T>(fn: (current: DataStoreSchema) => T | Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const current = await this.read();
      const result = await fn(current);
      await this.write(current);
      return result;
    };

    const chained = this.pending.then(run, run);
    this.pending = chained.then(() => undefined, () => undefined);
    return chained;
  }
}
