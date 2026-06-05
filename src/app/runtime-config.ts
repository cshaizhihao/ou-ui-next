type RuntimeEnv = Record<string, string | boolean | undefined> & {
  PROD?: boolean;
  VITE_ASSET_BASE?: string;
  VITE_CONTROL_PLANE_MODE?: string;
  VITE_CONTROL_PLANE_BASE_URL?: string;
  VITE_DISABLE_IN_APP_LOGIN?: string | boolean;
  VITE_CONTROL_PLANE_LOGIN_USERNAME?: string;
  VITE_CONTROL_PLANE_OPERATOR_GROUP_ID?: string;
  VITE_CONTROL_PLANE_RESOURCE_GROUP_ID?: string;
};

export type AppRuntimeConfig = {
  assetBase: string;
  controlPlaneMode: 'mock' | 'http';
  controlPlaneBaseUrl?: string;
  disableInAppLogin: boolean;
  loginUsername: string;
  loginPassword: string;
  operatorGroupId: string;
  resourceGroupId: string;
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

function normalizeString(value: string | undefined, fallback: string) {
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

export function resolveAppRuntimeConfig(env: RuntimeEnv = import.meta.env): AppRuntimeConfig {
  const isProduction = env.PROD === true;
  const controlPlaneMode = isProduction || env.VITE_CONTROL_PLANE_MODE === 'http' ? 'http' : 'mock';
  const controlPlaneBaseUrl = normalizeString(env.VITE_CONTROL_PLANE_BASE_URL, '');

  return {
    assetBase: normalizeAssetBase(env.VITE_ASSET_BASE),
    controlPlaneMode,
    ...(controlPlaneBaseUrl ? { controlPlaneBaseUrl } : {}),
    disableInAppLogin: parseBooleanFlag(env.VITE_DISABLE_IN_APP_LOGIN),
    loginUsername: normalizeString(env.VITE_CONTROL_PLANE_LOGIN_USERNAME, 'operator'),
    loginPassword: 'local-password',
    operatorGroupId: normalizeString(env.VITE_CONTROL_PLANE_OPERATOR_GROUP_ID, 'owner'),
    resourceGroupId: normalizeString(env.VITE_CONTROL_PLANE_RESOURCE_GROUP_ID, 'group-premium')
  };
}
