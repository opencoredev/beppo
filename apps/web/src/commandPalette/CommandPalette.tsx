import { useMemo, useState } from "react";

import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandShortcut,
} from "~/components/ui/command";

import { useCommandPalette } from "./useCommandPalette";

function CommandPalette() {
  const { isOpen, close, commands } = useCommandPalette();
  const [search, setSearch] = useState("");

  const visibleCommands = useMemo(() => {
    return commands.filter((cmd) => {
      // Check when() guard
      if (cmd.when && !cmd.when()) return false;

      // Check search filter
      if (search.length > 0) {
        const query = search.toLowerCase();
        const matchesLabel = cmd.label.toLowerCase().includes(query);
        const matchesGroup = cmd.group.toLowerCase().includes(query);
        const matchesKeywords = cmd.keywords?.some((kw) => kw.toLowerCase().includes(query));
        if (!matchesLabel && !matchesGroup && !matchesKeywords) return false;
      }

      return true;
    });
  }, [commands, search]);

  const groupedCommands = useMemo(() => {
    const groups = new Map<string, typeof visibleCommands>();
    for (const cmd of visibleCommands) {
      const existing = groups.get(cmd.group);
      if (existing) {
        existing.push(cmd);
      } else {
        groups.set(cmd.group, [cmd]);
      }
    }
    return groups;
  }, [visibleCommands]);

  function handleOpenChange(open: boolean) {
    if (!open) {
      close();
      setSearch("");
    }
  }

  function handleSelect(execute: () => void) {
    execute();
    close();
    setSearch("");
  }

  return (
    <CommandDialog open={isOpen} onOpenChange={handleOpenChange}>
      <CommandDialogPopup>
        <Command>
          <CommandInput
            placeholder="Type a command..."
            value={search}
            onChange={(event) => setSearch((event.target as HTMLInputElement).value)}
          />
          <CommandPanel>
            <CommandList>
              {visibleCommands.length === 0 && <CommandEmpty>No results found.</CommandEmpty>}
              {[...groupedCommands.entries()].map(([group, cmds]) => (
                <CommandGroup key={group}>
                  <CommandGroupLabel>{group}</CommandGroupLabel>
                  {cmds.map((cmd) => (
                    <CommandItem key={cmd.id} onClick={() => handleSelect(cmd.execute)}>
                      {cmd.icon ? (
                        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/36">
                          <cmd.icon className="size-3.5 opacity-80" />
                        </span>
                      ) : null}
                      <span className="flex-1">{cmd.label}</span>
                      {cmd.shortcutLabel && <CommandShortcut>{cmd.shortcutLabel}</CommandShortcut>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </CommandPanel>
        </Command>
        <CommandFooter>
          <span>
            <kbd className="rounded border px-1.5 py-0.5 font-mono text-xs">↑↓</kbd> Navigate
          </span>
          <span>
            <kbd className="rounded border px-1.5 py-0.5 font-mono text-xs">↵</kbd> Select
          </span>
          <span>
            <kbd className="rounded border px-1.5 py-0.5 font-mono text-xs">Esc</kbd> Close
          </span>
        </CommandFooter>
      </CommandDialogPopup>
    </CommandDialog>
  );
}

export { CommandPalette };
