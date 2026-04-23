export function buildWorkspaceView(snapshot) {
  const tasksById = new Map(snapshot.tasks.map((task) => [task.id, task]));
  const childIdsByParent = new Map();
  const unlocksByTaskId = new Map();

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
  }

  const tasks = snapshot.tasks.map((task) => {
    const blockedByIds = task.dependencyIds.filter((dependencyId) => {
      return tasksById.get(dependencyId)?.status !== "completed";
    });

    return {
      ...task,
      childIds: childIdsByParent.get(task.id) ?? [],
      blockedByIds,
      unlocksIds: unlocksByTaskId.get(task.id) ?? [],
      effectiveStatus: task.status === "pending" && blockedByIds.length ? "blocked" : task.status,
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
    phases: snapshot.phases,
    categories: snapshot.categories,
    tasks,
    stats,
  };
}
