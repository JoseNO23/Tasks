import { AppError } from "../utils/errors.js";
import {
  DEFAULTS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TIME_MODES,
  isTerminalStatus,
  resolveEffectiveStatus,
  taskUsesDate,
  taskUsesDateTime,
  taskUsesStopwatch,
  taskUsesTimer,
  taskUsesLiveClock,
} from "./task-map-constants.js";

function asTrimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asCatalogName(value) {
  return asTrimmedString(value).replace(/\s+/g, " ");
}

function asOptionalPositiveInteger(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError(400, "invalid_number", "Expected a positive integer.");
  }

  return parsed;
}

function asNonNegativeInteger(value, fallback = 0) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new AppError(400, "invalid_number", "Expected a non-negative integer.");
  }

  return parsed;
}

function asIsoDateTime(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(400, "invalid_datetime", "Expected a valid date and time.");
  }

  return date.toISOString();
}

function asDateOnly(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const normalized = asTrimmedString(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new AppError(400, "invalid_date", "Expected a valid date.");
  }

  const [year, month, day] = normalized.split("-").map(Number);
  const probe = new Date(year, month - 1, day);
  if (
    Number.isNaN(probe.getTime())
    || probe.getFullYear() !== year
    || probe.getMonth() !== month - 1
    || probe.getDate() !== day
  ) {
    throw new AppError(400, "invalid_date", "Expected a valid date.");
  }

  return normalized;
}

function asBoolean(value, fallback = false) {
  return value === undefined ? fallback : Boolean(value);
}

