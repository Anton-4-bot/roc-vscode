import { execFile } from "node:child_process";
import * as vscode from "vscode";
import { LanguageClient, type LanguageClientOptions, type Middleware, type ServerOptions } from "vscode-languageclient/node";

// The server refuses these without `trustedWorkspace`, because checking can download
// packages and run compile-time Roc code. Skip them client side instead of logging errors.
const skip = () => undefined;
const restrictedModeMiddleware: Middleware = {
	provideHover: skip,
	provideDefinition: skip,
	provideCompletionItem: skip,
	provideDocumentSymbols: skip,
	provideDocumentHighlights: skip,
	provideReferences: skip,
	prepareRename: skip,
	provideRenameEdits: skip,
	provideInlayHints: skip,
	provideCodeActions: skip,
	provideDocumentSemanticTokens: skip,
};

/** Owns the language client for one roc executable at a time. */
export class RocLanguageServer implements vscode.Disposable {
	private client: LanguageClient | undefined;
	private readonly status: vscode.LanguageStatusItem;

	constructor(private readonly output: vscode.LogOutputChannel) {
		this.status = vscode.languages.createLanguageStatusItem("roc.server", { language: "roc" });
		this.status.name = "Roc Language Server";
		this.showStopped("Not running");
	}

	async start(executable: string): Promise<void> {
		await this.stop();

		const config = vscode.workspace.getConfiguration("roc");
		const args = [...config.get<string[]>("server.args", ["experimental-lsp"]), ...config.get<string[]>("server.debugFlags", [])];
		const trusted = vscode.workspace.isTrusted;

		// No `transport` field: stdio without vscode-languageclient appending `--stdio`.
		const serverOptions: ServerOptions = { command: executable, args };
		const clientOptions: LanguageClientOptions = {
			documentSelector: [
				{ scheme: "file", language: "roc" },
				{ scheme: "untitled", language: "roc" },
			],
			initializationOptions: { trustedWorkspace: trusted },
			outputChannel: this.output,
			...(trusted ? {} : { middleware: restrictedModeMiddleware }),
		};

		this.output.info(`Starting ${executable} ${args.join(" ")} (${trusted ? "trusted" : "restricted mode"})`);
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

		const version = await rocVersion(executable);
		this.status.text = trusted ? `Roc ${version}` : "Roc: Restricted Mode";
		this.status.detail = trusted ? executable : "Trust this workspace for diagnostics, hover, completion and more";
		this.status.severity = trusted ? vscode.LanguageStatusSeverity.Information : vscode.LanguageStatusSeverity.Warning;
		this.status.command = trusted
			? { title: "Restart", command: "roc.restartServer" }
			: { title: "Manage Workspace Trust", command: "workbench.trust.manage" };
	}

	async stop(): Promise<void> {
		const client = this.client;
		this.client = undefined;
		if (client === undefined) return;
		try {
			await client.dispose(2000);
		} catch (error) {
			this.output.warn(`Stopping the language server failed: ${String(error)}`);
		}
		this.showStopped("Not running");
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

/** `Roc compiler version nightly-2026-10-16-f14c106` → `nightly-2026-10-16-f14c106`. */
function rocVersion(executable: string): Promise<string> {
	return new Promise((resolve) => {
		execFile(executable, ["version"], { timeout: 10_000 }, (error, stdout) => {
			const version = stdout.trim().replace(/^Roc compiler version\s+/, "");
			resolve(error || version === "" ? "(unknown version)" : version);
		});
	});
}
