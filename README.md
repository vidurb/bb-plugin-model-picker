# bb-plugin-model-picker

A [bb](https://getbb.app) plugin that adds a favorite-model picker to every
thread and New Thread composer.

- **Composer button** showing the current model, effort, and Fast state.
- **Picker popup** with model search across all providers, favorite models
  (each remembers its own effort, drag to reorder), **Add models**, an
  **Effort** submenu, a **Fast** toggle, and **Edit** to remove favorites.
- Favorites are stored on the bb server, so every window and device shares them.

## Optional composer layout

In Settings → Plugins → Model Picker, enable **Show favorite model shortcuts**
to add a horizontally scrolling row, and **Hide BB's model picker** to hide
BB's native picker. Both default to off. The plugin's own button remains
available for managing favorites and changing effort. Short labels show the
full provider and model name on hover and to screen readers. Scroll the row
with a trackpad, mouse wheel, or by focusing it and using the arrow keys.

The row and native picker visibility use BB's composer action-row markers and
the native picker's accessible label; a future BB layout change may require an update.

## Keyboard shortcuts

You can rebind these in bb's keyboard settings.

| Keys | Action |
| --- | --- |
| ⌘⌃1 … ⌘⌃9 | Switch to favorite model N |
| ⌘⌃] / ⌘⌃[ | Next / previous favorite |
| ⌘⇧/ | Cycle reasoning effort |
| ⌘⌃M | Open the picker |

Switching to a favorite on another provider inside an existing thread starts
bb's normal provider handoff.

## Install

```sh
bb plugin install https://github.com/incpo/bb-plugin-model-picker
```

## CLI

```sh
bb model-picker list [--json]
bb model-picker add <providerId> <model> [reasoningLevel]
bb model-picker remove <providerId> <model>
```

Get provider and model ids from `bb provider list` and `bb provider models <providerId>`.

## Development

```sh
npm install
bb plugin build .
bb plugin install .
bb plugin dev        # rebuild and reload on save
```
