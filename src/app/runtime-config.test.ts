import { resolveAppRuntimeConfig } from './runtime-config';

describe('resolveAppRuntimeConfig', () => {
  it('defaults to the interactive in-app login flow and root asset base', () => {
    expect(resolveAppRuntimeConfig({})).toEqual({
      assetBase: '/',
      controlPlaneMode: 'mock',
      disableInAppLogin: false,
      loginUsername: 'operator',
      loginPassword: 'local-password',
      operatorGroupId: 'owner',
      resourceGroupId: 'group-premium'
    });
  });

  it('parses production-friendly runtime flags from Vite environment values', () => {
    expect(
      resolveAppRuntimeConfig({
        PROD: true,
        VITE_ASSET_BASE: './',
        VITE_CONTROL_PLANE_BASE_URL: '/secure-panel',
        VITE_DISABLE_IN_APP_LOGIN: 'true',
        VITE_CONTROL_PLANE_LOGIN_USERNAME: 'operator_001',
        VITE_CONTROL_PLANE_OPERATOR_GROUP_ID: 'ops',
        VITE_CONTROL_PLANE_RESOURCE_GROUP_ID: 'group-alpha'
      })
    ).toEqual({
      assetBase: './',
      controlPlaneMode: 'http',
      controlPlaneBaseUrl: '/secure-panel',
      disableInAppLogin: true,
      loginUsername: 'operator_001',
      loginPassword: 'local-password',
      operatorGroupId: 'ops',
      resourceGroupId: 'group-alpha'
    });
  });
});
