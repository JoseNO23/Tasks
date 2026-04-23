import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonStore } from "../src/storage/json-store.js";
import { createEmptySnapshot } from "../src/sample/empty-snapshot.js";
import { TaskMapService } from "../src/domain/task-map-service.js";

const sourceUrl = process.argv[2];
if (!sourceUrl) {
  console.error("Usage: npm run import:url -- <read-only-url>");
  process.exit(1);
}

const response = await fetch(sourceUrl);
if (!response.ok) {
  console.error(`Could not read URL: ${response.status} ${response.statusText}`);
  process.exit(1);
}

const snapshot = await response.json();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const store = new JsonStore(path.join(rootDir, "data", "task-map.json"), createEmptySnapshot);
const service = new TaskMapService(store);

await service.importSnapshot(snapshot);
console.log("Read-only import completed.");
