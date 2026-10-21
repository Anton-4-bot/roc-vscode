// The VS Code side of nightlies: installing on request, remembering the install, and weekly update checks.
import { existsSync } from "node:fs";
import * as vscode from "vscode";
import { fetchLatestRelease, type InstalledNightly, installNightly, removeOtherNightlies } from "./nightly";
import { isNewerNightly, shouldCheckForUpdate } from "./platform";

const MANAGED_KEY = "roc.managedNightly";
const LAST_CHECK_KEY = "roc.lastNightlyUpdateCheck";

export function getManagedNightly(context: vscode.ExtensionContext): InstalledNightly | undefined {
	return context.globalState.get<InstalledNightly>(MANAGED_KEY);
}

/**
 * Downloads the latest nightly and makes it the managed roc. Returns the new install,
 * or undefined if cancelled, failed (already reported) or already up to date.
 */
export async function installLatestNightly(
	context: vscode.ExtensionContext,
	output: vscode.LogOutputChannel,
): Promise<InstalledNightly | undefined> {
	try {
		return await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: "Roc nightly", cancellable: true },
			async (progress, token) => {
				const abort = new AbortController();
				token.onCancellationRequested(() => abort.abort());

				progress.report({ message: "Checking for the latest release…" });
				const release = await fetchLatestRelease(abort.signal);
				const current = getManagedNightly(context);
				if (current?.tag === release.tag_name && existsSync(current.executable)) {
					void vscode.window.showInformationMessage(`Roc ${release.tag_name} is already installed.`);
					return undefined;
				}

				output.info(`Installing Roc ${release.tag_name}`);
				let reported = 0;
				const installed = await installNightly({
					release,
					storageDir: context.globalStorageUri.fsPath,
					platform: process.platform,
					arch: process.arch,
					signal: abort.signal,
					onProgress: (fraction) => {
						if (fraction === undefined) {
							progress.report({ message: "Unpacking…" });
							return;
						}
						const percent = Math.floor(fraction * 100);
						progress.report({ message: `Downloading ${release.tag_name}…`, increment: percent - reported });
						reported = percent;
					},
				});
				await context.globalState.update(MANAGED_KEY, installed);
				output.info(`Installed Roc ${installed.tag} at ${installed.executable}`);

				if (vscode.workspace.getConfiguration("roc").get<string>("path", "").trim() !== "") {
					void vscode.window.showWarningMessage(
						`Installed Roc ${installed.tag}, but the roc.path setting takes precedence over it. Clear roc.path to use the nightly.`,
					);
				} else {
					void vscode.window.showInformationMessage(`Installed Roc ${installed.tag}.`);
				}
				return installed;
			},
		);
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") return undefined;
		output.error(`Installing the Roc nightly failed: ${String(error)}`);
		void vscode.window.showErrorMessage(`Installing the Roc nightly failed: ${errorMessage(error)}`);
		return undefined;
	}
}

/** Deletes nightlies other than the managed one. Call after the server has switched executables. */
export async function cleanUpOldNightlies(context: vscode.ExtensionContext): Promise<void> {
	const managed = getManagedNightly(context);
	if (managed !== undefined) await removeOtherNightlies(context.globalStorageUri.fsPath, managed.tag);
}

/** At most once a week, offers to update the managed nightly. Never downloads without asking. */
export async function maybeOfferNightlyUpdate(
	context: vscode.ExtensionContext,
	output: vscode.LogOutputChannel,
	usingManagedNightly: boolean,
	onUpdate: () => Promise<void>,
): Promise<void> {
	const config = vscode.workspace.getConfiguration("roc");
	const installed = getManagedNightly(context);
	const due = shouldCheckForUpdate({
		enabled: config.get<boolean>("nightly.checkForUpdates", true),
		usingManagedNightly,
		lastCheck: context.globalState.get<number>(LAST_CHECK_KEY),
		now: Date.now(),
	});
	if (!due || installed === undefined) return;

	// Stamp first so a failing check (offline, rate limited) isn't retried on every window.
	await context.globalState.update(LAST_CHECK_KEY, Date.now());
	let latest: string;
	try {
		latest = (await fetchLatestRelease()).tag_name;
	} catch (error) {
		output.warn(`Checking for a newer Roc nightly failed: ${String(error)}`);
		return;
	}
	if (!isNewerNightly(latest, installed.tag)) return;

	const choice = await vscode.window.showInformationMessage(
		`A newer Roc nightly is available: ${latest} (you have ${installed.tag}).`,
		"Update Now",
		"Later",
		"Don't Check Again",
	);
	if (choice === "Update Now") {
		await onUpdate();
	} else if (choice === "Don't Check Again") {
		await config.update("nightly.checkForUpdates", false, vscode.ConfigurationTarget.Global);
	}
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
