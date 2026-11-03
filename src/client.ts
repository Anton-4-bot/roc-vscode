import { execFile } from "node:child_process";
import * as vscode from "vscode";
import { LanguageClient, type LanguageClientOptions, type ServerOptions } from "vscode-languageclient/node";

const documentSelector = [
	{ scheme: "file", language: "roc" },
	{ scheme: "untitled", language: "roc" },
];

/**
 * Owns the language client for one roc executable at a time.
 * The server checks every open document, which can download packages and run compile-time
 * Roc code, so restricted mode runs no server and only formats, with `roc fmt`.
 */
export class RocLanguageServer implements vscode.Disposable {
	private client: LanguageClient | undefined;
	private formatter: vscode.Disposable | undefined;
	private readonly status: vscode.LanguageStatusItem;

	constructor(private readonly output: vscode.LogOutputChannel) {
		this.status = vscode.languages.createLanguageStatusItem("roc.server", { language: "roc" });
		this.status.name = "Roc Language Server";
		this.showStopped("Not running");
	}

	async start(executable: string): Promise<void> {
		await this.stop();

		if (!vscode.workspace.isTrusted) {
			this.output.info(`Restricted mode: formatting with ${executable} fmt, not starting the language server`);
			this.formatter = vscode.languages.registerDocumentFormattingEditProvider(documentSelector, new RocFmtFormatter(executable, this.output));
			this.status.text = "Roc: Restricted Mode";
			this.status.detail = "Trust this workspace for diagnostics, hover, completion and more";
			this.status.severity = vscode.LanguageStatusSeverity.Warning;
			this.status.command = { title: "Manage Workspace Trust", command: "workbench.trust.manage" };
			return;
		}

		const config = vscode.workspace.getConfiguration("roc");
		const args = [...config.get<string[]>("server.args", ["experimental-lsp"]), ...config.get<string[]>("server.debugFlags", [])];

		// No `transport` field: stdio without vscode-languageclient appending `--stdio`.
		const serverOptions: ServerOptions = { command: executable, args };
		const clientOptions: LanguageClientOptions = {
			documentSelector,
			// Nightlies from October 2026 only check code with this.
			initializationOptions: { trustedWorkspace: true },
			outputChannel: this.output,
		};

		this.output.info(`Starting ${executable} ${args.join(" ")}`);
		const client = new LanguageClient("roc", "Roc Language Server", serverOptions, clientOptions);
		this.client = client;
		try {
			await client.start();
		} catch (error) {
			this.client = undefined;
			await client.dispose().catch(() => undefined);
			this.showStopped("Failed to start");
			throw error;
		}

		this.status.text = `Roc ${await rocVersion(executable)}`;
		this.status.detail = executable;
		this.status.severity = vscode.LanguageStatusSeverity.Information;
		this.status.command = { title: "Restart", command: "roc.restartServer" };
	}

	async stop(): Promise<void> {
		const { client, formatter } = this;
		this.client = undefined;
		this.formatter = undefined;
		formatter?.dispose();
		if (client !== undefined) {
			try {
				await client.dispose(2000);
			} catch (error) {
				this.output.warn(`Stopping the language server failed: ${String(error)}`);
			}
		}
		if (client !== undefined || formatter !== undefined) this.showStopped("Not running");
	}

	showStopped(text: string, command?: vscode.Command): void {
		this.status.text = `Roc: ${text}`;
		this.status.detail = "";
		this.status.severity = vscode.LanguageStatusSeverity.Error;
		this.status.command = command ?? { title: "Show Output", command: "roc.showOutput" };
	}

	dispose(): void {
		void this.stop();
		this.status.dispose();
	}
}

/** Formats with `roc fmt --stdin`, which only parses, so it is safe without trust. */
class RocFmtFormatter implements vscode.DocumentFormattingEditProvider {
	constructor(
		private readonly executable: string,
		private readonly output: vscode.LogOutputChannel,
	) {}

	provideDocumentFormattingEdits(
		document: vscode.TextDocument,
		_options: vscode.FormattingOptions,
		token: vscode.CancellationToken,
	): Promise<vscode.TextEdit[]> {
		const text = document.getText();
		const whole = new vscode.Range(document.positionAt(0), document.positionAt(text.length));
		return new Promise((resolve) => {
			const options = { timeout: 10_000, maxBuffer: 64 * 1024 * 1024 };
			const child = execFile(this.executable, ["fmt", "--stdin"], options, (error, stdout, stderr) => {
				cancel.dispose();
				if (error) {
					// Syntax errors land here too.
					this.output.warn(`roc fmt failed: ${stderr.trim() || error.message}`);
					resolve([]);
				} else {
					resolve([vscode.TextEdit.replace(whole, stdout)]);
				}
			});
			const cancel = token.onCancellationRequested(() => child.kill());
			// A roc that exits without reading stdin is reported by the callback above.
			child.stdin?.on("error", () => undefined);
			child.stdin?.end(text);
		});
	}
}

/** `Roc compiler version nightly-2026-10-16-f14c106` → `nightly-2026-10-16-f14c106`. */
function rocVersion(executable: string): Promise<string> {
	return new Promise((resolve) => {
		execFile(executable, ["version"], { timeout: 10_000 }, (error, stdout) => {
			const version = stdout.trim().replace(/^Roc compiler version\s+/, "");
			resolve(error || version === "" ? "(unknown version)" : version);
		});
	});
}
