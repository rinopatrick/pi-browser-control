# pi-browser-control

Codex-desktop-style browser control for Pi: the agent operates a visible Chrome,
the user watches live, other tabs are undisturbed. Not computer use.

## Install

```bash
pi install ./pi-browser-control   # local, or
pi install npm:pi-browser-control # after publishing
```

Enable Chrome remote debugging, then run `/browser-setup` (from the harness) once.

## Usage

- `/bc-view` — read-only live view of the agent tab.
- `/bc-policy` — effective policy.
- Annotations: click an element on the live page, leave a comment, the agent reads it back.

## Architecture

CDP engine = harness (dependency). This layer: policy guard, command UX,
skill, annotation overlay.

## Credit

- [pi-browser-harness](https://github.com/amankumarsingh77/pi-browser-harness) — CDP engine (40 tools, ref-first, owned-tab).
- Annotation + policy patterns: `pi-browser-plus` (author's own).
