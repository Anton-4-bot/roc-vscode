// Bundles the extension (and, with --tests, the test entry points) with esbuild.
import * as esbuild from "esbuild";
import { readdirSync } from "node:fs";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");
const tests = process.argv.includes("--tests");

const common = {
	bundle: true,
	platform: "node",
	target: "node20",
	sourcemap: !production,
	minify: production,
	logLevel: "info",
};

const builds = [
	{
		...common,
		entryPoints: ["src/extension.ts"],
		outfile: "dist/extension.js",
		format: "cjs",
		external: ["vscode"],
	},
];

if (tests) {
	const unitTests = readdirSync("test/unit")
		.filter((f) => f.endsWith(".test.ts"))
		.map((f) => `test/unit/${f}`);
	builds.push(
		{
			...common,
			entryPoints: [...unitTests, "test/grammar/run.ts", "test/integration/runTest.ts", "test/nightly/install.ts"],
			outdir: "dist-test",
			outbase: "test",
			format: "esm",
			outExtension: { ".js": ".mjs" },
			packages: "external",
		},
		{
			// Loaded by the VS Code test host, which expects CommonJS.
			...common,
			entryPoints: ["test/integration/index.ts"],
			outfile: "dist-test/integration/index.js",
			format: "cjs",
			external: ["vscode"],
		},
	);
}

if (watch) {
	for (const options of builds) {
		const ctx = await esbuild.context(options);
		await ctx.watch();
	}
} else {
	await Promise.all(builds.map((options) => esbuild.build(options)));
}
