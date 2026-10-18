// Document synchronisation is where integrations usually break: a feature can work on a freshly
// opened file and still be wrong after an edit, or on lines with non-ASCII text or CRLF endings.
import assert from "node:assert/strict";
import * as vscode from "vscode";
import { closeAll, errors, eventually, hoverText, openScratch, positionOf, replaceAll, request, targetOf, trustedTest } from "./helpers";

const module = (name: string, body: string) => `${name} := [].{\n${body}\n}\n`;

trustedTest("reports an error in an unsaved edit, and clears it when repaired", async () => {
	const valid = module("Unsaved", "\tanswer : I64\n\tanswer = 42");
	const document = await openScratch("Unsaved.roc", valid);
	await hoverText(document, positionOf(document, "answer =", 1));
	assert.deepEqual(errors(document.uri), []);

	await replaceAll(document, valid.replace("answer = 42", "answer = missing_name"));
	assert.ok(document.isDirty, "the edit must stay unsaved for this test to mean anything");
	await eventually("a diagnostic for the undefined name", () => (errors(document.uri).length > 0 ? true : undefined));

	await replaceAll(document, valid);
	await eventually("the diagnostic to clear", () => (errors(document.uri).length === 0 ? true : undefined));
	await closeAll();
});

// VS Code counts UTF-16 code units; "é" is 2 bytes in UTF-8 and the emoji is 2 UTF-16 units and 4 bytes.
// A server that counts columns differently misses `count` on the line with the string.
trustedTest("keeps positions right after non-ASCII text", async () => {
	const document = await openScratch("Unicode.roc", module("Unicode", '\tcount = 1.I64\n\n\tpair = ("café \u{1F600}", count)'));
	await assertCountPositions(document, "count)");
	await closeAll();
});

trustedTest("keeps positions right with CRLF line endings", async () => {
	const document = await openScratch("Windows.roc", module("Windows", "\tcount = 1.I64\n\n\ttwice = count + count").replaceAll("\n", "\r\n"));
	assert.equal(document.eol, vscode.EndOfLine.CRLF);
	await assertCountPositions(document, "count + count");
	await closeAll();
});

/** Goes from the use of `count` at `use` to its definition, and back via references. */
async function assertCountPositions(document: vscode.TextDocument, use: string): Promise<void> {
	const definitionLine = positionOf(document, "count =").line;
	const usePosition = positionOf(document, use);
	const [definition] = await request<(vscode.Location | vscode.LocationLink)[]>(
		"vscode.executeDefinitionProvider",
		document.uri,
		usePosition.translate(0, 1),
	);
	assert.equal(targetOf(definition!).range.start.line, definitionLine);

	const references = await request<vscode.Location[]>("vscode.executeReferenceProvider", document.uri, positionOf(document, "count =", 1));
	assert.ok(
		references.some((r) => r.range.start.isEqual(usePosition)),
		`no reference starts at ${JSON.stringify(usePosition)}: ${JSON.stringify(references.map((r) => r.range.start))}`,
	);
}

trustedTest("stays consistent under rapid edits and requests", async () => {
	const body = (value: number) => module("Rapid", `\tanswer : I64\n\tanswer = ${value}`);
	const document = await openScratch("Rapid.roc", body(0));
	const pending: Thenable<unknown>[] = [];
	for (let value = 1; value <= 15; value++) {
		await replaceAll(document, body(value));
		pending.push(vscode.commands.executeCommand("vscode.executeHoverProvider", document.uri, positionOf(document, "answer =", 1)));
	}
	// Requests overtaken by a later edit may be cancelled, but none may wedge the server.
	await Promise.allSettled(pending);
	assert.match(await hoverText(document, positionOf(document, "answer =", 1)), /I64/);
	assert.deepEqual(errors(document.uri), []);
	await closeAll();
});
