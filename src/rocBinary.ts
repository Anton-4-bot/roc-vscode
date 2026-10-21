// Finds the roc executable. Pure apart from the injected `isExecutable`, so unit-testable.
import * as path from "node:path";

export type RocSource = "setting" | "managed" | "path";

export type RocResolution =
	| { kind: "found"; executable: string; source: RocSource }
	/** `roc.path` is set but doesn't point at an executable. We don't fall back, so the mistake is visible. */
	| { kind: "badSetting"; setting: string }
	| { kind: "notFound" };

export interface ResolveOptions {
	/** The `roc.path` setting, possibly empty. */
	setting: string;
	/** Executable of the nightly installed by this extension, if any. */
	managedExecutable: string | undefined;
	env: Record<string, string | undefined>;
	platform: string;
	homedir: string;
	isExecutable: (file: string) => boolean;
}

export function resolveRoc(options: ResolveOptions): RocResolution {
	const setting = options.setting.trim();
	if (setting !== "") {
		const expanded = expandHome(setting, options.homedir);
		// A bare name like `roc` or `roc-dev` is looked up on PATH; anything with a separator is a path.
		const executable = /[\\/]/.test(expanded) ? expanded : findOnPath(expanded, options);
		if (executable !== undefined && pathFor(options.platform).isAbsolute(executable) && options.isExecutable(executable)) {
			return { kind: "found", executable, source: "setting" };
		}
		return { kind: "badSetting", setting };
	}

	if (options.managedExecutable !== undefined && options.isExecutable(options.managedExecutable)) {
		return { kind: "found", executable: options.managedExecutable, source: "managed" };
	}

	const onPath = findOnPath("roc", options);
	if (onPath !== undefined) return { kind: "found", executable: onPath, source: "path" };

	return { kind: "notFound" };
}

export function expandHome(file: string, homedir: string): string {
	if (file.startsWith("${userHome}")) return homedir + file.slice("${userHome}".length);
	if (file === "~" || file.startsWith("~/") || file.startsWith("~\\")) return homedir + file.slice(1);
	return file;
}

/** Looks up `name` on PATH without a shell. Relative PATH entries are skipped so the workspace can't plant a roc. */
export function findOnPath(name: string, options: Pick<ResolveOptions, "env" | "platform" | "isExecutable">): string | undefined {
	const isWindows = options.platform === "win32";
	const pathImpl = pathFor(options.platform);
	// Windows env var names are case-insensitive, and it is usually spelled `Path`.
	const pathKey = isWindows ? Object.keys(options.env).find((key) => key.toUpperCase() === "PATH") : "PATH";
	const pathValue = pathKey === undefined ? undefined : options.env[pathKey];
	if (!pathValue) return undefined;

	const fileName = isWindows && !name.toLowerCase().endsWith(".exe") ? `${name}.exe` : name;
	for (const dir of pathValue.split(isWindows ? ";" : ":")) {
		const trimmed = dir.trim().replace(/^"(.*)"$/, "$1");
		if (trimmed === "" || !pathImpl.isAbsolute(trimmed)) continue;
		const candidate = pathImpl.join(trimmed, fileName);
		if (options.isExecutable(candidate)) return candidate;
	}
	return undefined;
}

function pathFor(platform: string): path.PlatformPath {
	return platform === "win32" ? path.win32 : path.posix;
}
