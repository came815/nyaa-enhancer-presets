import assert from "node:assert/strict";
import test from "node:test";
import {
  dispatchFeatureHook,
  dispatchTableMutated,
  handleSettingChange,
  setFeatures,
} from "../../src/chrome/content/core/registry.js";

async function captureFeatureErrors(run) {
  const original = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args);
  try {
    await run();
  } finally {
    console.error = original;
    setFeatures([]);
  }
  return errors;
}

test("a rejected table hook is reported and does not block later hooks", async () => {
  const calls = [];
  setFeatures([
    {
      id: "broken-table",
      async onTableMutated() {
        calls.push("broken");
        throw new Error("synthetic table failure");
      },
    },
    {
      id: "later-table",
      async onTableMutated() {
        await Promise.resolve();
        calls.push("later");
      },
    },
  ]);

  const errors = await captureFeatureErrors(() => dispatchTableMutated([]));
  assert.deepEqual(calls, ["broken", "later"]);
  assert.match(errors[0][0], /onTableMutated failed for feature "broken-table"/);
  assert.equal(errors[0][1].message, "synthetic table failure");
});

test("setting and initialization hooks await work while isolating failures", async () => {
  const calls = [];
  setFeatures([
    {
      id: "broken-setting",
      onSettingChanged() {
        calls.push("broken-setting");
        return Promise.reject(new Error("synthetic setting failure"));
      },
      init() {
        calls.push("broken-init");
        throw new Error("synthetic init failure");
      },
    },
    {
      id: "later-feature",
      async onSettingChanged(setting, value) {
        await Promise.resolve();
        calls.push(`${setting}:${value}`);
      },
      async init() {
        await Promise.resolve();
        calls.push("later-init");
      },
    },
  ]);

  const errors = await captureFeatureErrors(async () => {
    await handleSettingChange("showButtons", true);
    await dispatchFeatureHook("init", {});
  });
  assert.deepEqual(calls, [
    "broken-setting",
    "showButtons:true",
    "broken-init",
    "later-init",
  ]);
  assert.equal(errors.length, 2);
  assert.match(errors[0][0], /onSettingChanged failed for feature "broken-setting"/);
  assert.match(errors[1][0], /init failed for feature "broken-setting"/);
});
