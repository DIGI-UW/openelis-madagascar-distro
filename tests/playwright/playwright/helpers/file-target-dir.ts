export function buildRunScopedFileTargetDir(baseTargetDir: string): string {
  const normalized = baseTargetDir.replace(/\/+$/, "");
  const incomingSuffix = "/incoming";
  const root = normalized.endsWith(incomingSuffix)
    ? normalized.slice(0, -incomingSuffix.length)
    : normalized;
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${root}/${runId}/incoming`;
}
