import type { AddressInfo } from 'node:net';
import { createServiceBackedControlPlane } from './create-service-backed-control-plane';
import { resolveHttpControlPlaneRuntimeConfig } from './http-control-plane-runtime-config';

const config = resolveHttpControlPlaneRuntimeConfig(process.env);
const { host, port, storage } = config;

const { server } = await createServiceBackedControlPlane(
  storage.type === 'file'
    ? {
        storage: 'file',
        stateFilePath: storage.stateFilePath,
        auth: config.auth
      }
    : {
        storage: 'memory',
        auth: config.auth
      }
);

await new Promise<void>((resolve) => {
  server.listen(port, host, resolve);
});

const address = server.address() as AddressInfo;
const url = `http://${address.address}:${address.port}`;

console.log(
  `OU-UI Next service-backed control plane listening at ${url} (${storage.type} storage, ${
    config.auth ? 'auth enabled' : 'auth disabled'
  })`
);

function shutdown(signal: NodeJS.Signals) {
  server.close((error) => {
    if (error) {
      console.error(`Failed to stop control plane after ${signal}:`, error);
      process.exitCode = 1;
    }

    process.exit();
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
