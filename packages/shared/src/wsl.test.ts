import { describe, expect, it } from "vitest";

import {
  isWslUncPath,
  parseWslPath,
  resolveDefaultWslDistroSync,
  resolveWindowsWslHomePathSync,
  toWslUncPath,
} from "./wsl";

describe("wsl helpers", () => {
  it("parses WSL UNC workspace paths", () => {
    expect(parseWslPath("\\\\wsl.localhost\\Ubuntu\\home\\leo\\code")).toEqual({
      distro: "Ubuntu",
      linuxPath: "/home/leo/code",
      uncPath: "\\\\wsl.localhost\\Ubuntu\\home\\leo\\code",
    });
  });

  it("maps Linux paths to the default distro when provided", () => {
    expect(parseWslPath("/home/leo/code", { defaultDistro: "Ubuntu" })).toEqual({
      distro: "Ubuntu",
      linuxPath: "/home/leo/code",
      uncPath: "\\\\wsl.localhost\\Ubuntu\\home\\leo\\code",
    });
  });

  it("formats WSL UNC paths", () => {
    expect(toWslUncPath({ distro: "Ubuntu", linuxPath: "/home/leo/code" })).toBe(
      "\\\\wsl.localhost\\Ubuntu\\home\\leo\\code",
    );
  });

  it("detects WSL UNC roots", () => {
    expect(isWslUncPath("\\\\wsl$\\Ubuntu")).toBe(true);
    expect(isWslUncPath("C:\\code")).toBe(false);
  });

  it("returns null for WSL detection on non-Windows hosts", () => {
    expect(resolveDefaultWslDistroSync()).toBeNull();
    expect(resolveWindowsWslHomePathSync()).toBeNull();
  });
});