function asTimeMode(value, fallback = DEFAULTS.timeMode) {
  const mode = asTrimmedString(value || fallback);
  if (!TASK_TIME_MODES.includes(mode)) {
    throw new AppError(400, "invalid_time_mode", "Time mode is invalid.");
  }
  return mode;
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
    const base = asCatalogName(item.name).toLowerCase();
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

function ensureHierarchySeparationFromDependencies(taskMap) {
  const childIdsByParent = new Map();
  const ancestorCache = new Map();
  const descendantCache = new Map();

  for (const task of taskMap.values()) {
    if (!task.parentTaskId) {
      continue;
    }
    if (!childIdsByParent.has(task.parentTaskId)) {
      childIdsByParent.set(task.parentTaskId, []);
    }
    childIdsByParent.get(task.parentTaskId).push(task.id);
  }

  function getAncestorIds(taskId) {
    if (ancestorCache.has(taskId)) {
      return ancestorCache.get(taskId);
    }

    const found = new Set();
    let current = taskMap.get(taskId);
    while (current?.parentTaskId) {
      found.add(current.parentTaskId);
      current = taskMap.get(current.parentTaskId);
    }

    ancestorCache.set(taskId, found);
    return found;
  }

  function getDescendantIds(taskId) {
    if (descendantCache.has(taskId)) {
      return descendantCache.get(taskId);
    }

    const found = new Set();
    const queue = [...(childIdsByParent.get(taskId) ?? [])];

    while (queue.length) {
      const currentId = queue.shift();
      found.add(currentId);
      queue.push(...(childIdsByParent.get(currentId) ?? []));
    }

    descendantCache.set(taskId, found);
    return found;
  }

  for (const task of taskMap.values()) {
    const ancestors = getAncestorIds(task.id);
    const descendants = getDescendantIds(task.id);

    for (const dependencyId of task.dependencyIds) {
      if (ancestors.has(dependencyId) || descendants.has(dependencyId)) {
        throw new AppError(
          400,
          "hierarchy_dependency_conflict",
          `Task "${task.title}" cannot depend on a node from its own local branch.`,
        );
      }
    }
  }
}

function ensureCompletedSubtrees(taskMap) {
  const childIdsByParent = new Map();

  for (const task of taskMap.values()) {
    if (!task.parentTaskId) {
      continue;
    }
    if (!childIdsByParent.has(task.parentTaskId)) {
      childIdsByParent.set(task.parentTaskId, []);
    }
    childIdsByParent.get(task.parentTaskId).push(task.id);
  }

  function hasIncompleteDescendant(taskId) {
    const queue = [...(childIdsByParent.get(taskId) ?? [])];

    while (queue.length) {
      const currentId = queue.shift();
      const current = taskMap.get(currentId);
      if (!isTerminalStatus(current.status)) {
        return true;
      }
      queue.push(...(childIdsByParent.get(currentId) ?? []));
    }

    return false;
  }

  for (const task of taskMap.values()) {
    if (task.status === "completed" && hasIncompleteDescendant(task.id)) {
      throw new AppError(
        400,
        "incomplete_descendants",
        `Task "${task.title}" cannot be completed while its subtree is still incomplete.`,
      );
    }
  }
}

function resolveOperationalState(taskMap, taskId, cache = new Map()) {
  if (cache.has(taskId)) {
    return cache.get(taskId);
  }

  const task = taskMap.get(taskId);
  const blockedByIds = task.dependencyIds.filter((dependencyId) => {
    return taskMap.get(dependencyId)?.status !== "completed";
  });
  const parentState = task.parentTaskId ? resolveOperationalState(taskMap, task.parentTaskId, cache) : null;
  const parentEffectiveStatus = parentState?.effectiveStatus ?? null;
  const hierarchyBlocked = parentEffectiveStatus !== null
    && parentEffectiveStatus !== "discarded"
    && !["in_progress", "completed"].includes(parentEffectiveStatus);
  const effectiveStatus = resolveEffectiveStatus(task.status, parentEffectiveStatus, blockedByIds.length > 0);

  const resolved = {
    blockedByIds,
    hierarchyBlocked,
    effectiveStatus,
  };

  cache.set(taskId, resolved);
  return resolved;
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

  const status = asTrimmedString(input.status || previous?.status || DEFAULTS.status);
  const priority = asTrimmedString(input.priority || previous?.priority || DEFAULTS.priority);
  const timeMode = asTimeMode(
    Object.prototype.hasOwnProperty.call(input, "timeMode") ? input.timeMode : previous?.timeMode,
  );
  const stopwatchEnabled = taskUsesStopwatch(timeMode);
  const timerEnabled = taskUsesTimer(timeMode);
  const dateEnabled = taskUsesDate(timeMode);
  const dateTimeEnabled = taskUsesDateTime(timeMode);
  const liveClockEnabled = taskUsesLiveClock(timeMode);
  const timerRunning = liveClockEnabled
    ? asBoolean(
        Object.prototype.hasOwnProperty.call(input, "timerRunning") ? input.timerRunning : previous?.timerRunning,
        false,
      )
    : false;
  const timerStartedAt = liveClockEnabled && timerRunning
    ? asIsoDateTime(
        Object.prototype.hasOwnProperty.call(input, "timerStartedAt") ? input.timerStartedAt : previous?.timerStartedAt,
      )
    : null;
  const trackedMs = stopwatchEnabled
    ? asNonNegativeInteger(
        Object.prototype.hasOwnProperty.call(input, "trackedMs") ? input.trackedMs : previous?.trackedMs,
        0,
      )
    : 0;
  const timerDurationMs = timerEnabled
    ? asOptionalPositiveInteger(
        Object.prototype.hasOwnProperty.call(input, "timerDurationMs")
          ? input.timerDurationMs
          : previous?.timerDurationMs,
      )
    : null;
  const timerRemainingMs = timerEnabled
    ? asNonNegativeInteger(
        Object.prototype.hasOwnProperty.call(input, "timerRemainingMs")
          ? input.timerRemainingMs
          : previous?.timerRemainingMs ?? timerDurationMs,
        timerDurationMs ?? 0,
      )
    : null;
  const completedAtCandidate = asIsoDateTime(
    Object.prototype.hasOwnProperty.call(input, "completedAt") ? input.completedAt : previous?.completedAt,
  );

  if (liveClockEnabled && timerRunning && !timerStartedAt) {
    throw new AppError(400, "invalid_timer", "A running timer must have a valid start time.");
  }
  if (timerEnabled && !timerDurationMs) {
    throw new AppError(400, "invalid_timer", "A countdown timer must have a duration.");
  }
  if (timerEnabled && timerRemainingMs > timerDurationMs) {
    throw new AppError(400, "invalid_timer", "Timer remaining time cannot exceed the original duration.");
  }
  if (dateEnabled && !asDateOnly(Object.prototype.hasOwnProperty.call(input, "dueDate") ? input.dueDate : previous?.dueDate)) {
    throw new AppError(400, "invalid_date", "A due date is required for date mode.");
  }
  if (dateTimeEnabled && !asIsoDateTime(Object.prototype.hasOwnProperty.call(input, "dueAt") ? input.dueAt : previous?.dueAt)) {
    throw new AppError(400, "invalid_datetime", "A due date and time is required for date and time mode.");
  }

  const rawAssigneeId = asTrimmedString(
    Object.prototype.hasOwnProperty.call(input, "assigneeId") ? input.assigneeId : previous?.assigneeId,
  ) || null;

  const inputNoAssignee = input.noAssignee;
  const noAssignee = inputNoAssignee !== null && inputNoAssignee !== undefined
    ? Boolean(inputNoAssignee)
    : previous?.noAssignee !== null && previous?.noAssignee !== undefined
      ? Boolean(previous.noAssignee)
      : rawAssigneeId === null;

  return {
    id: input.id,
    title: asTrimmedString(input.title),
    description: asTrimmedString(input.description),
    phaseId: asTrimmedString(input.phaseId),
    categoryId: asTrimmedString(input.categoryId),
    parentTaskId: asTrimmedString(input.parentTaskId) || null,
    assigneeId: noAssignee ? null : rawAssigneeId,
    noAssignee,
    dependencyIds: [...new Set(dependencyIds)],
    status,
    priority,
    timeMode,
    trackedMs,
    timerDurationMs,
    timerRemainingMs,
    timerStartedAt,
    timerRunning,
    dueDate: dateEnabled
      ? asDateOnly(
          Object.prototype.hasOwnProperty.call(input, "dueDate") ? input.dueDate : previous?.dueDate,
        )
      : null,
    dueAt: dateTimeEnabled
      ? asIsoDateTime(
          Object.prototype.hasOwnProperty.call(input, "dueAt") ? input.dueAt : previous?.dueAt,
        )
      : null,
    completedAt: status === "completed" ? completedAtCandidate ?? now : null,
    notes: asTrimmedString(input.notes),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
}

export function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new AppError(400, "invalid_payload", "Snapshot is invalid.");
  }

  const assignees = Array.isArray(snapshot.assignees) ? snapshot.assignees : [];

  ensureArray(snapshot.phases, "phases");
  ensureArray(snapshot.categories, "categories");
  ensureArray(snapshot.tasks, "tasks");

  ensureUniqueIds(assignees, "assignees");
  ensureUniqueIds(snapshot.phases, "phases");
  ensureUniqueIds(snapshot.categories, "categories");
  ensureUniqueIds(snapshot.tasks, "tasks");
  ensureUniqueNames(assignees, "assignees");
  ensureUniqueNames(snapshot.phases, "phases");
  ensureUniqueNames(snapshot.categories, "categories", "phaseId");

  const assigneeMap = new Map();
  for (const assignee of assignees) {
    const name = asCatalogName(assignee.name);
    if (!assignee.id || !name) {
      throw new AppError(400, "invalid_assignee", "Each assignee must have an id and name.");
    }
    assigneeMap.set(assignee.id, {
      id: assignee.id,
      name,
      isActive: assignee.isActive !== false,
    });
  }

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
    if (!TASK_TIME_MODES.includes(task.timeMode)) {
      throw new AppError(400, "invalid_time_mode", `Task "${task.title}" has an invalid time mode.`);
    }
    if (task.assigneeId && !assigneeMap.has(task.assigneeId)) {
      throw new AppError(400, "missing_assignee", `Task "${task.title}" references a missing assignee.`);
    }
    if (!task.noAssignee && !task.assigneeId) {
      throw new AppError(400, "missing_assignee", `Task "${task.title}" requires an assignee, or must explicitly mark no assignee.`);
    }
    if (task.noAssignee && task.assigneeId) {
      throw new AppError(400, "conflicting_assignee", `Task "${task.title}" cannot have both an assignee and the no-assignee flag.`);
    }
    if (task.timerRunning && !taskUsesLiveClock(task.timeMode)) {
      throw new AppError(400, "invalid_timer", `Task "${task.title}" cannot run a live timer in its current time mode.`);
    }
    if (task.timerRunning && !task.timerStartedAt) {
      throw new AppError(400, "invalid_timer", `Task "${task.title}" has a running timer without a start time.`);
    }
    if (task.status === "completed" && task.timerRunning) {
      throw new AppError(400, "invalid_timer", `Task "${task.title}" cannot stay completed while its timer is running.`);
    }
    if (taskUsesDate(task.timeMode) && !task.dueDate) {
      throw new AppError(400, "invalid_date", `Task "${task.title}" requires a due date.`);
    }
    if (taskUsesDateTime(task.timeMode) && !task.dueAt) {
      throw new AppError(400, "invalid_datetime", `Task "${task.title}" requires a due date and time.`);
    }
    if (taskUsesTimer(task.timeMode) && !task.timerDurationMs) {
      throw new AppError(400, "invalid_timer", `Task "${task.title}" requires a countdown duration.`);
    }
    if (taskUsesTimer(task.timeMode) && task.timerRemainingMs > task.timerDurationMs) {
      throw new AppError(400, "invalid_timer", `Task "${task.title}" has invalid remaining countdown time.`);
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
  ensureHierarchySeparationFromDependencies(taskMap);
  detectDependencyCycles(taskMap);
  ensureCompletedSubtrees(taskMap);

  const effectiveStateCache = new Map();
  for (const task of taskMap.values()) {
    const resolved = resolveOperationalState(taskMap, task.id, effectiveStateCache);
    if (resolved.effectiveStatus === "blocked" && (task.status === "in_progress" || task.status === "completed")) {
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
    assignees: assignees.map((assignee) => assigneeMap.get(assignee.id)),
    phases: snapshot.phases.map((phase) => phaseMap.get(phase.id)),
    categories: snapshot.categories.map((category) => categoryMap.get(category.id)),
    tasks: snapshot.tasks.map((task) => taskMap.get(task.id)),
  };
}
