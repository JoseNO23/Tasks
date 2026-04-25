export const TASK_STATUSES = ["pending", "in_progress", "completed", "discarded"];
export const TASK_PRIORITIES = ["low", "medium", "high", "critical"];
export const TASK_TIME_MODES = ["none", "date", "datetime", "stopwatch", "timer"];

export const DEFAULTS = {
  status: "pending",
  priority: "medium",
  timeMode: "none",
};

export function isTerminalStatus(status) {
  return status === "completed" || status === "discarded";
}

/**
 * Resolves the derived effective status of a task.
 * @param {string} storedStatus — raw status stored on the task
 * @param {string|null} parentEffectiveStatus — computed effectiveStatus of parent, or null if root
 * @param {boolean} hasBlockingDependencies — true if any dependency is not yet completed
 */
export function resolveEffectiveStatus(storedStatus, parentEffectiveStatus, hasBlockingDependencies) {
  if (storedStatus === "discarded") return "discarded";
  if (parentEffectiveStatus === "discarded") return "discarded";
  const hierarchyBlocked = parentEffectiveStatus !== null
    && !["in_progress", "completed"].includes(parentEffectiveStatus);
  if (hasBlockingDependencies || hierarchyBlocked) return "blocked";
  return storedStatus;
}

export function taskUsesDate(timeMode) {
  return timeMode === "date";
}

export function taskUsesDateTime(timeMode) {
  return timeMode === "datetime";
}

export function taskUsesStopwatch(timeMode) {
  return timeMode === "stopwatch";
}

export function taskUsesTimer(timeMode) {
  return timeMode === "timer";
}

export function taskUsesDeadline(timeMode) {
  return taskUsesDate(timeMode) || taskUsesDateTime(timeMode);
}

export function taskUsesLiveClock(timeMode) {
  return taskUsesStopwatch(timeMode) || taskUsesTimer(timeMode);
}
