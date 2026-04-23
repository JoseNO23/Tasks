export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function statusLabel(t, status) {
  return t(`status.${status}`);
}

export function priorityLabel(t, priority) {
  return t(`priority.${priority}`);
}

function highlight(text, search) {
  const source = String(text ?? "");
  if (!search) {
    return escapeHtml(source);
  }

  const safe = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`(${safe})`, "gi");
  return escapeHtml(source).replace(matcher, "<mark>$1</mark>");
}

function taskMatches(task, filters) {
  if (filters.status !== "all" && task.effectiveStatus !== filters.status) {
    return false;
  }

  if (filters.priority !== "all" && task.priority !== filters.priority) {
    return false;
  }

  if (!filters.search) {
    return true;
  }

  const haystack = [task.title, task.description, task.notes, task.assignee]
    .join(" ")
    .toLowerCase();

  return haystack.includes(filters.search.toLowerCase());
}

export function buildIndexes(workspace) {
  const tasksById = new Map();
  const categoriesByPhase = new Map();
  const tasksByCategory = new Map();

  for (const phase of workspace.phases) {
    categoriesByPhase.set(phase.id, []);
  }

  for (const category of workspace.categories) {
    if (!categoriesByPhase.has(category.phaseId)) {
      categoriesByPhase.set(category.phaseId, []);
    }
    categoriesByPhase.get(category.phaseId).push(category);
  }

  for (const task of workspace.tasks) {
    tasksById.set(task.id, task);
    const categoryKey = `${task.phaseId}::${task.categoryId}`;
    if (!tasksByCategory.has(categoryKey)) {
      tasksByCategory.set(categoryKey, []);
    }
    tasksByCategory.get(categoryKey).push(task);
  }

  return {
    tasksById,
    categoriesByPhase,
    tasksByCategory,
  };
}

export function renderStats(workspace, t) {
  const items = [
    { className: "completed", value: workspace.stats.completed, label: t("stats.completed") },
    { className: "in-progress", value: workspace.stats.inProgress, label: t("stats.inProgress") },
    { className: "pending", value: workspace.stats.pending, label: t("stats.pending") },
    { className: "blocked", value: workspace.stats.blocked, label: t("stats.blocked") },
  ];

  return items
    .map(
      (item) => `
        <div class="status-strip-item">
          <span class="status-dot ${item.className}"></span>
          <strong>${item.value}</strong>
          <span>${escapeHtml(item.label)}</span>
        </div>
      `,
    )
    .join("");
}

