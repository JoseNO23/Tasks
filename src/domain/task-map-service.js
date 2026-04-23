import { createId } from "../utils/id.js";
import { AppError } from "../utils/errors.js";
import { createEmptySnapshot } from "../sample/empty-snapshot.js";
import { DEFAULTS, TASK_PRIORITIES, TASK_STATUSES } from "./task-map-constants.js";
import { validateSnapshot, normalizeTaskInput } from "./task-map-validators.js";
import { buildWorkspaceView } from "./task-map-view.js";

function nowIso() {
  return new Date().toISOString();
}

function moveItem(items, id, direction) {
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) {
    throw new AppError(404, "not_found", "Item not found.");
  }

  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= items.length) {
    return items;
  }

  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(targetIndex, 0, item);
  return next;
}

function listDescendants(snapshot, rootId) {
  const descendants = [];
  const queue = [rootId];

  while (queue.length) {
    const currentId = queue.shift();
    const children = snapshot.tasks.filter((task) => task.parentTaskId === currentId).map((task) => task.id);
    descendants.push(...children);
    queue.push(...children);
  }

  return descendants;
}

function ensureTaskExists(snapshot, taskId) {
  const task = snapshot.tasks.find((item) => item.id === taskId);
  if (!task) {
    throw new AppError(404, "task_not_found", "Task not found.");
  }
  return task;
}

function ensurePhaseExists(snapshot, phaseId) {
  const phase = snapshot.phases.find((item) => item.id === phaseId);
  if (!phase) {
    throw new AppError(404, "phase_not_found", "Phase not found.");
  }
  return phase;
}

function ensureCategoryExists(snapshot, categoryId) {
  const category = snapshot.categories.find((item) => item.id === categoryId);
  if (!category) {
    throw new AppError(404, "category_not_found", "Category not found.");
  }
  return category;
}

function sanitizeName(name, label) {
  const value = typeof name === "string" ? name.trim() : "";
  if (!value) {
    throw new AppError(400, "invalid_name", `${label} is required.`);
  }
  return value;
}

function getInputValue(input, key, fallback) {
  return Object.prototype.hasOwnProperty.call(input, key) ? input[key] : fallback;
}

function sanitizeTaskPayload(input, options = {}) {
  const previous = options.previous ?? null;
  const now = nowIso();
  const task = normalizeTaskInput(
    {
      id: options.id ?? previous?.id,
      title: getInputValue(input, "title", previous?.title),
      description: getInputValue(input, "description", previous?.description ?? ""),
      phaseId: getInputValue(input, "phaseId", previous?.phaseId),
      categoryId: getInputValue(input, "categoryId", previous?.categoryId),
      parentTaskId: getInputValue(input, "parentTaskId", previous?.parentTaskId),
      dependencyIds: getInputValue(input, "dependencyIds", previous?.dependencyIds ?? []),
      status: getInputValue(input, "status", previous?.status ?? DEFAULTS.status),
      priority: getInputValue(input, "priority", previous?.priority ?? DEFAULTS.priority),
      notes: getInputValue(input, "notes", previous?.notes ?? ""),
      assignee: getInputValue(input, "assignee", previous?.assignee ?? ""),
    },
    { now, previous },
  );

  if (!task.title) {
    throw new AppError(400, "invalid_title", "Title is required.");
  }
  if (!TASK_STATUSES.includes(task.status)) {
    throw new AppError(400, "invalid_status", "Status is invalid.");
  }
  if (!TASK_PRIORITIES.includes(task.priority)) {
    throw new AppError(400, "invalid_priority", "Priority is invalid.");
  }
  return task;
}

export class TaskMapService {
  constructor(store) {
    this.store = store;
  }

  async getWorkspace() {
    const snapshot = validateSnapshot(await this.store.read());
    return buildWorkspaceView(snapshot);
  }

  async exportSnapshot() {
    return validateSnapshot(await this.store.read());
  }

  async importSnapshot(input) {
    const nextSnapshot = validateSnapshot({
      ...createEmptySnapshot(),
      ...input,
      savedAt: nowIso(),
    });
    await this.store.replace(nextSnapshot);
    return buildWorkspaceView(nextSnapshot);
  }

