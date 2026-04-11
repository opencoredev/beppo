import type { ThreadSession } from "~/types";

export interface AgentControlState {
  canPause: boolean;
  canKill: boolean;
  statusLabel: string;
  statusVariant: "default" | "success" | "warning" | "error" | "info";
  isRunning: boolean;
}

export function deriveAgentControlState(session: ThreadSession | null): AgentControlState {
  if (!session) {
    return {
      canPause: false,
      canKill: false,
      statusLabel: "Idle",
      statusVariant: "default",
      isRunning: false,
    };
  }

  switch (session.orchestrationStatus) {
    case "idle":
      return {
        canPause: false,
        canKill: false,
        statusLabel: "Idle",
        statusVariant: "default",
        isRunning: false,
      };
    case "starting":
      return {
        canPause: false,
        canKill: true,
        statusLabel: "Starting",
        statusVariant: "info",
        isRunning: false,
      };
    case "running":
      return {
        canPause: Boolean(session.activeTurnId),
        canKill: true,
        statusLabel: "Running",
        statusVariant: "success",
        isRunning: true,
      };
    case "ready":
      return {
        canPause: false,
        canKill: true,
        statusLabel: "Ready",
        statusVariant: "info",
        isRunning: false,
      };
    case "interrupted":
      return {
        canPause: false,
        canKill: true,
        statusLabel: "Paused",
        statusVariant: "warning",
        isRunning: false,
      };
    case "stopped":
      return {
        canPause: false,
        canKill: false,
        statusLabel: "Stopped",
        statusVariant: "default",
        isRunning: false,
      };
    case "error":
      return {
        canPause: false,
        canKill: true,
        statusLabel: "Error",
        statusVariant: "error",
        isRunning: false,
      };
    default:
      return {
        canPause: false,
        canKill: false,
        statusLabel: "Unknown",
        statusVariant: "default",
        isRunning: false,
      };
  }
}
