# bb-plugin-model-picker

A [bb](https://getbb.app) plugin that adds a favorite-model picker to every
thread and New Thread composer.

- **Composer button** showing the current model, effort, and Fast state.
- **Picker popup** with model search across all providers, favorite models
  (each remembers its own effort, drag to reorder), **Add models**, an
  **Effort** submenu, a **Fast** toggle, and **Edit** to remove favorites.
- Favorites are stored on the bb server, so every window and device shares them.
- Favorite shortcuts appear beside BB's native model picker. The row scrolls
  horizontally when there is not enough room, and the current favorite is highlighted.

This fork adds the shortcut row while retaining the original popup for managing
favorites. It uses BB's composer action-row markers and the native picker's
accessible label to place the row; a future BB layout change may require an update.

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
