import {
  createCategory,
  createPhase,
  createTask,
  deleteCategory,
  deletePhase,
  deleteTask,
  exportSnapshot,
  fetchWorkspace,
  importSnapshot,
  moveCategory,
  movePhase,
  setTaskStatus,
  updateCategory,
  updatePhase,
  updateTask,
} from "./api.js";
import {
  applyStaticTranslations,
  createTranslator,
  formatDateTime,
  getStoredLocale,
  normalizeLocale,
  setStoredLocale,
} from "./i18n.js";
import {
  buildIndexes,
  escapeHtml,
  priorityLabel,
  renderMap,
  renderStats,
  statusLabel,
} from "./ui.js";

const UI_STORAGE_KEY = "task-map-template-ui";
const STATUS_CYCLE = ["pending", "in_progress", "completed", "discarded"];

const refs = {
  statsBar: document.getElementById("stats-bar"),
  mapRoot: document.getElementById("map-root"),
  savedAtLabel: document.getElementById("saved-at-label"),
  searchInput: document.getElementById("search-input"),
  statusFilter: document.getElementById("status-filter"),
  priorityFilter: document.getElementById("priority-filter"),
  localeSwitch: document.getElementById("locale-switch"),
  importFile: document.getElementById("import-file"),
  entityDialog: document.getElementById("entity-dialog"),
  entityForm: document.getElementById("entity-form"),
  entityDialogType: document.getElementById("entity-dialog-type"),
  entityDialogTitle: document.getElementById("entity-dialog-title"),
  entityPhaseField: document.getElementById("entity-phase-field"),
  entityPhaseSelect: document.getElementById("entity-phase-select"),
  entityNameInput: document.getElementById("entity-name-input"),
  taskDialog: document.getElementById("task-dialog"),
  taskForm: document.getElementById("task-form"),
  taskDialogTitle: document.getElementById("task-dialog-title"),
  taskTitleInput: document.getElementById("task-title-input"),
  taskAssigneeInput: document.getElementById("task-assignee-input"),
  taskDescriptionInput: document.getElementById("task-description-input"),
  taskPhaseSelect: document.getElementById("task-phase-select"),
  taskCategorySelect: document.getElementById("task-category-select"),
  taskParentSelect: document.getElementById("task-parent-select"),
  taskStatusSelect: document.getElementById("task-status-select"),
  taskPrioritySelect: document.getElementById("task-priority-select"),
  taskNotesInput: document.getElementById("task-notes-input"),
  taskDependencySearch: document.getElementById("task-dependency-search"),
  taskDependencySelected: document.getElementById("task-dependency-selected"),
  taskDependencyOptions: document.getElementById("task-dependency-options"),
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
    entity: null,
    task: null,
    delete: null,
  },
};

