// Installs the nightly pinned in test/roc-nightly.txt with the extension's own installer into
// .vscode-test/roc and prints the roc executable path. CI uses this both to exercise the installer
// and to get a roc for the integration tests.
import { appendFileSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchRelease, installNightly, removeOtherNightlies } from "../../src/nightly";

const storageDir = fileURLToPath(new URL("../../.vscode-test/roc", import.meta.url));
const tag = readFileSync(new URL("../../test/roc-nightly.txt", import.meta.url), "utf8").trim();
const release = await fetchRelease(tag, undefined, process.env["GITHUB_TOKEN"]);
const installed = await installNightly({ release, storageDir, platform: process.platform, arch: process.arch });
await removeOtherNightlies(storageDir, installed.tag);

// A digest that doesn't match the download must be rejected.
const tampered = structuredClone(release);
for (const asset of tampered.assets) asset.digest = `sha256:${"0".repeat(64)}`;
const accepted = await installNightly({ release: tampered, storageDir, platform: process.platform, arch: process.arch }).then(
	() => true,
	(error: Error) => !error.message.startsWith("Checksum mismatch"),
);
if (accepted) throw new Error("A download with a mismatching sha256 digest was not rejected.");

console.log(`Installed ${installed.tag}: ${installed.executable}`);
if (process.env["GITHUB_OUTPUT"]) appendFileSync(process.env["GITHUB_OUTPUT"], `roc=${path.resolve(installed.executable)}\n`);
