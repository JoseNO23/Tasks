import { getStoredLocale } from "./i18n.js";

async function request(path, options = {}) {
  const config = {
    method: options.method || "GET",
    headers: {
      "x-ui-locale": getStoredLocale(),
    },
  };

  if (options.body !== undefined) {
    config.headers["Content-Type"] = "application/json";
    config.body = JSON.stringify(options.body);
  }

  const response = await fetch(path, config);
  const raw = await response.text();
  const payload = raw ? JSON.parse(raw) : {};

  if (!response.ok) {
    throw new Error(payload.error?.message || "Request failed.");
  }

  return payload.data ?? payload;
}

export function fetchWorkspace() {
  return request("/api/map");
}

export function exportSnapshot() {
  return request("/api/export");
}

export function importSnapshot(snapshot) {
  return request("/api/import", {
    method: "POST",
    body: snapshot,
  });
}

export function createPhase(name) {
  return request("/api/phases", {
    method: "POST",
    body: { name },
  });
}

export function updatePhase(phaseId, name) {
  return request(`/api/phases/${phaseId}`, {
    method: "PATCH",
    body: { name },
  });
}

export function movePhase(phaseId, direction) {
  return request(`/api/phases/${phaseId}/move`, {
    method: "POST",
    body: { direction },
  });
}

export function deletePhase(phaseId) {
  return request(`/api/phases/${phaseId}`, {
    method: "DELETE",
  });
}

export function createCategory(payload) {
  return request("/api/categories", {
    method: "POST",
    body: payload,
  });
}

export function updateCategory(categoryId, name) {
  return request(`/api/categories/${categoryId}`, {
    method: "PATCH",
    body: { name },
  });
}

export function moveCategory(categoryId, direction) {
  return request(`/api/categories/${categoryId}/move`, {
    method: "POST",
    body: { direction },
  });
}

export function deleteCategory(categoryId) {
  return request(`/api/categories/${categoryId}`, {
    method: "DELETE",
  });
}

export function createTask(payload) {
  return request("/api/tasks", {
    method: "POST",
    body: payload,
  });
}

export function updateTask(taskId, payload) {
  return request(`/api/tasks/${taskId}`, {
    method: "PATCH",
    body: payload,
  });
}

export function setTaskStatus(taskId, status) {
  return request(`/api/tasks/${taskId}/status`, {
    method: "POST",
    body: { status },
  });
}

export function deleteTask(taskId, strategy) {
  return request(`/api/tasks/${taskId}?strategy=${encodeURIComponent(strategy)}`, {
    method: "DELETE",
  });
}
