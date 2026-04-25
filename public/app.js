import {
  createAssignee,
  createCategory,
  createPhase,
  createTask,
  deleteAssignee,
  deleteCategory,
  deletePhase,
  deleteTask,
  exportSnapshot,
  fetchWorkspace,
  importSnapshot,
  moveCategory,
  movePhase,
  pauseTaskTimer,
  resetCategoryProgress,
  resetMapProgress,
  resetPhaseProgress,
  resetRootTaskProgress,
  resetTaskTimer,
  setTaskStatus,
  startTaskTimer,
  updateAssignee,
  updateCategory,
  updatePhase,
  updateTask,
} from "./api.js";
import {
  applyStaticTranslations,
  createTranslator,
  formatDateOnly,
  formatDateTime,
  getStoredLocale,
  normalizeLocale,
  setStoredLocale,
} from "./i18n.js";
import {
  formatDuration,
  fromDateInputValue,
  fromDateTimeLocalValue,
  getLiveRemainingMs,
  getLiveTrackedMs,
  getTaskTimeState as deriveTaskTimeState,
  getTimeIconSvg,
  isDateMode,
  isDateTimeMode,
  isStopwatchMode,
  isTimerMode,
  minutesToMs,
  msToWholeMinutes,
  toDateInputValue,
  toDateTimeLocalValue,
  usesLiveClock,
} from "./task-time.js";
import {
  buildIndexes,
  escapeHtml,
  priorityLabel,
  renderMap,
  renderStats,
  statusLabel,
} from "./ui.js";

const UI_STORAGE_KEY = "tasks-ui";
const STATUS_CYCLE = ["pending", "in_progress", "completed", "discarded"];

function createEmptySnapshot() {
  return {
    version: 1,
    assignees: [],
    phases: [],
    categories: [],
    tasks: [],
  };
}

const refs = {
  statsBar: document.getElementById("stats-bar"),
  mapRoot: document.getElementById("map-root"),
  savedAtLabel: document.getElementById("saved-at-label"),
  searchInput: document.getElementById("search-input"),
  statusFilter: document.getElementById("status-filter"),
  priorityFilter: document.getElementById("priority-filter"),
  localeSwitch: document.getElementById("locale-switch"),
  importFile: document.getElementById("import-file"),
  detailDialog: document.getElementById("detail-dialog"),
  detailDialogEyebrow: document.getElementById("detail-dialog-eyebrow"),
  detailDialogTitle: document.getElementById("detail-dialog-title"),
  detailDialogSummary: document.getElementById("detail-dialog-summary"),
  detailDialogBody: document.getElementById("detail-dialog-body"),
  detailDialogActions: document.getElementById("detail-dialog-actions"),
  timeDialog: document.getElementById("time-dialog"),
  timeDialogTitle: document.getElementById("time-dialog-title"),
  timeDialogSummary: document.getElementById("time-dialog-summary"),
  timeDialogBody: document.getElementById("time-dialog-body"),
  timeDialogActions: document.getElementById("time-dialog-actions"),
  entityDialog: document.getElementById("entity-dialog"),
  entityForm: document.getElementById("entity-form"),
  entityDialogType: document.getElementById("entity-dialog-type"),
  entityDialogTitle: document.getElementById("entity-dialog-title"),
  entityContextSection: document.getElementById("entity-context-section"),
  entityContextGrid: document.getElementById("entity-context-grid"),
  entityPhaseField: document.getElementById("entity-phase-field"),
  entityPhaseSelect: document.getElementById("entity-phase-select"),
  entityNameInput: document.getElementById("entity-name-input"),
  taskDialog: document.getElementById("task-dialog"),
  taskForm: document.getElementById("task-form"),
  taskDialogTitle: document.getElementById("task-dialog-title"),
  taskContextSection: document.getElementById("task-context-section"),
  taskContextGrid: document.getElementById("task-context-grid"),
  taskScopeSection: document.getElementById("task-scope-section"),
  taskQuickNote: document.getElementById("task-quick-note"),
  taskAdvancedSection: document.getElementById("task-advanced-section"),
  taskTitleInput: document.getElementById("task-title-input"),
  taskAssigneeSelect: document.getElementById("task-assignee-select"),
  taskAssigneeModeAssigned: document.getElementById("task-assignee-mode-assigned"),
  taskAssigneeModeNone: document.getElementById("task-assignee-mode-none"),
  taskAssigneeSelectField: document.getElementById("task-assignee-select-field"),
  taskDescriptionInput: document.getElementById("task-description-input"),
  taskPhaseSelect: document.getElementById("task-phase-select"),
  taskCategorySelect: document.getElementById("task-category-select"),
  taskParentSelect: document.getElementById("task-parent-select"),
  taskPrioritySelect: document.getElementById("task-priority-select"),
  taskTimeModeSelect: document.getElementById("task-time-mode-select"),
  taskDateField: document.getElementById("task-date-field"),
  taskDateInput: document.getElementById("task-date-input"),
  taskDateTimeField: document.getElementById("task-datetime-field"),
  taskDueInput: document.getElementById("task-due-input"),
  taskTimerDurationField: document.getElementById("task-timer-duration-field"),
  taskTimerDurationInput: document.getElementById("task-timer-duration-input"),
  taskTrackedSummary: document.getElementById("task-tracked-summary"),
  taskNotesInput: document.getElementById("task-notes-input"),
  taskDependencySearch: document.getElementById("task-dependency-search"),
  taskDependencySelected: document.getElementById("task-dependency-selected"),
  taskDependencyOptions: document.getElementById("task-dependency-options"),
  moveDialog: document.getElementById("move-dialog"),
  moveForm: document.getElementById("move-form"),
  moveDialogTitle: document.getElementById("move-dialog-title"),
  moveCurrentContext: document.getElementById("move-current-context"),
  movePhaseSelect: document.getElementById("move-phase-select"),
  moveCategorySelect: document.getElementById("move-category-select"),
  moveParentSelect: document.getElementById("move-parent-select"),
  settingsDialog: document.getElementById("settings-dialog"),
  assigneeForm: document.getElementById("assignee-form"),
  assigneeFormLabel: document.getElementById("assignee-form-label"),
  assigneeNameInput: document.getElementById("assignee-name-input"),
  assigneeList: document.getElementById("assignee-list"),
  deleteDialog: document.getElementById("delete-dialog"),
  deleteForm: document.getElementById("delete-form"),
  deleteDialogEyebrow: document.getElementById("delete-dialog-eyebrow"),
  deleteDialogTitle: document.getElementById("delete-dialog-title"),
  deleteDialogMessage: document.getElementById("delete-dialog-message"),
  deleteDialogImpact: document.getElementById("delete-dialog-impact"),
  deleteStrategyField: document.getElementById("delete-strategy-field"),
  deleteBranchTitle: document.getElementById("delete-branch-title"),
  deleteBranchHelp: document.getElementById("delete-branch-help"),
  deletePromoteOption: document.getElementById("delete-promote-option"),
  deletePromoteTitle: document.getElementById("delete-promote-title"),
  deletePromoteHelp: document.getElementById("delete-promote-help"),
  toastRoot: document.getElementById("toast-root"),
  createCategoryButton: document.getElementById("create-category-button"),
  createTaskButton: document.getElementById("create-task-button"),
};

const defaultUiState = {
  filters: {
    search: "",
    status: "all",
    priority: "all",
  },
  phaseOpen: {},
  categoryOpen: {},
  taskOpen: {},
};

const initialLocale = getStoredLocale();

const state = {
  workspace: null,
  locale: initialLocale,
  translate: createTranslator(initialLocale),
  ui: loadUiState(),
  dialogs: {
    detail: null,
    time: null,
    entity: null,
    task: null,
    move: null,
    settings: null,
    delete: null,
  },
};

let liveRefreshHandle = null;

function t(key, params) {
  return state.translate(key, params);
}

function getCurrentLocale() {
  return document.documentElement.lang || state.locale || "en";
}

function canUseStopwatch(task) {
  return isStopwatchMode(task?.timeMode);
}

function canUseDate(task) {
  return isDateMode(task?.timeMode);
}

function canUseDateTime(task) {
  return isDateTimeMode(task?.timeMode);
}

function canUseTimer(task) {
  return isTimerMode(task?.timeMode);
}

function getTaskTimeView(task) {
  const timeState = deriveTaskTimeState(task);
  return {
    ...timeState,
    trackedLabel: formatDuration(timeState.trackedMs),
    remainingLabel: formatDuration(timeState.remainingMs),
  };
}

function hasLiveTimeSignals(workspace) {
  if (!workspace) {
    return false;
  }

  return workspace.tasks.some((task) => {
    if (task.timerRunning) {
      return true;
    }

    if ((canUseDate(task) || canUseDateTime(task)) && !["completed", "discarded"].includes(task.effectiveStatus)) {
      return true;
    }

    return false;
  });
}

function loadUiState() {
  try {
    const raw = localStorage.getItem(UI_STORAGE_KEY);
    if (!raw) {
      return structuredClone(defaultUiState);
    }

    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(defaultUiState),
      ...parsed,
      filters: {
        ...structuredClone(defaultUiState).filters,
        ...parsed.filters,
      },
    };
  } catch {
    return structuredClone(defaultUiState);
  }
}

function saveUiState() {
  localStorage.setItem(
    UI_STORAGE_KEY,
    JSON.stringify({
      filters: state.ui.filters,
      phaseOpen: state.ui.phaseOpen,
      categoryOpen: state.ui.categoryOpen,
      taskOpen: state.ui.taskOpen,
    }),
  );
}

function refreshLocale() {
  state.locale = normalizeLocale(state.locale);
  state.translate = createTranslator(state.locale);
  setStoredLocale(state.locale);
  document.documentElement.lang = state.locale;
  document.title = t("app.documentTitle");
  refs.localeSwitch.value = state.locale;
  applyStaticTranslations(document, state.translate);
  syncOpenDialogCopy();

  if (state.workspace) {
    render();
  } else {
    refs.savedAtLabel.textContent = t("app.savedAtEmpty");
  }
}

function getIndexes() {
  return buildIndexes(state.workspace);
}

function findTask(taskId) {
  return state.workspace.tasks.find((task) => task.id === taskId) || null;
}

function findPhase(phaseId) {
  return state.workspace.phases.find((phase) => phase.id === phaseId) || null;
}

function findCategory(categoryId) {
  return state.workspace.categories.find((category) => category.id === categoryId) || null;
}

function findAssignee(assigneeId) {
  return state.workspace.assignees.find((assignee) => assignee.id === assigneeId) || null;
}

function applyTimeIndicatorState(element, task) {
  const timeState = getTaskTimeView(task);
  if (!timeState.hasTime) {
    element.remove();
    return;
  }

  element.className = `time-indicator-button tone-${timeState.tone}`;
  element.title = `${t(`time.mode.${timeState.mode}`)} · ${t(timeState.stateKey)}`;
  element.setAttribute("aria-label", t("aria.openTime"));
}

