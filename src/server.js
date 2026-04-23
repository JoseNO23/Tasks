import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonStore } from "./storage/json-store.js";
import { createEmptySnapshot } from "./sample/empty-snapshot.js";
import { TaskMapService } from "./domain/task-map-service.js";
import { createApiRouter } from "./routes/api.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const dataFilePath = path.join(rootDir, "data", "task-map.json");

const store = new JsonStore(dataFilePath, createEmptySnapshot);
const service = new TaskMapService(store);

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use("/api", createApiRouter(service));
app.use(express.static(publicDir));
app.use((_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

const port = Number(process.env.PORT || 8080);
app.listen(port, () => {
  console.log(`TASKS running at http://localhost:${port}`);
});
