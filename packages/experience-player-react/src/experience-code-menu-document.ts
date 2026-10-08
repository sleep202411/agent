import type { GameUIArtifact } from "@repo/shared/experience-runtime";

const scriptText = (text: string) =>
  text.replace(/<\/script/gi, (match) => match.replace("</", "<\\/")).replace(/<!--/g, "<\\!--");
const styleText = (text: string) =>
  text.replace(/<\/style/gi, (match) => match.replace("</", "<\\/"));

/** Scripts run with an opaque origin. The nonce grants scripts, never host origin privileges. */
export function codeMenuDocument(
  artifact: GameUIArtifact,
  credential: string,
  coverUrl?: string
): string {
  const nonce = credential.replace(/[^a-zA-Z0-9-]/g, "");
  let coverSource = "";
  if (coverUrl) {
    const cover = new URL(coverUrl);
    if (cover.protocol === "http:" || cover.protocol === "https:")
      coverSource = `${cover.origin}${cover.pathname.replace(/[;'"]/g, (value) => encodeURIComponent(value))}`;
  }
  const bootstrap = `
  (() => {
    const credential = ${JSON.stringify(credential)};
    let port, snapshot, initialized = false, nextId = 0, mapOrigin;
    const listeners = new Set(), pending = new Map();
    const fail = (error) => port?.postMessage({type:'error',message:String(error?.message || error).slice(0,2000)});
    const command = request => new Promise((resolve,reject) => {
      if (pending.size >= 8) { resolve({ok:false,reason:'busy'}); return }
      const id = ++nextId;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Game command timed out.')) },15000);
      pending.set(id,{resolve,reject,timer}); port.postMessage({...request,id});
    });
    const game = Object.freeze({apiVersion:${artifact.apiVersion},
      getSnapshot: () => snapshot,
      subscribe: (listener) => {listeners.add(listener); return () => listeners.delete(listener)},
      invoke: (action) => {
        if (action === 'open-map') mapOrigin = document.activeElement;
        return command({type:'invoke',action});
      }
    });
    const freeze = value => Object.freeze({...value,actions:Object.freeze({...value.actions})});
    const receive = (event) => {
      if (initialized || event.source !== parent || event.data?.type !== 'fizz.game.connect' || event.data?.credential !== credential || event.ports.length !== 1) return;
      initialized = true; removeEventListener('message',receive); port = event.ports[0];
      port.onmessage = async ({data}) => {
        if (data.type === 'initialize') {
          snapshot = freeze(data.snapshot);
          try {
            if (typeof FizzGameUI.mount !== 'function') throw new Error('Game UI must export mount.');
            const cleanup = await FizzGameUI.mount({root:document.getElementById('game-root'),game,context:data.context});
            if (typeof cleanup === 'function') addEventListener('pagehide',cleanup,{once:true});
            port.postMessage({type:'ready'});
          } catch(error) {fail(error)}
        } else if(data.type === 'snapshot') {
          snapshot = freeze(data.snapshot); for(const listener of listeners) {try {listener()} catch(error){fail(error)}}
        } else if(data.type === 'result') {
          const request = pending.get(data.id); if(!request) return;
          pending.delete(data.id); clearTimeout(request.timer);
          data.error ? request.reject(new Error(data.error)) : request.resolve(data.result);
        } else if(data.type === 'focus') {
          const target = mapOrigin?.isConnected ? mapOrigin : document.querySelector('button:not(:disabled),[tabindex="0"]');
          mapOrigin = undefined; target?.focus();
        }
      }; port.start();
      addEventListener('error',event => fail(event.error || event.message));
      addEventListener('unhandledrejection',event => fail(event.reason));
      addEventListener('pagehide',()=>{for(const request of pending.values()){clearTimeout(request.timer);request.resolve({ok:false,reason:'disposed'})}pending.clear();listeners.clear();port.close()},{once:true});
    };
    addEventListener('message',receive);
    parent.postMessage({type:'fizz.game.ready',credential},'*');
  })();`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: blob: ${coverSource}; font-src data:; connect-src 'none'; media-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body,#game-root{margin:0;width:100%;height:100%;overflow:hidden}body{color:white;color-scheme:dark;font-family:system-ui}button{font:inherit}</style><style>${styleText(artifact.css)}</style></head><body><div id="game-root"></div><script nonce="${nonce}">${scriptText(artifact.javascript)}</script><script nonce="${nonce}">${scriptText(bootstrap)}</script></body></html>`;
}
