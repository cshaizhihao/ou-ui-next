import { createRequire } from 'node:module';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

type StaticPanelProxyScript = {
  resolveStaticFile(staticRoot: string, urlPathname: string): string | undefined;
  shouldProxy(pathname: string): boolean;
};

const staticPanelProxyScript = require('../../../scripts/static-panel-proxy.cjs') as StaticPanelProxyScript;

describe('static panel proxy script helpers', () => {
  it('proxies control-plane API and public runtime routes to the backend', () => {
    expect(staticPanelProxyScript.shouldProxy('/api/v1/snapshot')).toBe(true);
    expect(staticPanelProxyScript.shouldProxy('/agent/v1/events')).toBe(true);
    expect(staticPanelProxyScript.shouldProxy('/events/v1/tasks')).toBe(true);
    expect(staticPanelProxyScript.shouldProxy('/sub/public-token')).toBe(true);
    expect(staticPanelProxyScript.shouldProxy('/portal/customer/subscription')).toBe(true);
    expect(staticPanelProxyScript.shouldProxy('/telegram/webhook')).toBe(true);
    expect(staticPanelProxyScript.shouldProxy('/metrics')).toBe(true);
    expect(staticPanelProxyScript.shouldProxy('/assets/index.js')).toBe(false);
  });

  it('serves SPA fallback without allowing path traversal outside the static root', () => {
    const directory = join(tmpdir(), `ou-ui-next-static-proxy-${Date.now()}`);

    try {
      mkdirSync(join(directory, 'assets'), { recursive: true });
      writeFileSync(join(directory, 'index.html'), '<div id="root"></div>');
      writeFileSync(join(directory, 'assets', 'index.js'), 'console.log("ok");');

      expect(staticPanelProxyScript.resolveStaticFile(directory, '/')).toBe(join(directory, 'index.html'));
      expect(staticPanelProxyScript.resolveStaticFile(directory, '/assets/index.js')).toBe(
        join(directory, 'assets', 'index.js')
      );
      expect(staticPanelProxyScript.resolveStaticFile(directory, '/nodes')).toBe(join(directory, 'index.html'));
      expect(staticPanelProxyScript.resolveStaticFile(directory, '/../outside.txt')).toBeUndefined();
      expect(staticPanelProxyScript.resolveStaticFile(directory, '/%2e%2e/%2e%2e/etc/passwd')).toBeUndefined();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
