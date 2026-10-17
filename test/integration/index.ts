// Runs inside the VS Code extension host. A tiny sequential runner, so no test framework is needed.
import assert from "node:assert/strict";
import * as path from "node:path";
import * as vscode from "vscode";

const fixtures = path.resolve(__dirname, "../../test/integration/fixtures");
const suite = process.env["ROC_TEST_SUITE"];
const tests: [string, () => Promise<void>][] = [];
const test = (name: string, fn: () => Promise<void>) => tests.push([name, fn]);
const trustedTest = (name: string, fn: () => Promise<void>) => suite === "trusted" && test(name, fn);
const restrictedTest = (name: string, fn: () => Promise<void>) => suite === "restricted" && test(name, fn);

async function open(file: string): Promise<vscode.TextDocument> {
	const document = await vscode.workspace.openTextDocument(path.join(fixtures, file));
	await vscode.window.showTextDocument(document);
	return document;
}

/** Retries `fn` until it returns a defined value, because the server starts and checks asynchronously. */
async function eventually<T>(what: string, fn: () => Promise<T | undefined> | T | undefined, timeoutMs = 60_000): Promise<T> {
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

test("registers .roc files as the roc language", async () => {
	const document = await open("Math.roc");
	assert.equal(document.languageId, "roc");
});

test("activates the extension", async () => {
	const extension = vscode.extensions.getExtension("roc-lang.roc");
	assert.ok(extension, "extension roc-lang.roc is installed");
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
	await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
});

trustedTest("publishes type errors as diagnostics", async () => {
	const document = await open("Broken.roc");
	const errors = await eventually("diagnostics", () => {
		const found = vscode.languages
			.getDiagnostics(document.uri)
			.filter((d) => d.severity === vscode.DiagnosticSeverity.Error);
		return found.length > 0 ? found : undefined;
	});
	assert.ok(errors.some((d) => d.range.start.line === 2), `an error on line 3, got ${JSON.stringify(errors)}`);
});

trustedTest("shows inferred types on hover", async () => {
	const document = await open("Math.roc");
	const position = document.positionAt(document.getText().indexOf("double ="));
	const hovers = await eventually("hover", async () => {
		const result = await vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", document.uri, position);
		return result && result.length > 0 ? result : undefined;
	});
	const text = hovers
		.flatMap((hover) => hover.contents)
		.map((content) => (typeof content === "string" ? content : content.value))
		.join("\n");
	assert.match(text, /I64/);
});

trustedTest("provides semantic tokens", async () => {
	const document = await open("Math.roc");
	const tokens = await eventually("semantic tokens", async () => {
		const result = await vscode.commands.executeCommand<vscode.SemanticTokens>(
			"vscode.provideDocumentSemanticTokens",
			document.uri,
		);
		return result && result.data.length > 0 ? result : undefined;
	});
	assert.ok(tokens.data.length % 5 === 0);
});

restrictedTest("does not check code or answer semantic requests", async () => {
	// Once formatting answers, the server is running; give it time to (wrongly) publish diagnostics.
	const document = await open("Broken.roc");
	await eventually("the server", () => formattingEdits(document).then((edits) => edits ?? []));
	await new Promise((resolve) => setTimeout(resolve, 3000));
	assert.deepEqual(vscode.languages.getDiagnostics(document.uri), []);

	const position = document.positionAt(document.getText().indexOf("greeting ="));
	const hovers = await vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", document.uri, position);
	assert.deepEqual(hovers, []);
	const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens | undefined>(
		"vscode.provideDocumentSemanticTokens",
		document.uri,
	);
	assert.equal(tokens, undefined);
});

async function formattingEdits(document: vscode.TextDocument): Promise<vscode.TextEdit[] | undefined> {
	const result = await vscode.commands.executeCommand<vscode.TextEdit[] | undefined>(
		"vscode.executeFormatDocumentProvider",
		document.uri,
		{ insertSpaces: false, tabSize: 4 },
	);
	return result && result.length > 0 ? result : undefined;
}

export async function run(): Promise<void> {
	assert.ok(suite === "trusted" || suite === "restricted", "ROC_TEST_SUITE must be trusted or restricted");
	const failures: string[] = [];
	for (const [name, fn] of tests) {
		try {
			await fn();
			console.log(`  ✓ ${name}`);
		} catch (error) {
			console.log(`  ✗ ${name}\n    ${String(error).replace(/\n/g, "\n    ")}`);
			failures.push(name);
		}
	}
	if (failures.length > 0) throw new Error(`${failures.length} of ${tests.length} integration tests failed`);
}
