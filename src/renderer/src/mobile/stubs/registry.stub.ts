/**
 * registry.stub.ts
 * iOS build stub — the plugin registry does not exist on iOS.
 * All exports are empty/no-op so TypeScript is satisfied without
 * including any plugin infrastructure in the bundle.
 */
export const BUILTIN_PLUGINS: never[] = [];
export const OFFICIAL_STORE_PLUGINS: never[] = [];
export const COMMUNITY_STORE_PLUGINS: never[] = [];
export const getInstalledPlugins = () => [];
export const enablePlugin = () => [];
export const disablePlugin = () => [];
export const installPlugin = () => [];
export const uninstallPlugin = () => [];
export const isPluginEnabled = () => false;
