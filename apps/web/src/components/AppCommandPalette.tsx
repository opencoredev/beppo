import type { ThreadId } from "@t3tools/contracts";
import { useNavigate, useLocation } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo } from "react";

import { CommandPalette } from "~/commandPalette/CommandPalette";
import { createCommand } from "~/commandPalette/commandRegistry";
import { useCommandPalette } from "~/commandPalette/useCommandPalette";
import { readNativeApi } from "~/nativeApi";
import { resolveShortcutCommand, shortcutLabelForCommand } from "~/keybindings";
import { useServerKeybindings } from "~/rpc/serverState";
import { useTheme } from "~/hooks/useTheme";
import { newCommandId } from "~/lib/utils";
import { isTerminalFocused } from "~/lib/terminalFocus";

function parseThreadIdFromPath(pathname: string): ThreadId | null {
  const match = pathname.match(/^\/(?:canvas\/|timeline\/)?([^/]+)$/);
  return (match?.[1] as ThreadId | undefined) ?? null;
}

export function AppCommandPalette() {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const activeThreadId = useMemo(() => parseThreadIdFromPath(pathname), [pathname]);
  const keybindings = useServerKeybindings();
  const { setTheme } = useTheme();
  const openPalette = useCommandPalette((state) => state.open);
  const registerCommands = useCommandPalette((state) => state.registerCommands);

  const dispatchAgentCommand = useCallback(
    (command: "thread.turn.interrupt" | "thread.session.stop") => {
      if (!activeThreadId) return;
      const api = readNativeApi();
      if (!api) return;
      void api.orchestration.dispatchCommand({
        type: command,
        commandId: newCommandId(),
        threadId: activeThreadId,
        createdAt: new Date().toISOString(),
      });
    },
    [activeThreadId],
  );

  useEffect(() => {
    const commands = [
      createCommand({
        id: "nav.settings",
        label: "Open Settings",
        group: "Navigation",
        execute: () => void navigate({ to: "/settings/general" }),
      }),
      createCommand({
        id: "theme.light",
        label: "Theme: Light",
        group: "Theme",
        execute: () => setTheme("light"),
      }),
      createCommand({
        id: "theme.dark",
        label: "Theme: Dark",
        group: "Theme",
        execute: () => setTheme("dark"),
      }),
      createCommand({
        id: "theme.system",
        label: "Theme: System",
        group: "Theme",
        execute: () => setTheme("system"),
      }),
    ];

    if (activeThreadId) {
      commands.push(
        createCommand({
          id: "agent.pause",
          label: "Pause Active Agent",
          group: "Agent",
          shortcutLabel: shortcutLabelForCommand(keybindings, "agent.pause"),
          execute: () => dispatchAgentCommand("thread.turn.interrupt"),
        }),
        createCommand({
          id: "agent.stop",
          label: "Stop Active Agent",
          group: "Agent",
          shortcutLabel: shortcutLabelForCommand(keybindings, "agent.stop"),
          execute: () => dispatchAgentCommand("thread.session.stop"),
        }),
      );
    }

    return registerCommands(commands);
  }, [activeThreadId, dispatchAgentCommand, keybindings, navigate, registerCommands, setTheme]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) {
        return;
      }

      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen: false,
        },
      });
      if (!command) {
        return;
      }

      if (command === "palette.open") {
        event.preventDefault();
        event.stopPropagation();
        openPalette();
        return;
      }

      if (command === "agent.pause") {
        event.preventDefault();
        event.stopPropagation();
        dispatchAgentCommand("thread.turn.interrupt");
        return;
      }

      if (command === "agent.stop") {
        event.preventDefault();
        event.stopPropagation();
        dispatchAgentCommand("thread.session.stop");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatchAgentCommand, keybindings, openPalette]);

  return <CommandPalette />;
}
