// Tokenizes test/grammar/fixtures/* with the TextMate grammar and compares against committed snapshots.
// Pass --update to rewrite the snapshots, then review the diff.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const vsctm = require("vscode-textmate") as typeof import("vscode-textmate");
const oniguruma = require("vscode-oniguruma") as typeof import("vscode-oniguruma");

const root = fileURLToPath(new URL("../../", import.meta.url));
const fixturesDir = path.join(root, "test/grammar/fixtures");
const update = process.argv.includes("--update");

const grammarFiles: Record<string, string> = {
	"source.roc": "syntaxes/roc.tmLanguage.json",
	"markdown.roc.codeblock": "syntaxes/roc.markdown.tmLanguage.json",
};

await oniguruma.loadWASM(readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm")).buffer);
const registry = new vsctm.Registry({
	onigLib: Promise.resolve({
		createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
		createOnigString: (s) => new oniguruma.OnigString(s),
	}),
	loadGrammar: async (scopeName) => {
		const file = grammarFiles[scopeName];
		if (file === undefined) return null;
		return vsctm.parseRawGrammar(readFileSync(path.join(root, file), "utf8"), file);
	},
});

const roc = await registry.loadGrammar("source.roc");
if (roc === null) throw new Error("Could not load source.roc");
// The Markdown injection can't be exercised without VS Code's Markdown grammar, but it must at least compile.
const markdown = await registry.loadGrammar("markdown.roc.codeblock");
markdown?.tokenizeLine("```roc", vsctm.INITIAL);

function snapshot(source: string): { text: string; invalid: string[] } {
	const out: string[] = [];
	const invalid: string[] = [];
	let state = vsctm.INITIAL;
	source.split(/\r?\n/).forEach((line, index) => {
		const result = roc!.tokenizeLine(line, state);
		state = result.ruleStack;
		out.push(`> ${line}`);
		for (const token of result.tokens) {
			const text = line.slice(token.startIndex, token.endIndex);
			const scopes = token.scopes.filter((scope) => scope !== "source.roc");
			if (text.trim() === "" && scopes.length === 0) continue;
			out.push(`  ${JSON.stringify(text)} ${scopes.join(" ") || "-"}`);
			if (scopes.some((scope) => scope.startsWith("invalid"))) invalid.push(`line ${index + 1}: ${JSON.stringify(text)}`);
		}
	});
	return { text: `${out.join("\n")}\n`, invalid };
}

let failures = 0;
for (const fixture of readdirSync(fixturesDir).filter((f) => f.endsWith(".roc")).sort()) {
	const { text, invalid } = snapshot(readFileSync(path.join(fixturesDir, fixture), "utf8"));
	if (invalid.length > 0 && !fixture.includes("invalid")) {
		failures++;
		console.error(`✗ ${fixture}: unexpected invalid tokens:\n  ${invalid.join("\n  ")}`);
	}

	const snapPath = path.join(fixturesDir, `${fixture}.snap`);
	if (update) {
		writeFileSync(snapPath, text);
		console.log(`updated ${fixture}.snap`);
		continue;
	}
	let expected: string;
	try {
		expected = readFileSync(snapPath, "utf8").replace(/\r\n/g, "\n");
	} catch {
		failures++;
		console.error(`✗ ${fixture}: missing snapshot; run npm run test:grammar -- --update`);
		continue;
	}
	if (expected === text) {
		console.log(`✓ ${fixture}`);
		continue;
	}
	failures++;
	const expectedLines = expected.split("\n");
	const actualLines = text.split("\n");
	const first = actualLines.findIndex((line, i) => line !== expectedLines[i]);
	console.error(`✗ ${fixture}: snapshot differs at snapshot line ${first + 1}`);
	console.error(`  expected: ${expectedLines[first]}`);
	console.error(`  actual:   ${actualLines[first]}`);
}

if (failures > 0) {
	console.error(`\n${failures} grammar fixture(s) failed.`);
	process.exit(1);
}
