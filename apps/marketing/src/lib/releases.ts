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
