import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/message-port';
import type { RouterClient } from '@orpc/server';

import type { createRouter } from '../main/router.ts';
import { rpcPortMessage } from '../shared/platforms.ts';

const { port1, port2 } = new MessageChannel();
window.postMessage(rpcPortMessage, '*', [port2]);
port1.start();

export const rpc: RouterClient<ReturnType<typeof createRouter>['router']> = createORPCClient(
  new RPCLink({ port: port1 }),
);