  async createPhase(input) {
    return this.#mutate((snapshot) => {
      snapshot.phases.push({
        id: createId("phase"),
        name: sanitizeName(input.name, "Phase name"),
      });
      return snapshot;
    });
  }

  async updatePhase(phaseId, input) {
    return this.#mutate((snapshot) => {
      const phase = ensurePhaseExists(snapshot, phaseId);
      phase.name = sanitizeName(input.name ?? phase.name, "Phase name");
      return snapshot;
    });
  }

  async movePhase(phaseId, direction) {
    if (!["up", "down"].includes(direction)) {
      throw new AppError(400, "invalid_direction", "Direction is invalid.");
    }
    return this.#mutate((snapshot) => {
      snapshot.phases = moveItem(snapshot.phases, phaseId, direction);
      return snapshot;
    });
  }

  async deletePhase(phaseId) {
    return this.#mutate((snapshot) => {
      ensurePhaseExists(snapshot, phaseId);
      const hasCategories = snapshot.categories.some((category) => category.phaseId === phaseId);
      const hasTasks = snapshot.tasks.some((task) => task.phaseId === phaseId);
      if (hasCategories || hasTasks) {
        throw new AppError(400, "phase_in_use", "You cannot delete a phase that still has categories or tasks.");
      }
      snapshot.phases = snapshot.phases.filter((phase) => phase.id !== phaseId);
      return snapshot;
    });
  }

  async createCategory(input) {
    return this.#mutate((snapshot) => {
      const phase = ensurePhaseExists(snapshot, input.phaseId);
      snapshot.categories.push({
        id: createId("category"),
        phaseId: phase.id,
        name: sanitizeName(input.name, "Category name"),
      });
      return snapshot;
    });
  }

  async updateCategory(categoryId, input) {
    return this.#mutate((snapshot) => {
      const category = ensureCategoryExists(snapshot, categoryId);
      category.name = sanitizeName(input.name ?? category.name, "Category name");
      return snapshot;
    });
  }

  async moveCategory(categoryId, direction) {
    if (!["up", "down"].includes(direction)) {
      throw new AppError(400, "invalid_direction", "Direction is invalid.");
    }
    return this.#mutate((snapshot) => {
      const category = ensureCategoryExists(snapshot, categoryId);
      const samePhase = snapshot.categories.filter((item) => item.phaseId === category.phaseId);
      const others = snapshot.categories.filter((item) => item.phaseId !== category.phaseId);
      const moved = moveItem(samePhase, categoryId, direction);
      snapshot.categories = snapshot.phases.flatMap((phase) => {
        if (phase.id === category.phaseId) {
          return moved;
        }
        return others.filter((item) => item.phaseId === phase.id);
      });
      return snapshot;
    });
  }

  async deleteCategory(categoryId) {
    return this.#mutate((snapshot) => {
      ensureCategoryExists(snapshot, categoryId);
      const hasTasks = snapshot.tasks.some((task) => task.categoryId === categoryId);
      if (hasTasks) {
        throw new AppError(400, "category_in_use", "You cannot delete a category that still has tasks.");
      }
      snapshot.categories = snapshot.categories.filter((category) => category.id !== categoryId);
      return snapshot;
    });
  }

  async createTask(input) {
    return this.#mutate((snapshot) => {
      snapshot.tasks.push(sanitizeTaskPayload(input, { id: createId("task") }));
      return snapshot;
    });
  }

  async updateTask(taskId, input) {
    return this.#mutate((snapshot) => {
      const task = ensureTaskExists(snapshot, taskId);
      const originalPhaseId = task.phaseId;
      const originalCategoryId = task.categoryId;
      const nextPhaseId = input.phaseId ?? task.phaseId;
      const nextCategoryId = input.categoryId ?? task.categoryId;

      if (task.parentTaskId) {
        const parent = ensureTaskExists(snapshot, task.parentTaskId);
        if (nextPhaseId !== parent.phaseId || nextCategoryId !== parent.categoryId) {
          throw new AppError(
            400,
            "move_requires_detach",
            "You cannot move a child task outside its parent phase and category.",
          );
        }
      }

      Object.assign(task, sanitizeTaskPayload(input, { previous: task }));

      if ((nextPhaseId !== originalPhaseId || nextCategoryId !== originalCategoryId) && task.parentTaskId === null) {
        for (const descendantId of listDescendants(snapshot, taskId)) {
          const descendant = ensureTaskExists(snapshot, descendantId);
          descendant.phaseId = task.phaseId;
          descendant.categoryId = task.categoryId;
          descendant.updatedAt = nowIso();
        }
      }

      return snapshot;
    });
  }

  async setTaskStatus(taskId, status) {
    if (!TASK_STATUSES.includes(status)) {
      throw new AppError(400, "invalid_status", "Status is invalid.");
    }

    return this.#mutate((snapshot) => {
      const task = ensureTaskExists(snapshot, taskId);
      task.status = status;
      task.updatedAt = nowIso();
      return snapshot;
    });
  }

  async deleteTask(taskId, strategy) {
    if (!["branch", "promote"].includes(strategy)) {
      throw new AppError(400, "invalid_strategy", "Delete strategy is invalid.");
    }

    return this.#mutate((snapshot) => {
      const task = ensureTaskExists(snapshot, taskId);
      const descendants = listDescendants(snapshot, taskId);
      const deletedIds = new Set([taskId]);

      if (strategy === "branch") {
        for (const descendantId of descendants) {
          deletedIds.add(descendantId);
        }
      } else {
        const hasExternalDependents = snapshot.tasks.some((item) => {
          return item.id !== taskId && item.dependencyIds.includes(taskId);
        });
        if (hasExternalDependents) {
          throw new AppError(
            400,
            "promote_blocked",
            "You cannot promote children while other tasks still depend on this node. Remove those dependencies or delete the full branch.",
          );
        }
        for (const child of snapshot.tasks.filter((item) => item.parentTaskId === taskId)) {
          child.parentTaskId = task.parentTaskId;
          child.updatedAt = nowIso();
        }
      }

      snapshot.tasks = snapshot.tasks
        .filter((item) => !deletedIds.has(item.id))
        .map((item) => ({
          ...item,
          dependencyIds: item.dependencyIds.filter((dependencyId) => !deletedIds.has(dependencyId)),
          parentTaskId: deletedIds.has(item.parentTaskId) ? null : item.parentTaskId,
        }));

      return snapshot;
    });
  }

  async #mutate(mutator) {
    const snapshot = await this.store.update((draft) => {
      draft.savedAt = nowIso();
      const nextDraft = mutator(draft) ?? draft;
      return validateSnapshot(nextDraft);
    });
    return buildWorkspaceView(snapshot);
  }
}
