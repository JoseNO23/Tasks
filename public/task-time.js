const DATE_TIME_WARNING_MS = 30 * 60 * 1000;

export function isDateMode(timeMode) {
  return timeMode === "date";
}

export function isDateTimeMode(timeMode) {
  return timeMode === "datetime";
}

export function isStopwatchMode(timeMode) {
  return timeMode === "stopwatch";
}

export function isTimerMode(timeMode) {
  return timeMode === "timer";
}

export function usesLiveClock(timeMode) {
  return isStopwatchMode(timeMode) || isTimerMode(timeMode);
}

export function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function toDateInputValue(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

export function fromDateInputValue(value) {
  return value ? String(value).trim() : null;
}

export function toDateTimeLocalValue(isoValue) {
  if (!isoValue) {
    return "";
  }

  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function fromDateTimeLocalValue(localValue) {
  if (!localValue) {
    return null;
  }

  const date = new Date(localValue);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

export function minutesToMs(minutesValue) {
  const minutes = Number(minutesValue);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return null;
  }

  return Math.round(minutes * 60 * 1000);
}

export function msToWholeMinutes(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) {
    return "";
  }

  return String(Math.max(1, Math.round(value / 60000)));
}

function getStartedAtMs(task) {
  const startedAtMs = new Date(task?.timerStartedAt ?? "").getTime();
  return Number.isNaN(startedAtMs) ? null : startedAtMs;
}

function parseDateRange(dueDate) {
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return null;
  }

  const [year, month, day] = dueDate.split("-").map(Number);
  const start = new Date(year, month - 1, day, 0, 0, 0, 0);
  const end = new Date(year, month - 1, day, 23, 59, 59, 999);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  return {
    startMs: start.getTime(),
    endMs: end.getTime(),
  };
}

export function getLiveTrackedMs(task, nowMs = Date.now()) {
  if (!isStopwatchMode(task?.timeMode)) {
    return 0;
  }

  const base = Number(task?.trackedMs ?? 0);
  if (!task?.timerRunning) {
    return Math.max(0, base);
  }

  const startedAtMs = getStartedAtMs(task);
  if (startedAtMs === null) {
    return Math.max(0, base);
  }

  return Math.max(0, base + Math.max(0, nowMs - startedAtMs));
}

export function getLiveRemainingMs(task, nowMs = Date.now()) {
  if (!isTimerMode(task?.timeMode)) {
    return 0;
  }

  const base = Number(task?.timerRemainingMs ?? task?.timerDurationMs ?? 0);
  if (!task?.timerRunning) {
    return Math.max(0, base);
  }

  const startedAtMs = getStartedAtMs(task);
  if (startedAtMs === null) {
    return Math.max(0, base);
  }

  return Math.max(0, base - Math.max(0, nowMs - startedAtMs));
}

