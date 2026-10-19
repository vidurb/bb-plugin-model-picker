// bb-plugin-model-picker — frontend entry.
//
// A composer button showing the selected model, a picker popup with favorite
// models, search, an effort submenu and a Fast toggle, and keyboard commands:
//   Cmd+Ctrl+1…9   switch to favorite N
//   Cmd+Ctrl+] / [ next / previous favorite
//   Cmd+Shift+/    cycle reasoning effort
//   Cmd+Ctrl+M     open the picker
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import * as Popover from "@radix-ui/react-popover";
import { toast } from "sonner";
import {
  definePluginApp,
  experimental_ProviderIcon as ProviderIcon,
  experimental_useProviders as useProviders,
  useComposer,
  useRealtime,
  useRpc,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import type { ComposerSelection, PluginComposerApi } from "@get-bb/plugin-sdk/app";
import type { Favorite, rpcContract } from "./server";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { usePortalScopeProps } from "@/lib/portal-scope";
import {
  type CatalogModel,
  type Routing,
  connect,
  effortLabel,
  effortsOf,
  getFavorites,
  getSdk,
  hasFastTier,
  loadFavorites,
  loadModels,
  rememberSelection,
  routingFor,
  sameModel,
  setFavorites,
  useFavorites,
} from "@/lib/store";

const POPUP_ID = "model-picker";
/** Must match FAVORITES_CHANGED in server.ts (type-only import keeps server code out of the bundle). */
const FAVORITES_CHANGED = "favorites-changed";

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/u.test(navigator.platform);

type Provider = ReturnType<typeof useProviders>["providers"][number];
type ModelsByProvider = Record<string, CatalogModel[] | undefined>;

// ---------------------------------------------------------------------------
// Shared hooks

/** Hand the RPC and SDK clients to the store and keep favorites current. */
function useConnect() {
  const rpc = useRpc<typeof rpcContract>();
  const sdk = useSdk();
  useEffect(() => connect({ rpc, sdk }), [rpc, sdk]);
  useRealtime(FAVORITES_CHANGED, () => void loadFavorites(true));
}

function useRouting(composer: PluginComposerApi): Routing | null {
  const [routing, setRouting] = useState<Routing | null>(null);
  const scopeKey = JSON.stringify(composer.scope);
  useEffect(() => {
    let live = true;
    void routingFor(composer).then((next) => live && setRouting(next));
    return () => {
      live = false;
    };
    // composer is a stable handle; scopeKey tracks what routingFor reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);
  return routing;
}

function useModels(
  routing: Routing | null,
  providerIds: readonly string[],
): ModelsByProvider {
  const [models, setModels] = useState<ModelsByProvider>({});
  const idsKey = [...new Set(providerIds)].sort().join(",");
  const routingKey = JSON.stringify(routing);
  useEffect(() => {
    if (routing === null) return;
    let live = true;
    for (const providerId of idsKey.split(",").filter(Boolean)) {
      void loadModels(routing, providerId).then((list) => {
        if (live) setModels((prev) => ({ ...prev, [providerId]: list }));
      });
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, routingKey]);
  return models;
}

function findModel(
  models: ModelsByProvider,
  target: { providerId?: string; model?: string },
): CatalogModel | undefined {
  if (!target.providerId || !target.model) return undefined;
  return models[target.providerId]?.find(
    (m) => m.model === target.model || m.id === target.model,
  );
}

function selectionFor(favorite: Favorite): ComposerSelection {
  const selection: ComposerSelection = {
    providerId: favorite.providerId,
    model: favorite.model,
  };
  if (favorite.reasoningLevel) selection.reasoningLevel = favorite.reasoningLevel;
  if (favorite.serviceTier) selection.serviceTier = favorite.serviceTier;
  return selection;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

// ---------------------------------------------------------------------------
// Composer button

function ModelButton() {
  useConnect();
  const composer = useComposer();
  const selection = composer.selection;
  const routing = useRouting(composer);
  const { providers } = useProviders();
  const models = useModels(
    routing,
    selection?.providerId ? [selection.providerId] : [],
  );
  if (selection === null || !selection.providerId) return null;
  const provider = providers.find((p) => p.id === selection.providerId);
  const model = findModel(models, selection);
  const name = model?.displayName ?? selection.model ?? "Model";
  const fast = selection.serviceTier === "fast";
  return (
    <button
      type="button"
      className="flex h-8 min-w-0 max-w-[16rem] items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground hover:bg-state-hover hover:text-foreground"
      title={`Model picker (${isMac ? "⌘⌃M" : "Win+Ctrl+M"})`}
      aria-label={`Model: ${name}, effort ${effortLabel(selection.reasoningLevel)}`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => composer.experimental_openPopup(POPUP_ID)}
    >
      <ProviderIcon
        providerKind="agent"
        provider={provider ?? { id: selection.providerId }}
        className="size-4 shrink-0"
        aria-hidden
      />
      <span className="truncate text-foreground">{name}</span>
      {selection.reasoningLevel ? (
        <span className="shrink-0 text-subtle-foreground">
          {effortLabel(selection.reasoningLevel)}
        </span>
      ) : null}
      {fast ? <Icon name="Zap" className="size-3.5 shrink-0" /> : null}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Picker popup

type Row =
  | { kind: "model"; key: string; providerId: string; model: string }
  | { kind: "add"; key: "add" };

function ModelPickerPopup() {
  useConnect();
  const composer = useComposer();
  const selection = composer.selection;
  const routing = useRouting(composer);
  const providersState = useProviders();
  const providers = useMemo(
    () => providersState.providers.filter((p) => p.available),
    [providersState.providers],
  );
  const favorites = useFavorites();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"main" | "add">("main");
  const [editing, setEditing] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [effortOpen, setEffortOpen] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef<Array<HTMLElement | null>>([]);
  const portalProps = usePortalScopeProps();

  const searching = query.trim().length > 0;
  const browseAll = searching || view === "add";
  const wantedProviders = browseAll
    ? providers.map((p) => p.id)
    : [
        ...(favorites ?? []).map((f) => f.providerId),
        ...(selection?.providerId ? [selection.providerId] : []),
      ];
  const models = useModels(routing, wantedProviders);
  const current = selection ? findModel(models, selection) : undefined;
  const catalogsLoading = providers.some((p) => models[p.id] === undefined);

  // First run: seed the favorites with whatever the composer has selected.
  useEffect(() => {
    if (favorites === null || favorites.length > 0) return;
    if (!selection?.providerId || !selection.model) return;
    void setFavorites([
      {
        providerId: selection.providerId,
        model: selection.model,
        reasoningLevel: selection.reasoningLevel,
        serviceTier: selection.serviceTier,
      },
    ]).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favorites === null]);

  const providerById = (id: string): Provider | undefined =>
    providersState.providers.find((p) => p.id === id);

  const rows: Row[] = useMemo(() => {
    if (browseAll) {
      const parts = query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
      const out: Row[] = [];
      for (const provider of providers) {
        for (const model of models[provider.id] ?? []) {
          const haystack =
            `${model.displayName} ${model.model} ${provider.displayName}`.toLowerCase();
          if (!parts.every((part) => haystack.includes(part))) continue;
          out.push({
            kind: "model",
            key: `${provider.id}/${model.model}`,
            providerId: provider.id,
            model: model.model,
          });
        }
      }
      return out;
    }
    return [
      ...(favorites ?? []).map(
        (f): Row => ({
          kind: "model",
          key: `${f.providerId}/${f.model}`,
          providerId: f.providerId,
          model: f.model,
        }),
      ),
      { kind: "add", key: "add" },
    ];
  }, [browseAll, query, providers, models, favorites]);

  const active = Math.min(highlighted, Math.max(rows.length - 1, 0));
  useEffect(() => {
    rowRefs.current[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);
  useEffect(() => setHighlighted(0), [query, view]);
  useEffect(() => {
    inputRef.current?.focus();
  }, [view]);

  const favoriteFor = (providerId: string, model: string) =>
    (favorites ?? []).find((f) => sameModel(f, { providerId, model }));

  async function apply(next: ComposerSelection, close: boolean) {
    setBusy(true);
    try {
      const result = await composer.setSelection(next);
      rememberSelection(result);
      if (close) composer.experimental_closePopup();
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  function toggleFavorite(providerId: string, model: string) {
    const list = favorites ?? [];
    const existing = favoriteFor(providerId, model);
    const next = existing
      ? list.filter((f) => f !== existing)
      : [...list, { providerId, model }];
    setFavorites(next).catch((cause) => toast.error(errorMessage(cause)));
  }

  function activate(row: Row | undefined) {
    if (row === undefined) return;
    if (row.kind === "add") {
      setView("add");
      setQuery("");
      return;
    }
    if (view === "add") {
      toggleFavorite(row.providerId, row.model);
      return;
    }
    const favorite = favoriteFor(row.providerId, row.model);
    void apply(
      favorite
        ? selectionFor(favorite)
        : { providerId: row.providerId, model: row.model },
      true,
    );
  }

  function move(from: number, to: number) {
    const list = [...(favorites ?? [])];
    const [item] = list.splice(from, 1);
    if (item === undefined) return;
    list.splice(to, 0, item);
    setFavorites(list).catch((cause) => toast.error(errorMessage(cause)));
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (rows.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlighted((active + step + rows.length) % rows.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      activate(rows[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (searching) setQuery("");
      else if (view === "add") setView("main");
      else composer.experimental_closePopup();
    } else if (
      event.key === "ArrowRight" &&
      view === "main" &&
      event.currentTarget.value === ""
    ) {
      event.preventDefault();
      setEffortOpen(true);
    }
  }

  const efforts = effortsOf(current);
  const fastSupported = hasFastTier(current);
  const fastOn = selection?.serviceTier === "fast";
  const currentProviderId = selection?.providerId;
  const threadScope = composer.scope.kind !== "new-thread";

  const renderModelRow = (
    row: Extract<Row, { kind: "model" }>,
    index: number,
  ) => {
    const model = findModel(models, row);
    const provider = providerById(row.providerId);
    const favorite = favoriteFor(row.providerId, row.model);
    const isCurrent = selection ? sameModel(selection, row) : false;
    const favoriteIndex =
      favorite === undefined ? -1 : (favorites ?? []).indexOf(favorite);
    const showHandle = !browseAll && favorite !== undefined;
    const handoff =
      threadScope &&
      currentProviderId !== undefined &&
      row.providerId !== currentProviderId;
    const effort =
      favorite?.reasoningLevel ??
      (isCurrent ? selection?.reasoningLevel : undefined);
    const shortcut =
      !browseAll && favoriteIndex >= 0 && favoriteIndex < 9
        ? favoriteIndex + 1
        : null;
    return (
      <div
        key={row.key}
        ref={(el) => {
          rowRefs.current[index] = el;
        }}
        role="option"
        aria-selected={index === active}
        onMouseMove={() => index !== active && setHighlighted(index)}
        onDragOver={(event) => {
          if (dragIndex === null || !showHandle) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={(event) => {
          if (dragIndex === null || !showHandle) return;
          event.preventDefault();
          move(dragIndex, favoriteIndex);
          setDragIndex(null);
        }}
        className={cn(
          "group flex h-10 shrink-0 items-center gap-2 rounded-lg pr-2.5 text-sm",
          showHandle ? "pl-0.5" : "pl-2.5",
          index === active && "bg-state-hover",
          dragIndex !== null && dragIndex === favoriteIndex && "opacity-50",
        )}
      >
        {showHandle ? (
          <span
            draggable
            onDragStart={(event) => {
              setDragIndex(favoriteIndex);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", row.key);
            }}
            onDragEnd={() => setDragIndex(null)}
            title="Drag to reorder"
            className="flex h-full w-5 shrink-0 cursor-grab items-center justify-center text-subtle-foreground active:cursor-grabbing"
          >
            <Icon name="DragDropVertical" className="size-3.5" />
          </span>
        ) : null}
        <button
          type="button"
          tabIndex={-1}
          disabled={busy}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => activate(row)}
          className="flex h-full min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <ProviderIcon
            providerKind="agent"
            provider={provider ?? { id: row.providerId }}
            className="size-4 shrink-0"
            aria-hidden
          />
          <span className="truncate text-foreground">
            {model?.displayName ?? row.model}
          </span>
          {browseAll ? (
            <span className="truncate text-xs text-subtle-foreground">
              {provider?.displayName ?? row.providerId}
            </span>
          ) : effort ? (
            <span className="shrink-0 text-xs text-subtle-foreground">
              {effortLabel(effort)}
            </span>
          ) : null}
        </button>
        {editing && showHandle ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Remove ${model?.displayName ?? row.model}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => toggleFavorite(row.providerId, row.model)}
            className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-state-active hover:text-foreground"
          >
            <Icon name="X" className="size-3.5" />
          </button>
        ) : view === "add" ? (
          favorite ? (
            <Icon name="Check" className="size-4 shrink-0 text-foreground" />
          ) : (
            <Icon name="Plus" className="size-4 shrink-0 text-muted-foreground" />
          )
        ) : (
          <>
            {shortcut !== null && index === active && !isCurrent ? (
              <kbd className="shrink-0 font-sans text-xs text-subtle-foreground">
                {isMac ? `⌘⌃${shortcut}` : `Win+Ctrl+${shortcut}`}
              </kbd>
            ) : null}
            {isCurrent ? (
              <Icon name="Check" className="size-4 shrink-0 text-foreground" />
            ) : handoff ? (
              <Icon
                name="ArrowUpRight"
                className="size-4 shrink-0 text-muted-foreground"
                aria-label="Hands off to a new thread"
              />
            ) : null}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5 p-1.5">
      <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center gap-2.5 border-b border-border px-3 py-2.5">
          {view === "add" ? (
            <button
              type="button"
              aria-label="Back"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setView("main");
                setQuery("");
              }}
              className="flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            >
              <Icon name="ArrowLeft" className="size-4" />
            </button>
          ) : (
            <Icon name="Search" className="size-4 shrink-0 text-muted-foreground" />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={view === "add" ? "Search models to add" : "Search models"}
            aria-label="Search models"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-subtle-foreground"
          />
        </div>

        <div
          role="listbox"
          aria-label="Models"
          className="flex max-h-72 flex-col overflow-y-auto p-1"
        >
          {favorites === null || (browseAll && catalogsLoading && rows.length === 0) ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              Loading models…
            </div>
          ) : browseAll && rows.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              No models match.
            </div>
          ) : null}
          {rows.map((row, index) =>
            row.kind === "add" ? (
              <button
                key="add"
                ref={(el) => {
                  rowRefs.current[index] = el;
                }}
                type="button"
                tabIndex={-1}
                onMouseMove={() => index !== active && setHighlighted(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => activate(row)}
                className={cn(
                  "flex h-10 shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-left text-sm text-muted-foreground",
                  index === active && "bg-state-hover text-foreground",
                )}
              >
                <Icon name="Plus" className="size-4 shrink-0" />
                <span className="flex-1">Add models</span>
                <Icon name="ArrowUpRight" className="size-4 shrink-0" />
              </button>
            ) : (
              renderModelRow(row, index)
            ),
          )}
        </div>

        {view === "main" && !searching ? (
          <div className="flex flex-col border-t border-border p-1">
            <Popover.Root open={effortOpen} onOpenChange={setEffortOpen}>
              <Popover.Trigger asChild>
                <button
                  type="button"
                  disabled={efforts.length === 0 || busy}
                  onMouseDown={(event) => event.preventDefault()}
                  className={cn(
                    "flex h-10 items-center rounded-lg px-2.5 text-left text-sm hover:bg-state-hover disabled:opacity-50 disabled:hover:bg-transparent",
                    effortOpen && "bg-state-hover",
                  )}
                >
                  <span className="flex-1 text-foreground">Effort</span>
                  <span className="text-muted-foreground">
                    {effortLabel(selection?.reasoningLevel)}
                  </span>
                  <Icon
                    name="ChevronRight"
                    className="ml-1.5 size-4 text-muted-foreground"
                  />
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  {...portalProps}
                  side="right"
                  align="start"
                  sideOffset={10}
                  collisionPadding={8}
                  onOpenAutoFocus={(event) => event.preventDefault()}
                  onCloseAutoFocus={(event) => {
                    event.preventDefault();
                    inputRef.current?.focus();
                  }}
                  className="z-50 w-56 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg"
                >
                  <EffortList
                    efforts={efforts}
                    value={selection?.reasoningLevel}
                    onPick={(reasoningLevel) => {
                      setEffortOpen(false);
                      void apply({ reasoningLevel }, false);
                    }}
                    onClose={() => setEffortOpen(false)}
                  />
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
            <div
              className={cn(
                "flex h-10 items-center rounded-lg px-2.5 text-sm",
                !fastSupported && "opacity-50",
              )}
            >
              <span className="flex-1 text-foreground">Fast</span>
              <button
                type="button"
                role="switch"
                aria-checked={fastOn}
                aria-label="Fast mode"
                disabled={!fastSupported || busy}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() =>
                  void apply({ serviceTier: fastOn ? "default" : "fast" }, false)
                }
                className={cn(
                  "relative h-6 w-10 shrink-0 rounded-full border border-border transition-colors",
                  fastOn ? "bg-primary" : "bg-state-active",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 size-[1.125rem] rounded-full bg-background shadow transition-[left]",
                    fastOn ? "left-[1.1rem]" : "left-0.5",
                  )}
                />
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between px-1.5 pb-0.5 text-sm text-muted-foreground">
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setEditing((value) => !value);
            setView("main");
            setQuery("");
          }}
          className={cn(
            "flex items-center gap-1.5 rounded px-1 py-0.5 hover:text-foreground",
            editing && "text-foreground",
          )}
        >
          <Icon name={editing ? "Check" : "Settings"} className="size-3.5" />
          {editing ? "Done" : "Edit"}
        </button>
        <span className="flex items-center gap-2">
          <kbd className="rounded-md border border-border px-1.5 py-0.5 font-sans text-xs">
            {isMac ? "⌘⇧/" : "Ctrl+Shift+/"}
          </kbd>
          Cycle effort
        </span>
      </div>
    </div>
  );
}

function EffortList({
  efforts,
  value,
  onPick,
  onClose,
}: {
  efforts: string[];
  value: string | undefined;
  onPick: (effort: string) => void;
  onClose: () => void;
}) {
  const [active, setActive] = useState(() =>
    Math.max(efforts.indexOf(value ?? ""), 0),
  );
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => listRef.current?.focus(), []);
  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Effort"
      tabIndex={-1}
      className="flex flex-col outline-none"
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const step = event.key === "ArrowDown" ? 1 : -1;
          setActive((i) => (i + step + efforts.length) % efforts.length);
        } else if (event.key === "Enter") {
          event.preventDefault();
          const effort = efforts[active];
          if (effort) onPick(effort);
        } else if (event.key === "ArrowLeft" || event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {efforts.map((effort, index) => (
        <button
          key={effort}
          type="button"
          role="option"
          aria-selected={effort === value}
          tabIndex={-1}
          onMouseMove={() => index !== active && setActive(index)}
          onClick={() => onPick(effort)}
          className={cn(
            "flex h-10 items-center rounded-lg px-3 text-left text-sm text-foreground",
            index === active && "bg-state-hover",
          )}
        >
          <span className="flex-1">{effortLabel(effort)}</span>
          {effort === value ? <Icon name="Check" className="size-4" /> : null}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Keyboard commands

async function catalogFor(
  composer: PluginComposerApi,
  providerId: string,
): Promise<CatalogModel[]> {
  return loadModels(await routingFor(composer), providerId);
}

async function announce(
  composer: PluginComposerApi,
  selection: ComposerSelection,
) {
  let name = selection.model ?? "Model";
  if (selection.providerId && selection.model) {
    const list = await catalogFor(composer, selection.providerId);
    name =
      list.find((m) => m.model === selection.model || m.id === selection.model)
        ?.displayName ?? name;
  }
  const parts = [name];
  if (selection.reasoningLevel) parts.push(effortLabel(selection.reasoningLevel));
  if (selection.serviceTier === "fast") parts.push("Fast");
  toast(parts.join(" · "), { duration: 1500 });
}

async function switchFavorite(
  composer: PluginComposerApi,
  pick: (favorites: Favorite[], currentIndex: number) => Favorite | undefined,
) {
  const selection = composer.selection;
  if (selection === null) return;
  if (getSdk() === null) {
    // Nothing mounted yet (compact composer): the popup connects the store.
    composer.experimental_openPopup(POPUP_ID);
    return;
  }
  const favorites = getFavorites() ?? (await loadFavorites());
  if (favorites.length === 0) {
    toast("No favorite models yet. Add some in the model picker.");
    return;
  }
  const index = favorites.findIndex((f) => sameModel(f, selection));
  const target = pick(favorites, index);
  if (target === undefined || (index >= 0 && favorites[index] === target)) {
    return;
  }
  try {
    const result = await composer.setSelection(selectionFor(target));
    void announce(composer, result);
  } catch (cause) {
    toast.error(errorMessage(cause));
  }
}

async function cycleEffort(composer: PluginComposerApi) {
  const selection = composer.selection;
  if (!selection?.providerId || !selection.model) return;
  if (getSdk() === null) {
    composer.experimental_openPopup(POPUP_ID);
    return;
  }
  const list = await catalogFor(composer, selection.providerId);
  const model = list.find(
    (m) => m.model === selection.model || m.id === selection.model,
  );
  const efforts = effortsOf(model);
  if (efforts.length < 2) return;
  const index = efforts.indexOf(selection.reasoningLevel ?? "");
  const next = efforts[(index + 1) % efforts.length];
  if (next === undefined) return;
  try {
    const result = await composer.setSelection({ reasoningLevel: next });
    rememberSelection(result);
    void announce(composer, result);
  } catch (cause) {
    toast.error(errorMessage(cause));
  }
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: "model-picker",
    scopes: ["thread", "new-thread"],
    actions: [{ id: "model-button", component: ModelButton }],
    experimental_popups: [
      { id: POPUP_ID, label: "Model picker", component: ModelPickerPopup },
    ],
  });

  app.composer.experimental_registerCommand({
    id: "open-picker",
    title: "Open model picker",
    defaultShortcut: { key: "m", meta: true, control: true },
    run: ({ composer }) => {
      composer.experimental_openPopup(POPUP_ID);
    },
  });

  app.composer.experimental_registerCommand({
    id: "next-model",
    title: "Next favorite model",
    defaultShortcut: { key: "]", meta: true, control: true },
    run: ({ composer }) =>
      switchFavorite(composer, (list, i) => list[(i + 1) % list.length]),
  });

  app.composer.experimental_registerCommand({
    id: "previous-model",
    title: "Previous favorite model",
    defaultShortcut: { key: "[", meta: true, control: true },
    run: ({ composer }) =>
      switchFavorite(composer, (list, i) => list[(i <= 0 ? list.length : i) - 1]),
  });

  for (let n = 1; n <= 9; n += 1) {
    app.composer.experimental_registerCommand({
      id: `favorite-${n}`,
      title: `Switch to favorite model ${n}`,
      defaultShortcut: { key: String(n), meta: true, control: true },
      run: ({ composer }) => switchFavorite(composer, (list) => list[n - 1]),
    });
  }

  app.composer.experimental_registerCommand({
    id: "cycle-effort",
    title: "Cycle reasoning effort",
    defaultShortcut: { key: "/", mod: true, shift: true },
    run: ({ composer }) => cycleEffort(composer),
  });
});
