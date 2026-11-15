// Module-level state shared by the composer button, the picker popup and the
// keyboard commands. Commands receive only a composer handle, so the mounted
// components hand this module the RPC and SDK clients they get from hooks.
import { useSyncExternalStore } from "react";
import type {
  ComposerSelection,
  PluginComposerApi,
  PluginRpcClient,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import type { Favorite, rpcContract } from "../server";

export type Sdk = ReturnType<typeof useSdk>;
export type CatalogModel = Awaited<
  ReturnType<Sdk["providers"]["models"]>
>["models"][number];
type Rpc = PluginRpcClient<typeof rpcContract>;

/** Where a composer's model catalog comes from. */
export type Routing = { environmentId: string } | { projectId?: string };

let rpc: Rpc | null = null;
let sdk: Sdk | null = null;
let favorites: Favorite[] | null = null;
let favoritesRequest: Promise<Favorite[]> | null = null;
let revision = 0;
let writesPending = 0;
let writeQueue: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function connect(clients: { rpc: Rpc; sdk: Sdk }) {
  rpc = clients.rpc;
  sdk = clients.sdk;
  if (favorites === null) void loadFavorites();
}

export function getSdk(): Sdk | null {
  return sdk;
}

export function loadFavorites(force = false): Promise<Favorite[]> {
  if (rpc === null) return Promise.resolve(favorites ?? []);
  if (writesPending > 0) return Promise.resolve(favorites ?? []);
  if (favoritesRequest !== null && !force) return favoritesRequest;
  const startedAt = revision;
  const request = rpc.call("favorites_get").then(
    (result) => {
      if (startedAt === revision && writesPending === 0) {
        favorites = result.favorites;
        emit();
      }
      return favorites ?? [];
    },
    () => favorites ?? [],
  );
  favoritesRequest = request;
  void request.finally(() => {
    if (favoritesRequest === request) favoritesRequest = null;
  });
  return request;
}

export async function setFavorites(next: Favorite[]): Promise<void> {
  const previous = favorites;
  const currentRevision = ++revision;
  favorites = next;
  emit();
  if (rpc === null) return;
  writesPending++;
  const client = rpc;
  const save = writeQueue.then(() => client.call("favorites_set", { favorites: next }));
  writeQueue = save.then(() => {}, () => {});
  try {
    const saved = (await save).favorites;
    if (currentRevision === revision) favorites = saved;
  } catch (cause) {
    if (currentRevision === revision) favorites = previous;
    throw cause;
  } finally {
    writesPending--;
    emit();
    if (writesPending === 0) void loadFavorites(true);
  }
}

export function getFavorites(): Favorite[] | null {
  return favorites;
}

export function useFavorites(): Favorite[] | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => favorites,
  );
}

export function sameModel(
  a: { providerId?: string; model?: string },
  b: { providerId?: string; model?: string },
): boolean {
  return a.providerId === b.providerId && a.model === b.model;
}

/** Remember the selection's effort and tier on its favorite row, if any. */
export function rememberSelection(selection: ComposerSelection): void {
  if (favorites === null || !selection.providerId || !selection.model) return;
  let changed = false;
  const next = favorites.map((favorite) => {
    if (!sameModel(favorite, selection)) return favorite;
    if (
      favorite.reasoningLevel === selection.reasoningLevel &&
      favorite.serviceTier === selection.serviceTier
    ) {
      return favorite;
    }
    changed = true;
    return {
      ...favorite,
      reasoningLevel: selection.reasoningLevel,
      serviceTier: selection.serviceTier,
    };
  });
  if (changed) void setFavorites(next).catch(() => {});
}

// ---------------------------------------------------------------------------
// Catalogs

const CATALOG_TTL_MS = 5 * 60_000;
const catalogs = new Map<
  string,
  { at: number; promise: Promise<CatalogModel[]> }
>();

function routingKey(routing: Routing): string {
  return "environmentId" in routing
    ? `env:${routing.environmentId}`
    : `project:${routing.projectId ?? ""}`;
}

export function loadModels(
  routing: Routing,
  providerId: string,
): Promise<CatalogModel[]> {
  const client = sdk;
  if (client === null) return Promise.resolve([]);
  const key = `${routingKey(routing)}|${providerId}`;
  const cached = catalogs.get(key);
  if (cached !== undefined && Date.now() - cached.at < CATALOG_TTL_MS) {
    return cached.promise;
  }
  const promise = client.providers
    .models({ ...routing, providerId })
    .then((result) => result.models)
    .catch(() => {
      catalogs.delete(key);
      return [] as CatalogModel[];
    });
  catalogs.set(key, { at: Date.now(), promise });
  return promise;
}

const routings = new Map<string, Routing>();
const threadEnvironments = new Map<string, Promise<Routing>>();

/** The catalog routing for a composer, resolved once per thread. */
export function routingFor(composer: PluginComposerApi): Promise<Routing> {
  const scope = composer.scope;
  if (scope.kind === "new-thread") {
    return Promise.resolve(
      scope.projectId === null ? {} : { projectId: scope.projectId },
    );
  }
  const known = routings.get(scope.threadId);
  if (known !== undefined) return Promise.resolve(known);
  let pending = threadEnvironments.get(scope.threadId);
  if (pending === undefined) {
    const client = sdk;
    pending = (
      client === null
        ? Promise.resolve<Routing>({})
        : client.threads.get({ threadId: scope.threadId }).then(
            (result): Routing => {
              const record = result as {
                environmentId?: string | null;
                thread?: { environmentId?: string | null };
              };
              const environmentId =
                record.environmentId ?? record.thread?.environmentId ?? null;
              return environmentId ? { environmentId } : {};
            },
            (): Routing => ({}),
          )
    ).then((routing) => {
      routings.set(scope.threadId, routing);
      return routing;
    });
    threadEnvironments.set(scope.threadId, pending);
  }
  return pending;
}

// ---------------------------------------------------------------------------
// Effort labels and order

const EFFORT_RANK = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultracode",
];

const EFFORT_LABELS: Record<string, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
  ultracode: "Ultracode",
};

export function effortLabel(effort: string | undefined): string {
  if (!effort) return "Default";
  return (
    EFFORT_LABELS[effort] ?? effort.charAt(0).toUpperCase() + effort.slice(1)
  );
}

/** A model's supported efforts, lowest first. */
export function effortsOf(model: CatalogModel | undefined): string[] {
  if (model === undefined) return [];
  const efforts = model.supportedReasoningEfforts.map((e) => e.reasoningEffort);
  const rank = (effort: string) => {
    const index = EFFORT_RANK.indexOf(effort);
    return index === -1 ? EFFORT_RANK.length : index;
  };
  return efforts
    .map((effort, index) => ({ effort, index }))
    .sort((a, b) => rank(a.effort) - rank(b.effort) || a.index - b.index)
    .map(({ effort }) => effort);
}

export function hasFastTier(model: CatalogModel | undefined): boolean {
  return model?.supportedServiceTiers?.some((t) => t.id === "fast") ?? false;
}