function refreshLiveTimeDisplays() {
  if (!state.workspace) {
    return;
  }

  document.querySelectorAll("[data-time-indicator-for]").forEach((element) => {
    const task = findTask(element.dataset.timeIndicatorFor);
    if (!task) {
      element.remove();
      return;
    }

    applyTimeIndicatorState(element, task);
  });

  if (state.dialogs.time) {
    syncTimeDialog();
  }
}

function syncLiveRefresh() {
  if (liveRefreshHandle) {
    window.clearInterval(liveRefreshHandle);
    liveRefreshHandle = null;
  }

  if (!hasLiveTimeSignals(state.workspace)) {
    return;
  }

  refreshLiveTimeDisplays();
  liveRefreshHandle = window.setInterval(() => {
    refreshLiveTimeDisplays();
  }, 1000);
}

function formatTaskNames(taskIds, fallbackKey = "task.none") {
  const names = taskIds
    .map((taskId) => findTask(taskId))
    .filter(Boolean)
    .map((task) => escapeHtml(task.title));

  return names.length ? names.join(", ") : escapeHtml(t(fallbackKey));
}

function formatAssigneeLabel(assignee) {
  if (!assignee) {
    return t("labels.noAssignee");
  }
  return assignee.isActive === false ? `${assignee.name} (${t("labels.inactive")})` : assignee.name;
}

function renderDetailItem(label, value, options = {}) {
  const content = value || escapeHtml(options.fallbackKey ? t(options.fallbackKey) : t("task.none"));
  return `
    <div class="detail-item ${options.wide ? "detail-item-wide" : ""}">
      <span>${escapeHtml(label)}</span>
      <strong>${content}</strong>
    </div>
  `;
}

function renderContextItem(label, value, options = {}) {
  return `
    <div class="context-item ${options.wide ? "context-item-wide" : ""}">
      <span>${escapeHtml(label)}</span>
      <strong>${value || escapeHtml(t(options.fallbackKey || "task.none"))}</strong>
    </div>
  `;
}

