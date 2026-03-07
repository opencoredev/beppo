import type { ElectrobunConfig } from "./src/electrobun-runtime";

const config = {
  app: {
    name: "Beppo",
    identifier: "com.t3tools.t3code",
    version: "0.0.2",
    description: "Beppo desktop app",
    urlSchemes: ["t3"],
  },
  build: {
    buildFolder: "build",
    artifactFolder: "artifacts",
    targets: process.env.ELECTROBUN_TARGETS ?? "current",
    bun: {
      entrypoint: "src/main.ts",
      sourcemap: "linked",
    },
    copy: {
      "preload.js": "preload.js",
      "../server/dist": "apps/server/dist",
    },
    mac: {
      defaultRenderer: "native",
    },
    win: {
      icon: "resources/icon.ico",
      defaultRenderer: "native",
    },
    linux: {
      icon: "resources/icon.png",
      defaultRenderer: "native",
    },
  },
  ...(process.env.T3CODE_DESKTOP_UPDATE_BASE_URL
    ? {
        release: {
          baseUrl: process.env.T3CODE_DESKTOP_UPDATE_BASE_URL,
        },
      }
    : {}),
  runtime: {
    exitOnLastWindowClosed: true,
  },
} satisfies ElectrobunConfig;

export default config;
