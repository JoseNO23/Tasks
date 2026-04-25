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

test("keeps hierarchy separate from blockedBy while gating a child behind a pending parent", async () => {
  const { service, phaseId, categoryId } = await buildServiceWithBasicMap();
  let workspace = await service.createTask({ title: "Root", phaseId, categoryId });
  const root = workspace.tasks.find((task) => task.title === "Root");
  workspace = await service.createTask({ title: "Child", phaseId, categoryId, parentTaskId: root.id });
  const child = workspace.tasks.find((task) => task.title === "Child");

  assert.deepEqual(child.dependencyIds, []);
  assert.deepEqual(child.blockedByIds, []);
  assert.equal(child.hierarchyBlocked, true);
  assert.equal(child.effectiveStatus, "blocked");
});

test("rejects duplicate assignee names after normalization", async () => {
  const { service } = await buildServiceWithBasicMap();
  await service.createAssignee({ name: "  Ana   Perez " });

  await assert.rejects(
    () => service.createAssignee({ name: "ana perez" }),
    /duplicate/i,
  );
});

test("prevents deleting assignees that are still in use", async () => {
  const { service, phaseId, categoryId } = await buildServiceWithBasicMap();
  let workspace = await service.createAssignee({ name: "Ana" });
  const assignee = workspace.assignees.find((item) => item.name === "Ana");
  workspace = await service.createTask({ title: "Task", phaseId, categoryId, assigneeId: assignee.id });

  await assert.rejects(
    () => service.deleteAssignee(assignee.id),
    /deactivate it instead|still used/i,
  );
});

