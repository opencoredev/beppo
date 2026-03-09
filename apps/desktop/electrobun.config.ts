import * as OS from "node:os";

import desktopPackageJson from "./package.json" with { type: "json" };
import type { ElectrobunConfig } from "./src/electrobun-runtime";

const isWslBuild =
  Boolean(process.env.WSL_DISTRO_NAME) ||
  OS.release().toLowerCase().includes("microsoft");
const isDevWatch = process.argv.includes("dev") && process.argv.includes("--watch");
const APP_BUNDLE_IDENTIFIER = "com.t3tools.beppo";
const APP_URL_SCHEME = "beppo";
const DEFAULT_UPDATE_BASE_URL = "https://github.com/opencoredev/beppo/releases/latest/download";
const appVersion = process.env.T3CODE_DESKTOP_VERSION?.trim() || desktopPackageJson.version;
const configuredReleaseBaseUrl = process.env.T3CODE_DESKTOP_UPDATE_BASE_URL?.trim();
const shouldConfigureRelease =
  typeof configuredReleaseBaseUrl === "string" && configuredReleaseBaseUrl.length > 0;
const releaseBaseUrl = configuredReleaseBaseUrl || DEFAULT_UPDATE_BASE_URL;
const hasMacCodesignIdentity = typeof process.env.ELECTROBUN_DEVELOPER_ID === "string"
  && process.env.ELECTROBUN_DEVELOPER_ID.trim().length > 0;
const hasMacNotarizationCredentials =
  typeof process.env.ELECTROBUN_APPLEID === "string"
    && process.env.ELECTROBUN_APPLEID.trim().length > 0
    && typeof process.env.ELECTROBUN_APPLEIDPASS === "string"
    && process.env.ELECTROBUN_APPLEIDPASS.trim().length > 0
    && typeof process.env.ELECTROBUN_TEAMID === "string"
    && process.env.ELECTROBUN_TEAMID.trim().length > 0;

const config = {
  app: {
    name: "Beppo",
    identifier: APP_BUNDLE_IDENTIFIER,
    version: appVersion,
    description: "Beppo desktop app",
    urlSchemes: [APP_URL_SCHEME],
  },
  build: {
    buildFolder: "build",
    artifactFolder: "artifacts",
    targets: process.env.ELECTROBUN_TARGETS ?? "current",
    bun: {
      entrypoint: "src/bun/index.ts",
      sourcemap: "linked",
    },
    copy: {
      "preload.js": "preload.js",
      ...(!isDevWatch
        ? {
            "../server/dist": "apps/server/dist",
          }
        : {}),
    },
    mac: {
      codesign: hasMacCodesignIdentity,
      notarize: hasMacCodesignIdentity && hasMacNotarizationCredentials,
      defaultRenderer: "native",
    },
    win: {
      icon: "resources/icon.png",
      defaultRenderer: "native",
    },
    linux: {
      icon: "resources/icon.png",
      defaultRenderer: isWslBuild ? "cef" : "native",
      ...(isWslBuild
        ? {
            bundleCEF: true,
            chromiumFlags: {
              "disable-gpu": true,
              "disable-gpu-compositing": true,
              "enable-unsafe-swiftshader": true,
              "use-angle": "swiftshader",
              "use-gl": "angle",
              "enable-features": "UseOzonePlatform",
              "ozone-platform": "wayland",
            },
          }
        : {}),
    },
  },
  ...(shouldConfigureRelease
    ? {
        release: {
          baseUrl: releaseBaseUrl,
        },
      }
    : {}),
  scripts: {
    postBuild: "scripts/post-build-icons.ts",
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
} satisfies ElectrobunConfig;

export default config;
