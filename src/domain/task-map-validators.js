import { AppError } from "../utils/errors.js";
import { TASK_PRIORITIES, TASK_STATUSES } from "./task-map-constants.js";

function asTrimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function ensureArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new AppError(400, "invalid_payload", `${fieldName} must be an array.`);
  }
}

function ensureUniqueIds(items, label) {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) {
      throw new AppError(400, "duplicate_id", `Duplicate ${label} ids are not allowed.`);
    }
    seen.add(item.id);
  }
}

function ensureUniqueNames(items, label, scopeKey = null) {
  const seen = new Set();
  for (const item of items) {
    const base = asTrimmedString(item.name).toLowerCase();
    const scoped = scopeKey ? `${item[scopeKey]}::${base}` : base;
    if (seen.has(scoped)) {
      throw new AppError(400, "duplicate_name", `Duplicate ${label} names are not allowed.`);
    }
    seen.add(scoped);
  }
}

function detectParentCycles(taskMap) {
  const visiting = new Set();
  const visited = new Set();

  function walk(taskId) {
    if (visited.has(taskId)) {
      return;
    }
    if (visiting.has(taskId)) {
      throw new AppError(400, "parent_cycle", "The local task tree contains a cycle.");
    }
    visiting.add(taskId);
    const task = taskMap.get(taskId);
    if (task?.parentTaskId) {
      walk(task.parentTaskId);
    }
    visiting.delete(taskId);
    visited.add(taskId);
  }

  for (const taskId of taskMap.keys()) {
    walk(taskId);
  }
}

function detectDependencyCycles(taskMap) {
  const visiting = new Set();
  const visited = new Set();

  function walk(taskId) {
    if (visited.has(taskId)) {
      return;
    }
    if (visiting.has(taskId)) {
      throw new AppError(400, "dependency_cycle", "The dependency graph contains a cycle.");
    }
    visiting.add(taskId);
    const task = taskMap.get(taskId);
    for (const dependencyId of task.dependencyIds) {
      walk(dependencyId);
    }
    visiting.delete(taskId);
    visited.add(taskId);
  }

  for (const taskId of taskMap.keys()) {
    walk(taskId);
  }
}

function collectBlockedBy(task, taskMap) {
  return task.dependencyIds.filter((dependencyId) => {
    const dependency = taskMap.get(dependencyId);
    return dependency.status !== "completed";
  });
}

export function normalizeTaskInput(input, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const previous = options.previous ?? null;

  const dependencyIds = Array.isArray(input.dependencyIds)
    ? input.dependencyIds.map((item) => asTrimmedString(item)).filter(Boolean)
    : [];

  return {
    id: input.id,
    title: asTrimmedString(input.title),
    description: asTrimmedString(input.description),
    phaseId: asTrimmedString(input.phaseId),
    categoryId: asTrimmedString(input.categoryId),
    parentTaskId: asTrimmedString(input.parentTaskId) || null,
    dependencyIds: [...new Set(dependencyIds)],
    status: asTrimmedString(input.status || previous?.status || "pending"),
    priority: asTrimmedString(input.priority || previous?.priority || "medium"),
    notes: asTrimmedString(input.notes),
    assignee: asTrimmedString(input.assignee),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
}

export function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new AppError(400, "invalid_payload", "Snapshot is invalid.");
  }

  ensureArray(snapshot.phases, "phases");
  ensureArray(snapshot.categories, "categories");
  ensureArray(snapshot.tasks, "tasks");

  ensureUniqueIds(snapshot.phases, "phases");
  ensureUniqueIds(snapshot.categories, "categories");
  ensureUniqueIds(snapshot.tasks, "tasks");
  ensureUniqueNames(snapshot.phases, "phases");
  ensureUniqueNames(snapshot.categories, "categories", "phaseId");

  const phaseMap = new Map();
  for (const phase of snapshot.phases) {
    const name = asTrimmedString(phase.name);
    if (!phase.id || !name) {
      throw new AppError(400, "invalid_phase", "Each phase must have an id and name.");
    }
    phaseMap.set(phase.id, { ...phase, name });
  }

  const categoryMap = new Map();
  for (const category of snapshot.categories) {
    const name = asTrimmedString(category.name);
    if (!category.id || !name || !category.phaseId) {
      throw new AppError(400, "invalid_category", "Each category must have an id, name, and phase.");
    }
    if (!phaseMap.has(category.phaseId)) {
      throw new AppError(400, "invalid_category_phase", "A category references a missing phase.");
    }
    categoryMap.set(category.id, { ...category, name });
  }

  const taskMap = new Map();
  for (const rawTask of snapshot.tasks) {
    if (!rawTask.id) {
      throw new AppError(400, "invalid_task", "Each task must have an id.");
    }
    const task = normalizeTaskInput(rawTask, { now: rawTask.updatedAt, previous: rawTask });
    if (!task.title) {
      throw new AppError(400, "invalid_task", "Each task must have a title.");
    }
    if (!phaseMap.has(task.phaseId)) {
      throw new AppError(400, "invalid_task_phase", `Task "${task.title}" references a missing phase.`);
    }
    const category = categoryMap.get(task.categoryId);
    if (!category) {
      throw new AppError(400, "invalid_task_category", `Task "${task.title}" references a missing category.`);
    }
    if (category.phaseId !== task.phaseId) {
      throw new AppError(400, "phase_category_mismatch", `Task "${task.title}" does not match the phase of its category.`);
    }
    if (!TASK_STATUSES.includes(task.status)) {
      throw new AppError(400, "invalid_status", `Task "${task.title}" has an invalid status.`);
    }
    if (!TASK_PRIORITIES.includes(task.priority)) {
      throw new AppError(400, "invalid_priority", `Task "${task.title}" has an invalid priority.`);
    }
    taskMap.set(task.id, task);
  }

  for (const task of taskMap.values()) {
    if (task.parentTaskId) {
      if (task.parentTaskId === task.id) {
        throw new AppError(400, "invalid_parent", `Task "${task.title}" cannot be its own parent.`);
      }
      const parent = taskMap.get(task.parentTaskId);
      if (!parent) {
        throw new AppError(400, "missing_parent", `Task "${task.title}" references a missing parent.`);
      }
      if (parent.phaseId !== task.phaseId || parent.categoryId !== task.categoryId) {
        throw new AppError(400, "parent_scope_mismatch", `Task "${task.title}" must share phase and category with its parent.`);
      }
    }

    for (const dependencyId of task.dependencyIds) {
      if (dependencyId === task.id) {
        throw new AppError(400, "self_dependency", `Task "${task.title}" cannot depend on itself.`);
      }
      if (!taskMap.has(dependencyId)) {
        throw new AppError(400, "missing_dependency", `Task "${task.title}" references a missing dependency.`);
      }
    }
  }

  detectParentCycles(taskMap);
  detectDependencyCycles(taskMap);

  for (const task of taskMap.values()) {
    const blockedBy = collectBlockedBy(task, taskMap);
    if (blockedBy.length && (task.status === "in_progress" || task.status === "completed")) {
      throw new AppError(
        400,
        "blocked_transition",
        `Task "${task.title}" cannot be in progress or completed while it is still blocked.`,
      );
    }
  }

  return {
    version: Number(snapshot.version) || 1,
    savedAt: snapshot.savedAt || new Date().toISOString(),
    phases: snapshot.phases.map((phase) => phaseMap.get(phase.id)),
    categories: snapshot.categories.map((category) => categoryMap.get(category.id)),
    tasks: snapshot.tasks.map((task) => taskMap.get(task.id)),
  };
}
