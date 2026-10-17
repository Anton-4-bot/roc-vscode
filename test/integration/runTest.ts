// Downloads VS Code into .vscode-test/ and runs test/integration/index.ts in it twice:
// once in a trusted workspace and once in restricted mode.
// ROC_PATH must point at a roc executable; VSCODE_VERSION optionally picks the VS Code build.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";

const root = fileURLToPath(new URL("../../", import.meta.url));
const rocPath = process.env["ROC_PATH"];
if (!rocPath) {
	console.error("Set ROC_PATH to a roc executable to run the integration tests.");
	process.exit(1);
}

const vscodeExecutable = await downloadAndUnzipVSCode(process.env["VSCODE_VERSION"] ?? "stable");

// Not runTests(): it always passes --disable-workspace-trust, which would make restricted mode untestable.
async function runSuite(suite: "trusted" | "restricted"): Promise<number> {
	const userDataDir = path.join(root, ".vscode-test", `user-data-${suite}`);
	rmSync(userDataDir, { recursive: true, force: true });
	mkdirSync(path.join(userDataDir, "User"), { recursive: true });
	writeFileSync(
		path.join(userDataDir, "User", "settings.json"),
		JSON.stringify({
			"roc.path": path.resolve(rocPath!),
			"security.workspace.trust.startupPrompt": "never",
			"security.workspace.trust.banner": "never",
		}),
	);

	const args = [
		path.join(root, "test/integration/fixtures"),
		"--no-sandbox",
		"--disable-gpu-sandbox",
		"--disable-updates",
		"--skip-welcome",
		"--skip-release-notes",
		"--disable-extensions",
		`--user-data-dir=${userDataDir}`,
		`--extensions-dir=${path.join(root, ".vscode-test", "extensions")}`,
		`--extensionDevelopmentPath=${root}`,
		`--extensionTestsPath=${path.join(root, "dist-test/integration/index.js")}`,
		...(suite === "trusted" ? ["--disable-workspace-trust"] : []),
	];
	console.log(`\n${suite} workspace:`);
	const child = spawn(vscodeExecutable, args, {
		stdio: "inherit",
		env: { ...process.env, ROC_TEST_SUITE: suite },
	});
	return new Promise((resolve) => child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0))));
}

let failed = false;
for (const suite of ["trusted", "restricted"] as const) {
	if ((await runSuite(suite)) !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
