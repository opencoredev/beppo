const REPO = "opencoredev/beppo";

export const REPO_URL = `https://github.com/${REPO}`;
export const RELEASES_URL = `${REPO_URL}/releases`;
export const DISCORD_URL = "https://discord.gg/jn4EGJjrvv";

const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const CACHE_KEY = "beppo-latest-release";

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface Release {
  tag_name: string;
  html_url: string;
  assets: ReleaseAsset[];
}

export type DownloadAssetTarget = "macos-arm64" | "macos-x64" | "windows-x64" | "linux-x64";

const DOWNLOAD_ASSET_MATCHERS: Record<DownloadAssetTarget, (asset: ReleaseAsset) => boolean> = {
  "macos-arm64": (asset) => /stable-macos-arm64-.*\.dmg$/i.test(asset.name),
  "macos-x64": (asset) => /stable-macos-x64-.*\.dmg$/i.test(asset.name),
  "windows-x64": (asset) => /stable-win-x64-.*-Setup\.zip$/i.test(asset.name),
  "linux-x64": (asset) => /stable-linux-x64-.*-Setup\.tar\.gz$/i.test(asset.name),
};

export function findDownloadAsset(
  assets: ReadonlyArray<ReleaseAsset>,
  target: DownloadAssetTarget,
): ReleaseAsset | null {
  return assets.find(DOWNLOAD_ASSET_MATCHERS[target]) ?? null;
}

export async function fetchLatestRelease(): Promise<Release> {
  const cached = sessionStorage.getItem(CACHE_KEY);
  if (cached) {
    return JSON.parse(cached) as Release;
  }

  const response = await fetch(API_URL);
  if (!response.ok) {
    throw new Error(`Failed to load release metadata: ${response.status}`);
  }

  const data = (await response.json()) as Release;

  if (data?.assets) {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));
  }

  return data;
}
