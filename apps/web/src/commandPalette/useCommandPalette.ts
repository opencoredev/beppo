import { create } from "zustand";

import type { PaletteCommand } from "./commandRegistry";

interface CommandPaletteState {
  isOpen: boolean;
  commands: PaletteCommand[];
}

interface CommandPaletteStore extends CommandPaletteState {
  open: () => void;
  close: () => void;
  toggle: () => void;
  /**
   * Register commands into the palette.
   * Returns an unregister function that removes the registered commands.
   */
  registerCommands: (commands: PaletteCommand[]) => () => void;
}

export const useCommandPalette = create<CommandPaletteStore>((set) => ({
  isOpen: false,
  commands: [],

  open: () => {
    set({ isOpen: true });
  },

  close: () => {
    set({ isOpen: false });
  },

  toggle: () => {
    set((state) => ({ isOpen: !state.isOpen }));
  },

  registerCommands: (commands) => {
    set((state) => ({ commands: [...state.commands, ...commands] }));

    return () => {
      const commandIds = new Set(commands.map((c) => c.id));
      set((state) => ({
        commands: state.commands.filter((c) => !commandIds.has(c.id)),
      }));
    };
  },
}));
