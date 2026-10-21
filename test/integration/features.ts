// Each request goes VS Code -> the installed extension -> vscode-languageclient -> roc and back.
// These check that bridge: a result arrives, has the right shape and points into the document.
// Whether the answer is right is up to the compiler's own tests, so these hold across nightlies.
import assert from "node:assert/strict";
import * as vscode from "vscode";
import { formattingEdits } from "./basics";
import {
	assertInside,
	closeAll,
	errors,
	eventually,
	hoverText,
	open,
	positionOf,
	request,
	restrictedTest,
	targetOf,
	trustedTest,
} from "./helpers";

trustedTest("publishes type errors as diagnostics", async () => {
	const document = await open("Broken.roc");
	const found = await eventually("diagnostics", () => {
		const list = errors(document.uri);
		return list.length > 0 ? list : undefined;
	});
	assert.ok(found.some((d) => d.range.start.line === 2), `an error on line 3, got ${JSON.stringify(found)}`);
});

trustedTest("shows inferred types on hover", async () => {
	const document = await open("Math.roc");
	assert.match(await hoverText(document, positionOf(document, "double =")), /I64/);
});

trustedTest("provides semantic tokens", async () => {
	const document = await open("Math.roc");
	const tokens = await request<vscode.SemanticTokens>("vscode.provideDocumentSemanticTokens", document.uri);
	assert.ok(tokens.data.length > 0 && tokens.data.length % 5 === 0);
});

trustedTest("reports no errors for a valid file", async () => {
	const document = await open("Geometry.roc");
	// Hover only answers once the file is checked, so diagnostics have settled by then.
	await hoverText(document, positionOf(document, "double =", 1));
	assert.deepEqual(errors(document.uri), []);
});

trustedTest("goes to definition", async () => {
	const document = await open("Geometry.roc");
	const results = await request<(vscode.Location | vscode.LocationLink)[]>(
		"vscode.executeDefinitionProvider",
		document.uri,
		positionOf(document, "double(double", 1),
	);
	const target = targetOf(results[0]!);
	assert.equal(target.uri.toString(), document.uri.toString());
	assertInside(document, target.range, "definition");
	assert.equal(target.range.start.line, positionOf(document, "double =").line);
});

trustedTest("finds references and document highlights", async () => {
	const document = await open("Geometry.roc");
	const position = positionOf(document, "double =", 1);
	const references = await request<vscode.Location[]>("vscode.executeReferenceProvider", document.uri, position);
	assert.ok(references.length >= 2, `expected the definition and its uses, got ${references.length}`);
	for (const location of references) assertInside(document, location.range, "reference");
	const highlights = await request<vscode.DocumentHighlight[]>("vscode.executeDocumentHighlights", document.uri, position);
	for (const highlight of highlights) assertInside(document, highlight.range, "highlight");
});

trustedTest("lists document symbols", async () => {
	const document = await open("Geometry.roc");
	const symbols = await request<vscode.DocumentSymbol[]>("vscode.executeDocumentSymbolProvider", document.uri);
	const names: string[] = [];
	const visit = (symbol: vscode.DocumentSymbol) => {
		names.push(symbol.name);
		assertInside(document, symbol.range, `symbol ${symbol.name}`);
		symbol.children.forEach(visit);
	};
	symbols.forEach(visit);
	assert.ok(names.some((name) => name.includes("Geometry")), `symbols were ${names.join(", ")}`);
});

trustedTest("completes, including after the . trigger character", async () => {
	const document = await open("Geometry.roc");
	const general = await request<vscode.CompletionList>("vscode.executeCompletionItemProvider", document.uri, positionOf(document, "double(double"));
	assert.ok(general.items.length > 0);
	const afterDot = await eventually("completion after .", async () => {
		const list = await vscode.commands.executeCommand<vscode.CompletionList>(
			"vscode.executeCompletionItemProvider",
			document.uri,
			positionOf(document, "point.x", "point.".length),
			".",
		);
		return list.items.length > 0 ? list : undefined;
	});
	assert.ok(afterDot.items.length > 0);
});

