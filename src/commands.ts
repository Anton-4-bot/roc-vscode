// `roc run`/`roc test` for the current file, and the `roc` task type.
import * as path from "node:path";
import * as vscode from "vscode";

export const TASK_TYPE = "roc";

interface RocTaskDefinition extends vscode.TaskDefinition {
	command: "run" | "test" | "check" | "build";
	file?: string;
	args?: string[];
}

/** Returns the roc executable, or undefined after telling the user it is missing. */
export type ExecutableProvider = () => Promise<string | undefined>;

export class RocTaskProvider implements vscode.TaskProvider {
	constructor(private readonly getExecutable: ExecutableProvider) {}

	provideTasks(): vscode.Task[] {
		return [];
	}

	async resolveTask(task: vscode.Task): Promise<vscode.Task | undefined> {
		const definition = task.definition as RocTaskDefinition;
		const executable = await this.getExecutable();
		if (executable === undefined) return undefined;
		const folder = typeof task.scope === "object" ? task.scope : vscode.workspace.workspaceFolders?.[0];
		const args = [definition.command, definition.file ?? "main.roc", ...(definition.args ?? [])];
		return createRocTask(executable, args, definition, task.scope ?? vscode.TaskScope.Workspace, folder?.uri.fsPath, task.name);
	}
}

function createRocTask(
	executable: string,
	args: string[],
	definition: RocTaskDefinition,
	scope: vscode.WorkspaceFolder | vscode.TaskScope,
	cwd: string | undefined,
	name: string,
): vscode.Task {
	const execution = new vscode.ProcessExecution(executable, args, cwd === undefined ? {} : { cwd });
	const task = new vscode.Task(definition, scope, name, "roc", execution);
	task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, clear: true, focus: true };
	return task;
}

/** Saves the active Roc file and runs `roc <command>` on it as a task. */
export async function runOnActiveFile(command: "run" | "test", getExecutable: ExecutableProvider, uri?: vscode.Uri): Promise<void> {
	const document = uri
		? await vscode.workspace.openTextDocument(uri)
		: vscode.window.activeTextEditor?.document;
	if (document === undefined || document.languageId !== "roc") {
		void vscode.window.showWarningMessage("Open a Roc file first.");
		return;
	}
	if (document.isUntitled) {
		void vscode.window.showWarningMessage("Save this file before running it with roc.");
		return;
	}
	if (document.isDirty && !(await document.save())) return;

	const executable = await getExecutable();
	if (executable === undefined) return;

	const file = document.uri.fsPath;
	const folder = vscode.workspace.getWorkspaceFolder(document.uri);
	const definition: RocTaskDefinition = {
		type: TASK_TYPE,
		command,
		file: folder ? path.relative(folder.uri.fsPath, file) : file,
	};
	// Run the file from its own directory, like `roc run` in a terminal next to it.
	const task = createRocTask(
		executable,
		[command, file],
		definition,
		folder ?? vscode.TaskScope.Workspace,
		path.dirname(file),
		`${command} ${path.basename(file)}`,
	);
	await vscode.tasks.executeTask(task);
}
