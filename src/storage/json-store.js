import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export class JsonStore {
  #filePath;
  #createInitialSnapshot;
  #writeChain = Promise.resolve();

  constructor(filePath, createInitialSnapshot) {
    this.#filePath = filePath;
    this.#createInitialSnapshot = createInitialSnapshot;
  }

  async read() {
    await this.#ensureFile();
    const raw = await readFile(this.#filePath, "utf8");
    return JSON.parse(raw);
  }

  async replace(snapshot) {
    return this.#enqueueWrite(() => this.#write(snapshot));
  }

  async update(mutator) {
    return this.#enqueueWrite(async () => {
      const current = await this.read();
      const draft = structuredClone(current);
      const result = await mutator(draft);
      const nextSnapshot = result ?? draft;
      await this.#write(nextSnapshot);
      return nextSnapshot;
    });
  }

  async #ensureFile() {
    await mkdir(path.dirname(this.#filePath), { recursive: true });
    try {
      await readFile(this.#filePath, "utf8");
    } catch {
      await this.#write(this.#createInitialSnapshot());
    }
  }

  async #write(snapshot) {
    const payload = `${JSON.stringify(snapshot, null, 2)}\n`;
    const tempPath = `${this.#filePath}.${Date.now()}.tmp`;
    await writeFile(tempPath, payload, "utf8");
    await rename(tempPath, this.#filePath);
    return snapshot;
  }

  async #enqueueWrite(work) {
    const next = this.#writeChain.then(work);
    this.#writeChain = next.catch(() => {});
    return next;
  }
}
