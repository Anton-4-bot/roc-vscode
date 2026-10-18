// Installs the extension's VSIX into a fresh VS Code profile and runs test/integration/index.ts against it
// twice: once in a trusted workspace and once in restricted mode. Testing the installed VSIX, not the
// source tree, also catches packaging mistakes.
// ROC_PATH must point at a roc executable. ROC_VSIX picks the VSIX to test; without it one is packaged.
// VSCODE_VERSION optionally picks the VS Code build.
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath } from "@vscode/test-electron";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sandbox = path.join(root, ".vscode-test");
const rocPath = process.env["ROC_PATH"];
if (!rocPath) {
	console.error("Set ROC_PATH to a roc executable to run the integration tests.");
	process.exit(1);
}

const vsix = process.env["ROC_VSIX"] ? path.resolve(process.env["ROC_VSIX"]) : path.join(sandbox, "roc.vsix");
if (!process.env["ROC_VSIX"]) run(process.execPath, [path.join(root, "node_modules/@vscode/vsce/vsce"), "package", "--out", vsix]);

const vscodeExecutable = await downloadAndUnzipVSCode(process.env["VSCODE_VERSION"] ?? "stable");
const extensionsDir = path.join(sandbox, "extensions");
rmSync(extensionsDir, { recursive: true, force: true });
run(resolveCliPathFromVSCodeExecutablePath(vscodeExecutable), [
	"--install-extension",
	vsix,
	`--extensions-dir=${extensionsDir}`,
	`--user-data-dir=${path.join(sandbox, "user-data-install")}`,
]);

function run(command: string, args: string[]): void {
	// Windows only runs the VS Code CLI, a .cmd file, through a shell.
	const shell = process.platform === "win32" && command.endsWith(".cmd");
	const quote = (arg: string) => (shell ? `"${arg}"` : arg);
	const result = spawnSync(quote(command), args.map(quote), { stdio: "inherit", shell });
	if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with ${result.error ?? `exit code ${result.status}`}`);
}

// Not runTests(): it always passes --disable-workspace-trust, which would make restricted mode untestable.
async function runSuite(suite: "trusted" | "restricted"): Promise<number> {
	const userDataDir = path.join(sandbox, `user-data-${suite}`);
	rmSync(userDataDir, { recursive: true, force: true });
	mkdirSync(path.join(userDataDir, "User"), { recursive: true });
	writeFileSync(
		path.join(userDataDir, "User", "settings.json"),
		JSON.stringify({
			"roc.path": path.resolve(rocPath!),
			// Lands in the Roc log under user-data-*/logs, which CI uploads when a test fails.
			"roc.trace.server": "verbose",
			"security.workspace.trust.startupPrompt": "never",
			"security.workspace.trust.banner": "never",
		}),
	);
	const workspace = path.join(sandbox, `workspace-${suite}`);
	rmSync(workspace, { recursive: true, force: true });
	cpSync(path.join(root, "test/integration/fixtures"), workspace, { recursive: true });
	const serversReport = path.join(sandbox, `servers-${suite}.json`);
	rmSync(serversReport, { force: true });

	const args = [
		workspace,
		"--no-sandbox",
		"--disable-gpu-sandbox",
		"--disable-updates",
		"--skip-welcome",
		"--skip-release-notes",
		`--user-data-dir=${userDataDir}`,
		`--extensions-dir=${extensionsDir}`,
		// Keep the language server trace in the Roc log.
		"--log=roc-lang.roc:trace",
		// An empty extension that hosts the tests, so the extension under test is the installed VSIX.
		`--extensionDevelopmentPath=${path.join(root, "test/integration/host")}`,
		`--extensionTestsPath=${path.join(root, "dist-test/integration/index.js")}`,
		...(suite === "trusted" ? ["--disable-workspace-trust"] : []),
	];
	console.log(`\n${suite} workspace:`);
	const child = spawn(vscodeExecutable, args, {
		stdio: "inherit",
		env: {
			...process.env,
			ROC_TEST_SUITE: suite,
			ROC_TEST_WORKSPACE: workspace,
			ROC_TEST_EXTENSIONS_DIR: extensionsDir,
			ROC_TEST_SERVERS_REPORT: serversReport,
		},
	});
	const code = await new Promise<number>((resolve) => child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0))));
	return (await serversExited(serversReport)) ? code : 1;
}

/** The language servers still running at the end of the tests must exit with VS Code. */
async function serversExited(report: string): Promise<boolean> {
	if (!existsSync(report)) return true;
	const pids: number[] = JSON.parse(readFileSync(report, "utf8"));
	const alive = (pid: number) => {
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	};
	for (let i = 0; i < 40 && pids.some(alive); i++) await new Promise((resolve) => setTimeout(resolve, 250));
	const leaked = pids.filter(alive);
	if (leaked.length === 0) return true;
	console.log(`  ✗ language servers still running after VS Code exited: ${leaked.join(", ")}`);
	for (const pid of leaked) process.kill(pid);
	return false;
}

let failed = false;
for (const suite of ["trusted", "restricted"] as const) {
	if ((await runSuite(suite)) !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