function renderTimeDetailMetric(label, value) {
  return `
    <div class="time-detail-metric">
      <span>${escapeHtml(label)}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function renderTimeTonePill(timeState) {
  return `
    <span class="meta-pill time-state-pill tone-${timeState.tone}">
      ${escapeHtml(t(timeState.stateKey))}
    </span>
  `;
}

function describeTaskTime(task) {
  const locale = getCurrentLocale();
  const timeState = getTaskTimeView(task);

  if (!timeState.hasTime) {
    return {
      ...timeState,
      modeLabel: t("time.mode.none"),
      stateLabel: t("time.state.none"),
    };
  }

  return {
    ...timeState,
    modeLabel: t(`time.mode.${timeState.mode}`),
    stateLabel: t(timeState.stateKey),
    dueDateLabel: task.dueDate ? formatDateOnly(locale, task.dueDate) : "",
    dueAtLabel: task.dueAt ? formatDateTime(locale, task.dueAt) : "",
    completedAtLabel: task.completedAt ? formatDateTime(locale, task.completedAt) : "",
  };
}

function renderTimeSummary(task) {
  const details = describeTaskTime(task);
  if (!details.hasTime) {
    return renderDetailItem(t("fields.timeMode"), escapeHtml(details.modeLabel));
  }

  return `
    <section class="detail-item detail-item-wide time-summary-card">
      <span>${escapeHtml(t("fields.timeMode"))}</span>
      <div class="time-summary-stack">
        <div class="time-summary-head">
          <span class="time-summary-icon tone-${details.tone}">
            ${getTimeIconSvg(details.icon)}
          </span>
          <div class="time-summary-copy">
            <strong>${escapeHtml(details.modeLabel)}</strong>
            <small>${escapeHtml(details.stateLabel)}</small>
          </div>
        </div>
        <button class="button button-ghost button-compact" type="button" data-action="open-task-time" data-task-id="${task.id}">
          ${escapeHtml(t("actions.viewTime"))}
        </button>
      </div>
    </section>
  `;
}

function renderTimeDialogActions(task, details) {
  if (!details.hasTime) {
    refs.timeDialogActions.innerHTML = `
      <button class="button button-ghost" type="button" data-action="close-time-dialog">${escapeHtml(t("actions.cancel"))}</button>
    `;
    return;
  }

  const canStart = usesLiveClock(task.timeMode) && !task.timerRunning && !["blocked", "completed", "discarded"].includes(task.effectiveStatus) && (!canUseTimer(task) || details.remainingMs > 0);
  const canPause = usesLiveClock(task.timeMode) && task.timerRunning;
  const canReset = canUseStopwatch(task)
    ? task.trackedMs > 0 || task.timerRunning
    : canUseTimer(task)
      ? (task.timerDurationMs ?? 0) > 0
      : false;
  const startLabel = canUseStopwatch(task)
    ? (task.trackedMs > 0 ? t("actions.resumeTimer") : t("actions.startTimer"))
    : (details.remainingMs < (task.timerDurationMs ?? 0) ? t("actions.resumeTimer") : t("actions.startTimer"));

  refs.timeDialogActions.innerHTML = `
    <button class="button button-ghost" type="button" data-action="close-time-dialog">${escapeHtml(t("actions.cancel"))}</button>
    ${usesLiveClock(task.timeMode) ? `
      <button class="button button-ghost" type="button" data-action="${task.timerRunning ? "pause-task-timer" : "start-task-timer"}" data-task-id="${task.id}" ${canStart || canPause ? "" : "disabled"}>
        ${escapeHtml(task.timerRunning ? t("actions.pauseTimer") : startLabel)}
      </button>
      <button class="button button-ghost" type="button" data-action="reset-task-timer" data-task-id="${task.id}" ${canReset ? "" : "disabled"}>
        ${escapeHtml(t("actions.resetTimer"))}
      </button>
    ` : ""}
  `;
}

function buildTaskPath(taskId, options = {}) {
  const labels = [];
  let current = taskId ? findTask(taskId) : null;

  while (current) {
    labels.unshift(current.title);
    current = current.parentTaskId ? findTask(current.parentTaskId) : null;
  }

  if (options.includeNewChildLabel) {
    labels.push(t("task.newChildLabel"));
  }

  return labels.length ? labels.map((label) => escapeHtml(label)).join(" / ") : escapeHtml(t("task.root"));
}

function getPhaseCategories(phaseId) {
  return state.workspace.categories.filter((category) => category.phaseId === phaseId);
}

function getPhaseStats(phaseId) {
  const categories = getPhaseCategories(phaseId);
  const tasks = state.workspace.tasks.filter((task) => task.phaseId === phaseId);
  const rootTasks = tasks.filter((task) => !task.parentTaskId);
  const subtasks = tasks.filter((task) => task.parentTaskId);

  return {
    categories,
    tasks,
    rootTasks,
    subtasks,
    completedRoots: rootTasks.filter((task) => task.effectiveStatus === "completed").length,
    completedSubtasks: subtasks.filter((task) => task.effectiveStatus === "completed").length,
  };
}

function getCategoryStats(categoryId) {
  const category = findCategory(categoryId);
  const tasks = state.workspace.tasks.filter((task) => task.categoryId === categoryId);
  const rootTasks = tasks.filter((task) => !task.parentTaskId);
  const subtasks = tasks.filter((task) => task.parentTaskId);

  return {
    category,
    phase: category ? findPhase(category.phaseId) : null,
    tasks,
    rootTasks,
    subtasks,
    completedRoots: rootTasks.filter((task) => task.effectiveStatus === "completed").length,
    completedSubtasks: subtasks.filter((task) => task.effectiveStatus === "completed").length,
  };
}

function renderDetailActions(actions) {
  refs.detailDialogActions.innerHTML = actions
    .map((action) => `
      <button
        class="button button-${action.variant ?? "ghost"} button-compact"
        type="button"
        data-action="${action.action}"
        ${action.disabled ? "disabled" : ""}
      >
        ${escapeHtml(action.label)}
      </button>
    `)
    .join("");
}

function buildAssigneeOptions(selectedAssigneeId = "") {
  const selectedAssignee = selectedAssigneeId ? findAssignee(selectedAssigneeId) : null;
  const options = [
    `<option value="">${escapeHtml(t("placeholders.selectAssignee"))}</option>`,
    ...state.workspace.assignees
      .filter((assignee) => assignee.isActive || assignee.id === selectedAssigneeId)
      .map((assignee) => `<option value="${assignee.id}">${escapeHtml(formatAssigneeLabel(assignee))}</option>`),
  ];

  if (selectedAssigneeId && !selectedAssignee) {
    options.push(`<option value="${selectedAssigneeId}">${escapeHtml(t("placeholders.selectAssignee"))}</option>`);
  }

  return options.join("");
}

function syncTaskAssigneeOptions(selectedAssigneeId = "") {
  refs.taskAssigneeSelect.innerHTML = buildAssigneeOptions(selectedAssigneeId);
  refs.taskAssigneeSelect.value = selectedAssigneeId || "";
  syncTaskAssigneeState();
}

function syncTaskAssigneeState() {
  const assigneeEnabled = refs.taskAssigneeModeAssigned.checked;
  refs.taskAssigneeSelectField.classList.toggle("is-hidden", !assigneeEnabled);
  refs.taskAssigneeSelect.disabled = !assigneeEnabled;
  if (!assigneeEnabled) {
    refs.taskAssigneeSelect.value = "";
  }
}

function syncTaskDialogMode() {
  const dialogState = state.dialogs.task;
  if (!dialogState) {
    return;
  }

  const isQuickCreate = dialogState.mode === "create";
  refs.taskAdvancedSection.classList.toggle("is-hidden", isQuickCreate);
  refs.taskQuickNote.classList.toggle("is-hidden", !isQuickCreate);
}

function syncSettingsDialog() {
  if (!state.dialogs.settings) {
    return;
  }

  const editor = state.dialogs.settings.editor;
  const assignee = editor.id ? findAssignee(editor.id) : null;

  refs.assigneeFormLabel.textContent = t(editor.mode === "edit" ? "settings.assigneeEdit" : "settings.assigneeNew");
  refs.assigneeNameInput.value = assignee?.name ?? "";
  refs.assigneeList.innerHTML = state.workspace.assignees.length
    ? state.workspace.assignees
        .map((item) => `
          <article class="catalog-item ${item.isActive ? "" : "is-inactive"}">
            <div class="catalog-item-main">
              <div class="catalog-item-row">
                <strong>${escapeHtml(item.name)}</strong>
                <span class="badge ${item.isActive ? "" : "status-discarded"}">${escapeHtml(t(item.isActive ? "labels.active" : "labels.inactive"))}</span>
                <span class="meta-pill">${escapeHtml(t("settings.usedBy", { count: item.usageCount }))}</span>
              </div>
            </div>
            <div class="catalog-item-actions">
              <button class="button button-ghost button-compact" type="button" data-action="edit-assignee" data-assignee-id="${item.id}">${escapeHtml(t("actions.edit"))}</button>
              <button class="button button-ghost button-compact" type="button" data-action="toggle-assignee-active" data-assignee-id="${item.id}">
                ${escapeHtml(t(item.isActive ? "actions.deactivate" : "actions.activate"))}
              </button>
              <button
                class="button button-danger button-compact"
                type="button"
                data-action="delete-assignee"
                data-assignee-id="${item.id}"
                ${item.usageCount > 0 ? "disabled" : ""}
                title="${escapeHtml(item.usageCount > 0 ? t("settings.deleteBlocked") : t("dialogs.detail.delete"))}"
              >
                ${escapeHtml(t("dialogs.detail.delete"))}
              </button>
            </div>
          </article>
        `)
        .join("")
    : `
      <section class="empty-card catalog-empty">
        <h3>${escapeHtml(t("empty.noAssigneesTitle"))}</h3>
        <p>${escapeHtml(t("empty.noAssigneesBody"))}</p>
      </section>
    `;
}

function openSettingsDialog() {
  if (!state.workspace) {
    return;
  }
  state.dialogs.settings = {
    editor: {
      mode: "create",
      id: null,
    },
  };
  syncSettingsDialog();
  refs.settingsDialog.showModal();
  refs.assigneeNameInput.focus();
}

function normalizeOpenState() {
  const phaseIds = new Set(state.workspace.phases.map((phase) => phase.id));
  const categoryIds = new Set(state.workspace.categories.map((category) => category.id));
  const taskIds = new Set(state.workspace.tasks.map((task) => task.id));

  state.ui.phaseOpen = Object.fromEntries(
    [...phaseIds].map((phaseId) => [phaseId, state.ui.phaseOpen[phaseId] ?? true]),
  );
  state.ui.categoryOpen = Object.fromEntries(
    [...categoryIds].map((categoryId) => [categoryId, state.ui.categoryOpen[categoryId] ?? true]),
  );
  state.ui.taskOpen = Object.fromEntries(
    [...taskIds].map((taskId) => [taskId, state.ui.taskOpen[taskId] ?? false]),
  );
}

function applyWorkspace(workspace, afterUpdate) {
  state.workspace = workspace;
  if (typeof afterUpdate === "function") {
    afterUpdate(workspace);
  }
  normalizeOpenState();
  saveUiState();
  render();
}

function render() {
  refs.statsBar.innerHTML = renderStats(state.workspace, t);
  refs.savedAtLabel.textContent = state.workspace.savedAt
    ? t("app.savedAtLabel", { value: formatDateTime(state.locale, state.workspace.savedAt) })
    : t("app.savedAtEmpty");
  refs.mapRoot.innerHTML = renderMap(state.workspace, state.ui.filters, state.ui, t);
  refs.searchInput.value = state.ui.filters.search;
  refs.statusFilter.value = state.ui.filters.status;
  refs.priorityFilter.value = state.ui.filters.priority;
  refs.createCategoryButton.disabled = state.workspace.phases.length === 0;
  refs.createTaskButton.disabled = state.workspace.categories.length === 0;
  syncOpenDialogCopy();
  syncLiveRefresh();
}

function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  refs.toastRoot.appendChild(toast);
  window.setTimeout(() => {
    toast.remove();
  }, 3200);
}

function showToastKey(key, type = "success", params) {
  showToast(t(key, params), type);
}

async function performMutation(operation, successKey, afterUpdate, successParams) {
  try {
    const workspace = await operation();
    applyWorkspace(workspace, afterUpdate);
    if (successKey) {
      showToastKey(successKey, "success", successParams);
    }
    return true;
  } catch (error) {
    showToast(error.message, "error");
    return false;
  }
}

function closeDialog(dialog) {
  if (dialog.open) {
    dialog.close();
  }
}

function closeDetailDialog() {
  closeDialog(refs.detailDialog);
  state.dialogs.detail = null;
}

function closeEntityDialog() {
  closeDialog(refs.entityDialog);
  state.dialogs.entity = null;
}

function closeTaskDialog() {
  closeDialog(refs.taskDialog);
  state.dialogs.task = null;
}

function closeMoveDialog() {
  closeDialog(refs.moveDialog);
  state.dialogs.move = null;
}

function closeDeleteDialog() {
  closeDialog(refs.deleteDialog);
  state.dialogs.delete = null;
}

function closeTimeDialog() {
  closeDialog(refs.timeDialog);
  state.dialogs.time = null;
}

function closeSettingsDialog() {
  closeDialog(refs.settingsDialog);
  state.dialogs.settings = null;
}

function syncTimeDialog() {
  const dialogState = state.dialogs.time;
  if (!dialogState) {
    return;
  }

  const task = findTask(dialogState.taskId);
  if (!task) {
    closeTimeDialog();
    return;
  }
  if (task.timeMode === "none") {
    closeTimeDialog();
    return;
  }

  const details = describeTaskTime(task);
  refs.timeDialogTitle.textContent = task.title;
  refs.timeDialogSummary.innerHTML = `
    <div class="detail-summary-main">
      <div class="detail-summary-row">
        <span class="time-summary-icon tone-${details.tone}">
          ${getTimeIconSvg(details.icon)}
        </span>
        <span class="meta-pill">${escapeHtml(details.modeLabel)}</span>
        ${details.hasTime ? renderTimeTonePill(details) : ""}
      </div>
    </div>
  `;

  refs.timeDialogBody.innerHTML = `
    ${renderDetailItem(t("fields.timeMode"), escapeHtml(details.modeLabel))}
    ${renderDetailItem(t("fields.timeState"), escapeHtml(details.stateLabel))}
    ${canUseDate(task)
      ? renderDetailItem(
          t("fields.dueDate"),
          details.dueDateLabel ? escapeHtml(details.dueDateLabel) : "",
          { fallbackKey: "time.noDate" },
        )
      : ""}
    ${canUseDateTime(task)
      ? renderDetailItem(
          t("fields.dueAt"),
          details.dueAtLabel ? escapeHtml(details.dueAtLabel) : "",
          { fallbackKey: "time.deadlineNone" },
        )
      : ""}
    ${canUseStopwatch(task)
      ? renderDetailItem(t("fields.trackedTime"), escapeHtml(details.trackedLabel))
      : ""}
    ${canUseTimer(task)
      ? renderDetailItem(t("fields.remainingTime"), escapeHtml(details.remainingLabel))
      : ""}
    ${canUseTimer(task)
      ? renderDetailItem(
          t("fields.timerMinutes"),
          task.timerDurationMs ? escapeHtml(t("time.timerDurationMinutes", { count: Math.round(task.timerDurationMs / 60000) })) : "",
          { fallbackKey: "time.noTimerDuration" },
        )
      : ""}
    ${task.completedAt
      ? renderDetailItem(t("fields.completedAt"), escapeHtml(details.completedAtLabel))
      : ""}
  `;

  renderTimeDialogActions(task, details);
}

function openTimeDialog(taskId) {
  const task = findTask(taskId);
  if (!task || task.timeMode === "none") {
    return;
  }

  state.dialogs.time = { taskId };
  syncTimeDialog();
  if (!refs.timeDialog.open) {
    refs.timeDialog.showModal();
  }
}

function syncDetailDialog() {
  const dialogState = state.dialogs.detail;
  if (!dialogState) {
    return;
  }

  if (dialogState.type === "task") {
    const task = findTask(dialogState.id);
    if (!task) {
      closeDetailDialog();
      return;
    }

    const parent = task.parentTaskId ? findTask(task.parentTaskId) : null;
    const phase = findPhase(task.phaseId);
    const category = findCategory(task.categoryId);
    const assignee = task.assigneeId ? findAssignee(task.assigneeId) : null;

    refs.detailDialogEyebrow.textContent = t("dialogs.detail.taskEyebrow");
    refs.detailDialogTitle.textContent = task.title;
    refs.detailDialogSummary.innerHTML = `
      <div class="detail-summary-main">
        <div class="detail-summary-row">
          <span class="badge status-${task.effectiveStatus}">${escapeHtml(statusLabel(t, task.effectiveStatus))}</span>
          <span class="badge priority-${task.priority}">${escapeHtml(priorityLabel(t, task.priority))}</span>
          ${task.assignee ? `<span class="meta-pill">@ ${escapeHtml(task.assignee)}</span>` : ""}
          ${task.noAssignee ? `<span class="meta-pill no-assignee-pill">${escapeHtml(t("labels.noAssignee"))}</span>` : ""}
          ${assignee && assignee.isActive === false ? `<span class="meta-pill">${escapeHtml(t("labels.inactive"))}</span>` : ""}
          ${task.childIds.length ? `<span class="meta-pill">${escapeHtml(t("count.child", { count: task.childIds.length }))}</span>` : ""}
        </div>
      </div>
    `;

    refs.detailDialogBody.innerHTML = `
      ${renderDetailItem(t("fields.phase"), escapeHtml(phase?.name ?? t("labels.noPhase")))}
      ${renderDetailItem(t("fields.category"), escapeHtml(category?.name ?? t("labels.noCategory")))}
      ${renderDetailItem(t("fields.status"), escapeHtml(statusLabel(t, task.effectiveStatus)))}
      ${renderDetailItem(t("fields.priority"), escapeHtml(priorityLabel(t, task.priority)))}
      ${renderDetailItem(
        t("fields.assignee"),
        task.assignee
          ? escapeHtml(formatAssigneeLabel(assignee ?? { name: task.assignee, isActive: task.assigneeActive }))
          : task.noAssignee
            ? `<span class="no-assignee-badge">${escapeHtml(t("labels.noAssignee"))}</span>`
            : "",
      )}
      ${renderDetailItem(t("fields.description"), task.description ? escapeHtml(task.description) : "", { wide: true, fallbackKey: "task.noDescription" })}
      ${renderDetailItem(t("task.structure"), parent ? escapeHtml(t("task.childOf", { title: parent.title })) : escapeHtml(t("task.root")))}
      ${renderDetailItem(t("fields.path"), buildTaskPath(task.id), { wide: true })}
      ${renderTimeSummary(task)}
      ${renderDetailItem(t("task.directChildren"), task.childIds.length ? escapeHtml(t("count.child", { count: task.childIds.length })) : "", { fallbackKey: "task.none" })}
      ${renderDetailItem(t("task.dependsOn"), formatTaskNames(task.dependencyIds, "task.noDependencies"), { wide: true })}
      ${renderDetailItem(t("task.blockedBy"), formatTaskNames(task.blockedByIds, "task.noDependencies"), { wide: true })}
      ${renderDetailItem(t("task.unlocks"), formatTaskNames(task.unlocksIds, "task.unlocksNone"), { wide: true })}
      ${renderDetailItem(t("fields.notes"), task.notes ? escapeHtml(task.notes) : "", { wide: true, fallbackKey: "task.noNotes" })}
    `;

    renderDetailActions([
      ...(task.timeMode !== "none" ? [{ action: "detail-open-time", label: t("actions.viewTime") }] : []),
      { action: "detail-add-child", label: t("actions.addChild") },
      ...(!task.parentTaskId ? [{ action: "detail-reset-root-task-progress", label: t("actions.resetBranchProgress") }] : []),
      { action: "detail-move-task", label: t("actions.moveTask") },
      { action: "detail-edit-task", label: t("dialogs.detail.edit") },
      { action: "detail-delete-task", label: t("dialogs.detail.delete"), variant: "danger" },
    ]);
    return;
  }

  if (dialogState.type === "phase") {
    const phase = findPhase(dialogState.id);
    if (!phase) {
      closeDetailDialog();
      return;
    }

    const stats = getPhaseStats(phase.id);
    const phaseIndex = state.workspace.phases.findIndex((item) => item.id === phase.id);
    const canMoveUp = phaseIndex > 0;
    const canMoveDown = phaseIndex < state.workspace.phases.length - 1;
    const canDelete = stats.categories.length === 0 && stats.tasks.length === 0;
    const rootProgress = stats.rootTasks.length
      ? t("phase.rootProgress", { done: stats.completedRoots, total: stats.rootTasks.length })
      : t("phase.progressEmpty");
    const subtaskProgress = stats.subtasks.length
      ? t("phase.subtaskProgress", { done: stats.completedSubtasks, total: stats.subtasks.length })
      : t("phase.subtaskEmpty");

    refs.detailDialogEyebrow.textContent = t("dialogs.detail.phaseEyebrow");
    refs.detailDialogTitle.textContent = phase.name;
    refs.detailDialogSummary.innerHTML = `
      <div class="detail-summary-main">
        <div class="detail-summary-row">
          <span class="meta-pill">${escapeHtml(t("count.category", { count: stats.categories.length }))}</span>
          <span class="meta-pill">${escapeHtml(t("count.task", { count: stats.rootTasks.length }))}</span>
          <span class="meta-pill">${escapeHtml(t("count.subtask", { count: stats.subtasks.length }))}</span>
        </div>
        <p class="detail-summary-copy">${escapeHtml(rootProgress)} · ${escapeHtml(subtaskProgress)}</p>
      </div>
    `;

    refs.detailDialogBody.innerHTML = `
      ${renderDetailItem(t("fields.name"), escapeHtml(phase.name))}
      ${renderDetailItem(t("fields.categories"), escapeHtml(t("count.category", { count: stats.categories.length })))}
      ${renderDetailItem(t("fields.rootTasks"), escapeHtml(t("count.task", { count: stats.rootTasks.length })))}
      ${renderDetailItem(t("fields.subtasks"), escapeHtml(t("count.subtask", { count: stats.subtasks.length })))}
      ${renderDetailItem(t("fields.progress"), escapeHtml(rootProgress), { wide: true })}
      ${renderDetailItem(t("fields.subtaskProgress"), escapeHtml(subtaskProgress), { wide: true })}
    `;

    renderDetailActions([
      { action: "detail-create-category", label: t("actions.createCategory") },
      { action: "detail-reset-phase-progress", label: t("actions.resetPhaseProgress") },
      { action: "detail-move-phase-up", label: t("actions.moveUp"), disabled: !canMoveUp },
      { action: "detail-move-phase-down", label: t("actions.moveDown"), disabled: !canMoveDown },
      { action: "detail-edit-phase", label: t("dialogs.detail.edit") },
      { action: "detail-delete-phase", label: t("dialogs.detail.delete"), variant: "danger", disabled: !canDelete },
    ]);
    return;
  }

  if (dialogState.type === "category") {
    const stats = getCategoryStats(dialogState.id);
    if (!stats.category) {
      closeDetailDialog();
      return;
    }

    const siblings = state.workspace.categories.filter((item) => item.phaseId === stats.category.phaseId);
    const categoryIndex = siblings.findIndex((item) => item.id === stats.category.id);
    const canMoveUp = categoryIndex > 0;
    const canMoveDown = categoryIndex < siblings.length - 1;
    const canDelete = stats.tasks.length === 0;
    const rootProgress = stats.rootTasks.length
      ? t("phase.rootProgress", { done: stats.completedRoots, total: stats.rootTasks.length })
      : t("phase.progressEmpty");
    const subtaskProgress = stats.subtasks.length
      ? t("phase.subtaskProgress", { done: stats.completedSubtasks, total: stats.subtasks.length })
      : t("phase.subtaskEmpty");

    refs.detailDialogEyebrow.textContent = t("dialogs.detail.categoryEyebrow");
    refs.detailDialogTitle.textContent = stats.category.name;
    refs.detailDialogSummary.innerHTML = `
      <div class="detail-summary-main">
        <div class="detail-summary-row">
          ${stats.phase ? `<span class="meta-pill">${escapeHtml(stats.phase.name)}</span>` : ""}
          <span class="meta-pill">${escapeHtml(t("count.task", { count: stats.rootTasks.length }))}</span>
          <span class="meta-pill">${escapeHtml(t("count.subtask", { count: stats.subtasks.length }))}</span>
        </div>
        <p class="detail-summary-copy">${escapeHtml(rootProgress)} · ${escapeHtml(subtaskProgress)}</p>
      </div>
    `;

    refs.detailDialogBody.innerHTML = `
      ${renderDetailItem(t("fields.phase"), escapeHtml(stats.phase?.name ?? t("labels.noPhase")))}
      ${renderDetailItem(t("fields.name"), escapeHtml(stats.category.name))}
      ${renderDetailItem(t("fields.rootTasks"), escapeHtml(t("count.task", { count: stats.rootTasks.length })))}
      ${renderDetailItem(t("fields.subtasks"), escapeHtml(t("count.subtask", { count: stats.subtasks.length })))}
      ${renderDetailItem(t("fields.progress"), escapeHtml(rootProgress), { wide: true })}
      ${renderDetailItem(t("fields.subtaskProgress"), escapeHtml(subtaskProgress), { wide: true })}
    `;

    renderDetailActions([
      { action: "detail-create-task", label: t("actions.createTask") },
      { action: "detail-reset-category-progress", label: t("actions.resetCategoryProgress") },
      { action: "detail-move-category-up", label: t("actions.moveUp"), disabled: !canMoveUp },
      { action: "detail-move-category-down", label: t("actions.moveDown"), disabled: !canMoveDown },
      { action: "detail-edit-category", label: t("dialogs.detail.edit") },
      { action: "detail-delete-category", label: t("dialogs.detail.delete"), variant: "danger", disabled: !canDelete },
    ]);
  }
}

function openDetailDialog(type, id) {
  const exists = type === "task" ? findTask(id) : type === "phase" ? findPhase(id) : findCategory(id);
  if (!exists) {
    return;
  }

  state.dialogs.detail = { type, id };
  syncDetailDialog();
  if (!refs.detailDialog.open) {
    refs.detailDialog.showModal();
  }
}

function syncMoveDialogCopy() {
  const dialogState = state.dialogs.move;
  if (!dialogState) {
    return;
  }

  const task = findTask(dialogState.taskId);
  if (!task) {
    closeDialog(refs.moveDialog);
    state.dialogs.move = null;
    return;
  }

  refs.moveDialogTitle.textContent = t("dialogs.move.title", { title: task.title });
  refs.moveCurrentContext.innerHTML = [
    renderContextItem(t("fields.phase"), escapeHtml(findPhase(task.phaseId)?.name ?? t("labels.noPhase"))),
    renderContextItem(t("fields.category"), escapeHtml(findCategory(task.categoryId)?.name ?? t("labels.noCategory"))),
    renderContextItem(t("fields.parent"), task.parentTaskId ? escapeHtml(findTask(task.parentTaskId)?.title ?? t("task.none")) : escapeHtml(t("task.root"))),
    renderContextItem(t("fields.path"), buildTaskPath(task.id), { wide: true }),
  ].join("");
}

function syncMoveDialogScopedOptions() {
  const dialogState = state.dialogs.move;
  if (!dialogState) {
    return;
  }

  const selectedPhaseId = refs.movePhaseSelect.value;
  const categories = getPhaseCategories(selectedPhaseId);
  const selectedCategoryBefore = refs.moveCategorySelect.value || dialogState.categoryId;

  refs.moveCategorySelect.innerHTML = categories.length
    ? categories.map((category) => `<option value="${category.id}">${escapeHtml(category.name)}</option>`).join("")
    : `<option value="">${escapeHtml(t("empty.noCategoriesTitle"))}</option>`;

  refs.moveCategorySelect.value = categories.some((category) => category.id === selectedCategoryBefore)
    ? selectedCategoryBefore
    : categories[0]?.id ?? "";

  const excludedParentIds = new Set([dialogState.taskId, ...collectDescendantIds(dialogState.taskId)]);
  const parentOptions = state.workspace.tasks.filter((task) => (
    task.phaseId === refs.movePhaseSelect.value
    && task.categoryId === refs.moveCategorySelect.value
    && !excludedParentIds.has(task.id)
  ));

  refs.moveParentSelect.innerHTML = [
    `<option value="">${escapeHtml(t("placeholders.noParent"))}</option>`,
    ...parentOptions.map((task) => `<option value="${task.id}">${escapeHtml(task.title)}</option>`),
  ].join("");

  refs.moveParentSelect.value = parentOptions.some((task) => task.id === dialogState.parentTaskId)
    ? dialogState.parentTaskId
    : "";
}

function openMoveDialog(taskId) {
  const task = findTask(taskId);
  if (!task) {
    return;
  }

  state.dialogs.move = {
    taskId,
    phaseId: task.phaseId,
    categoryId: task.categoryId,
    parentTaskId: task.parentTaskId ?? "",
  };

  refs.movePhaseSelect.innerHTML = collectPhaseOptions();
  refs.movePhaseSelect.value = task.phaseId;
  syncMoveDialogCopy();
  syncMoveDialogScopedOptions();
  refs.moveDialog.showModal();
}

function syncEntityDialogCopy() {
  const dialogState = state.dialogs.entity;
  if (!dialogState) {
    return;
  }

  const isCategory = dialogState.type === "category";
  refs.entityDialogType.textContent = t(isCategory ? "dialogs.entity.categoryType" : "dialogs.entity.phaseType");
  refs.entityDialogTitle.textContent = t(
    dialogState.mode === "edit"
      ? isCategory ? "dialogs.entity.editCategory" : "dialogs.entity.editPhase"
      : isCategory ? "dialogs.entity.newCategory" : "dialogs.entity.newPhase",
  );

  syncEntityDialogContext();
}

function syncEntityDialogContext() {
  const dialogState = state.dialogs.entity;
  if (!dialogState) {
    return;
  }

  const usesLockedPhase = dialogState.type === "category" && dialogState.phaseMode !== "global";
  refs.entityContextSection.classList.toggle("is-hidden", !usesLockedPhase);
  refs.entityPhaseField.classList.toggle("is-hidden", dialogState.type !== "category" || usesLockedPhase);

  refs.entityContextGrid.innerHTML = usesLockedPhase
    ? renderContextItem(
      t("fields.phase"),
      escapeHtml(findPhase(dialogState.phaseId)?.name ?? t("labels.noPhase")),
      { wide: true },
    )
    : "";
}

function openEntityDialog(config) {
  const isCategory = config.type === "category";
  const currentEntity = config.id ? (isCategory ? findCategory(config.id) : findPhase(config.id)) : null;
  const phaseMode = isCategory
    ? currentEntity
      ? "locked"
      : config.source === "phase"
        ? "locked"
        : "global"
    : "none";
  const phaseId = isCategory
    ? currentEntity?.phaseId ?? config.phaseId ?? state.workspace.phases[0]?.id ?? ""
    : "";

  state.dialogs.entity = {
    ...config,
    phaseMode,
    phaseId,
  };

  refs.entityNameInput.value = currentEntity?.name ?? "";
  refs.entityPhaseSelect.disabled = !isCategory || phaseMode !== "global";
  refs.entityPhaseSelect.innerHTML = state.workspace.phases
    .map((phase) => `<option value="${phase.id}">${escapeHtml(phase.name)}</option>`)
    .join("");

  if (isCategory) {
    refs.entityPhaseSelect.value = phaseId;
  }

  syncEntityDialogCopy();
  refs.entityDialog.showModal();
  refs.entityNameInput.focus();
}

async function handleEntitySubmit(event) {
  event.preventDefault();
  const dialogState = state.dialogs.entity;
  if (!dialogState) {
    return;
  }

  const name = refs.entityNameInput.value.trim();
  if (!name) {
    showToastKey("toasts.nameRequired", "error");
    return;
  }

  const ok = dialogState.type === "phase"
    ? await performMutation(
      () => (dialogState.mode === "edit" ? updatePhase(dialogState.id, name) : createPhase(name)),
      dialogState.mode === "edit" ? "toasts.phaseUpdated" : "toasts.phaseCreated",
    )
    : await performMutation(
      () =>
        dialogState.mode === "edit"
          ? updateCategory(dialogState.id, name)
          : createCategory({ phaseId: dialogState.phaseMode === "global" ? refs.entityPhaseSelect.value : dialogState.phaseId, name }),
      dialogState.mode === "edit" ? "toasts.categoryUpdated" : "toasts.categoryCreated",
      () => {
        state.ui.phaseOpen[dialogState.phaseMode === "global" ? refs.entityPhaseSelect.value : dialogState.phaseId] = true;
      },
    );

  if (ok) {
    closeDialog(refs.entityDialog);
    state.dialogs.entity = null;
  }
}

function getFirstCategory() {
  return state.workspace.categories[0] ?? null;
}

function getFirstPhaseWithCategories() {
  const firstCategory = getFirstCategory();
  return firstCategory ? findPhase(firstCategory.phaseId) : state.workspace.phases[0] ?? null;
}

function collectPhaseOptions() {
  return state.workspace.phases
    .map((phase) => `<option value="${phase.id}">${escapeHtml(phase.name)}</option>`)
    .join("");
}

function resolveTaskDialogFlow(config, task) {
  if (task) {
    return "edit";
  }

  if (config.source === "child") {
    return "child";
  }

  if (config.source === "category") {
    return "category";
  }

  return "global";
}

function getScopedParentTasks(phaseId, categoryId) {
  return sortTasksForPicker(
    state.workspace.tasks.filter((task) => task.phaseId === phaseId && task.categoryId === categoryId),
  );
}

function collectParentTaskOptions(phaseId, categoryId, selectedParentId = "") {
  const scopedTasks = getScopedParentTasks(phaseId, categoryId);
  const options = [
    `<option value="">${escapeHtml(t("placeholders.noParent"))}</option>`,
    ...scopedTasks.map((task) => `<option value="${task.id}">${buildTaskPath(task.id)}</option>`),
  ];

  if (selectedParentId && !scopedTasks.some((task) => task.id === selectedParentId)) {
    options.push(`<option value="${selectedParentId}">${escapeHtml(t("placeholders.noParent"))}</option>`);
  }

  return {
    options: options.join(""),
    taskIds: new Set(scopedTasks.map((task) => task.id)),
  };
}

function syncTaskTimeFields() {
  const dialogState = state.dialogs.task;
  if (!dialogState) {
    return;
  }

  const timeMode = refs.taskTimeModeSelect.value;
  const dateEnabled = isDateMode(timeMode);
  const dateTimeEnabled = isDateTimeMode(timeMode);
  const stopwatchEnabled = isStopwatchMode(timeMode);
  const timerEnabled = isTimerMode(timeMode);
  const currentTask = dialogState.taskId ? findTask(dialogState.taskId) : null;
  const trackedMs = currentTask ? getLiveTrackedMs(currentTask) : 0;
  const remainingMs = currentTask ? getLiveRemainingMs(currentTask) : 0;

  refs.taskDateField.classList.toggle("is-hidden", !dateEnabled);
  refs.taskDateTimeField.classList.toggle("is-hidden", !dateTimeEnabled);
  refs.taskTimerDurationField.classList.toggle("is-hidden", !timerEnabled);

  refs.taskTrackedSummary.classList.toggle(
    "is-hidden",
    !(stopwatchEnabled && trackedMs > 0) && !(timerEnabled && (remainingMs > 0 || currentTask?.timerDurationMs)),
  );

  if (stopwatchEnabled && trackedMs > 0) {
    refs.taskTrackedSummary.innerHTML = `
      <span>${escapeHtml(t("fields.trackedTime"))}</span>
      <strong>${escapeHtml(formatDuration(trackedMs))}</strong>
    `;
    return;
  }

  if (timerEnabled && (remainingMs > 0 || currentTask?.timerDurationMs)) {
    refs.taskTrackedSummary.innerHTML = `
      <span>${escapeHtml(t("fields.remainingTime"))}</span>
      <strong>${escapeHtml(formatDuration(remainingMs || currentTask?.timerDurationMs || 0))}</strong>
    `;
    return;
  }

  refs.taskTrackedSummary.innerHTML = "";
}

function syncTaskDialogCopy() {
  const dialogState = state.dialogs.task;
  if (!dialogState) {
    return;
  }

  refs.taskDialogTitle.textContent = t(
    dialogState.flow === "child"
      ? "dialogs.task.addChild"
      : dialogState.mode === "edit"
        ? "dialogs.task.edit"
        : "dialogs.task.new",
  );
  syncTaskDialogMode();
  syncTaskTimeFields();
}

function collectDescendantIds(taskId) {
  if (!taskId) {
    return [];
  }

  const indexes = getIndexes();
  const found = [];
  const queue = [...(indexes.tasksById.get(taskId)?.childIds ?? [])];

  while (queue.length) {
    const currentId = queue.shift();
    found.push(currentId);
    const currentTask = indexes.tasksById.get(currentId);
    if (currentTask) {
      queue.push(...currentTask.childIds);
    }
  }

  return found;
}

function collectAncestorIds(taskId) {
  const found = [];
  let current = taskId ? findTask(taskId) : null;

  while (current?.parentTaskId) {
    found.push(current.parentTaskId);
    current = findTask(current.parentTaskId);
  }

  return found;
}

function collectDisallowedDependencyIds(dialogState) {
  const disallowed = new Set();

  if (dialogState.mode === "edit" && dialogState.taskId) {
    disallowed.add(dialogState.taskId);
    collectAncestorIds(dialogState.taskId).forEach((taskId) => disallowed.add(taskId));
    collectDescendantIds(dialogState.taskId).forEach((taskId) => disallowed.add(taskId));
    return disallowed;
  }

  if (dialogState.context.parentTaskId) {
    let current = dialogState.context.parentTaskId;
    while (current) {
      disallowed.add(current);
      current = findTask(current)?.parentTaskId ?? null;
    }
  }

  return disallowed;
}

function openTaskDialog(config = {}) {
  if (state.workspace.phases.length === 0 || state.workspace.categories.length === 0) {
    showToastKey("toasts.needPhaseAndCategory", "error");
    return;
  }

  const task = config.taskId ? findTask(config.taskId) : null;
  const defaults = config.defaults ?? {};
  const firstPhaseWithCategories = getFirstPhaseWithCategories();
  const firstCategory = getFirstCategory();
  const fallbackPhaseId = defaults.phaseId ?? task?.phaseId ?? firstPhaseWithCategories?.id ?? "";
  const fallbackCategoryId = defaults.categoryId ?? task?.categoryId ?? firstCategory?.id ?? "";
  const flow = resolveTaskDialogFlow(config, task);
  const parentTaskId = task?.parentTaskId ?? defaults.parentTaskId ?? null;
  const lockedDependencyIds = [...new Set(defaults.lockedDependencyIds ?? [])];
  const dependencyIds = [...new Set([...(task?.dependencyIds ?? defaults.dependencyIds ?? []), ...lockedDependencyIds])];

  state.dialogs.task = {
    mode: task ? "edit" : "create",
    flow,
    taskId: task?.id ?? null,
    dependencyIds,
    lockedDependencyIds,
    dependencyFilter: "",
    context: {
      phaseId: fallbackPhaseId,
      categoryId: fallbackCategoryId,
      parentTaskId,
    },
  };

  refs.taskTitleInput.value = task?.title ?? "";
  const noAssignee = task ? Boolean(task.noAssignee) : Boolean(defaults.noAssignee);
  refs.taskAssigneeModeAssigned.checked = !noAssignee;
  refs.taskAssigneeModeNone.checked = noAssignee;
  syncTaskAssigneeOptions(task?.assigneeId ?? defaults.assigneeId ?? "");
  refs.taskDescriptionInput.value = task?.description ?? "";
  refs.taskPrioritySelect.value = task?.priority ?? "medium";
  refs.taskTimeModeSelect.value = task?.timeMode ?? defaults.timeMode ?? "none";
  refs.taskDateInput.value = task?.dueDate ? toDateInputValue(task.dueDate) : "";
  refs.taskDueInput.value = task?.dueAt ? toDateTimeLocalValue(task.dueAt) : "";
  refs.taskTimerDurationInput.value = task?.timerDurationMs ? msToWholeMinutes(task.timerDurationMs) : "";
  refs.taskNotesInput.value = task?.notes ?? "";
  refs.taskDependencySearch.value = "";
  refs.taskPhaseSelect.innerHTML = collectPhaseOptions();
  refs.taskPhaseSelect.value = fallbackPhaseId;
  refs.taskContextSection.classList.toggle("is-hidden", flow === "global");
  refs.taskScopeSection.classList.toggle("is-hidden", flow !== "global");

  syncTaskDialogCopy();
  syncTaskDialogScopedOptions();
  refs.taskDialog.showModal();
  refs.taskTitleInput.focus();
}

function syncTaskDialogScopedOptions() {
  const dialogState = state.dialogs.task;
  if (!dialogState) {
    return;
  }

  const selectedPhaseId = dialogState.flow === "global" ? refs.taskPhaseSelect.value : dialogState.context.phaseId;
  const categories = getPhaseCategories(selectedPhaseId);
  const selectedCategoryBefore = dialogState.flow === "global"
    ? (refs.taskCategorySelect.value || dialogState.context.categoryId)
    : dialogState.context.categoryId;

  refs.taskCategorySelect.innerHTML = categories.length
    ? categories
        .map((category) => `<option value="${category.id}">${escapeHtml(category.name)}</option>`)
        .join("")
    : `<option value="">${escapeHtml(t("empty.noCategoriesTitle"))}</option>`;

  const resolvedCategoryId = categories.some((category) => category.id === selectedCategoryBefore)
    ? selectedCategoryBefore
    : categories[0]?.id ?? "";

  refs.taskCategorySelect.value = resolvedCategoryId;
  if (dialogState.flow === "global") {
    dialogState.context.phaseId = selectedPhaseId;
    dialogState.context.categoryId = resolvedCategoryId;
    const { options, taskIds } = collectParentTaskOptions(selectedPhaseId, resolvedCategoryId, refs.taskParentSelect.value || dialogState.context.parentTaskId || "");
    refs.taskParentSelect.innerHTML = options;
    const resolvedParentTaskId = taskIds.has(refs.taskParentSelect.value || dialogState.context.parentTaskId || "")
      ? (refs.taskParentSelect.value || dialogState.context.parentTaskId || "")
      : "";
    refs.taskParentSelect.value = resolvedParentTaskId;
    dialogState.context.parentTaskId = resolvedParentTaskId || null;
  } else {
    refs.taskParentSelect.innerHTML = `<option value="">${escapeHtml(t("placeholders.noParent"))}</option>`;
    refs.taskParentSelect.value = "";
  }

  refs.taskContextGrid.innerHTML = dialogState.flow === "global"
    ? ""
    : [
        renderContextItem(t("fields.phase"), escapeHtml(findPhase(dialogState.context.phaseId)?.name ?? t("labels.noPhase"))),
        renderContextItem(t("fields.category"), escapeHtml(findCategory(dialogState.context.categoryId)?.name ?? t("labels.noCategory"))),
        renderContextItem(
          t("fields.parent"),
          dialogState.context.parentTaskId
            ? escapeHtml(findTask(dialogState.context.parentTaskId)?.title ?? t("task.none"))
            : escapeHtml(t("task.root")),
        ),
        renderContextItem(
          t("fields.path"),
          buildTaskPath(dialogState.flow === "edit" ? dialogState.taskId : dialogState.context.parentTaskId, {
            includeNewChildLabel: dialogState.flow === "child",
          }),
          { wide: true },
        ),
        ...(dialogState.lockedDependencyIds.length
          ? [renderContextItem(t("fields.inheritedDependency"), formatTaskNames(dialogState.lockedDependencyIds), { wide: true })]
          : []),
      ].join("");
  syncTaskAssigneeOptions(refs.taskAssigneeSelect.value);
  renderDependencyOptions();
}

function sortTasksForPicker(tasks) {
  const phaseOrder = new Map(state.workspace.phases.map((phase, index) => [phase.id, index]));
  const categoryOrder = new Map(state.workspace.categories.map((category, index) => [category.id, index]));
  return [...tasks].sort((left, right) => {
    const phaseDiff = (phaseOrder.get(left.phaseId) ?? 0) - (phaseOrder.get(right.phaseId) ?? 0);
    if (phaseDiff !== 0) {
      return phaseDiff;
    }

    const categoryDiff = (categoryOrder.get(left.categoryId) ?? 0) - (categoryOrder.get(right.categoryId) ?? 0);
    if (categoryDiff !== 0) {
      return categoryDiff;
    }

    return left.title.localeCompare(right.title, state.locale);
  });
}

function renderDependencyOptions() {
  const dialogState = state.dialogs.task;
  if (!dialogState) {
    return;
  }

  const currentTaskId = dialogState.taskId;
  const filterValue = dialogState.dependencyFilter.trim().toLowerCase();
  const selectedIds = new Set(dialogState.dependencyIds);
  const lockedIds = new Set(dialogState.lockedDependencyIds);
  const disallowedIds = collectDisallowedDependencyIds(dialogState);
  const restrictToContextCategory = dialogState.mode === "create" && ["category", "child"].includes(dialogState.flow);
  const tasks = sortTasksForPicker(
    state.workspace.tasks.filter((task) => {
      if (task.id === currentTaskId || disallowedIds.has(task.id)) {
        return false;
      }
      if (restrictToContextCategory && (task.phaseId !== dialogState.context.phaseId || task.categoryId !== dialogState.context.categoryId)) {
        return false;
      }
      if (!filterValue) {
        return true;
      }
      return [task.title, task.description, task.notes, task.assignee]
        .join(" ")
        .toLowerCase()
        .includes(filterValue);
    }),
  );

  refs.taskDependencySelected.innerHTML = dialogState.dependencyIds.length
    ? dialogState.dependencyIds
        .map((taskId) => findTask(taskId))
        .filter(Boolean)
        .map((task) => `<span class="chip ${lockedIds.has(task.id) ? "chip-locked" : ""}">${escapeHtml(task.title)}</span>`)
        .join("")
    : `<span class="task-supporting">${escapeHtml(t("dependency.noneSelected"))}</span>`;

  refs.taskDependencyOptions.innerHTML = tasks.length
    ? tasks
        .map((task) => {
          const phase = findPhase(task.phaseId);
          const category = findCategory(task.categoryId);
          return `
            <label class="dependency-option">
              <input type="checkbox" value="${task.id}" ${selectedIds.has(task.id) ? "checked" : ""} ${lockedIds.has(task.id) ? "disabled" : ""} />
              <span>
                <strong>${escapeHtml(task.title)}</strong>
                <small>${escapeHtml(phase?.name ?? t("labels.noPhase"))} / ${escapeHtml(category?.name ?? t("labels.noCategory"))} · ${escapeHtml(statusLabel(t, task.effectiveStatus))} · ${escapeHtml(priorityLabel(t, task.priority))}${lockedIds.has(task.id) ? ` · ${escapeHtml(t("labels.inherited"))}` : ""}</small>
              </span>
            </label>
          `;
        })
        .join("")
    : `<div class="dependency-option"><span>${escapeHtml(t("dependency.noItems"))}</span></div>`;
}

async function handleTaskSubmit(event) {
  event.preventDefault();
  const dialogState = state.dialogs.task;
  if (!dialogState) {
    return;
  }

  const title = refs.taskTitleInput.value.trim();
  if (!title) {
    showToastKey("toasts.titleRequired", "error");
    return;
  }

  if (!(dialogState.flow === "global" ? refs.taskCategorySelect.value : dialogState.context.categoryId)) {
    showToastKey("toasts.categoryRequired", "error");
    return;
  }

  const noAssignee = refs.taskAssigneeModeNone.checked;
  if (!noAssignee && !refs.taskAssigneeSelect.value) {
    showToastKey("toasts.assigneeRequired", "error");
    return;
  }

  const payload = {
    title,
    assigneeId: noAssignee ? null : (refs.taskAssigneeSelect.value || null),
    noAssignee,
    priority: refs.taskPrioritySelect.value,
  };

  if (dialogState.mode === "create") {
    payload.phaseId = dialogState.flow === "global" ? refs.taskPhaseSelect.value : dialogState.context.phaseId;
    payload.categoryId = dialogState.flow === "global" ? refs.taskCategorySelect.value : dialogState.context.categoryId;
    payload.parentTaskId = dialogState.flow === "global"
      ? (refs.taskParentSelect.value || null)
      : dialogState.flow === "child"
        ? dialogState.context.parentTaskId
        : null;
    if (dialogState.dependencyIds.length) {
      payload.dependencyIds = dialogState.dependencyIds;
    }
  } else {
    const timeMode = refs.taskTimeModeSelect.value;
    if (timeMode === "date" && !refs.taskDateInput.value) {
      showToastKey("toasts.dateRequired", "error");
      return;
    }
    if (timeMode === "datetime" && !refs.taskDueInput.value) {
      showToastKey("toasts.dateTimeRequired", "error");
      return;
    }
    if (timeMode === "timer" && !minutesToMs(refs.taskTimerDurationInput.value)) {
      showToastKey("toasts.timerDurationRequired", "error");
      return;
    }

    payload.description = refs.taskDescriptionInput.value.trim();
    payload.timeMode = timeMode;
    payload.dueDate = fromDateInputValue(refs.taskDateInput.value);
    payload.dueAt = fromDateTimeLocalValue(refs.taskDueInput.value);
    payload.timerDurationMs = minutesToMs(refs.taskTimerDurationInput.value);
    payload.notes = refs.taskNotesInput.value.trim();
    payload.dependencyIds = dialogState.dependencyIds;
  }

  const ok = await performMutation(
    () => (dialogState.mode === "edit" ? updateTask(dialogState.taskId, payload) : createTask(payload)),
    dialogState.mode === "edit" ? "toasts.taskUpdated" : "toasts.taskCreated",
    () => {
      const phaseId = dialogState.mode === "edit" ? dialogState.context.phaseId : payload.phaseId;
      const categoryId = dialogState.mode === "edit" ? dialogState.context.categoryId : payload.categoryId;
      const parentTaskId = dialogState.mode === "edit" ? dialogState.context.parentTaskId : payload.parentTaskId;
      state.ui.phaseOpen[phaseId] = true;
      state.ui.categoryOpen[categoryId] = true;
      if (parentTaskId) {
        state.ui.taskOpen[parentTaskId] = true;
      }
    },
  );

  if (ok) {
    closeDialog(refs.taskDialog);
    state.dialogs.task = null;
  }
}

async function handleAssigneeSubmit(event) {
  event.preventDefault();
  if (!state.dialogs.settings) {
    return;
  }

  const name = refs.assigneeNameInput.value.trim().replace(/\s+/g, " ");
  if (!name) {
    showToastKey("toasts.assigneeNameRequired", "error");
    return;
  }

  const editor = state.dialogs.settings.editor;
  const ok = await performMutation(
    () => (
      editor.mode === "edit" && editor.id
        ? updateAssignee(editor.id, { name })
        : createAssignee(name)
    ),
    editor.mode === "edit" ? "toasts.assigneeUpdated" : "toasts.assigneeCreated",
  );

  if (ok && state.dialogs.settings) {
    state.dialogs.settings.editor = { mode: "create", id: null };
    syncSettingsDialog();
    if (state.dialogs.task) {
      syncTaskAssigneeOptions(refs.taskAssigneeSelect.value);
    }
    refs.assigneeNameInput.focus();
  }
}

function nextStatus(task) {
  const currentIndex = STATUS_CYCLE.indexOf(task.status);
  return STATUS_CYCLE[(currentIndex + 1) % STATUS_CYCLE.length];
}

function syncDeleteDialogCopy() {
  const dialogState = state.dialogs.delete;
  if (!dialogState) {
    return;
  }

  const task = findTask(dialogState.taskId);
  if (!task) {
    return;
  }

  refs.deleteDialogEyebrow.textContent = t("dialogs.delete.eyebrow");
  refs.deleteDialogTitle.textContent = t("dialogs.delete.title", { title: task.title });
  refs.deleteDialogMessage.textContent = dialogState.descendants.length
    ? t("dialogs.delete.messageWithChildren")
    : t("dialogs.delete.messageWithoutChildren");
  refs.deleteDialogImpact.innerHTML = `
    <div><strong>${escapeHtml(t("dialogs.delete.descendants", { count: dialogState.descendants.length }))}</strong></div>
    <div><strong>${escapeHtml(t("dialogs.delete.dependents", { count: dialogState.externalDependents.length }))}</strong></div>
  `;
  refs.deleteBranchTitle.textContent = t("dialogs.delete.branchTitle");
  refs.deleteBranchHelp.textContent = t("dialogs.delete.branchHelp");
  refs.deletePromoteTitle.textContent = t("dialogs.delete.promoteTitle");
  refs.deletePromoteHelp.textContent = dialogState.promoteAllowed
    ? t("dialogs.delete.promoteHelp")
    : t("dialogs.delete.promoteDisabled");
}

function openDeleteDialog(taskId) {
  const task = findTask(taskId);
  if (!task) {
    return;
  }

  const descendants = collectDescendantIds(taskId);
  const externalDependents = state.workspace.tasks.filter((item) => item.id !== taskId && item.dependencyIds.includes(taskId));
  const promoteAllowed = externalDependents.length === 0;

  state.dialogs.delete = {
    taskId,
    descendants,
    externalDependents,
    promoteAllowed,
  };

  refs.deleteStrategyField.classList.toggle("is-hidden", descendants.length === 0);
  refs.deletePromoteOption.classList.toggle("is-disabled", !promoteAllowed);
  refs.deletePromoteOption.querySelector('input[value="promote"]').disabled = !promoteAllowed;

  const branchInput = refs.deleteForm.querySelector('input[value="branch"]');
  const promoteInput = refs.deleteForm.querySelector('input[value="promote"]');
  branchInput.checked = true;
  promoteInput.checked = false;

  syncDeleteDialogCopy();
  refs.deleteDialog.showModal();
}

async function handleDeleteSubmit(event) {
  event.preventDefault();
  const dialogState = state.dialogs.delete;
  if (!dialogState) {
    return;
  }

  const chosen = refs.deleteForm.querySelector('input[name="deleteStrategy"]:checked')?.value || "branch";
  const ok = await performMutation(
    () => deleteTask(dialogState.taskId, chosen),
    "toasts.taskDeleted",
  );

  if (ok) {
    closeDialog(refs.deleteDialog);
    state.dialogs.delete = null;
  }
}

async function handleMoveSubmit(event) {
  event.preventDefault();
  const dialogState = state.dialogs.move;
  if (!dialogState) {
    return;
  }

  const ok = await performMutation(
    () => updateTask(dialogState.taskId, {
      phaseId: refs.movePhaseSelect.value,
      categoryId: refs.moveCategorySelect.value,
      parentTaskId: refs.moveParentSelect.value || null,
    }),
    "toasts.taskMoved",
    () => {
      state.ui.phaseOpen[refs.movePhaseSelect.value] = true;
      state.ui.categoryOpen[refs.moveCategorySelect.value] = true;
      if (refs.moveParentSelect.value) {
        state.ui.taskOpen[refs.moveParentSelect.value] = true;
      }
    },
  );

  if (ok) {
    closeDialog(refs.moveDialog);
    state.dialogs.move = null;
  }
}

async function handleStatusCycle(taskId) {
  const task = findTask(taskId);
  if (!task) {
    return;
  }

  if (task.effectiveStatus === "blocked") {
    showToastKey("errors.blockedStatus", "error");
    return;
  }

  const next = nextStatus(task);
  await performMutation(
    () => setTaskStatus(taskId, next),
    "toasts.statusUpdated",
    undefined,
    { status: statusLabel(t, next) },
  );
}

async function handleTaskTimerAction(taskId, action) {
  if (!findTask(taskId)) {
    return;
  }

  if (action === "start") {
    await performMutation(() => startTaskTimer(taskId), "toasts.timerStarted");
    return;
  }

  if (action === "pause") {
    await performMutation(() => pauseTaskTimer(taskId), "toasts.timerPaused");
    return;
  }

  if (action === "reset") {
    await performMutation(() => resetTaskTimer(taskId), "toasts.timerReset");
  }
}

function confirmWithBrowser(key, params) {
  return window.confirm(t(key, params));
}

function setAllOpen(value) {
  for (const phase of state.workspace.phases) {
    state.ui.phaseOpen[phase.id] = value;
  }
  for (const category of state.workspace.categories) {
    state.ui.categoryOpen[category.id] = value;
  }
  for (const task of state.workspace.tasks) {
    state.ui.taskOpen[task.id] = value;
  }
  saveUiState();
  render();
}

async function handleDocumentClick(event) {
  const actionTarget = event.target.closest("[data-action]");
  if (!actionTarget) {
    return;
  }

  const action = actionTarget.dataset.action;
  const phaseId = actionTarget.dataset.phaseId;
  const categoryId = actionTarget.dataset.categoryId;
  const taskId = actionTarget.dataset.taskId;

  switch (action) {
    case "open-settings":
      openSettingsDialog();
      break;
    case "create-phase":
      openEntityDialog({ type: "phase", mode: "create" });
      break;
    case "create-category":
      if (state.workspace.phases.length === 0) {
        showToastKey("toasts.needPhaseFirst", "error");
        return;
      }
      openEntityDialog({
        type: "category",
        mode: "create",
        source: phaseId ? "phase" : "global",
        phaseId: phaseId || state.workspace.phases[0].id,
      });
      break;
    case "create-task":
      openTaskDialog({
        source: categoryId ? "category" : "global",
        defaults: { phaseId, categoryId },
      });
      break;
    case "create-child-task": {
      const parent = findTask(taskId);
      if (!parent) {
        return;
      }
      openTaskDialog({
        source: "child",
        defaults: {
          phaseId: parent.phaseId,
          categoryId: parent.categoryId,
          parentTaskId: parent.id,
        },
      });
      break;
    }
    case "open-task-detail":
      openDetailDialog("task", taskId);
      break;
    case "open-task-time":
      openTimeDialog(taskId);
      break;
    case "open-phase-detail":
      openDetailDialog("phase", phaseId);
      break;
    case "open-category-detail":
      openDetailDialog("category", categoryId);
      break;
    case "edit-phase":
      openEntityDialog({ type: "phase", mode: "edit", id: phaseId });
      break;
    case "edit-category":
      openEntityDialog({ type: "category", mode: "edit", id: categoryId });
      break;
    case "edit-task":
      closeDetailDialog();
      openTaskDialog({ taskId });
      break;
    case "move-phase-up":
      await performMutation(() => movePhase(phaseId, "up"), "toasts.phaseReordered");
      break;
    case "move-phase-down":
      await performMutation(() => movePhase(phaseId, "down"), "toasts.phaseReordered");
      break;
    case "move-category-up":
      await performMutation(() => moveCategory(categoryId, "up"), "toasts.categoryReordered");
      break;
    case "move-category-down":
      await performMutation(() => moveCategory(categoryId, "down"), "toasts.categoryReordered");
      break;
    case "delete-phase":
      if (!confirmWithBrowser("confirms.deleteEmptyPhase")) {
        return;
      }
      await performMutation(() => deletePhase(phaseId), "toasts.phaseDeleted");
      break;
    case "delete-category":
      if (!confirmWithBrowser("confirms.deleteEmptyCategory")) {
        return;
      }
      await performMutation(() => deleteCategory(categoryId), "toasts.categoryDeleted");
      break;
    case "delete-task":
      closeDetailDialog();
      openDeleteDialog(taskId);
      break;
    case "toggle-phase":
      state.ui.phaseOpen[phaseId] = state.ui.phaseOpen[phaseId] === false;
      saveUiState();
      render();
      break;
    case "toggle-category":
      state.ui.categoryOpen[categoryId] = state.ui.categoryOpen[categoryId] === false;
      saveUiState();
      render();
      break;
    case "toggle-task":
      state.ui.taskOpen[taskId] = !state.ui.taskOpen[taskId];
      saveUiState();
      render();
      break;
    case "cycle-status":
      await handleStatusCycle(taskId);
      break;
    case "start-task-timer":
      await handleTaskTimerAction(taskId, "start");
      break;
    case "pause-task-timer":
      await handleTaskTimerAction(taskId, "pause");
      break;
    case "reset-task-timer":
      await handleTaskTimerAction(taskId, "reset");
      break;
    case "export-json":
      await handleExport();
      break;
    case "import-json":
      refs.importFile.click();
      break;
    case "reset-map-progress":
      await handleResetMapProgress();
      break;
    case "reset-workspace":
      await handleResetWorkspace();
      break;
    case "expand-all":
      setAllOpen(true);
      break;
    case "collapse-all":
      setAllOpen(false);
      break;
    case "close-entity-dialog":
      closeEntityDialog();
      break;
    case "close-detail-dialog":
      closeDetailDialog();
      break;
    case "close-time-dialog":
      closeTimeDialog();
      break;
    case "close-settings-dialog":
      closeSettingsDialog();
      break;
    case "cancel-assignee-edit":
      if (!state.dialogs.settings) {
        return;
      }
      state.dialogs.settings.editor = { mode: "create", id: null };
      syncSettingsDialog();
      break;
    case "edit-assignee":
      if (!state.dialogs.settings) {
        return;
      }
      state.dialogs.settings.editor = { mode: "edit", id: actionTarget.dataset.assigneeId };
      syncSettingsDialog();
      refs.assigneeNameInput.focus();
      break;
    case "toggle-assignee-active": {
      const assigneeId = actionTarget.dataset.assigneeId;
      const assignee = findAssignee(assigneeId);
      if (!assignee) {
        return;
      }
      await performMutation(
        () => updateAssignee(assigneeId, { isActive: !assignee.isActive }),
        assignee.isActive ? "toasts.assigneeDeactivated" : "toasts.assigneeActivated",
      );
      if (state.dialogs.task) {
        syncTaskAssigneeOptions(refs.taskAssigneeSelect.value);
      }
      break;
    }
    case "delete-assignee":
      await performMutation(
        () => deleteAssignee(actionTarget.dataset.assigneeId),
        "toasts.assigneeDeleted",
      );
      if (state.dialogs.settings) {
        state.dialogs.settings.editor = { mode: "create", id: null };
        syncSettingsDialog();
      }
      if (state.dialogs.task) {
        syncTaskAssigneeOptions(refs.taskAssigneeSelect.value);
      }
      break;
    case "detail-create-category": {
      if (state.dialogs.detail?.type !== "phase") {
        return;
      }
      const currentPhaseId = state.dialogs.detail.id;
      closeDetailDialog();
      openEntityDialog({ type: "category", mode: "create", source: "phase", phaseId: currentPhaseId });
      break;
    }
    case "detail-reset-phase-progress":
      if (state.dialogs.detail?.type !== "phase") {
        return;
      }
      await handleResetPhaseProgress(state.dialogs.detail.id);
      break;
    case "detail-create-task": {
      if (state.dialogs.detail?.type !== "category") {
        return;
      }
      const currentCategoryId = state.dialogs.detail.id;
      const category = findCategory(currentCategoryId);
      if (!category) {
        return;
      }
      closeDetailDialog();
      openTaskDialog({
        source: "category",
        defaults: { phaseId: category.phaseId, categoryId: currentCategoryId },
      });
      break;
    }
    case "detail-reset-category-progress":
      if (state.dialogs.detail?.type !== "category") {
        return;
      }
      await handleResetCategoryProgress(state.dialogs.detail.id);
      break;
    case "detail-edit-phase":
      if (state.dialogs.detail?.type !== "phase") {
        return;
      }
      {
        const currentPhaseId = state.dialogs.detail.id;
        closeDetailDialog();
        openEntityDialog({ type: "phase", mode: "edit", id: currentPhaseId });
      }
      break;
    case "detail-edit-category":
      if (state.dialogs.detail?.type !== "category") {
        return;
      }
      {
        const currentCategoryId = state.dialogs.detail.id;
        closeDetailDialog();
        openEntityDialog({ type: "category", mode: "edit", id: currentCategoryId });
      }
      break;
    case "detail-move-phase-up":
      if (state.dialogs.detail?.type !== "phase") {
        return;
      }
      await performMutation(() => movePhase(state.dialogs.detail.id, "up"), "toasts.phaseReordered");
      break;
    case "detail-move-phase-down":
      if (state.dialogs.detail?.type !== "phase") {
        return;
      }
      await performMutation(() => movePhase(state.dialogs.detail.id, "down"), "toasts.phaseReordered");
      break;
    case "detail-move-category-up":
      if (state.dialogs.detail?.type !== "category") {
        return;
      }
      await performMutation(() => moveCategory(state.dialogs.detail.id, "up"), "toasts.categoryReordered");
      break;
    case "detail-move-category-down":
      if (state.dialogs.detail?.type !== "category") {
        return;
      }
      await performMutation(() => moveCategory(state.dialogs.detail.id, "down"), "toasts.categoryReordered");
      break;
    case "detail-delete-phase":
      if (state.dialogs.detail?.type !== "phase") {
        return;
      }
      if (!confirmWithBrowser("confirms.deleteEmptyPhase")) {
        return;
      }
      await performMutation(() => deletePhase(state.dialogs.detail.id), "toasts.phaseDeleted");
      break;
    case "detail-delete-category":
      if (state.dialogs.detail?.type !== "category") {
        return;
      }
      if (!confirmWithBrowser("confirms.deleteEmptyCategory")) {
        return;
      }
      await performMutation(() => deleteCategory(state.dialogs.detail.id), "toasts.categoryDeleted");
      break;
    case "detail-add-child": {
      if (state.dialogs.detail?.type !== "task") {
        return;
      }
      const parent = findTask(state.dialogs.detail.id);
      if (!parent) {
        return;
      }
      closeDetailDialog();
      openTaskDialog({
        source: "child",
        defaults: {
          phaseId: parent.phaseId,
          categoryId: parent.categoryId,
          parentTaskId: parent.id,
        },
      });
      break;
    }
    case "detail-reset-root-task-progress":
      if (state.dialogs.detail?.type !== "task") {
        return;
      }
      await handleResetRootTaskProgress(state.dialogs.detail.id);
      break;
    case "detail-edit-task": {
      if (state.dialogs.detail?.type !== "task") {
        return;
      }
      const currentTaskId = state.dialogs.detail.id;
      if (!currentTaskId) {
        return;
      }
      closeDetailDialog();
      openTaskDialog({ taskId: currentTaskId });
      break;
    }
    case "detail-open-time": {
      if (state.dialogs.detail?.type !== "task") {
        return;
      }
      const currentTaskId = state.dialogs.detail.id;
      if (!currentTaskId) {
        return;
      }
      closeDetailDialog();
      openTimeDialog(currentTaskId);
      break;
    }
    case "detail-move-task": {
      if (state.dialogs.detail?.type !== "task") {
        return;
      }
      const currentTaskId = state.dialogs.detail.id;
      if (!currentTaskId) {
        return;
      }
      closeDetailDialog();
      openMoveDialog(currentTaskId);
      break;
    }
    case "detail-delete-task": {
      if (state.dialogs.detail?.type !== "task") {
        return;
      }
      const currentTaskId = state.dialogs.detail.id;
      if (!currentTaskId) {
        return;
      }
      closeDetailDialog();
      openDeleteDialog(currentTaskId);
      break;
    }
    case "close-task-dialog":
      closeTaskDialog();
      break;
    case "close-move-dialog":
      closeMoveDialog();
      break;
    case "close-delete-dialog":
      closeDeleteDialog();
      break;
    default:
      break;
  }
}

async function handleExport() {
  try {
    const snapshot = await exportSnapshot();
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tasks-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToastKey("toasts.exported");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function handleImportFile(event) {
  const file = event.target.files[0];
  if (!file) {
    return;
  }

  try {
    if (state.workspace && (state.workspace.tasks.length > 0 || state.workspace.phases.length > 0 || state.workspace.categories.length > 0)) {
      const accepted = confirmWithBrowser("confirms.replaceImport");
      if (!accepted) {
        refs.importFile.value = "";
        return;
      }
    }

    const raw = await file.text();
    const snapshot = JSON.parse(raw);
    await performMutation(() => importSnapshot(snapshot), "toasts.imported");
  } catch (error) {
    showToast(error.message || t("errors.importFailed"), "error");
  } finally {
    refs.importFile.value = "";
  }
}

async function handleResetWorkspace() {
  if (!confirmWithBrowser("confirms.resetWorkspace")) {
    return;
  }

  await performMutation(
    () => importSnapshot(createEmptySnapshot()),
    "toasts.reset",
  );
}

async function handleResetMapProgress() {
  if (!confirmWithBrowser("confirms.resetMapProgress")) {
    return;
  }

  await performMutation(
    () => resetMapProgress(),
    "toasts.mapProgressReset",
  );
}

async function handleResetPhaseProgress(phaseId) {
  if (!phaseId || !confirmWithBrowser("confirms.resetPhaseProgress")) {
    return;
  }

  await performMutation(
    () => resetPhaseProgress(phaseId),
    "toasts.phaseProgressReset",
  );
}

async function handleResetCategoryProgress(categoryId) {
  if (!categoryId || !confirmWithBrowser("confirms.resetCategoryProgress")) {
    return;
  }

  await performMutation(
    () => resetCategoryProgress(categoryId),
    "toasts.categoryProgressReset",
  );
}

async function handleResetRootTaskProgress(taskId) {
  if (!taskId || !confirmWithBrowser("confirms.resetBranchProgress")) {
    return;
  }

  await performMutation(
    () => resetRootTaskProgress(taskId),
    "toasts.branchProgressReset",
  );
}

function handleDependencyListChange(event) {
  const checkbox = event.target.closest('input[type="checkbox"]');
  if (!checkbox || !state.dialogs.task) {
    return;
  }

  if (state.dialogs.task.lockedDependencyIds.includes(checkbox.value)) {
    checkbox.checked = true;
    return;
  }

  const current = new Set(state.dialogs.task.dependencyIds);
  if (checkbox.checked) {
    current.add(checkbox.value);
  } else {
    current.delete(checkbox.value);
  }

  state.dialogs.task.dependencyIds = [...current];
  renderDependencyOptions();
}

function syncOpenDialogCopy() {
  syncDetailDialog();
  syncTimeDialog();
  syncEntityDialogCopy();
  if (state.dialogs.task) {
    syncTaskDialogCopy();
    syncTaskDialogScopedOptions();
  }
  if (state.dialogs.move) {
    syncMoveDialogCopy();
    syncMoveDialogScopedOptions();
  }
  syncSettingsDialog();
  syncDeleteDialogCopy();
}

async function init() {
  refreshLocale();

  refs.searchInput.addEventListener("input", () => {
    state.ui.filters.search = refs.searchInput.value.trim();
    saveUiState();
    render();
  });

  refs.statusFilter.addEventListener("change", () => {
    state.ui.filters.status = refs.statusFilter.value;
    saveUiState();
    render();
  });

  refs.priorityFilter.addEventListener("change", () => {
    state.ui.filters.priority = refs.priorityFilter.value;
    saveUiState();
    render();
  });

  refs.localeSwitch.addEventListener("change", () => {
    state.locale = refs.localeSwitch.value;
    refreshLocale();
  });

  refs.entityForm.addEventListener("submit", handleEntitySubmit);
  refs.taskForm.addEventListener("submit", handleTaskSubmit);
  refs.moveForm.addEventListener("submit", handleMoveSubmit);
  refs.assigneeForm.addEventListener("submit", handleAssigneeSubmit);
  refs.deleteForm.addEventListener("submit", handleDeleteSubmit);
  refs.detailDialog.addEventListener("close", () => {
    state.dialogs.detail = null;
  });
  refs.timeDialog.addEventListener("close", () => {
    state.dialogs.time = null;
  });
  refs.entityDialog.addEventListener("close", () => {
    state.dialogs.entity = null;
  });
  refs.taskDialog.addEventListener("close", () => {
    state.dialogs.task = null;
  });
  refs.moveDialog.addEventListener("close", () => {
    state.dialogs.move = null;
  });
  refs.settingsDialog.addEventListener("close", () => {
    state.dialogs.settings = null;
  });
  refs.deleteDialog.addEventListener("close", () => {
    state.dialogs.delete = null;
  });
  refs.importFile.addEventListener("change", handleImportFile);
  refs.taskPhaseSelect.addEventListener("change", syncTaskDialogScopedOptions);
  refs.taskCategorySelect.addEventListener("change", syncTaskDialogScopedOptions);
  refs.taskParentSelect.addEventListener("change", () => {
    if (!state.dialogs.task) {
      return;
    }

    state.dialogs.task.context.parentTaskId = refs.taskParentSelect.value || null;
    renderDependencyOptions();
  });
  refs.taskAssigneeModeAssigned.addEventListener("change", syncTaskAssigneeState);
  refs.taskAssigneeModeNone.addEventListener("change", syncTaskAssigneeState);
  refs.taskTimeModeSelect.addEventListener("change", syncTaskTimeFields);
  refs.movePhaseSelect.addEventListener("change", syncMoveDialogScopedOptions);
  refs.moveCategorySelect.addEventListener("change", syncMoveDialogScopedOptions);
  refs.taskDependencySearch.addEventListener("input", () => {
    if (!state.dialogs.task) {
      return;
    }
    state.dialogs.task.dependencyFilter = refs.taskDependencySearch.value;
    renderDependencyOptions();
  });
  refs.taskDependencyOptions.addEventListener("change", handleDependencyListChange);
  document.addEventListener("click", (event) => {
    void handleDocumentClick(event);
  });

  try {
    const workspace = await fetchWorkspace();
    applyWorkspace(workspace);
  } catch (error) {
    showToast(error.message, "error");
  }
}

void init();
