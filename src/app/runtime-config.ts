type RuntimeEnv = Record<string, string | boolean | undefined> & {
  VITE_ASSET_BASE?: string;
  VITE_DISABLE_IN_APP_LOGIN?: string | boolean;
};

export type AppRuntimeConfig = {
  assetBase: string;
  disableInAppLogin: boolean;
};

function parseBooleanFlag(value: string | boolean | undefined) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return false;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function normalizeAssetBase(value: string | undefined) {
  if (!value || value.trim().length === 0) {
    return '/';
  }

  return value;
}

export function resolveAppRuntimeConfig(env: RuntimeEnv = import.meta.env): AppRuntimeConfig {
  return {
    assetBase: normalizeAssetBase(env.VITE_ASSET_BASE),
    disableInAppLogin: parseBooleanFlag(env.VITE_DISABLE_IN_APP_LOGIN)
  };
}
