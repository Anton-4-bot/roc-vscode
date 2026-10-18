// Shared by the integration suites, which run inside the VS Code extension host.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

export const suite = process.env["ROC_TEST_SUITE"];
/** A fresh copy of test/integration/fixtures, so tests can write files. */
export const workspaceDir = process.env["ROC_TEST_WORKSPACE"] ?? "";

// A tiny sequential runner, so no test framework is needed. Suites register in import order.
export const tests: [string, () => Promise<void>][] = [];
export const test = (name: string, fn: () => Promise<void>) => tests.push([name, fn]);
export const trustedTest = (name: string, fn: () => Promise<void>) => suite === "trusted" && test(name, fn);
export const restrictedTest = (name: string, fn: () => Promise<void>) => suite === "restricted" && test(name, fn);

export async function open(file: string): Promise<vscode.TextDocument> {
	const document = await vscode.workspace.openTextDocument(path.join(workspaceDir, file));
	await vscode.window.showTextDocument(document, { preview: false });
	return document;
}

/** Writes `text` to a new file in the workspace and opens it. */
export function openScratch(file: string, text: string): Promise<vscode.TextDocument> {
	writeFileSync(path.join(workspaceDir, file), text);
	return open(file);
}

/** Reverts and closes every editor. Closing a dirty one would otherwise open a save prompt. */
export async function closeAll(): Promise<void> {
	for (let i = 0; vscode.window.activeTextEditor && i < 20; i++) {
		await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
	}
}

/** Replaces the whole document without saving it. */
export async function replaceAll(document: vscode.TextDocument, text: string): Promise<void> {
	const edit = new vscode.WorkspaceEdit();
	edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text);
	assert.ok(await vscode.workspace.applyEdit(edit));
}

/** Retries `fn` until it returns a defined value, because the server starts and checks asynchronously. */
export async function eventually<T>(what: string, fn: () => Promise<T | undefined> | T | undefined, timeoutMs = 60_000): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	let lastError: unknown;
	while (Date.now() < deadline) {
		try {
			const value = await fn();
			if (value !== undefined) return value;
		} catch (error) {
			lastError = error;
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`Timed out waiting for ${what}${lastError ? `: ${String(lastError)}` : ""}`);
}

/** Runs a `vscode.execute*` command until it returns a non-empty result. */
export function request<T>(command: string, ...args: unknown[]): Promise<T> {
	return eventually(command, async () => {
		const result = await vscode.commands.executeCommand<T>(command, ...args);
		const empty = result === undefined || result === null || (Array.isArray(result) && result.length === 0);
		return empty ? undefined : result;
	});
}

/** The position `offset` characters into the first occurrence of `needle`. */
export function positionOf(document: vscode.TextDocument, needle: string, offset = 0): vscode.Position {
	const index = document.getText().indexOf(needle);
	assert.notEqual(index, -1, `"${needle}" is not in ${path.basename(document.fileName)}`);
	return document.positionAt(index + offset);
}

export async function hoverText(document: vscode.TextDocument, position: vscode.Position): Promise<string> {
	const hovers = await request<vscode.Hover[]>("vscode.executeHoverProvider", document.uri, position);
	return hovers
		.flatMap((hover) => hover.contents)
		.map((content) => (typeof content === "string" ? content : content.value))
		.join("\n");
}

export const errors = (uri: vscode.Uri) =>
	vscode.languages.getDiagnostics(uri).filter((d) => d.severity === vscode.DiagnosticSeverity.Error);

export function assertInside(document: vscode.TextDocument, range: vscode.Range, what: string): void {
	assert.ok(document.validateRange(range).isEqual(range), `${what} ${JSON.stringify(range)} lies outside the document`);
}

/** A definition result is either a Location or a LocationLink. */
export const targetOf = (result: vscode.Location | vscode.LocationLink) =>
	"targetUri" in result
		? { uri: result.targetUri, range: result.targetSelectionRange ?? result.targetRange }
		: { uri: result.uri, range: result.range };

export interface ServerProcess {
	pid: number;
	command: string;
}

/**
 * Language servers started by this window, which are children of this extension host.
 * Undefined on Windows, which has no `ps`.
 */
export function servers(): ServerProcess[] | undefined {
	if (process.platform === "win32") return undefined;
	return execFileSync("ps", ["-A", "-o", "pid=,ppid=,args="], { encoding: "utf8" })
		.split("\n")
		.map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
		.filter((m): m is RegExpExecArray => m !== null && Number(m[2]) === process.pid && m[3]!.includes("experimental-lsp"))
		.map((m) => ({ pid: Number(m[1]), command: m[3]! }));
}

export function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
