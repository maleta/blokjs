# blokjs-check

CLI tool to validate BlokJS HTML files and report warnings.

## Install

```bash
npm i -D blokjs-check
```

## Usage

```bash
npx blokjs-check <file.html>
```

Runs BlokJS in a headless DOM (happy-dom), executes your scripts, and reports any `[blok warn]` messages.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Clean - no warnings found |
| `1` | Warnings detected |
| `2` | Error (missing argument, file not found, script failure) |

## Links

- [BlokJS](https://github.com/maleta/blokjs)
- [Issues](https://github.com/maleta/blokjs/issues)
