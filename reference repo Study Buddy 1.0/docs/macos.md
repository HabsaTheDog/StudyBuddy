# macOS Setup

This repository can be used directly on macOS. The supported entrypoints are
the npm commands from [README.md](../README.md).

## Prerequisites

Install these tools first:

- Node.js with `npm`
- Python 3
- Typst if you want PDF output from `study-build`

Homebrew is the simplest setup path on macOS:

```bash
brew install node python typst
```

After installation, open a new Terminal window and verify:

```bash
node --version
npm --version
python3 --version
```

## First Setup

From the repository root:

```bash
npm install
npm run browser:install
python3 -m pip install -r requirements.txt
```

Create `.env` from `.env.example` and fill in the Moodle credentials.

## Common Commands

Use these commands in Terminal:

```bash
npm run moodle:login
npm run moodle:snapshot -- https://moodle.technikum-wien.at/my/
npm run moodle:courses
npm run moodle:sync
npm run moodle:sync -- --no-download
npm run study:buddy -- "find the next math quiz"
npm run study:buddy -- "do the next math quiz"
npm run study:build -- "DYN2 Formelsammlung" --format markdown+pdf
npm run quiz:assist -- "https://moodle.technikum-wien.at/mod/quiz/view.php?id=123"
```

The double `--` matters when you pass arguments through `npm run`.

## Python Selection

The npm entrypoints use `scripts/run_python.js` and try these interpreters in
order:

1. `PYTHON`
2. `python3`
3. `python`
4. `py -3`

On macOS, `python3` is normally the correct interpreter. If the launcher picks
the wrong one, set `PYTHON` explicitly in the current shell:

```bash
export PYTHON="$(which python3)"
```

Then rerun the npm command.

## Common macOS Notes

- Use `npm run ...` commands instead of `scripts/*.sh` if you want the same
  documented path as Windows and Linux.
- The Unix shell wrappers still work on macOS, but the npm entrypoints are the
  intended cross-platform interface.
- `agent-browser` is resolved from `node_modules/.bin` automatically.
- Both Apple Silicon and Intel Macs should work as long as Node.js and Python 3
  are installed normally.

## Troubleshooting

If `python3` works but `pip` does not:

```bash
python3 -m pip --version
```

Use `python3 -m pip ...` instead of a standalone `pip3` command.

If `npm run browser:install` succeeds but browser commands still fail, run:

```bash
npm run providers
npm run py -- -m uni_agent.orchestrator --help
```

That separates Python launcher problems from Moodle or browser issues.
