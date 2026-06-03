# Windows Setup

This repository can be used from Windows without WSL. The supported entrypoints
are the npm commands from [README.md](../README.md).

## Prerequisites

Install these tools first:

- Node.js with `npm`
- Python 3
- Typst if you want PDF output from `study-build`

After installation, open a new PowerShell window and verify:

```powershell
node --version
npm --version
python --version
```

## First Setup

From the repository root:

```powershell
npm install
npm run browser:install
python -m pip install -r requirements.txt
```

Create `.env` from `.env.example` and fill in the Moodle credentials.

## PowerShell Commands

Use these commands in PowerShell:

```powershell
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

If Windows resolves the wrong interpreter, set `PYTHON` explicitly in the
current PowerShell session:

```powershell
$env:PYTHON = "C:\Path\To\python.exe"
```

Then rerun the npm command.

## Common Windows Notes

- Use `npm run ...` commands instead of `scripts/*.sh`. The shell scripts are
  Unix wrappers.
- `agent-browser` is resolved from `node_modules\.bin` automatically, including
  Windows shims such as `.cmd`.
- Paths with spaces are supported by the npm launcher and provider tests.
- Generated files still go to `output\`, cached Moodle files to `data\moodle\`,
  and local indexes to `state\`.

## Troubleshooting

If `python` is not found:

```powershell
py -3 --version
```

If that works, the npm launcher should also work. If not, set `PYTHON`
explicitly for the session.

If `npm run browser:install` succeeds but browser commands still fail, run:

```powershell
npm run providers
npm run py -- -m uni_agent.orchestrator --help
```

That separates Python launcher problems from Moodle or browser issues.
