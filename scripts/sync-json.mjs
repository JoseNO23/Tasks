import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { JsonStore } from "../src/storage/json-store.js";
import { createEmptySnapshot } from "../src/sample/empty-snapshot.js";
import { TaskMapService } from "../src/domain/task-map-service.js";

const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error("Usage: npm run import:file -- <path-to-json>");
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const store = new JsonStore(path.join(rootDir, "data", "task-map.json"), createEmptySnapshot);
const service = new TaskMapService(store);

const raw = await readFile(path.resolve(sourcePath), "utf8");
const snapshot = JSON.parse(raw);
await service.importSnapshot(snapshot);
console.log("Import completed.");
