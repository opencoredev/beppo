import type { ComponentType } from "react";

export interface PaletteCommand {
  id: string;
  label: string;
  group: string;
  icon?: ComponentType<{ className?: string }>;
  shortcutLabel?: string | null;
  keywords?: string[];
  when?: () => boolean;
  execute: () => void;
}

export function createCommand(command: PaletteCommand): PaletteCommand {
  return command;
}