test("rejects dependencies against the same local branch", async () => {
  const { service, phaseId, categoryId } = await buildServiceWithBasicMap();
  let workspace = await service.createTask({ title: "Root", phaseId, categoryId });
  const root = workspace.tasks.find((task) => task.title === "Root");
  workspace = await service.createTask({ title: "Child", phaseId, categoryId, parentTaskId: root.id });
  const child = workspace.tasks.find((task) => task.title === "Child");

  await assert.rejects(
    () => service.updateTask(child.id, { dependencyIds: [root.id] }),
    /own local branch|branch/i,
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

test("propagates blocked status from a blocked parent to its children", async () => {
  const { service, phaseId, categoryId } = await buildServiceWithBasicMap();
  let workspace = await service.createTask({ title: "Base", phaseId, categoryId });
  const baseTask = workspace.tasks.find((task) => task.title === "Base");
  workspace = await service.createTask({
    title: "Parent",
    phaseId,
    categoryId,
    dependencyIds: [baseTask.id],
  });
  const parentTask = workspace.tasks.find((task) => task.title === "Parent");
  workspace = await service.createTask({
    title: "Child",
    phaseId,
    categoryId,
    parentTaskId: parentTask.id,
  });
  const childTask = workspace.tasks.find((task) => task.title === "Child");

  assert.equal(parentTask.effectiveStatus, "blocked");
  assert.deepEqual(childTask.blockedByIds, []);
  assert.equal(childTask.hierarchyBlocked, true);
  assert.equal(childTask.effectiveStatus, "blocked");
});

test("keeps a child blocked until its parent leaves pending", async () => {
  const { service, phaseId, categoryId } = await buildServiceWithBasicMap();
  let workspace = await service.createTask({ title: "Base", phaseId, categoryId });
  const baseTask = workspace.tasks.find((task) => task.title === "Base");
  workspace = await service.createTask({
    title: "Parent",
    phaseId,
    categoryId,
    dependencyIds: [baseTask.id],
  });
  const parentTask = workspace.tasks.find((task) => task.title === "Parent");
  workspace = await service.createTask({
    title: "Child",
    phaseId,
    categoryId,
    parentTaskId: parentTask.id,
  });

  workspace = await service.setTaskStatus(baseTask.id, "completed");
  const updatedParent = workspace.tasks.find((task) => task.id === parentTask.id);
  const updatedChild = workspace.tasks.find((task) => task.title === "Child");

  assert.equal(updatedParent.effectiveStatus, "pending");
  assert.equal(updatedChild.hierarchyBlocked, true);
  assert.equal(updatedChild.effectiveStatus, "blocked");
});

test("enables a child only after its parent moves to in progress", async () => {
  const { service, phaseId, categoryId } = await buildServiceWithBasicMap();
  let workspace = await service.createTask({ title: "Parent", phaseId, categoryId });
  const parentTask = workspace.tasks.find((task) => task.title === "Parent");
  workspace = await service.createTask({
    title: "Child",
    phaseId,
    categoryId,
    parentTaskId: parentTask.id,
  });

  let childTask = workspace.tasks.find((task) => task.title === "Child");
  assert.equal(childTask.effectiveStatus, "blocked");

  workspace = await service.setTaskStatus(parentTask.id, "in_progress");
  childTask = workspace.tasks.find((task) => task.title === "Child");
  assert.equal(childTask.hierarchyBlocked, false);
  assert.equal(childTask.effectiveStatus, "pending");
});

test("blocks children again when the parent falls back to pending", async () => {
  const { service, phaseId, categoryId } = await buildServiceWithBasicMap();
  let workspace = await service.createTask({ title: "Parent", phaseId, categoryId, status: "in_progress" });
  const parentTask = workspace.tasks.find((task) => task.title === "Parent");
  workspace = await service.createTask({
    title: "Child",
    phaseId,
    categoryId,
    parentTaskId: parentTask.id,
  });
  let childTask = workspace.tasks.find((task) => task.title === "Child");

  assert.equal(childTask.effectiveStatus, "pending");

  workspace = await service.setTaskStatus(parentTask.id, "pending");
  childTask = workspace.tasks.find((task) => task.title === "Child");

  assert.equal(childTask.hierarchyBlocked, true);
  assert.equal(childTask.effectiveStatus, "blocked");
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

test("rejects completing a parent while any descendant is incomplete", async () => {
  const { service, phaseId, categoryId } = await buildServiceWithBasicMap();
  let workspace = await service.createTask({ title: "Raiz", phaseId, categoryId });
  const root = workspace.tasks.find((task) => task.title === "Raiz");
  workspace = await service.createTask({ title: "Hija", phaseId, categoryId, parentTaskId: root.id });
  const child = workspace.tasks.find((task) => task.title === "Hija");
  workspace = await service.createTask({ title: "Nieta", phaseId, categoryId, parentTaskId: child.id });

  await assert.rejects(
    () => service.setTaskStatus(root.id, "completed"),
    /descendant|subtree/i,
  );
});

test("demotes completed ancestors when a descendant becomes incomplete", async () => {
  const { service, phaseId, categoryId } = await buildServiceWithBasicMap();
  let workspace = await service.createTask({ title: "Raiz", phaseId, categoryId, status: "in_progress" });
  const root = workspace.tasks.find((task) => task.title === "Raiz");
  workspace = await service.createTask({ title: "Hija", phaseId, categoryId, parentTaskId: root.id, status: "completed" });
  const child = workspace.tasks.find((task) => task.title === "Hija");

  workspace = await service.setTaskStatus(root.id, "completed");
  assert.equal(workspace.tasks.find((task) => task.id === root.id)?.status, "completed");

  workspace = await service.setTaskStatus(child.id, "pending");
  assert.equal(workspace.tasks.find((task) => task.id === root.id)?.status, "pending");
});

test("normalizes imported parents with incomplete descendants", async () => {
  const { service, phaseId, categoryId } = await buildServiceWithBasicMap();
  const snapshot = {
    version: 1,
    phases: [{ id: phaseId, name: "Planning" }],
    categories: [{ id: categoryId, phaseId, name: "General" }],
    tasks: [
      {
        id: "task-root",
        title: "Raiz",
        phaseId,
        categoryId,
        parentTaskId: null,
        dependencyIds: [],
        status: "completed",
        priority: "medium",
        notes: "",
        assignee: "",
      },
      {
        id: "task-child",
        title: "Hija",
        phaseId,
        categoryId,
        parentTaskId: "task-root",
        dependencyIds: [],
        status: "pending",
        priority: "medium",
        notes: "",
        assignee: "",
      },
    ],
  };

  const workspace = await service.importSnapshot(snapshot);
  assert.equal(workspace.tasks.find((task) => task.id === "task-root")?.status, "pending");
});

test("repairs legacy local-branch dependencies on read", async () => {
  const snapshot = {
    version: 1,
    assignees: [],
    phases: [{ id: "phase-1", name: "Planning" }],
    categories: [{ id: "category-1", phaseId: "phase-1", name: "General" }],
    tasks: [
      {
        id: "task-root",
        title: "Root",
        phaseId: "phase-1",
        categoryId: "category-1",
        parentTaskId: null,
        dependencyIds: [],
        status: "pending",
        priority: "medium",
        notes: "",
        assignee: "",
      },
      {
        id: "task-child",
        title: "Child",
        phaseId: "phase-1",
        categoryId: "category-1",
        parentTaskId: "task-root",
        dependencyIds: ["task-root"],
        status: "pending",
        priority: "medium",
        notes: "",
        assignee: "",
      },
    ],
  };
  const store = new MemoryStore(snapshot);
  const service = new TaskMapService(store);

  const workspace = await service.getWorkspace();
  const child = workspace.tasks.find((task) => task.id === "task-child");

  assert.deepEqual(child.dependencyIds, []);
  assert.deepEqual(child.blockedByIds, []);
});

test("repairs legacy assignee strings into the assignee catalog", async () => {
  const snapshot = {
    version: 1,
    phases: [{ id: "phase-1", name: "Planning" }],
    categories: [{ id: "category-1", phaseId: "phase-1", name: "General" }],
    tasks: [
      {
        id: "task-1",
        title: "Task",
        phaseId: "phase-1",
        categoryId: "category-1",
        parentTaskId: null,
        dependencyIds: [],
        status: "pending",
        priority: "medium",
        notes: "",
        assignee: "  Ana   Perez ",
      },
    ],
  };
  const store = new MemoryStore(snapshot);
  const service = new TaskMapService(store);

  const workspace = await service.getWorkspace();

  assert.equal(workspace.assignees.length, 1);
  assert.equal(workspace.assignees[0].name, "Ana Perez");
  assert.equal(workspace.tasks[0].assignee, "Ana Perez");
  assert.equal(workspace.tasks[0].assigneeId, workspace.assignees[0].id);
});

test("allows reparenting a child when detaching it from the old parent", async () => {
  const { service, phaseId, categoryId } = await buildServiceWithBasicMap();
  let workspace = await service.createPhase({ name: "Execution" });
  const secondPhase = workspace.phases.find((phase) => phase.name === "Execution");
  workspace = await service.createCategory({ phaseId: secondPhase.id, name: "Backend" });
  const secondCategory = workspace.categories.find((category) => category.name === "Backend");
  workspace = await service.createTask({ title: "Raiz", phaseId, categoryId });
  const root = workspace.tasks.find((task) => task.title === "Raiz");
  workspace = await service.createTask({ title: "Hija", phaseId, categoryId, parentTaskId: root.id });
  const child = workspace.tasks.find((task) => task.title === "Hija");

  workspace = await service.updateTask(child.id, {
    phaseId: secondPhase.id,
    categoryId: secondCategory.id,
    parentTaskId: null,
  });

  const movedChild = workspace.tasks.find((task) => task.id === child.id);
  assert.equal(movedChild.phaseId, secondPhase.id);
  assert.equal(movedChild.categoryId, secondCategory.id);
  assert.equal(movedChild.parentTaskId, null);
});

test("stores exclusive date mode without losing other task data", async () => {
  const { service, phaseId, categoryId } = await buildServiceWithBasicMap();
  const dueDate = "2026-04-30";
  const workspace = await service.createTask({
    title: "Timed",
    phaseId,
    categoryId,
    timeMode: "date",
    dueDate,
  });

  const task = workspace.tasks.find((item) => item.title === "Timed");
  assert.equal(task.timeMode, "date");
  assert.equal(task.dueDate, dueDate);
  assert.equal(task.dueAt, null);
  assert.equal(task.trackedMs, 0);
  assert.equal(task.timerDurationMs, null);
  assert.equal(task.timerRemainingMs, null);
  assert.equal(task.timerRunning, false);
});

test("pauses the timer and stamps completion time when a task completes", async () => {
  const { service, phaseId, categoryId } = await buildServiceWithBasicMap();
  let workspace = await service.createTask({
    title: "Timed",
    phaseId,
    categoryId,
    timeMode: "stopwatch",
  });
  const task = workspace.tasks.find((item) => item.title === "Timed");

  await service.startTaskTimer(task.id);
  await new Promise((resolve) => setTimeout(resolve, 20));
  workspace = await service.setTaskStatus(task.id, "completed");

  const completedTask = workspace.tasks.find((item) => item.id === task.id);
  assert.equal(completedTask.timerRunning, false);
  assert.equal(completedTask.status, "completed");
  assert.ok(completedTask.completedAt);
  assert.ok(completedTask.trackedMs >= 10);
});

test("starting a new timer pauses the previously running timer", async () => {
  const { service, phaseId, categoryId } = await buildServiceWithBasicMap();
  let workspace = await service.createTask({
    title: "First",
    phaseId,
    categoryId,
    timeMode: "stopwatch",
  });
  const firstTask = workspace.tasks.find((item) => item.title === "First");
  workspace = await service.createTask({
    title: "Second",
    phaseId,
    categoryId,
    timeMode: "stopwatch",
  });
  const secondTask = workspace.tasks.find((item) => item.title === "Second");

  await service.startTaskTimer(firstTask.id);
  await new Promise((resolve) => setTimeout(resolve, 20));
  workspace = await service.startTaskTimer(secondTask.id);

  const updatedFirst = workspace.tasks.find((item) => item.id === firstTask.id);
  const updatedSecond = workspace.tasks.find((item) => item.id === secondTask.id);

  assert.equal(updatedFirst.timerRunning, false);
  assert.ok(updatedFirst.trackedMs >= 10);
  assert.equal(updatedSecond.timerRunning, true);
  assert.ok(updatedSecond.timerStartedAt);
});

test("allows completing a parent when all descendants are completed or discarded", async () => {
  const { service, phaseId, categoryId } = await buildServiceWithBasicMap();
  let workspace = await service.createTask({ title: "Raiz", phaseId, categoryId, status: "in_progress" });
  const root = workspace.tasks.find((task) => task.title === "Raiz");
  workspace = await service.createTask({ title: "Completa", phaseId, categoryId, parentTaskId: root.id, status: "completed" });
  workspace = await service.createTask({ title: "Descartada", phaseId, categoryId, parentTaskId: root.id });
  const discarded = workspace.tasks.find((task) => task.title === "Descartada");

  workspace = await service.setTaskStatus(discarded.id, "discarded");
  workspace = await service.setTaskStatus(root.id, "completed");

  assert.equal(workspace.tasks.find((task) => task.id === root.id)?.status, "completed");
});

test("discarding a node cascades to all descendants", async () => {
  const { service, phaseId, categoryId } = await buildServiceWithBasicMap();
  let workspace = await service.createTask({ title: "Raiz", phaseId, categoryId, status: "in_progress" });
  const root = workspace.tasks.find((task) => task.title === "Raiz");
  workspace = await service.createTask({ title: "Hija", phaseId, categoryId, parentTaskId: root.id });
  const child = workspace.tasks.find((task) => task.title === "Hija");
  workspace = await service.createTask({ title: "Nieta", phaseId, categoryId, parentTaskId: child.id });
  const grandchild = workspace.tasks.find((task) => task.title === "Nieta");

  workspace = await service.setTaskStatus(root.id, "discarded");

  assert.equal(workspace.tasks.find((task) => task.id === root.id)?.status, "discarded");
  assert.equal(workspace.tasks.find((task) => task.id === child.id)?.status, "discarded");
  assert.equal(workspace.tasks.find((task) => task.id === grandchild.id)?.status, "discarded");
});

test("child of a discarded parent shows discarded, not blocked", async () => {
  const { service, phaseId, categoryId } = await buildServiceWithBasicMap();
  let workspace = await service.createTask({ title: "Raiz", phaseId, categoryId, status: "in_progress" });
  const root = workspace.tasks.find((task) => task.title === "Raiz");
  workspace = await service.createTask({ title: "Hija", phaseId, categoryId, parentTaskId: root.id });
  const child = workspace.tasks.find((task) => task.title === "Hija");

  workspace = await service.setTaskStatus(root.id, "discarded");

  const updatedChild = workspace.tasks.find((task) => task.id === child.id);
  assert.equal(updatedChild.status, "discarded");
  assert.equal(updatedChild.effectiveStatus, "discarded");
  assert.notEqual(updatedChild.effectiveStatus, "blocked");
});

test("view and validator resolve identical effective status", async () => {
  const { service, phaseId, categoryId } = await buildServiceWithBasicMap();
  let workspace = await service.createTask({ title: "Base", phaseId, categoryId });
  const base = workspace.tasks.find((task) => task.title === "Base");
  workspace = await service.createTask({ title: "Dependiente", phaseId, categoryId, dependencyIds: [base.id] });
  const dependent = workspace.tasks.find((task) => task.title === "Dependiente");
  workspace = await service.createTask({ title: "Hija", phaseId, categoryId, parentTaskId: dependent.id });
  const child = workspace.tasks.find((task) => task.title === "Hija");

  // All blocked in different ways — view should match what validators accepted
  assert.equal(dependent.effectiveStatus, "blocked");
  assert.equal(child.effectiveStatus, "blocked");
  assert.equal(child.hierarchyBlocked, true);

  // Unblock base, let dependent start
  workspace = await service.setTaskStatus(base.id, "completed");
  workspace = await service.setTaskStatus(dependent.id, "in_progress");
  const unlockedChild = workspace.tasks.find((task) => task.id === child.id);
  assert.equal(unlockedChild.effectiveStatus, "pending");
  assert.equal(unlockedChild.hierarchyBlocked, false);
});

test("counts down timer mode and preserves remaining time when paused", async () => {
  const { service, phaseId, categoryId } = await buildServiceWithBasicMap();
  let workspace = await service.createTask({
    title: "Countdown",
    phaseId,
    categoryId,
    timeMode: "timer",
    timerDurationMs: 60_000,
  });
  const timerTask = workspace.tasks.find((item) => item.title === "Countdown");

  await service.startTaskTimer(timerTask.id);
  await new Promise((resolve) => setTimeout(resolve, 25));
  workspace = await service.pauseTaskTimer(timerTask.id);

  const pausedTask = workspace.tasks.find((item) => item.id === timerTask.id);
  assert.equal(pausedTask.timerRunning, false);
  assert.ok(pausedTask.timerRemainingMs < 60_000);
  assert.ok(pausedTask.timerRemainingMs > 0);
});

test("resetting map progress preserves structure while rewinding statuses and timers", async () => {
  const { service, phaseId, categoryId } = await buildServiceWithBasicMap();
  let workspace = await service.createTask({
    title: "Root",
    phaseId,
    categoryId,
    status: "in_progress",
    timeMode: "stopwatch",
    trackedMs: 1_500,
  });
  const root = workspace.tasks.find((task) => task.title === "Root");
  workspace = await service.createTask({
    title: "Child",
    phaseId,
    categoryId,
    parentTaskId: root.id,
    status: "in_progress",
    timeMode: "timer",
    timerDurationMs: 60_000,
    timerRemainingMs: 15_000,
    timerRunning: true,
    timerStartedAt: new Date().toISOString(),
  });
  workspace = await service.createTask({
    title: "Done",
    phaseId,
    categoryId,
    status: "completed",
  });
  workspace = await service.createTask({
    title: "Skipped",
    phaseId,
    categoryId,
    status: "discarded",
    timeMode: "stopwatch",
    trackedMs: 3_000,
  });

  workspace = await service.resetMapProgress();

  const resetRoot = workspace.tasks.find((task) => task.title === "Root");
  const resetChild = workspace.tasks.find((task) => task.title === "Child");
  const done = workspace.tasks.find((task) => task.title === "Done");
  const skipped = workspace.tasks.find((task) => task.title === "Skipped");

  assert.equal(resetRoot.parentTaskId, null);
  assert.equal(resetRoot.status, "pending");
  assert.equal(resetRoot.effectiveStatus, "pending");
  assert.equal(resetRoot.completedAt, null);
  assert.equal(resetRoot.trackedMs, 0);
  assert.equal(resetRoot.timerRunning, false);
  assert.equal(resetRoot.timerStartedAt, null);

  assert.equal(resetChild.parentTaskId, resetRoot.id);
  assert.equal(resetChild.status, "pending");
  assert.equal(resetChild.effectiveStatus, "blocked");
  assert.equal(resetChild.hierarchyBlocked, true);
  assert.equal(resetChild.completedAt, null);
  assert.equal(resetChild.timerRunning, false);
  assert.equal(resetChild.timerStartedAt, null);
  assert.equal(resetChild.timerRemainingMs, 60_000);

  assert.equal(done.status, "pending");
  assert.equal(done.effectiveStatus, "pending");
  assert.equal(done.completedAt, null);

  assert.equal(skipped.status, "discarded");
  assert.equal(skipped.effectiveStatus, "discarded");
  assert.equal(skipped.trackedMs, 0);
});

test("resetting phase progress only affects tasks inside that phase", async () => {
  const { service, phaseId, categoryId } = await buildServiceWithBasicMap();
  let workspace = await service.createPhase({ name: "Execution" });
  const secondPhase = workspace.phases.find((phase) => phase.name === "Execution");
  workspace = await service.createCategory({ phaseId: secondPhase.id, name: "Backend" });
  const secondCategory = workspace.categories.find((category) => category.name === "Backend");
  workspace = await service.createTask({ title: "Planning root", phaseId, categoryId, status: "completed" });
  workspace = await service.createTask({ title: "Execution root", phaseId: secondPhase.id, categoryId: secondCategory.id, status: "in_progress" });

  workspace = await service.resetPhaseProgress(phaseId);

  assert.equal(workspace.tasks.find((task) => task.title === "Planning root")?.status, "pending");
  assert.equal(workspace.tasks.find((task) => task.title === "Execution root")?.status, "in_progress");
});

test("resetting category progress only affects tasks inside that category", async () => {
  const { service, phaseId } = await buildServiceWithBasicMap();
  let workspace = await service.createCategory({ phaseId, name: "Secondary" });
  const primaryCategory = workspace.categories.find((category) => category.name === "General");
  const secondaryCategory = workspace.categories.find((category) => category.name === "Secondary");
  workspace = await service.createTask({ title: "Primary root", phaseId, categoryId: primaryCategory.id, status: "completed" });
  workspace = await service.createTask({ title: "Secondary root", phaseId, categoryId: secondaryCategory.id, status: "in_progress" });

  workspace = await service.resetCategoryProgress(primaryCategory.id);

  assert.equal(workspace.tasks.find((task) => task.title === "Primary root")?.status, "pending");
  assert.equal(workspace.tasks.find((task) => task.title === "Secondary root")?.status, "in_progress");
});

test("resetting root task progress only affects that branch", async () => {
  const { service, phaseId, categoryId } = await buildServiceWithBasicMap();
  let workspace = await service.createTask({ title: "Root A", phaseId, categoryId, status: "completed" });
  const rootA = workspace.tasks.find((task) => task.title === "Root A");
  workspace = await service.createTask({ title: "Child A", phaseId, categoryId, parentTaskId: rootA.id, status: "completed" });
  workspace = await service.createTask({ title: "Root B", phaseId, categoryId, status: "in_progress" });

  workspace = await service.resetRootTaskProgress(rootA.id);

  assert.equal(workspace.tasks.find((task) => task.title === "Root A")?.status, "pending");
  assert.equal(workspace.tasks.find((task) => task.title === "Child A")?.effectiveStatus, "blocked");
  assert.equal(workspace.tasks.find((task) => task.title === "Root B")?.status, "in_progress");
});

test("resetting root task progress rejects non-root nodes", async () => {
  const { service, phaseId, categoryId } = await buildServiceWithBasicMap();
  let workspace = await service.createTask({ title: "Root", phaseId, categoryId });
  const root = workspace.tasks.find((task) => task.title === "Root");
  workspace = await service.createTask({ title: "Child", phaseId, categoryId, parentTaskId: root.id });
  const child = workspace.tasks.find((task) => task.title === "Child");

  await assert.rejects(
    () => service.resetRootTaskProgress(child.id),
    /root tasks/i,
  );
});