function t(key, params) {
  return state.translate(key, params);
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

function getPhaseCategories(phaseId) {
  return state.workspace.categories.filter((category) => category.phaseId === phaseId);
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
}

function openEntityDialog(config) {
  state.dialogs.entity = config;
  const isCategory = config.type === "category";
  const currentEntity = config.id ? (isCategory ? findCategory(config.id) : findPhase(config.id)) : null;

  refs.entityNameInput.value = currentEntity?.name ?? "";
  refs.entityPhaseField.classList.toggle("is-hidden", !isCategory);
  refs.entityPhaseSelect.disabled = config.mode === "edit";
  refs.entityPhaseSelect.innerHTML = state.workspace.phases
    .map((phase) => `<option value="${phase.id}">${escapeHtml(phase.name)}</option>`)
    .join("");

  if (isCategory) {
    refs.entityPhaseSelect.value = currentEntity?.phaseId ?? config.phaseId ?? state.workspace.phases[0]?.id ?? "";
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
          : createCategory({ phaseId: refs.entityPhaseSelect.value, name }),
      dialogState.mode === "edit" ? "toasts.categoryUpdated" : "toasts.categoryCreated",
      () => {
        state.ui.phaseOpen[refs.entityPhaseSelect.value] = true;
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

function syncTaskDialogCopy() {
  const dialogState = state.dialogs.task;
  if (!dialogState) {
    return;
  }

  refs.taskDialogTitle.textContent = t(dialogState.mode === "edit" ? "dialogs.task.edit" : "dialogs.task.new");
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

  state.dialogs.task = {
    mode: task ? "edit" : "create",
    taskId: task?.id ?? null,
    dependencyIds: [...(task?.dependencyIds ?? defaults.dependencyIds ?? [])],
    dependencyFilter: "",
    defaults: {
      phaseId: fallbackPhaseId,
      categoryId: fallbackCategoryId,
      parentTaskId: defaults.parentTaskId ?? task?.parentTaskId ?? "",
    },
  };

  refs.taskTitleInput.value = task?.title ?? "";
  refs.taskAssigneeInput.value = task?.assignee ?? "";
  refs.taskDescriptionInput.value = task?.description ?? "";
  refs.taskStatusSelect.value = task?.status ?? "pending";
  refs.taskPrioritySelect.value = task?.priority ?? "medium";
  refs.taskNotesInput.value = task?.notes ?? "";
  refs.taskDependencySearch.value = "";
  refs.taskPhaseSelect.innerHTML = collectPhaseOptions();
  refs.taskPhaseSelect.value = fallbackPhaseId;

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

  const selectedPhaseId = refs.taskPhaseSelect.value;
  const categories = getPhaseCategories(selectedPhaseId);
  const selectedCategoryBefore = refs.taskCategorySelect.value || dialogState.defaults.categoryId;

  refs.taskCategorySelect.innerHTML = categories.length
    ? categories
        .map((category) => `<option value="${category.id}">${escapeHtml(category.name)}</option>`)
        .join("")
    : `<option value="">${escapeHtml(t("empty.noCategoriesTitle"))}</option>`;

  refs.taskCategorySelect.value = categories.some((category) => category.id === selectedCategoryBefore)
    ? selectedCategoryBefore
    : categories[0]?.id ?? "";

  const currentTaskId = dialogState.taskId;
  const excludedParentIds = new Set([currentTaskId, ...collectDescendantIds(currentTaskId)].filter(Boolean));
  const selectedParentBefore = refs.taskParentSelect.value || dialogState.defaults.parentTaskId || "";
  const parentOptions = state.workspace.tasks.filter((task) => (
    task.phaseId === selectedPhaseId
    && task.categoryId === refs.taskCategorySelect.value
    && !excludedParentIds.has(task.id)
  ));

  refs.taskParentSelect.innerHTML = [
    `<option value="">${escapeHtml(t("placeholders.noParent"))}</option>`,
    ...parentOptions.map((task) => `<option value="${task.id}">${escapeHtml(task.title)}</option>`),
  ].join("");

  refs.taskParentSelect.value = parentOptions.some((task) => task.id === selectedParentBefore) ? selectedParentBefore : "";
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
  const tasks = sortTasksForPicker(
    state.workspace.tasks.filter((task) => {
      if (task.id === currentTaskId) {
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
        .map((task) => `<span class="chip">${escapeHtml(task.title)}</span>`)
        .join("")
    : `<span class="task-supporting">${escapeHtml(t("dependency.noneSelected"))}</span>`;

  refs.taskDependencyOptions.innerHTML = tasks.length
    ? tasks
        .map((task) => {
          const phase = findPhase(task.phaseId);
          const category = findCategory(task.categoryId);
          return `
            <label class="dependency-option">
              <input type="checkbox" value="${task.id}" ${selectedIds.has(task.id) ? "checked" : ""} />
              <span>
                <strong>${escapeHtml(task.title)}</strong>
                <small>${escapeHtml(phase?.name ?? t("labels.noPhase"))} / ${escapeHtml(category?.name ?? t("labels.noCategory"))} · ${escapeHtml(statusLabel(t, task.effectiveStatus))} · ${escapeHtml(priorityLabel(t, task.priority))}</small>
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

  if (!refs.taskCategorySelect.value) {
    showToastKey("toasts.categoryRequired", "error");
    return;
  }

  const payload = {
    title,
    assignee: refs.taskAssigneeInput.value.trim(),
    description: refs.taskDescriptionInput.value.trim(),
    phaseId: refs.taskPhaseSelect.value,
    categoryId: refs.taskCategorySelect.value,
    parentTaskId: refs.taskParentSelect.value || null,
    status: refs.taskStatusSelect.value,
    priority: refs.taskPrioritySelect.value,
    notes: refs.taskNotesInput.value.trim(),
    dependencyIds: dialogState.dependencyIds,
  };

  const ok = await performMutation(
    () => (dialogState.mode === "edit" ? updateTask(dialogState.taskId, payload) : createTask(payload)),
    dialogState.mode === "edit" ? "toasts.taskUpdated" : "toasts.taskCreated",
    () => {
      state.ui.phaseOpen[payload.phaseId] = true;
      state.ui.categoryOpen[payload.categoryId] = true;
      if (payload.parentTaskId) {
        state.ui.taskOpen[payload.parentTaskId] = true;
      }
    },
  );

  if (ok) {
    closeDialog(refs.taskDialog);
    state.dialogs.task = null;
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

function confirmWithBrowser(key) {
  return window.confirm(t(key));
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
    case "create-phase":
      openEntityDialog({ type: "phase", mode: "create" });
      break;
    case "create-category":
      if (state.workspace.phases.length === 0) {
        showToastKey("toasts.needPhaseFirst", "error");
        return;
      }
      openEntityDialog({ type: "category", mode: "create", phaseId: phaseId || state.workspace.phases[0].id });
      break;
    case "create-task":
      openTaskDialog({ defaults: { phaseId, categoryId } });
      break;
    case "create-child-task": {
      const parent = findTask(taskId);
      if (!parent) {
        return;
      }
      openTaskDialog({
        defaults: {
          phaseId: parent.phaseId,
          categoryId: parent.categoryId,
          parentTaskId: parent.id,
        },
      });
      break;
    }
    case "edit-phase":
      openEntityDialog({ type: "phase", mode: "edit", id: phaseId });
      break;
    case "edit-category":
      openEntityDialog({ type: "category", mode: "edit", id: categoryId });
      break;
    case "edit-task":
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
    case "export-json":
      await handleExport();
      break;
    case "import-json":
      refs.importFile.click();
      break;
    case "expand-all":
      setAllOpen(true);
      break;
    case "collapse-all":
      setAllOpen(false);
      break;
    case "close-entity-dialog":
      closeDialog(refs.entityDialog);
      state.dialogs.entity = null;
      break;
    case "close-task-dialog":
      closeDialog(refs.taskDialog);
      state.dialogs.task = null;
      break;
    case "close-delete-dialog":
      closeDialog(refs.deleteDialog);
      state.dialogs.delete = null;
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
    link.download = `task-map-template-${new Date().toISOString().slice(0, 10)}.json`;
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

function handleDependencyListChange(event) {
  const checkbox = event.target.closest('input[type="checkbox"]');
  if (!checkbox || !state.dialogs.task) {
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
  syncEntityDialogCopy();
  if (state.dialogs.task) {
    syncTaskDialogCopy();
    syncTaskDialogScopedOptions();
  }
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
  refs.deleteForm.addEventListener("submit", handleDeleteSubmit);
  refs.importFile.addEventListener("change", handleImportFile);
  refs.taskPhaseSelect.addEventListener("change", syncTaskDialogScopedOptions);
  refs.taskCategorySelect.addEventListener("change", syncTaskDialogScopedOptions);
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
