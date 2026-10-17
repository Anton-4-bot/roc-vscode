import assert from "node:assert/strict";
import { test } from "node:test";
import {
	isAllowedDownloadUrl,
	isNewerNightly,
	nightlyTagDate,
	parseSha256Digest,
	type Release,
	selectNightlyAsset,
	shouldCheckForUpdate,
	UPDATE_CHECK_INTERVAL_MS,
} from "../../src/platform";

const tag = "nightly-2026-10-16-f14c106";
const asset = (name: string) => ({
	name,
	browser_download_url: `https://github.com/roc-lang/nightlies/releases/download/${tag}/${name}`,
	size: 1,
	digest: `sha256:${"a".repeat(64)}`,
});
const release: Release = {
	tag_name: tag,
	assets: [
		asset("echo.wasm.zst"),
		asset(`roc_nightly-linux_arm64-2026-10-16-f14c106.tar.gz`),
		asset(`roc_nightly-linux_x86_64-2026-10-16-f14c106.tar.gz`),
		asset(`roc_nightly-macos_apple_silicon-2026-10-16-f14c106.tar.gz`),
		asset(`roc_nightly-macos_x86_64-2026-10-16-f14c106.tar.gz`),
		asset(`roc_nightly-source-2026-10-16-f14c106.tar.gz`),
		asset(`roc_nightly-source-2026-10-16-f14c106.zip`),
		asset(`roc_nightly-windows_x86_64-2026-10-16-f14c106.zip`),
	],
};

test("selects the archive for each supported platform", () => {
	const cases: [string, string, string][] = [
		["darwin", "arm64", "roc_nightly-macos_apple_silicon-2026-10-16-f14c106.tar.gz"],
		["darwin", "x64", "roc_nightly-macos_x86_64-2026-10-16-f14c106.tar.gz"],
		["linux", "x64", "roc_nightly-linux_x86_64-2026-10-16-f14c106.tar.gz"],
		["linux", "arm64", "roc_nightly-linux_arm64-2026-10-16-f14c106.tar.gz"],
		["win32", "x64", "roc_nightly-windows_x86_64-2026-10-16-f14c106.zip"],
	];
	for (const [platform, arch, expected] of cases) {
		assert.equal(selectNightlyAsset(release, platform, arch)?.name, expected, `${platform}-${arch}`);
	}
});

test("has no archive for unsupported platforms", () => {
	assert.equal(selectNightlyAsset(release, "win32", "arm64"), undefined);
	assert.equal(selectNightlyAsset(release, "freebsd", "x64"), undefined);
	assert.equal(selectNightlyAsset(release, "linux", "ia32"), undefined);
});

test("only allows downloads from the nightlies repo", () => {
	assert.ok(isAllowedDownloadUrl(`https://github.com/roc-lang/nightlies/releases/download/${tag}/roc.tar.gz`));
	assert.ok(!isAllowedDownloadUrl("http://github.com/roc-lang/nightlies/releases/download/x/roc.tar.gz"));
	assert.ok(!isAllowedDownloadUrl("https://github.com/evil/nightlies/releases/download/x/roc.tar.gz"));
	assert.ok(!isAllowedDownloadUrl("https://github.com/roc-lang/nightlies/releases/download/../../evil/roc.tar.gz"));
	assert.ok(!isAllowedDownloadUrl("https://github.com.evil.example/roc-lang/nightlies/releases/download/x/roc.tar.gz"));
});

test("parses sha256 digests", () => {
	const hex = "895d051d693996308f4c72ccd38d8058e367c5b75ea03117c7eb239f1bf360a0";
	assert.equal(parseSha256Digest(`sha256:${hex}`), hex);
	assert.equal(parseSha256Digest(`sha256:${hex.toUpperCase()}`), hex);
	assert.equal(parseSha256Digest(undefined), undefined);
	assert.equal(parseSha256Digest(null), undefined);
	assert.equal(parseSha256Digest(`sha512:${hex}`), undefined);
	assert.equal(parseSha256Digest(`sha256:${hex.slice(1)}`), undefined);
	assert.equal(parseSha256Digest(`sha256:${hex}\n`), undefined);
});

test("compares nightly tags by date", () => {
	assert.equal(nightlyTagDate(tag), "2026-10-16");
	assert.equal(nightlyTagDate("v1.0.0"), undefined);
	assert.ok(isNewerNightly("nightly-2026-10-16-f14c106", "nightly-2026-10-09-abc1234"));
	assert.ok(isNewerNightly("nightly-2026-10-16-f14c106", "nightly-2026-10-16-abc1234"), "same-day rebuild");
	assert.ok(!isNewerNightly(tag, tag));
	assert.ok(!isNewerNightly("nightly-2026-10-09-abc1234", tag));
	assert.ok(!isNewerNightly("garbage", tag));
	assert.ok(!isNewerNightly(tag, "garbage"));
});

test("checks for updates weekly, only for the managed nightly", () => {
	const now = 1_800_000_000_000;
	const state = { enabled: true, usingManagedNightly: true, lastCheck: undefined, now };
	assert.ok(shouldCheckForUpdate(state), "never checked");
	assert.ok(!shouldCheckForUpdate({ ...state, enabled: false }));
	assert.ok(!shouldCheckForUpdate({ ...state, usingManagedNightly: false }));
	assert.ok(!shouldCheckForUpdate({ ...state, lastCheck: now - UPDATE_CHECK_INTERVAL_MS + 1 }));
	assert.ok(shouldCheckForUpdate({ ...state, lastCheck: now - UPDATE_CHECK_INTERVAL_MS }));
	assert.ok(shouldCheckForUpdate({ ...state, lastCheck: now + 60_000 }), "clock moved backwards");
	assert.equal(UPDATE_CHECK_INTERVAL_MS, 7 * 24 * 60 * 60 * 1000);
});
