// Runs inside the VS Code extension host. Suites register their tests in import order.
import "./basics";
import "./features";
import "./editing";
import "./lifecycle";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { servers, suite, tests } from "./helpers";

export async function run(): Promise<void> {
	assert.ok(suite === "trusted" || suite === "restricted", "ROC_TEST_SUITE must be trusted or restricted");
	const grep = process.env["ROC_TEST_GREP"];
	const selected = grep ? tests.filter(([name]) => name.includes(grep)) : tests;
	const failures: string[] = [];
	for (const [name, fn] of selected) {
		try {
			await fn();
			console.log(`  ✓ ${name}`);
		} catch (error) {
			console.log(`  ✗ ${name}\n    ${String(error).replace(/\n/g, "\n    ")}`);
			failures.push(name);
		}
	}
	// runTest checks that these exit together with VS Code.
	const report = process.env["ROC_TEST_SERVERS_REPORT"];
	const running = servers();
	if (report && running) writeFileSync(report, JSON.stringify(running.map((server) => server.pid)));
	if (failures.length > 0) throw new Error(`${failures.length} of ${selected.length} integration tests failed`);
}
