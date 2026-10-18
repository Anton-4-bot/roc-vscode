import assert from "node:assert/strict";
import * as path from "node:path";
import * as vscode from "vscode";
import { closeAll, eventually, open, suite, test } from "./helpers";

test("registers .roc files as the roc language", async () => {
	const document = await open("Math.roc");
	assert.equal(document.languageId, "roc");
});

test("activates the extension installed from the VSIX", async () => {
	const extension = vscode.extensions.getExtension("roc-lang.roc");
	assert.ok(extension, "extension roc-lang.roc is installed");
	// Loading it from the source tree would hide packaging mistakes.
	const extensionsDir = process.env["ROC_TEST_EXTENSIONS_DIR"] ?? "";
	const relative = path.relative(extensionsDir, extension.extensionPath);
	assert.ok(extensionsDir !== "" && !relative.startsWith("..") && !path.isAbsolute(relative), `loaded from ${extension.extensionPath}`);
	await extension.activate();
	assert.ok(extension.isActive);
});

test("matches the trust of the workspace", async () => {
	assert.equal(vscode.workspace.isTrusted, suite === "trusted");
});

// Formatting only parses, so the server offers it in restricted mode too.
test("formats a document through the language server", async () => {
	const document = await open("unformatted.roc");
	const edits = await eventually("formatting edits", () => formattingEdits(document));
	const edit = new vscode.WorkspaceEdit();
	edit.set(document.uri, edits);
	assert.ok(await vscode.workspace.applyEdit(edit));
	assert.equal(document.getText(), "add : I64, I64 -> I64\nadd = |a, b| a + b\n");
	await closeAll();
});

export async function formattingEdits(document: vscode.TextDocument): Promise<vscode.TextEdit[] | undefined> {
	const result = await vscode.commands.executeCommand<vscode.TextEdit[] | undefined>(
		"vscode.executeFormatDocumentProvider",
		document.uri,
		{ insertSpaces: false, tabSize: 4 },
	);
	return result && result.length > 0 ? result : undefined;
}