trustedTest("renames with an edit that applies", async () => {
	const document = await open("Geometry.roc");
	const edit = await request<vscode.WorkspaceEdit>(
		"vscode.executeDocumentRenameProvider",
		document.uri,
		positionOf(document, "amount|", 1),
		"distance",
	);
	const changes = edit.entries().flatMap(([, edits]) => edits);
	assert.ok(changes.length >= 2, `expected the parameter and its uses, got ${changes.length}`);
	for (const change of changes) {
		assertInside(document, change.range, "rename edit");
		assert.equal(change.newText, "distance");
	}
	assert.ok(await vscode.workspace.applyEdit(edit));
	assert.match(document.getText(), /\|point, distance\|/);
	await closeAll();
});

trustedTest("provides folding and selection ranges", async () => {
	const document = await open("Geometry.roc");
	const folds = await request<vscode.FoldingRange[]>("vscode.executeFoldingRangeProvider", document.uri);
	for (const fold of folds) assert.ok(fold.start < fold.end && fold.end < document.lineCount, `folding range ${fold.start}-${fold.end}`);
	const [selection] = await request<vscode.SelectionRange[]>("vscode.executeSelectionRangeProvider", document.uri, [
		positionOf(document, "point.x", 1),
	]);
	assertInside(document, selection!.range, "selection range");
	if (selection!.parent) assert.ok(selection!.parent.range.contains(selection!.range), "a parent must enclose its child");
});

trustedTest("provides inlay hints and code actions", async () => {
	const document = await open("Geometry.roc");
	// Wait for the file to be checked, since neither request has to return anything.
	await hoverText(document, positionOf(document, "double =", 1));
	const hints = await vscode.commands.executeCommand<vscode.InlayHint[]>(
		"vscode.executeInlayHintProvider",
		document.uri,
		new vscode.Range(0, 0, document.lineCount, 0),
	);
	for (const hint of hints) assert.ok(document.validatePosition(hint.position).isEqual(hint.position), "inlay hint outside the document");
	const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
		"vscode.executeCodeActionProvider",
		document.uri,
		new vscode.Range(positionOf(document, "double ="), positionOf(document, "n * 2")),
	);
	for (const action of actions) assert.equal(typeof action.title, "string");
});

restrictedTest("does not check code or answer semantic requests", async () => {
	// Once formatting answers, the server is running; give it time to (wrongly) publish diagnostics.
	const broken = await open("Broken.roc");
	await eventually("the server", () => formattingEdits(broken).then((edits) => edits ?? []));
	await new Promise((resolve) => setTimeout(resolve, 3000));
	assert.deepEqual(vscode.languages.getDiagnostics(broken.uri), []);

	const document = await open("Geometry.roc");
	const at = (needle: string, offset = 1) => positionOf(document, needle, offset);
	// A request no provider answers comes back empty or undefined, depending on the request.
	const assertNoAnswer = async (command: string, ...args: unknown[]) => {
		const result = await vscode.commands.executeCommand<unknown>(command, document.uri, ...args);
		assert.ok(result === undefined || (Array.isArray(result) && result.length === 0), `${command} answered ${JSON.stringify(result)}`);
	};
	await assertNoAnswer("vscode.executeHoverProvider", at("double ="));
	await assertNoAnswer("vscode.executeDefinitionProvider", at("double(double"));
	await assertNoAnswer("vscode.executeReferenceProvider", at("double ="));
	await assertNoAnswer("vscode.executeDocumentSymbolProvider");
	await assertNoAnswer("vscode.executeInlayHintProvider", new vscode.Range(0, 0, document.lineCount, 0));
	// VS Code adds its own chat actions to every selection.
	const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
		"vscode.executeCodeActionProvider",
		document.uri,
		new vscode.Range(at("double ="), at("n * 2")),
	);
	assert.deepEqual(actions.filter((action) => !action.command?.command.startsWith("inlineChat.")), []);
	await assertNoAnswer("vscode.provideDocumentSemanticTokens");
	const completion = await vscode.commands.executeCommand<vscode.CompletionList>(
		"vscode.executeCompletionItemProvider",
		document.uri,
		at("point.x", "point.".length),
		".",
	);
	// VS Code suggests words from open documents itself, as plain text items.
	assert.deepEqual(completion.items.filter((item) => item.kind !== vscode.CompletionItemKind.Text), []);
	// VS Code rejects a rename that no provider answers.
	const rename = await Promise.resolve(
		vscode.commands.executeCommand<vscode.WorkspaceEdit | undefined>("vscode.executeDocumentRenameProvider", document.uri, at("amount|"), "distance"),
	).catch(() => undefined);
	assert.equal(rename?.size ?? 0, 0);
});
