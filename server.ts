// bb-plugin-model-picker — backend entry.
//
// Stores the person's favorite models (the rows at the top of the picker) in
// bb.storage.kv so every window and device shares one list. Each write
// publishes a realtime signal so open pickers refetch.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const favoriteSchema = z.object({
  providerId: z.string().min(1).max(200),
  model: z.string().min(1).max(200),
  reasoningLevel: z.string().max(100).optional(),
  serviceTier: z.string().max(100).optional(),
});
export type Favorite = z.infer<typeof favoriteSchema>;

const favoritesSchema = z.array(favoriteSchema).max(50);

export const rpcContract = defineRpcContract({
  favorites_get: {
    input: z.null(),
    output: z.object({ favorites: favoritesSchema }),
  },
  favorites_set: {
    input: z.object({ favorites: favoritesSchema }),
    output: z.object({ favorites: favoritesSchema }),
  },
});

/** Realtime channel app.tsx listens on. */
export const FAVORITES_CHANGED = "favorites-changed";
const KEY = "favorites";

/** Same model listed twice keeps the first entry. */
function dedupe(favorites: Favorite[]): Favorite[] {
  const seen = new Set<string>();
  return favorites.filter((favorite) => {
    const id = `${favorite.providerId}\u0000${favorite.model}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export default async function plugin(bb: BbPluginApi) {
  bb.settings.define({
    showFavoritesRow: {
      type: "boolean", label: "Show favorite model shortcuts",
      description: "Show a horizontally scrollable row of favorites in the composer.", default: false,
    },
    hideNativePicker: {
      type: "boolean", label: "Hide BB's model picker",
      description: "Hide the native picker in expanded composers. The Model Picker button remains available.", default: false,
    },
  });
  async function read(): Promise<Favorite[]> {
    const parsed = favoritesSchema.safeParse(await bb.storage.kv.get(KEY));
    return parsed.success ? parsed.data : [];
  }
  async function write(favorites: Favorite[]): Promise<Favorite[]> {
    const next = dedupe(favorites);
    await bb.storage.kv.set(KEY, next);
    bb.realtime.publish(FAVORITES_CHANGED, { count: next.length });
    return next;
  }

  bb.rpc.register(rpcContract, {
    favorites_get: async () => ({ favorites: await read() }),
    favorites_set: async ({ favorites }) => ({
      favorites: await write(favorites),
    }),
  });

  const usage = [
    "Usage:",
    "  bb model-picker list [--json]",
    "  bb model-picker add <providerId> <model> [reasoningLevel]",
    "  bb model-picker remove <providerId> <model>",
  ].join("\n");
  bb.cli.register({
    name: "model-picker",
    summary: "Manage the Model Picker plugin's favorite models",
    commands: [
      { name: "list", summary: "List favorite models", usage: "bb model-picker list [--json]" },
      {
        name: "add",
        summary: "Add a favorite model",
        usage: "bb model-picker add <providerId> <model> [reasoningLevel]",
      },
      {
        name: "remove",
        summary: "Remove a favorite model",
        usage: "bb model-picker remove <providerId> <model>",
      },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const [command, ...args] = argv.filter((arg) => arg !== "--json");
      const format = (list: Favorite[]) =>
        list.length === 0
          ? "No favorite models."
          : list
              .map(
                (f, i) =>
                  `${i + 1}. ${f.providerId}/${f.model}${f.reasoningLevel ? ` (${f.reasoningLevel})` : ""}${f.serviceTier && f.serviceTier !== "default" ? ` [${f.serviceTier}]` : ""}`,
              )
              .join("\n");
      const reply = (list: Favorite[]) => ({
        exitCode: 0,
        stdout: json ? JSON.stringify(list) : format(list),
      });
      const [providerId, model, reasoningLevel] = args;
      switch (command) {
        case undefined:
        case "help":
        case "--help":
          return { exitCode: 0, stdout: usage };
        case "list":
          return reply(await read());
        case "add": {
          if (!providerId || !model || args.length > 3) break;
          const entry = favoriteSchema.safeParse({ providerId, model, reasoningLevel });
          if (!entry.success) break;
          return reply(await write([...(await read()), entry.data]));
        }
        case "remove": {
          if (!providerId || !model || args.length !== 2) break;
          const current = await read();
          const next = current.filter(
            (f) => !(f.providerId === providerId && f.model === model),
          );
          if (next.length === current.length) {
            return { exitCode: 1, stderr: `${providerId}/${model} is not a favorite.` };
          }
          return reply(await write(next));
        }
      }
      return { exitCode: 1, stderr: usage };
    },
  });
}
