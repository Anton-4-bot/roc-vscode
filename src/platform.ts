// Pure helpers describing roc-lang/nightlies release assets. No vscode imports, so unit-testable.

export const NIGHTLY_RELEASES_API = "https://api.github.com/repos/roc-lang/nightlies/releases";
export const NIGHTLY_DOWNLOAD_PREFIX = "https://github.com/roc-lang/nightlies/releases/download/";

export interface ReleaseAsset {
	name: string;
	browser_download_url: string;
	size: number;
	digest?: string | null;
}

export interface Release {
	tag_name: string;
	assets: ReleaseAsset[];
}

/** The platform part of a nightly archive name, e.g. `macos_apple_silicon`, or undefined if unsupported. */
export function nightlyPlatformName(platform: string, arch: string): string | undefined {
	switch (`${platform}-${arch}`) {
		case "darwin-arm64":
			return "macos_apple_silicon";
		case "darwin-x64":
			return "macos_x86_64";
		case "linux-x64":
			return "linux_x86_64";
		case "linux-arm64":
			return "linux_arm64";
		case "win32-x64":
			return "windows_x86_64";
		default:
			return undefined;
	}
}

export function rocExecutableName(platform: string): string {
	return platform === "win32" ? "roc.exe" : "roc";
}

/** Picks the archive for this platform from a release, e.g. `roc_nightly-linux_x86_64-2026-10-16-f14c106.tar.gz`. */
export function selectNightlyAsset(release: Release, platform: string, arch: string): ReleaseAsset | undefined {
	const name = nightlyPlatformName(platform, arch);
	if (name === undefined) return undefined;
	const extension = platform === "win32" ? ".zip" : ".tar.gz";
	return release.assets.find((asset) => asset.name.startsWith(`roc_nightly-${name}-`) && asset.name.endsWith(extension));
}

/** Only accept downloads from the official nightlies repo, over https. */
export function isAllowedDownloadUrl(url: string): boolean {
	return url.startsWith(NIGHTLY_DOWNLOAD_PREFIX) && !url.slice(NIGHTLY_DOWNLOAD_PREFIX.length).includes("..");
}

/** Parses GitHub's `sha256:<hex>` asset digest into lowercase hex, or undefined if absent or malformed. */
export function parseSha256Digest(digest: string | null | undefined): string | undefined {
	const match = /^sha256:([0-9a-fA-F]{64})$/.exec(digest ?? "");
	return match?.[1]?.toLowerCase();
}

/** The date of a tag like `nightly-2026-10-16-f14c106`, as `2026-10-16`. */
export function nightlyTagDate(tag: string): string | undefined {
	return /^nightly-(\d{4}-\d{2}-\d{2})-[0-9a-f]+$/.exec(tag)?.[1];
}

/** Whether `latest` is a newer nightly than `installed`. Unparseable tags are never considered newer. */
export function isNewerNightly(latest: string, installed: string): boolean {
	const latestDate = nightlyTagDate(latest);
	const installedDate = nightlyTagDate(installed);
	if (latestDate === undefined || installedDate === undefined) return false;
	return latest !== installed && latestDate >= installedDate;
}

export const UPDATE_CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export interface UpdateCheckState {
	enabled: boolean;
	/** Whether the roc in use is the nightly managed by this extension. */
	usingManagedNightly: boolean;
	/** Milliseconds since the epoch of the last check, if any. */
	lastCheck: number | undefined;
	now: number;
}

export function shouldCheckForUpdate(state: UpdateCheckState): boolean {
	if (!state.enabled || !state.usingManagedNightly) return false;
	const { lastCheck, now } = state;
	// A check stamped in the future means the clock moved backwards; don't wait for it to catch up.
	return lastCheck === undefined || lastCheck > now || now - lastCheck >= UPDATE_CHECK_INTERVAL_MS;
}
