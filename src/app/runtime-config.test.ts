import { resolveAppRuntimeConfig } from './runtime-config';

describe('resolveAppRuntimeConfig', () => {
  it('defaults to the interactive in-app login flow and root asset base', () => {
    expect(resolveAppRuntimeConfig({})).toEqual({
      assetBase: '/',
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
      VITE_DISABLE_IN_APP_LOGIN: 'true',
      VITE_CONTROL_PLANE_LOGIN_USERNAME: 'operator_001',
      VITE_CONTROL_PLANE_LOGIN_PASSWORD: 'secret-001',
      VITE_CONTROL_PLANE_OPERATOR_GROUP_ID: 'ops',
      VITE_CONTROL_PLANE_RESOURCE_GROUP_ID: 'group-alpha'
    })
  ).toEqual({
      assetBase: './',
      disableInAppLogin: true,
      loginUsername: 'operator_001',
      loginPassword: 'secret-001',
      operatorGroupId: 'ops',
      resourceGroupId: 'group-alpha'
    });
  });

  it('requires explicit login credentials in production builds', () => {
    expect(() => resolveAppRuntimeConfig({ PROD: true })).toThrow('VITE_CONTROL_PLANE_LOGIN_USERNAME');
    expect(() =>
      resolveAppRuntimeConfig({
        PROD: true,
        VITE_CONTROL_PLANE_LOGIN_USERNAME: 'operator_001'
      })
    ).toThrow('VITE_CONTROL_PLANE_LOGIN_PASSWORD');
  });
});
