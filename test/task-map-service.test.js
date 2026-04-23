import test from "node:test";
import assert from "node:assert/strict";
import { TaskMapService } from "../src/domain/task-map-service.js";
import { createEmptySnapshot } from "../src/sample/empty-snapshot.js";

class MemoryStore {
  constructor(snapshot = createEmptySnapshot()) {
    this.snapshot = structuredClone(snapshot);
  }

  async read() {
    return structuredClone(this.snapshot);
  }

  async replace(snapshot) {
    this.snapshot = structuredClone(snapshot);
    return this.read();
  }

  async update(mutator) {
    const draft = structuredClone(this.snapshot);
    const result = await mutator(draft);
    this.snapshot = structuredClone(result ?? draft);
    return this.read();
  }
}

async function buildServiceWithBasicMap() {
  const store = new MemoryStore();
  const service = new TaskMapService(store);
  await service.createPhase({ name: "Planning" });
  const { phases } = await service.getWorkspace();
  await service.createCategory({ phaseId: phases[0].id, name: "General" });
  const workspace = await service.getWorkspace();
  return { service, phaseId: workspace.phases[0].id, categoryId: workspace.categories[0].id };
}

test("rejects self dependency", async () => {
  const { service, phaseId, categoryId } = await buildServiceWithBasicMap();
  const workspace = await service.createTask({
    title: "Base",
    phaseId,
    categoryId,
  });
  const taskId = workspace.tasks[0].id;

  await assert.rejects(
    () =>
      service.updateTask(taskId, {
        dependencyIds: [taskId],
      }),
    /cannot depend on itself/i,
  );
});

test("rejects circular dependency", async () => {
  const { service, phaseId, categoryId } = await buildServiceWithBasicMap();
  let workspace = await service.createTask({ title: "A", phaseId, categoryId });
  const taskA = workspace.tasks.find((task) => task.title === "A");
  workspace = await service.createTask({ title: "B", phaseId, categoryId, dependencyIds: [taskA.id] });
  const taskB = workspace.tasks.find((task) => task.title === "B");

  await assert.rejects(
    () =>
      service.updateTask(taskA.id, {
        dependencyIds: [taskB.id],
      }),
    /cycle/i,
  );
});

test("prevents blocked task from starting", async () => {
  const { service, phaseId, categoryId } = await buildServiceWithBasicMap();
  let workspace = await service.createTask({ title: "Base", phaseId, categoryId });
  const baseTask = workspace.tasks.find((task) => task.title === "Base");
  workspace = await service.createTask({
    title: "Dependiente",
    phaseId,
    categoryId,
    dependencyIds: [baseTask.id],
  });
  const dependentTask = workspace.tasks.find((task) => task.title === "Dependiente");

  await assert.rejects(
    () =>
      service.setTaskStatus(dependentTask.id, "in_progress"),
    /still blocked/i,
  );
});

test("branch delete removes descendants and broken references", async () => {
  const { service, phaseId, categoryId } = await buildServiceWithBasicMap();
  let workspace = await service.createTask({ title: "Raiz", phaseId, categoryId });
  const root = workspace.tasks.find((task) => task.title === "Raiz");
  workspace = await service.createTask({ title: "Hija", phaseId, categoryId, parentTaskId: root.id });
  const child = workspace.tasks.find((task) => task.title === "Hija");
  workspace = await service.createTask({
    title: "Bloqueada por hija",
    phaseId,
    categoryId,
    dependencyIds: [child.id],
  });

  workspace = await service.deleteTask(root.id, "branch");
  assert.equal(workspace.tasks.length, 1);
  assert.deepEqual(workspace.tasks[0].dependencyIds, []);
});

test("promoting children fails when external dependencies target the node", async () => {
  const { service, phaseId, categoryId } = await buildServiceWithBasicMap();
  let workspace = await service.createTask({ title: "Nodo", phaseId, categoryId });
  const node = workspace.tasks.find((task) => task.title === "Nodo");
  workspace = await service.createTask({ title: "Hija", phaseId, categoryId, parentTaskId: node.id });
  workspace = await service.createTask({
    title: "Externa",
    phaseId,
    categoryId,
    dependencyIds: [node.id],
  });

  await assert.rejects(
    () => service.deleteTask(node.id, "promote"),
    /still depend on this node/i,
  );
});

test("promoting children reassigns parentTaskId", async () => {
  const { service, phaseId, categoryId } = await buildServiceWithBasicMap();
  let workspace = await service.createTask({ title: "Raiz", phaseId, categoryId });
  const root = workspace.tasks.find((task) => task.title === "Raiz");
  workspace = await service.createTask({ title: "Nodo", phaseId, categoryId, parentTaskId: root.id });
  const node = workspace.tasks.find((task) => task.title === "Nodo");
  workspace = await service.createTask({ title: "Hija", phaseId, categoryId, parentTaskId: node.id });
  const child = workspace.tasks.find((task) => task.title === "Hija");

  workspace = await service.deleteTask(node.id, "promote");
  const movedChild = workspace.tasks.find((task) => task.id === child.id);
  assert.equal(movedChild.parentTaskId, root.id);
});
