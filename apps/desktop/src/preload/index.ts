import { ipcRenderer } from 'electron';

import { rpcPortMessage } from '../shared/platforms.ts';

window.addEventListener('message', event => {
  if (event.source !== window || event.data !== rpcPortMessage || event.ports.length !== 1) {
    return;
  }

  ipcRenderer.postMessage(rpcPortMessage, null, [event.ports[0]]);
});
