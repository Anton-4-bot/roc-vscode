Work In Progress.

# Roc for Visual Studio Code

Official [Roc](https://www.roc-lang.org) language support, powered by the language server built into the `roc` compiler.

## Features

- Syntax highlighting, including Roc code blocks in doc comments and Markdown files
- Diagnostics as you type
- Formatting (format on save is on by default for Roc files)
- Hover with inferred types, go to definition, find references, document highlights
- Completion, rename, document symbols, folding and selection ranges
- Inlay hints for inferred types
- Code actions: annotate a binding with its inferred type, generate an `expect` test for a function
- Semantic highlighting
- **Roc: Run File** and **Roc: Test File** from the editor title bar, and a `roc` task type

The language server is still experimental, so expect rough edges. Please report problems in the [roc repo](https://github.com/roc-lang/roc/issues) (language server) or [here](https://github.com/roc-lang/roc-vscode/issues) (extension).

## Thanks

Thanks to [Luke Boswell](https://github.com/lukewilliamboswell), whose [roc-vscode](https://github.com/lukewilliamboswell/roc-vscode) showed how to test the packaged VSIX, and inspired the language feature, editing and server lifecycle tests here.

## Getting `roc`

The extension uses the first `roc` it finds:

1. the `roc.path` setting
2. the nightly installed by this extension
3. `roc` on your `PATH`

If there is none, it offers to download the latest nightly from [roc-lang/nightlies](https://github.com/roc-lang/nightlies). Downloads are checked against the sha256 digest GitHub publishes for the release asset. You can also run **Roc: Install or Update Nightly** at any time. While you use the nightly installed by the extension, it checks once a week whether a newer one exists and asks before updating; turn this off with `roc.nightly.checkForUpdates`.

## Workspace trust

Checking Roc code can download packages and run compile-time Roc code, so semantic features only run in [trusted workspaces](https://code.visualstudio.com/docs/editor/workspace-trust). In restricted mode the extension still highlights, formats and folds. Trusting the workspace restarts the language server with all features enabled.

In restricted mode, `roc.path` and `roc.server.args` are only read from your user settings, so a repository can't choose which program runs.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `roc.path` | `""` | Path to the `roc` executable. `~` and `${userHome}` are expanded. |
| `roc.server.args` | `["experimental-lsp"]` | Arguments that start the language server. |
| `roc.server.debugFlags` | `[]` | Any of `--debug-transport`, `--debug-build`, `--debug-syntax`, `--debug-server`. The log file path appears in the **Roc** output. Transport logs contain your source code. |
| `roc.nightly.checkForUpdates` | `true` | Weekly update check for the nightly installed by the extension. |
| `roc.trace.server` | `"off"` | Log language server messages to the **Roc** output. |

## Tasks

```jsonc
// .vscode/tasks.json
{
	"version": "2.0.0",
	"tasks": [
		{ "type": "roc", "command": "test", "file": "main.roc", "label": "roc test" },
		{ "type": "roc", "command": "run", "file": "main.roc", "args": ["--", "arg1"], "label": "roc run" }
	]
}
```

## Development

```sh
npm ci                    # install pinned dependencies (install scripts are disabled in .npmrc)
npm run check             # typecheck
npm test                  # unit tests and grammar snapshot tests
npm run test:nightly      # install the nightly pinned in test/roc-nightly.txt into .vscode-test/roc with the extension's installer
ROC_PATH=/path/to/roc npm run test:integration  # package, install and test the VSIX in a real VS Code
npm run package           # build roc-<version>.vsix
```

The integration tests install the packaged VSIX into a fresh VS Code profile, so packaging mistakes show up. They run once in a trusted and once in a restricted workspace, and check language features, editing, and restarting and stopping the language server. `ROC_VSIX` tests an existing VSIX instead of packaging one, `VSCODE_VERSION` picks the VS Code build, and `ROC_TEST_GREP` runs only the tests whose name contains it. CI also checks the VSIX contents against `test/vsix-files.txt`.

Press <kbd>F5</kbd> to try changes in a new VS Code window.

The TextMate grammar lives in `syntaxes/roc.tmLanguage.json`. After changing it, run `npm run test:grammar -- --update` and review the snapshot diff in `test/grammar/fixtures/`.

Dependencies are deliberately few: `vscode-languageclient` at runtime, and Microsoft's or esbuild's own tooling for development. New versions are only adopted once they have been published for at least two weeks.