function renderTask(task, indexes, filters, uiState, visibilityCache, t) {
  const visibleChildren = task.childIds
    .map((childId) => indexes.tasksById.get(childId))
    .filter((childTask) => visibilityCache.get(childTask.id));

  const ownMatch = taskMatches(task, filters);
  if (!ownMatch && visibleChildren.length === 0) {
    return "";
  }

  const searchIsActive = Boolean(filters.search);
  const isOpen = searchIsActive || Boolean(uiState.taskOpen[task.id]);
  const statusClass = task.effectiveStatus;
  const parent = task.parentTaskId ? indexes.tasksById.get(task.parentTaskId) : null;
  const dependencyNames = task.dependencyIds.map((dependencyId) => indexes.tasksById.get(dependencyId)?.title).filter(Boolean);
  const blockedByNames = task.blockedByIds.map((dependencyId) => indexes.tasksById.get(dependencyId)?.title).filter(Boolean);
  const unlockNames = task.unlocksIds.map((unlockId) => indexes.tasksById.get(unlockId)?.title).filter(Boolean);
  const disableStatusAction = task.effectiveStatus === "blocked";
  const toggleLabel = task.childIds.length ? t("aria.toggleChildren") : t("aria.noChildren");
  const statusTitle = disableStatusAction ? t("errors.blockedStatus") : t("aria.changeStatus");

  return `
    <article class="task-row">
      <div class="task-card ${statusClass === "blocked" ? "is-blocked" : ""} ${statusClass === "completed" ? "is-completed" : ""}">
        <button
          class="tree-toggle ${task.childIds.length ? "" : "is-leaf"}"
          type="button"
          data-action="toggle-task"
          data-task-id="${task.id}"
          ${task.childIds.length ? "" : "disabled"}
          aria-label="${escapeHtml(toggleLabel)}"
          title="${escapeHtml(toggleLabel)}"
        >
          ${task.childIds.length ? (isOpen ? "–" : "+") : "·"}
        </button>

        <button
          class="status-button status-${statusClass}"
          type="button"
          data-action="cycle-status"
          data-task-id="${task.id}"
          ${disableStatusAction ? "disabled" : ""}
          aria-label="${escapeHtml(statusTitle)}"
          title="${escapeHtml(statusTitle)}"
        >
          ${statusClass === "completed" ? "✓" : statusClass === "in_progress" ? "→" : statusClass === "discarded" ? "×" : statusClass === "blocked" ? "!" : "○"}
        </button>

        <div class="task-main">
          <div class="task-title-row">
            <span class="task-title">${highlight(task.title, filters.search)}</span>
          </div>

          <div class="badge-row">
            <span class="badge status-${statusClass}">${escapeHtml(statusLabel(t, statusClass))}</span>
            <span class="badge priority-${task.priority}">${escapeHtml(priorityLabel(t, task.priority))}</span>
            ${task.assignee ? `<span class="meta-pill">@ ${escapeHtml(task.assignee)}</span>` : ""}
            ${task.childIds.length ? `<span class="meta-pill">${escapeHtml(t("count.subtask", { count: task.childIds.length }))}</span>` : ""}
          </div>

          ${task.description ? `<div class="task-description">${highlight(task.description, filters.search)}</div>` : ""}
          ${task.notes ? `<div class="task-notes">${highlight(task.notes, filters.search)}</div>` : ""}

          <div class="task-links">
            <div class="task-meta-line">
              <strong>${escapeHtml(t("task.structure"))}:</strong>
              <span>${parent ? escapeHtml(t("task.childOf", { title: parent.title })) : escapeHtml(t("task.root"))}</span>
            </div>

            <div class="task-meta-line">
              <strong>${escapeHtml(t("task.dependsOn"))}:</strong>
              <span>${dependencyNames.length ? dependencyNames.map((name) => escapeHtml(name)).join(", ") : escapeHtml(t("task.noDependencies"))}</span>
            </div>

            ${blockedByNames.length ? `
              <div class="task-meta-line">
                <strong>${escapeHtml(t("task.blockedBy"))}:</strong>
                <span>${blockedByNames.map((name) => escapeHtml(name)).join(", ")}</span>
              </div>
            ` : ""}

            <div class="task-meta-line">
              <strong>${escapeHtml(t("task.unlocks"))}:</strong>
              <span>${unlockNames.length ? unlockNames.map((name) => escapeHtml(name)).join(", ") : escapeHtml(t("task.unlocksNone"))}</span>
            </div>
          </div>
        </div>

        <div class="task-actions">
          <button class="button button-ghost" type="button" data-action="create-child-task" data-task-id="${task.id}">${escapeHtml(t("actions.subtask"))}</button>
          <button class="button button-ghost" type="button" data-action="edit-task" data-task-id="${task.id}">${escapeHtml(t("actions.edit"))}</button>
          <button class="button button-danger" type="button" data-action="delete-task" data-task-id="${task.id}">${escapeHtml(t("actions.delete"))}</button>
        </div>
      </div>

      ${visibleChildren.length ? `
        <div class="task-children ${isOpen ? "" : "is-hidden"}">
          ${visibleChildren.map((childTask) => renderTask(childTask, indexes, filters, uiState, visibilityCache, t)).join("")}
        </div>
      ` : ""}
    </article>
  `;
}

