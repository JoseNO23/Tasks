export function createEmptySnapshot() {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    assignees: [],
    phases: [],
    categories: [],
    tasks: [],
  };
}
