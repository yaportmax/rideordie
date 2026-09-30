import { registerHooks } from 'node:module';
// Unit tests exercise the real transport with injected peers; the browser suite exercises actual WebRTC.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'peerjs') return { url: 'data:text/javascript,export class Peer { constructor() { throw new Error("Inject a test peer"); } }', shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