export function renderMap(workspace, filters, uiState, t) {
  if (workspace.phases.length === 0) {
    return `
      <section class="empty-card">
        <h3>${escapeHtml(t("empty.noPhasesTitle"))}</h3>
        <p>${escapeHtml(t("empty.noPhasesBody"))}</p>
        <button class="button button-primary" type="button" data-action="create-phase">${escapeHtml(t("empty.noPhasesAction"))}</button>
      </section>
    `;
  }

  const indexes = buildIndexes(workspace);
  const visibilityCache = new Map();
  const hasActiveFilters = Boolean(filters.search) || filters.status !== "all" || filters.priority !== "all";

  function resolveVisibility(task) {
    if (visibilityCache.has(task.id)) {
      return visibilityCache.get(task.id);
    }

    const ownMatch = taskMatches(task, filters);
    const childMatch = task.childIds.some((childId) => {
      const childTask = indexes.tasksById.get(childId);
      return childTask ? resolveVisibility(childTask) : false;
    });

    const visible = ownMatch || childMatch;
    visibilityCache.set(task.id, visible);
    return visible;
  }

  for (const task of workspace.tasks) {
    resolveVisibility(task);
  }

  const phasesHtml = workspace.phases
    .map((phase) => {
      const categories = indexes.categoriesByPhase.get(phase.id) ?? [];
      const phaseTasks = workspace.tasks.filter((task) => task.phaseId === phase.id);
      const completed = phaseTasks.filter((task) => task.effectiveStatus === "completed").length;
      const phaseOpen = uiState.phaseOpen[phase.id] !== false;

      const categoriesHtml = categories
        .map((category) => {
          const categoryKey = `${phase.id}::${category.id}`;
          const tasksInCategory = (indexes.tasksByCategory.get(categoryKey) ?? []).filter((task) => !task.parentTaskId);
          const visibleRoots = tasksInCategory.filter((task) => visibilityCache.get(task.id));
          const categoryOpen = uiState.categoryOpen[category.id] !== false;

          if (hasActiveFilters && visibleRoots.length === 0) {
            return "";
          }

          return `
            <article class="category-card">
              <header class="category-header">
                <div class="category-header-main">
                  <div class="category-title-row">
                    <span class="category-title">${escapeHtml(category.name)}</span>
                    <span class="meta-pill">${escapeHtml(t("count.task", { count: tasksInCategory.length }))}</span>
                  </div>
                </div>

                <div class="category-actions">
                  <button class="icon-button" type="button" data-action="toggle-category" data-category-id="${category.id}" aria-label="${escapeHtml(t("aria.toggleCategory"))}" title="${escapeHtml(t("aria.toggleCategory"))}">
                    ${categoryOpen ? "–" : "+"}
                  </button>
                  <button class="icon-button" type="button" data-action="move-category-up" data-category-id="${category.id}" aria-label="${escapeHtml(t("aria.moveUp"))}" title="${escapeHtml(t("aria.moveUp"))}">↑</button>
                  <button class="icon-button" type="button" data-action="move-category-down" data-category-id="${category.id}" aria-label="${escapeHtml(t("aria.moveDown"))}" title="${escapeHtml(t("aria.moveDown"))}">↓</button>
                  <button class="icon-button" type="button" data-action="edit-category" data-category-id="${category.id}" aria-label="${escapeHtml(t("aria.edit"))}" title="${escapeHtml(t("aria.edit"))}">✎</button>
                  <button class="icon-button" type="button" data-action="create-task" data-phase-id="${phase.id}" data-category-id="${category.id}" aria-label="${escapeHtml(t("aria.create"))}" title="${escapeHtml(t("aria.create"))}">＋</button>
                  <button class="icon-button" type="button" data-action="delete-category" data-category-id="${category.id}" aria-label="${escapeHtml(t("aria.delete"))}" title="${escapeHtml(t("aria.delete"))}">×</button>
                </div>
              </header>

              <div class="category-body ${categoryOpen ? "" : "is-hidden"}">
                ${visibleRoots.length ? `
                  <div class="task-tree">
                    ${visibleRoots.map((task) => renderTask(task, indexes, filters, uiState, visibilityCache, t)).join("")}
                  </div>
                ` : `
                  <section class="empty-card">
                    <h3>${escapeHtml(t("empty.noTasksTitle"))}</h3>
                    <p>${escapeHtml(t("empty.noTasksBody"))}</p>
                    <button class="button button-primary" type="button" data-action="create-task" data-phase-id="${phase.id}" data-category-id="${category.id}">${escapeHtml(t("empty.noTasksAction"))}</button>
                  </section>
                `}
              </div>
            </article>
          `;
        })
        .filter(Boolean)
        .join("");

      if (hasActiveFilters && !categoriesHtml) {
        return "";
      }

      const phaseProgress = phaseTasks.length
        ? t("phase.progressPercent", { percent: Math.round((completed / phaseTasks.length) * 100) })
        : t("phase.progressEmpty");

      return `
        <section class="phase-card">
          <header class="phase-header">
            <div class="phase-header-main">
              <div class="phase-title-row">
                <span class="phase-title">${escapeHtml(phase.name)}</span>
                <span class="meta-pill">${escapeHtml(t("phase.completedRatio", { done: completed, total: phaseTasks.length || 0 }))}</span>
              </div>
              <div class="phase-progress">${escapeHtml(phaseProgress)}</div>
            </div>

            <div class="phase-actions">
              <button class="icon-button" type="button" data-action="toggle-phase" data-phase-id="${phase.id}" aria-label="${escapeHtml(t("aria.togglePhase"))}" title="${escapeHtml(t("aria.togglePhase"))}">
                ${phaseOpen ? "–" : "+"}
              </button>
              <button class="icon-button" type="button" data-action="move-phase-up" data-phase-id="${phase.id}" aria-label="${escapeHtml(t("aria.moveUp"))}" title="${escapeHtml(t("aria.moveUp"))}">↑</button>
              <button class="icon-button" type="button" data-action="move-phase-down" data-phase-id="${phase.id}" aria-label="${escapeHtml(t("aria.moveDown"))}" title="${escapeHtml(t("aria.moveDown"))}">↓</button>
              <button class="icon-button" type="button" data-action="edit-phase" data-phase-id="${phase.id}" aria-label="${escapeHtml(t("aria.edit"))}" title="${escapeHtml(t("aria.edit"))}">✎</button>
              <button class="icon-button" type="button" data-action="create-category" data-phase-id="${phase.id}" aria-label="${escapeHtml(t("aria.create"))}" title="${escapeHtml(t("aria.create"))}">＋</button>
              <button class="icon-button" type="button" data-action="delete-phase" data-phase-id="${phase.id}" aria-label="${escapeHtml(t("aria.delete"))}" title="${escapeHtml(t("aria.delete"))}">×</button>
            </div>
          </header>

          <div class="phase-body ${phaseOpen ? "" : "is-hidden"}">
            ${categoriesHtml || `
              <section class="empty-card">
                <h3>${escapeHtml(t("empty.noCategoriesTitle"))}</h3>
                <p>${escapeHtml(t("empty.noCategoriesBody"))}</p>
                <button class="button button-primary" type="button" data-action="create-category" data-phase-id="${phase.id}">${escapeHtml(t("empty.noCategoriesAction"))}</button>
              </section>
            `}
          </div>
        </section>
      `;
    })
    .filter(Boolean)
    .join("");

  if (!phasesHtml) {
    return `
      <section class="empty-card">
        <h3>${escapeHtml(t("empty.noResultsTitle"))}</h3>
        <p>${escapeHtml(t("empty.noResultsBody"))}</p>
      </section>
    `;
  }

  return phasesHtml;
}
