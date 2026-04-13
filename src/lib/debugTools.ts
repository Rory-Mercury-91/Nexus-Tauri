const DEBUG_MODE_KEY = "nexus:debug-mode:enabled";

export function isDebugModeEnabled(): boolean {
  return localStorage.getItem(DEBUG_MODE_KEY) === "1";
}

export function setDebugModeEnabled(enabled: boolean): void {
  localStorage.setItem(DEBUG_MODE_KEY, enabled ? "1" : "0");
}

export function downloadJsonFile(filename: string, payload: unknown): void {
  const content = JSON.stringify(payload, null, 2);
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
