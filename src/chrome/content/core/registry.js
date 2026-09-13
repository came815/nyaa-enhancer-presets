let features = [];

export function setFeatures(list) {
  features = list;
}

export function getFeatures() {
  return features;
}

function reportFeatureHookError(feature, hook, error) {
  const id = feature?.id || "unknown";
  console.error(`[Nyaa Enhancer] ${hook} failed for feature "${id}".`, error);
}

export async function dispatchFeatureHook(hook, ...args) {
  for (const feature of features) {
    try {
      const handler = feature?.[hook];
      if (typeof handler === "function") {
        await handler.apply(feature, args);
      }
    } catch (error) {
      reportFeatureHookError(feature, hook, error);
    }
  }
}

export async function handleSettingChange(setting, value) {
  await dispatchFeatureHook("onSettingChanged", setting, value);
}

export async function dispatchTableMutated(mutations) {
  await dispatchFeatureHook("onTableMutated", mutations);
}
