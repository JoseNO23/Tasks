import { resolveEffectiveStatus } from "./task-map-constants.js";

export function buildWorkspaceView(snapshot) {
  const tasksById = new Map(snapshot.tasks.map((task) => [task.id, task]));
  const assigneesById = new Map(snapshot.assignees.map((assignee) => [assignee.id, assignee]));
  const childIdsByParent = new Map();
  const unlocksByTaskId = new Map();
  const usageByAssigneeId = new Map();
  const statusByTaskId = new Map();

  for (const task of snapshot.tasks) {
    if (task.parentTaskId) {
      if (!childIdsByParent.has(task.parentTaskId)) {
        childIdsByParent.set(task.parentTaskId, []);
      }
      childIdsByParent.get(task.parentTaskId).push(task.id);
    }

    for (const dependencyId of task.dependencyIds) {
      if (!unlocksByTaskId.has(dependencyId)) {
        unlocksByTaskId.set(dependencyId, []);
      }
      unlocksByTaskId.get(dependencyId).push(task.id);
    }

    if (task.assigneeId) {
      usageByAssigneeId.set(task.assigneeId, (usageByAssigneeId.get(task.assigneeId) ?? 0) + 1);
    }
  }

  function resolveTaskStatus(taskId) {
    if (statusByTaskId.has(taskId)) {
      return statusByTaskId.get(taskId);
    }

    const task = tasksById.get(taskId);
    const blockedByIds = task.dependencyIds.filter((dependencyId) => {
      return tasksById.get(dependencyId)?.status !== "completed";
    });
    const parentStatus = task.parentTaskId ? resolveTaskStatus(task.parentTaskId) : null;
    const parentEffectiveStatus = parentStatus?.effectiveStatus ?? null;
    const hierarchyBlocked = parentEffectiveStatus !== null
      && parentEffectiveStatus !== "discarded"
      && !["in_progress", "completed"].includes(parentEffectiveStatus);
    const effectiveStatus = resolveEffectiveStatus(task.status, parentEffectiveStatus, blockedByIds.length > 0);

    const resolved = {
      blockedByIds,
      hierarchyBlocked,
      isOperationallyBlocked: blockedByIds.length > 0 || hierarchyBlocked,
      effectiveStatus,
    };
    statusByTaskId.set(taskId, resolved);
    return resolved;
  }

  const tasks = snapshot.tasks.map((task) => {
    const assignee = task.assigneeId ? assigneesById.get(task.assigneeId) : null;
    const resolvedStatus = resolveTaskStatus(task.id);

    return {
      ...task,
      assignee: assignee?.name ?? "",
      assigneeActive: assignee ? assignee.isActive : null,
      childIds: childIdsByParent.get(task.id) ?? [],
      blockedByIds: resolvedStatus.blockedByIds,
      hierarchyBlocked: resolvedStatus.hierarchyBlocked,
      unlocksIds: unlocksByTaskId.get(task.id) ?? [],
      effectiveStatus: resolvedStatus.effectiveStatus,
    };
  });

  const stats = {
    total: tasks.length,
    completed: tasks.filter((task) => task.effectiveStatus === "completed").length,
    inProgress: tasks.filter((task) => task.effectiveStatus === "in_progress").length,
    blocked: tasks.filter((task) => task.effectiveStatus === "blocked").length,
    pending: tasks.filter((task) => task.effectiveStatus === "pending").length,
    discarded: tasks.filter((task) => task.effectiveStatus === "discarded").length,
  };

  return {
    savedAt: snapshot.savedAt,
    assignees: snapshot.assignees.map((assignee) => ({
      ...assignee,
      usageCount: usageByAssigneeId.get(assignee.id) ?? 0,
    })),
    phases: snapshot.phases,
    categories: snapshot.categories,
    tasks,
    stats,
  };
}
