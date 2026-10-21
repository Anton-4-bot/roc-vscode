// Finding the server process needs `ps`, so these don't run on Windows.
import assert from "node:assert/strict";
import { rmSync, symlinkSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { closeAll, eventually, hoverText, isAlive, open, positionOf, type ServerProcess, servers, trustedTest } from "./helpers";

const lifecycleTest = process.platform === "win32" ? () => {} : trustedTest;

const restart = () => vscode.commands.executeCommand("roc.restartServer");
const rocPath = () => vscode.workspace.getConfiguration("roc").inspect<string>("path")?.globalValue ?? "";
// Changing roc.path restarts the server by itself.
const setRocPath = (value: string) => vscode.workspace.getConfiguration("roc").update("path", value, vscode.ConfigurationTarget.Global);

const running = (what: string, matches: (server: ServerProcess) => boolean = () => true) =>
	eventually(what, () => {
		const list = servers()!;
		return list.length === 1 && matches(list[0]!) ? list[0]! : undefined;
	});
const exited = (pid: number) => eventually(`server ${pid} to exit`, () => (isAlive(pid) ? undefined : true));
const noServer = () => eventually("no server to be running", () => (servers()!.length === 0 ? true : undefined));

async function assertWorks(): Promise<void> {
	const document = await open("Math.roc");
	assert.match(await hoverText(document, positionOf(document, "double =")), /I64/);
	await closeAll();
}

lifecycleTest("restart replaces the server process with a working one", async () => {
	await assertWorks();
	const before = await running("one server");
	await restart();
	await running("a new server", (server) => server.pid !== before.pid);
	await exited(before.pid);
	await assertWorks();
});

lifecycleTest("repeated restarts leave exactly one server", async () => {
	const seen = new Set([(await running("one server")).pid]);
	for (let i = 0; i < 3; i++) {
		await restart();
		for (const server of servers()!) seen.add(server.pid);
	}
	const current = await running("one server after restarting");
	for (const pid of seen) if (pid !== current.pid) await exited(pid);
	await assertWorks();
});

lifecycleTest("a missing executable stops the server, and fixing roc.path recovers", async () => {
	const original = rocPath();
	try {
		await setRocPath(path.join(os.tmpdir(), "no-such-roc"));
		await restart();
		await noServer();
	} finally {
		await setRocPath(original);
	}
	await running("the server to come back");
	await assertWorks();
});

lifecycleTest("an executable that is not a language server fails rather than hangs", async () => {
	const original = rocPath();
	const impostor = path.join(os.tmpdir(), `not-roc-${process.pid}`);
	writeFileSync(impostor, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
	try {
		await setRocPath(impostor);
		await Promise.race([restart(), timeout(30_000)]);
		await noServer();
	} finally {
		await setRocPath(original);
		rmSync(impostor, { force: true });
	}
	await running("the server to come back");
	await assertWorks();
});

lifecycleTest("starts the server from a changed roc.path", async () => {
	const original = rocPath();
	const link = path.join(os.tmpdir(), `roc-link-${process.pid}`);
	rmSync(link, { force: true });
	symlinkSync(original, link);
	try {
		await setRocPath(link);
		await running("a server started from the new path", (server) => server.command.startsWith(link));
	} finally {
		await setRocPath(original);
		rmSync(link, { force: true });
	}
	await running("a server started from the original path", (server) => server.command.startsWith(original));
	await assertWorks();
});

const timeout = (ms: number) =>
	new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`still running after ${ms} ms`)), ms));
