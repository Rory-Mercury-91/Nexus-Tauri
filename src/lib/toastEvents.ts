export const NEXUS_TOAST_EVENT = "nexus:toast";

export type NexusToastKind = "success" | "error" | "info";

export type NexusToastPayload = {
  message: string;
  kind?: NexusToastKind;
  durationMs?: number;
};

export function notifyToast(payload: NexusToastPayload): void {
  window.dispatchEvent(new CustomEvent<NexusToastPayload>(NEXUS_TOAST_EVENT, { detail: payload }));
}
