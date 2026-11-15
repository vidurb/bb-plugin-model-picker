import { test } from "node:test";
import assert from "node:assert/strict";
import { modelLabels } from "../lib/model-labels.ts";
import { shortModelName } from "../lib/short-model-name.ts";

test("catalog labels are four characters and unique within each provider", () => {
  for (const [provider, models] of Object.entries(modelLabels)) {
    const labels = Object.values(models);
    assert.equal(new Set(labels).size, labels.length, `${provider} has duplicate labels`);
    for (const label of labels) assert.equal(label.length, 4, `${provider}: ${label}`);
  }
});

test("looks up provider and model IDs and falls back for unknown combinations", () => {
  assert.equal(shortModelName("codex", "gpt-6.1-terra", "GPT-6.1 Terra"), "6.1T");
  assert.equal(shortModelName("claude-code", "claude-fable-5-2", "Fable 5.2"), "5.2F");
  assert.equal(shortModelName("acp-cursor", "default", "Auto"), "AUTO");
  assert.equal(shortModelName("unknown", "claude-fable-5-2", "Fable 5.2"), "5.2");
  assert.equal(shortModelName("toString", "toString", "Custom model"), "Custom mo…");
});
