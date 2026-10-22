// Downloads, verifies and unpacks Roc nightlies. Free of vscode imports so it can be smoke-tested from node.
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import { promisify } from "node:util";
import {
	isAllowedDownloadUrl,
	NIGHTLY_RELEASES_API,
	nightlyTagDate,
	parseSha256Digest,
	type Release,
	rocExecutableName,
	selectNightlyAsset,
} from "./platform";

const execFileAsync = promisify(execFile);

const USER_AGENT = "roc-vscode";

export interface InstalledNightly {
	tag: string;
	executable: string;
}

export interface InstallOptions {
	release: Release;
	/** Directory owned by the extension; nightlies go in `<storageDir>/nightlies/<tag>`. */
	storageDir: string;
	platform: string;
	arch: string;
	signal?: AbortSignal;
	/** Called with a 0..1 fraction of the download, or undefined while unpacking. */
	onProgress?: (fraction: number | undefined) => void;
}

export function fetchLatestRelease(signal?: AbortSignal): Promise<Release> {
	return fetchRelease("latest", signal);
}

/** `tag` is a nightly tag or `latest`. `token` is only for CI, where unauthenticated requests share a rate limit with every other runner. */
export async function fetchRelease(tag: string, signal?: AbortSignal, token?: string): Promise<Release> {
	const timeout = AbortSignal.timeout(30_000);
	const url = tag === "latest" ? `${NIGHTLY_RELEASES_API}/latest` : `${NIGHTLY_RELEASES_API}/tags/${encodeURIComponent(tag)}`;
	const response = await fetch(url, {
		headers: {
			Accept: "application/vnd.github+json",
			"User-Agent": USER_AGENT,
			"X-GitHub-Api-Version": "2022-11-28",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
	});
	if (!response.ok) {
		throw new Error(`GitHub API request for the ${tag} Roc nightly failed: ${response.status} ${response.statusText}`);
	}
	const release = (await response.json()) as Partial<Release>;
	if (typeof release.tag_name !== "string" || !Array.isArray(release.assets)) {
		throw new Error(`Unexpected response from the GitHub API for the ${tag} Roc nightly.`);
	}
	return release as Release;
}

export async function installNightly(options: InstallOptions): Promise<InstalledNightly> {
	const { release, platform, arch } = options;
	if (nightlyTagDate(release.tag_name) === undefined) {
		throw new Error(`Unexpected nightly tag name: ${release.tag_name}`);
	}
	const asset = selectNightlyAsset(release, platform, arch);
	if (asset === undefined) {
		throw new Error(
			`There is no Roc nightly for ${platform} ${arch}. See https://github.com/roc-lang/roc/blob/main/BUILDING_FROM_SOURCE.md for building Roc from source.`,
		);
	}
	if (!isAllowedDownloadUrl(asset.browser_download_url) || !/^[\w.-]+$/.test(asset.name)) {
		throw new Error(`Refusing to download unexpected asset: ${asset.browser_download_url}`);
	}
	const expectedSha256 = parseSha256Digest(asset.digest);
	if (expectedSha256 === undefined) {
		throw new Error(`The release asset ${asset.name} has no sha256 digest, so it can't be verified.`);
	}

	const nightliesDir = path.join(options.storageDir, "nightlies");
	const tagDir = path.join(nightliesDir, release.tag_name);
	const staging = path.join(nightliesDir, `.partial-${randomBytes(6).toString("hex")}`);
	await fs.mkdir(staging, { recursive: true });
	try {
		const archive = path.join(staging, asset.name);
		const actualSha256 = await download(asset.browser_download_url, archive, asset.size, options);
		if (actualSha256 !== expectedSha256) {
			throw new Error(`Checksum mismatch for ${asset.name}: expected ${expectedSha256}, got ${actualSha256}.`);
		}

		options.onProgress?.(undefined);
		await extract(archive, staging, platform, options.signal);
		await fs.rm(archive);

		const relativeExecutable = await findExecutable(staging, platform);
		const stagedExecutable = path.join(staging, relativeExecutable);
		if (platform !== "win32") await fs.chmod(stagedExecutable, 0o755);
		await execFileAsync(stagedExecutable, ["version"], { timeout: 30_000 });

		await fs.rm(tagDir, { recursive: true, force: true });
		await fs.rename(staging, tagDir);
		return { tag: release.tag_name, executable: path.join(tagDir, relativeExecutable) };
	} catch (error) {
		await fs.rm(staging, { recursive: true, force: true });
		throw error;
	}
}

/** Removes every managed nightly except `keepTag`. Best effort: a running roc.exe can't be deleted on Windows. */
export async function removeOtherNightlies(storageDir: string, keepTag: string): Promise<void> {
	const nightliesDir = path.join(storageDir, "nightlies");
	let entries: string[];
	try {
		entries = await fs.readdir(nightliesDir);
	} catch {
		return;
	}
	await Promise.all(
		entries
			.filter((entry) => entry !== keepTag)
			.map((entry) => fs.rm(path.join(nightliesDir, entry), { recursive: true, force: true }).catch(() => undefined)),
	);
}

/** Streams `url` to `file`, returning the sha256 of what was written. */
async function download(url: string, file: string, expectedSize: number, options: InstallOptions): Promise<string> {
	const response = await fetch(url, {
		headers: { "User-Agent": USER_AGENT },
		...(options.signal ? { signal: options.signal } : {}),
	});
	if (!response.ok || response.body === null) {
		throw new Error(`Downloading ${url} failed: ${response.status} ${response.statusText}`);
	}

	const hash = createHash("sha256");
	let received = 0;
	const hashAndCount = new Transform({
		transform(chunk: Buffer, _encoding, callback) {
			hash.update(chunk);
			received += chunk.length;
			if (expectedSize > 0) options.onProgress?.(Math.min(received / expectedSize, 1));
			callback(null, chunk);
		},
	});
	await pipeline(
		Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
		hashAndCount,
		createWriteStream(file),
		...(options.signal ? [{ signal: options.signal }] : []),
	);
	return hash.digest("hex");
}

async function extract(archive: string, destination: string, platform: string, signal: AbortSignal | undefined): Promise<void> {
	// Windows 10+ ships bsdtar, which also reads zip. Use its absolute path so PATH can't substitute another tar.
	const tar =
		platform === "win32" ? path.join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "tar.exe") : "tar";
	const args = platform === "win32" ? ["-xf", archive, "-C", destination] : ["-xzf", archive, "-C", destination];
	await execFileAsync(tar, args, { timeout: 5 * 60_000, ...(signal ? { signal } : {}) });
}

/** The archives contain a single `roc_nightly-<platform>-<date>-<sha>/` directory holding `roc`. */
async function findExecutable(dir: string, platform: string): Promise<string> {
	const name = rocExecutableName(platform);
	for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
		if (entry.isFile() && entry.name === name) return name;
		if (entry.isDirectory()) {
			const candidate = path.join(entry.name, name);
			const stat = await fs.stat(path.join(dir, candidate)).catch(() => undefined);
			if (stat?.isFile()) return candidate;
		}
	}
	throw new Error(`The downloaded archive does not contain ${name}.`);
}
