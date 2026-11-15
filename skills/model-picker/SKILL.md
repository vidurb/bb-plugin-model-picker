---
name: model-picker
description: Manage the Model Picker plugin's favorite models (the rows at the top of the composer model picker) and explain its keyboard shortcuts.
---

# Model Picker

The plugin adds a model button to every thread and new-thread composer. It opens
a picker with favorite models, search across all provider models, an Effort
submenu and a Fast toggle.

Favorites are stored on the bb server and shared by every window.

Settings → Plugins → Model Picker offers two independent, off-by-default
toggles: Show favorite model shortcuts adds a scrollable row in the composer;
Hide BB's model picker hides the native picker in expanded composers. The
plugin's own picker button remains available to manage favorites.

## CLI

- `bb model-picker list [--json]`: list favorites in shortcut order.
- `bb model-picker add <providerId> <model> [reasoningLevel]`: append a favorite.
- `bb model-picker remove <providerId> <model>`: remove a favorite.

Get provider ids and model ids from `bb provider list` and
`bb provider models <providerId>`.

## Shortcuts (rebindable in bb keyboard settings)

- Cmd+Ctrl+1…9: switch to favorite N
- Cmd+Ctrl+] / Cmd+Ctrl+[: next / previous favorite
- Cmd+Shift+/: cycle reasoning effort
- Cmd+Ctrl+M: open the picker

Switching to a favorite on another provider inside an existing thread starts
bb's normal provider handoff.
