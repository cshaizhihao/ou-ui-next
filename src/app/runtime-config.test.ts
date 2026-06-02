import { resolveAppRuntimeConfig } from './runtime-config';

describe('resolveAppRuntimeConfig', () => {
  it('defaults to the interactive in-app login flow and root asset base', () => {
    expect(resolveAppRuntimeConfig({})).toEqual({
      assetBase: '/',
      disableInAppLogin: false
    });
  });

  it('parses production-friendly runtime flags from Vite environment values', () => {
    expect(
      resolveAppRuntimeConfig({
        VITE_ASSET_BASE: './',
        VITE_DISABLE_IN_APP_LOGIN: 'true'
      })
    ).toEqual({
      assetBase: './',
      disableInAppLogin: true
    });
  });
});
