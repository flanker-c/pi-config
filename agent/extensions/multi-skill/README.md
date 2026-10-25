# Multi-Skill for Pi

Compose multiple [Pi Coding Agent](https://pi.dev) skills in a single prompt using `$name`, with autocomplete and a separate collapsible card for each skill.

```text
$tdd $implement

Implement password reset with tests.
```

Each selected skill is loaded in order, and the full instructions reach the model together with your original task. No composite `SKILL.md` files or additional agent messages are created.

> **Status:** Early-stage, local-installable package. Tested with Pi **1.4.0**. The TUI renderer uses an internal Pi method, so compatibility must be rechecked when upgrading Pi. npm publishing is currently disabled.

## Features

- Activate one or more skills with `$name`.
- Mix same-line and multiline skill lists.
- Complete skill names with the standard Pi editor.
- Display each skill as a native, collapsible TUI card.
- Resolve skills through Pi's existing registry, including configured global and project resources.
- Cancel the entire request if any selected skill cannot be loaded.
- Keep ordinary slash commands separate from skill selection.

## Requirements

- Node.js **22.19.0 or later**.
- Pi Coding Agent; **1.4.0** is the tested development baseline.

Pi loads the TypeScript source directly. Using the extension does not require a build step or installation of development dependencies.

## Installation

From a local checkout:

```bash
pi install /absolute/path/to/multi-skill
```

To try it for one invocation without persisting the installation:

```bash
pi -e /absolute/path/to/multi-skill/index.ts
```

Alternatively, place the directory at `~/.pi/agent/extensions/multi-skill/` for automatic discovery. Use only one installation method to avoid duplicate loading.

Run `/reload` in an existing Pi session after installing or updating the extension.

## Usage

### Select a single skill

```text
$tdd Implement password reset.
```

### Combine skills on the same line

```text
$tdd $implement Implement password reset with tests.
```

### Use multiple lines

```text
$tdd $implement
$review

Implement password reset with tests.
```

The task is shared by all selected skills. Per-skill arguments are not supported.

### Autocomplete

Type `$` to list available skills, or a prefix such as `$im` to filter them. Press **Tab** to complete the current name, then add a space or newline to select another skill.

Completion works for the first skill, subsequent skills on the same line, and skills on subsequent lines within the initial list. It preserves previously entered skills.

Skill suggestions are removed from the `/` menu; ordinary slash commands remain available. A manually entered `/skill:name` at the beginning of a message is blocked with a reminder to use `$name` instead.

### TUI display

Selected skills appear in order as separate native cards, followed by the task once:

```text
[skill] tdd (ctrl+o to expand)

[skill] implement (ctrl+o to expand)

Implement password reset with tests.
```

Use Pi's expand/collapse action, **Ctrl+O** by default, to inspect the instructions.

## Syntax and behavior

| Rule | Behavior |
| --- | --- |
| Position | The skill list must start at the beginning of the message, without leading whitespace. |
| Separators | Spaces, tabs, and single LF or CRLF line breaks separate skills. |
| List boundary | Ordinary text or a blank line ends the list. Nothing after that boundary is scanned for skills. |
| Names | Names start with an ASCII letter or digit and may contain ASCII letters, digits, `.`, `_`, and `-`. |
| Order | Instructions follow the order of selection. Repeated names expand repeatedly. |
| Limit | There is no fixed skill-count limit; memory and model context limits still apply. |
| Task | The task text, including whitespace after the last skill, is preserved. An empty task is allowed. |
| Errors | An unknown skill, unreadable file, or YAML parsing failure cancels the whole request. No partial combination is submitted. |

For example:

```text
$tdd $implement Explain this example: $review
```

Only `tdd` and `implement` are activated. `$review` belongs to the task.

A blank line also ends selection:

```text
$tdd

$review is an example, not a selected skill.
```

To discuss a literal `$name` at the beginning of a message, put it in a code block or introduce it with ordinary text. A leading shell-style variable such as `$HOME` is otherwise interpreted as an explicit skill name.

## Compatibility and limitations

- **Context composition, not orchestration.** The extension does not resolve conflicting instructions, execute a workflow, or guarantee that the model follows every skill.
- **Pi remains the source of truth.** Skill discovery, trust decisions, package filtering, and name-conflict resolution are delegated to Pi. The extension does not modify the registry or original skill files. Registry entries and file contents are read for each request.
- **TUI adapter.** Sequential cards use an in-memory wrapper around the internal `InteractiveMode.addMessageToChat()` method. Installed Pi files are not modified. The adapter is installed for TUI sessions and remains attached to the process-lifetime InteractiveMode prototype so transcript replay during `/reload` and `/resume` is rendered correctly. It does not create session or model messages.
- **Message metadata.** Expanded messages include a small `pi-local-multi-skill:v1` HTML comment containing exact block lengths. This metadata is persisted and included in model context. It prevents XML examples inside instructions or the task from being mistaken for additional selected skills.
- **Existing history.** Older messages without this metadata retain Pi's original rendering. New marked messages can be rendered again without creating additional transcript entries.
- **Other clients.** HTML export and external RPC clients are not customized and may display the metadata and raw skill blocks.
- **Other extensions.** Extensions that rewrite input, replace autocomplete, or wrap the same rendering method may affect behavior. Custom editors must support Pi's autocomplete contract; this extension does not install its own editor.
- **Error reporting.** Errors are shown through UI notifications or stderr. Pi's `handled` input result does not guarantee a distinct RPC error response or nonzero CLI exit code.

## Development

The package is self-contained. It does not require a global Pi installation, neighboring repositories, or manually created dependency symlinks.

```bash
npm ci --ignore-scripts
npm run verify
```

Host packages are declared as peer dependencies for use inside Pi and pinned to **1.4.0** in development dependencies for reproducible local checks. Commit `package-lock.json`; do not commit `node_modules/`.

### Commands

| Command | Purpose |
| --- | --- |
| `npm run check` | Run strict TypeScript checking without emitting JavaScript. |
| `npm test` | Run unit tests and integration tests against the locally installed Pi. |
| `npm run check:package` | Validate npm package contents using a dry run; nothing is published. |
| `npm run verify` | Run all checks above. |

Tests import TypeScript directly through Node's type stripping. Host tests run by default and fail rather than silently skip when required dependencies are missing.

To check a different Pi module, override the host used by the renderer, editor, and expansion tests:

```bash
PI_HOST_MODULE=file:///absolute/path/to/pi-coding-agent/dist/index.js npm test
```

The loader smoke test always uses the local development dependency.

### Project structure

```text
index.ts                  Extension registration and lifecycle
core.ts                   Parsing, resolution, expansion, and input handling
autocomplete.ts           Skill completion and slash-menu filtering
renderer.ts               Message metadata and the TUI rendering adapter
tests/                    Unit tests and Pi integration tests
scripts/check-package.mjs Package contents validation
tsconfig.json             Strict, no-emit TypeScript configuration
```

Tests cover syntax boundaries, single and multiple skills, mixed separators, duplicates, error handling, task and image preservation, registry freshness, native expansion parity, real editor completion, sequential native cards (including nested skill-like XML), idempotent renderer installation, and extension loading.

Physical-terminal interaction, full interactive resume/reload flows, live RPC clients, and model requests have not been tested end to end. Checks are local; no CI workflow is included.

## Security

Extensions run with the permissions of the Pi process. Review both extension code and selected skills before use.

The last dependency audit reported **one high and one moderate finding** in the development dependency tree, involving `undici` and the pinned Pi package. The extension has no standalone runtime dependency on `undici`, but the Pi host has its own dependency-security requirements. Run `npm audit` for the current report. Do not apply a forced dependency downgrade without rechecking Pi compatibility.

## Publishing status

This package currently has `private: true` and cannot be published to npm. Before a public release:

- Choose the final package name and repository metadata.
- Choose a license and add a `LICENSE` file; none is currently provided.
- Validate and document the supported Pi version range, especially the internal renderer adapter.
- Review outstanding dependency advisories.
- Remove `private: true` only when ready to publish.

The package allowlist includes the TypeScript implementation, README, and package manifest. Development dependencies and tests are not bundled in the npm archive.

## Acknowledgments

The integration approach was informed by [pi-multi-skills](https://github.com/AleixRocal/pi-multi-skills). This extension uses its own implementation and a different interaction model: explicit `$name` selection in an initial list, with all-or-nothing expansion.