function resolveTemporalTone(task, nowMs = Date.now()) {
  const isDone = task?.effectiveStatus === "completed" || task?.status === "completed";

  if (!task || task.timeMode === "none") {
    return {
      hasTime: false,
      icon: "none",
      tone: "none",
      mode: "none",
      stateKey: "",
    };
  }

  if (isDateMode(task.timeMode)) {
    const range = parseDateRange(task.dueDate);
    const completedAtMs = task.completedAt ? new Date(task.completedAt).getTime() : null;
    if (!range) {
      return {
        hasTime: true,
        icon: "date",
        tone: isDone ? "completed" : "normal",
        mode: task.timeMode,
        stateKey: isDone ? "time.state.completed" : "time.state.normal",
      };
    }

    if (isDone) {
      return {
        hasTime: true,
        icon: "date",
        tone: "completed",
        mode: task.timeMode,
        stateKey: completedAtMs !== null && completedAtMs > range.endMs ? "time.state.completedLate" : "time.state.completedOnTime",
      };
    }

    if (nowMs > range.endMs) {
      return { hasTime: true, icon: "date", tone: "danger", mode: task.timeMode, stateKey: "time.state.overdue" };
    }
    if (nowMs >= range.startMs) {
      return { hasTime: true, icon: "date", tone: "warning", mode: task.timeMode, stateKey: "time.state.dueToday" };
    }
    return { hasTime: true, icon: "date", tone: "normal", mode: task.timeMode, stateKey: "time.state.normal" };
  }

  if (isDateTimeMode(task.timeMode)) {
    const dueAtMs = new Date(task.dueAt ?? "").getTime();
    const completedAtMs = task.completedAt ? new Date(task.completedAt).getTime() : null;

    if (!Number.isFinite(dueAtMs)) {
      return {
        hasTime: true,
        icon: "datetime",
        tone: isDone ? "completed" : "normal",
        mode: task.timeMode,
        stateKey: isDone ? "time.state.completed" : "time.state.normal",
      };
    }

    if (isDone) {
      return {
        hasTime: true,
        icon: "datetime",
        tone: "completed",
        mode: task.timeMode,
        stateKey: completedAtMs !== null && completedAtMs > dueAtMs ? "time.state.completedLate" : "time.state.completedOnTime",
      };
    }

    if (nowMs > dueAtMs) {
      return { hasTime: true, icon: "datetime", tone: "danger", mode: task.timeMode, stateKey: "time.state.overdue" };
    }
    if (nowMs >= dueAtMs - DATE_TIME_WARNING_MS) {
      return { hasTime: true, icon: "datetime", tone: "warning", mode: task.timeMode, stateKey: "time.state.dueSoon" };
    }
    return { hasTime: true, icon: "datetime", tone: "normal", mode: task.timeMode, stateKey: "time.state.normal" };
  }

  if (isStopwatchMode(task.timeMode)) {
    if (isDone) {
      return { hasTime: true, icon: "stopwatch", tone: "completed", mode: task.timeMode, stateKey: "time.state.completed" };
    }

    return {
      hasTime: true,
      icon: "stopwatch",
      tone: task.timerRunning ? "active" : "normal",
      mode: task.timeMode,
      stateKey: task.timerRunning ? "time.state.running" : getLiveTrackedMs(task, nowMs) > 0 ? "time.state.paused" : "time.state.ready",
    };
  }

  if (isTimerMode(task.timeMode)) {
    const remainingMs = getLiveRemainingMs(task, nowMs);

    if (isDone) {
      return { hasTime: true, icon: "timer", tone: "completed", mode: task.timeMode, stateKey: "time.state.completed" };
    }
    if (remainingMs <= 0) {
      return { hasTime: true, icon: "timer", tone: "danger", mode: task.timeMode, stateKey: "time.state.timerFinished" };
    }

    return {
      hasTime: true,
      icon: "timer",
      tone: task.timerRunning ? "active" : "normal",
      mode: task.timeMode,
      stateKey: task.timerRunning ? "time.state.running" : "time.state.paused",
    };
  }

  return {
    hasTime: false,
    icon: "none",
    tone: "none",
    mode: "none",
    stateKey: "",
  };
}

export function getTaskTimeState(task, nowMs = Date.now()) {
  const resolved = resolveTemporalTone(task, nowMs);
  return {
    ...resolved,
    trackedMs: getLiveTrackedMs(task, nowMs),
    remainingMs: getLiveRemainingMs(task, nowMs),
  };
}

export function getTimeIconSvg(iconName) {
  switch (iconName) {
    case "date":
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 3v3M17 3v3M4 9h16M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
        </svg>
      `;
    case "datetime":
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 3v3M14 3v3M4 9h10M6 5h8a2 2 0 0 1 2 2v3" />
          <path d="M16.5 13.5a4.5 4.5 0 1 1 0 9a4.5 4.5 0 0 1 0-9Z" />
          <path d="M16.5 15.5v2.2l1.6 1" />
          <path d="M4 11v7a2 2 0 0 0 2 2h6" />
        </svg>
      `;
    case "stopwatch":
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 2h6M12 8v4l2.5 1.5" />
          <path d="M17 4l1.5 1.5" />
          <circle cx="12" cy="14" r="7" />
        </svg>
      `;
    case "timer":
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 2h6M8 6h8M12 10v4l-2 2" />
          <path d="M7 6.5A8 8 0 1 0 17 6.5" />
        </svg>
      `;
    default:
      return "";
  }
}
