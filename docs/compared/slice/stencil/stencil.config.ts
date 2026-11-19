import { Config } from '@stencil/core';

// `www` builds what the browser loads; `dist-hydrate-script` renders the same components on the server.
export const config: Config = {
  namespace: 'slice',
  outputTargets: [{ type: 'www', serviceWorker: null, empty: true }, { type: 'dist-hydrate-script' }],
};
