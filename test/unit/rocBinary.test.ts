import assert from "node:assert/strict";
import { test } from "node:test";
import { expandHome, findOnPath, type ResolveOptions, resolveRoc } from "../../src/rocBinary";

function options(overrides: Partial<ResolveOptions> & { executables?: string[] }): ResolveOptions {
	const executables = new Set(overrides.executables ?? []);
	return {
		setting: "",
		managedExecutable: undefined,
		env: { PATH: "/usr/local/bin:/usr/bin" },
		platform: "linux",
		homedir: "/home/me",
		isExecutable: (file) => executables.has(file),
		...overrides,
	};
}

test("prefers roc.path, then the managed nightly, then PATH", () => {
	const all = ["/opt/roc/roc", "/store/nightly/roc", "/usr/bin/roc"];
	assert.deepEqual(resolveRoc(options({ setting: "/opt/roc/roc", managedExecutable: "/store/nightly/roc", executables: all })), {
		kind: "found",
		executable: "/opt/roc/roc",
		source: "setting",
	});
	assert.deepEqual(resolveRoc(options({ managedExecutable: "/store/nightly/roc", executables: all })), {
		kind: "found",
		executable: "/store/nightly/roc",
		source: "managed",
	});
	assert.deepEqual(resolveRoc(options({ executables: all })), { kind: "found", executable: "/usr/bin/roc", source: "path" });
});

test("a missing managed nightly falls back to PATH", () => {
	const resolution = resolveRoc(options({ managedExecutable: "/deleted/roc", executables: ["/usr/bin/roc"] }));
	assert.deepEqual(resolution, { kind: "found", executable: "/usr/bin/roc", source: "path" });
});

test("a wrong roc.path is reported instead of silently falling back", () => {
	const resolution = resolveRoc(options({ setting: "/nope/roc", executables: ["/usr/bin/roc"] }));
	assert.deepEqual(resolution, { kind: "badSetting", setting: "/nope/roc" });
});

test("a bare roc.path name is looked up on PATH", () => {
	const resolution = resolveRoc(options({ setting: "roc-dev", executables: ["/usr/local/bin/roc-dev"] }));
	assert.deepEqual(resolution, { kind: "found", executable: "/usr/local/bin/roc-dev", source: "setting" });
});

test("relative roc.path values are rejected", () => {
	const resolution = resolveRoc(options({ setting: "./bin/roc", executables: ["./bin/roc"] }));
	assert.deepEqual(resolution, { kind: "badSetting", setting: "./bin/roc" });
});

test("reports when roc is nowhere", () => {
	assert.deepEqual(resolveRoc(options({})), { kind: "notFound" });
	assert.deepEqual(resolveRoc(options({ env: {} })), { kind: "notFound" });
});

test("expands the home directory", () => {
	assert.equal(expandHome("~/roc/roc", "/home/me"), "/home/me/roc/roc");
	assert.equal(expandHome("${userHome}/roc/roc", "/home/me"), "/home/me/roc/roc");
	assert.equal(expandHome("/a/~/roc", "/home/me"), "/a/~/roc");
	assert.deepEqual(resolveRoc(options({ setting: "~/bin/roc", executables: ["/home/me/bin/roc"] })), {
		kind: "found",
		executable: "/home/me/bin/roc",
		source: "setting",
	});
});

test("skips relative and empty PATH entries", () => {
	const env = { PATH: ":.:bin:/usr/bin" };
	const executables = new Set(["roc", "bin/roc", "/usr/bin/roc"]);
	assert.equal(findOnPath("roc", { env, platform: "linux", isExecutable: (f) => executables.has(f) }), "/usr/bin/roc");
});

test("searches the Windows Path for roc.exe", () => {
	const env = { Path: 'C:\\Windows\\System32;"C:\\Program Files\\Roc";relative' };
	const executables = new Set(["C:\\Program Files\\Roc\\roc.exe"]);
	assert.equal(
		findOnPath("roc", { env, platform: "win32", isExecutable: (f) => executables.has(f) }),
		"C:\\Program Files\\Roc\\roc.exe",
	);
	assert.deepEqual(
		resolveRoc(options({ env, platform: "win32", setting: "C:\\Program Files\\Roc\\roc.exe", executables: [...executables] })),
		{ kind: "found", executable: "C:\\Program Files\\Roc\\roc.exe", source: "setting" },
	);
});
