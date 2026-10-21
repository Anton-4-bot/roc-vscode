import { accessSync, constants, statSync } from "node:fs";
import * as os from "node:os";
import * as vscode from "vscode";
import { RocLanguageServer } from "./client";
import { RocTaskProvider, runOnActiveFile, TASK_TYPE } from "./commands";
import {
	cleanUpOldNightlies,
	errorMessage,
	getManagedNightly,
	installLatestNightly,
	maybeOfferNightlyUpdate,
} from "./managedNightly";
import { type RocResolution, resolveRoc } from "./rocBinary";

let server: RocLanguageServer | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const output = vscode.window.createOutputChannel("Roc", { log: true });
	server = new RocLanguageServer(output);
	const languageServer = server;
	context.subscriptions.push(output, languageServer);

	const resolve = (): RocResolution =>
		resolveRoc({
			setting: vscode.workspace.getConfiguration("roc").get<string>("path", ""),
			managedExecutable: getManagedNightly(context)?.executable,
			env: process.env,
			platform: process.platform,
			homedir: os.homedir(),
			isExecutable,
		});

	// Serialize (re)starts so overlapping triggers, e.g. a settings change during an install, can't race.
	let pending: Promise<void> = Promise.resolve();
	const restart = (): Promise<void> => {
		pending = pending.then(async () => {
			const resolution = resolve();
			if (resolution.kind !== "found") {
				await languageServer.stop();
				languageServer.showStopped("roc not found", { title: "Install", command: "roc.installNightly" });
				void reportMissingRoc(resolution);
				return;
			}
			try {
				await languageServer.start(resolution.executable);
			} catch (error) {
				output.error(`Failed to start the Roc language server: ${String(error)}`);
				void vscode.window.showErrorMessage(`Failed to start the Roc language server: ${errorMessage(error)}`, "Show Output").then(
					(choice) => choice && output.show(),
				);
			}
		});
		return pending;
	};

	const install = async (): Promise<void> => {
		if ((await installLatestNightly(context, output)) === undefined) return;
		await restart();
		await cleanUpOldNightlies(context);
	};

	const reportMissingRoc = async (resolution: Exclude<RocResolution, { kind: "found" }>): Promise<void> => {
		const message =
			resolution.kind === "badSetting"
				? `The roc.path setting is "${resolution.setting}", but no roc executable was found there.`
				: "The roc executable was not found. The Roc extension needs it for diagnostics, formatting and more.";
		const choice = await vscode.window.showWarningMessage(
			message,
			"Download Nightly",
			"Select Executable…",
			"Install Instructions",
		);
		if (choice === "Download Nightly") await install();
		else if (choice === "Select Executable…") await vscode.commands.executeCommand("roc.selectExecutable");
		else if (choice === "Install Instructions") await vscode.env.openExternal(vscode.Uri.parse("https://www.roc-lang.org/install"));
	};

	const getExecutable = async (): Promise<string | undefined> => {
		const resolution = resolve();
		if (resolution.kind === "found") return resolution.executable;
		void reportMissingRoc(resolution);
		return undefined;
	};

	context.subscriptions.push(
		vscode.commands.registerCommand("roc.restartServer", restart),
		vscode.commands.registerCommand("roc.showOutput", () => output.show()),
		vscode.commands.registerCommand("roc.installNightly", install),
		vscode.commands.registerCommand("roc.selectExecutable", selectExecutable),
		vscode.commands.registerCommand("roc.runFile", (uri?: vscode.Uri) => runOnActiveFile("run", getExecutable, uri)),
		vscode.commands.registerCommand("roc.testFile", (uri?: vscode.Uri) => runOnActiveFile("test", getExecutable, uri)),
		vscode.tasks.registerTaskProvider(TASK_TYPE, new RocTaskProvider(getExecutable)),
		// The server reads trust once, at initialize, so it must restart when trust is granted.
		vscode.workspace.onDidGrantWorkspaceTrust(restart),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration("roc.path") || event.affectsConfiguration("roc.server")) void restart();
		}),
	);

	await restart();
	void cleanUpOldNightlies(context);

	const resolution = resolve();
	void maybeOfferNightlyUpdate(context, output, resolution.kind === "found" && resolution.source === "managed", install);
}

export async function deactivate(): Promise<void> {
	await server?.stop();
}

async function selectExecutable(): Promise<void> {
	const picked = await vscode.window.showOpenDialog({
		title: "Select the roc executable",
		canSelectFiles: true,
		canSelectFolders: false,
		canSelectMany: false,
		...(process.platform === "win32" ? { filters: { Executables: ["exe"] } } : {}),
	});
	const file = picked?.[0]?.fsPath;
	if (file === undefined) return;
	// User settings: a workspace can't be trusted to choose which binary runs.
	await vscode.workspace.getConfiguration("roc").update("path", file, vscode.ConfigurationTarget.Global);
}

function isExecutable(file: string): boolean {
	try {
		accessSync(file, process.platform === "win32" ? constants.F_OK : constants.X_OK);
		return statSync(file).isFile();
	} catch {
		return false;
	}
}
