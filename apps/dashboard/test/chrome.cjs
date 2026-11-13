const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

async function waitFor(check, label) {
  const deadline = Date.now() + 6_000;
  let lastError;
  do {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) { lastError = error; }
    await delay(50);
  } while (Date.now() < deadline);
  throw new Error('Timed out waiting for ' + label, { cause: lastError });
}

async function withChrome(origin, clientMarker, run) {
  if (!globalThis.WebSocket) throw new Error('Run the browser tests with node --experimental-websocket');
  const profile = await mkdtemp(join(tmpdir(), 'studio-chrome-'));
  const chrome = spawn(process.env.STUDIO_TEST_CHROME, [
    '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-port=0',
    '--user-data-dir=' + profile, 'about:blank',
  ], { stdio: 'ignore' });
  const exited = once(chrome, 'exit');
  // A failed launch is reported by the same cleanup path as a normal exit.
  void exited.catch(() => {});
  let socket;
  try {
    const port = await Promise.race([
      waitFor(async () => (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0], 'Chrome'),
      exited.then(([code]) => { throw new Error('Chrome exited during startup: ' + code); }),
    ]);
    const tabs = await fetch('http://127.0.0.1:' + port + '/json/list').then(response => response.json());
    socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
    await once(socket, 'open', { signal: AbortSignal.timeout(6_000) });

    let sequence = 0;
    const pending = new Map();
    const browserErrors = [];
    const lifecycle = [];
    const responses = [];
    const memoryCache = new Set();
    const cacheMisses = [];
    socket.addEventListener('message', event => {
      const { id, result, error, method, params } = JSON.parse(event.data);
      if (method === 'Runtime.exceptionThrown') {
        browserErrors.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text);
      }
      if (method === 'Runtime.bindingCalled' && params.name === 'reportStudioHistory') {
        lifecycle.push(JSON.parse(params.payload));
      }
      if (method === 'Network.requestServedFromCache') memoryCache.add(params.requestId);
      if (method === 'Network.responseReceived' && ['Document', 'Fetch'].includes(params.type)) {
        const { url, status, fromDiskCache, fromServiceWorker, fromPrefetchCache } = params.response;
        const cached = Boolean(fromDiskCache || fromServiceWorker || fromPrefetchCache || memoryCache.has(params.requestId));
        responses.push({ url, status, cached, type: params.type });
      }
      if (method === 'Page.backForwardCacheNotUsed') {
        cacheMisses.push(params.notRestoredExplanations.map(({ reason }) => reason));
      }
      const call = pending.get(id);
      if (!call) return;
      pending.delete(id);
      clearTimeout(call.timer);
      if (error) call.reject(new Error(error.message));
      else call.resolve(result);
    });

    const call = (method, params) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Chrome did not respond to ' + method));
      }, 6_000).unref();
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });

    async function evaluate(expression) {
      const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'Browser evaluation failed');
      return result.result.value;
    }

    await Promise.all([call('Runtime.enable'), call('Page.enable'), call('Network.enable')]);
    await call('Runtime.addBinding', { name: 'reportStudioHistory' });
    await call('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      const marker = ${JSON.stringify(clientMarker)};
      const documentId = String(performance.timeOrigin);
      let previousVisibility = false;
      function sample(event, persisted = null) {
        const workspace = document.querySelector('.workspace-content');
        const visible = Boolean(workspace && getComputedStyle(workspace).visibility === 'visible'
          && workspace.getClientRects().length && workspace.innerText.includes(marker));
        if (event !== 'visibility' || visible !== previousVisibility) {
          reportStudioHistory(JSON.stringify({ event, persisted, visible, documentId, url: location.href,
            navigation: performance.getEntriesByType('navigation')[0]?.type }));
        }
        previousVisibility = visible;
      }
      function sampleFrame() {
        sample('visibility');
        requestAnimationFrame(sampleFrame);
      }
      // Capture the restored snapshot before the application's pageshow handler can reload it.
      addEventListener('pageshow', event => sample('pageshow', event.persisted), true);
      addEventListener('pagehide', event => sample('pagehide', event.persisted), true);
      addEventListener('popstate', () => sample('popstate'), true);
      new MutationObserver(() => sample('visibility')).observe(document, {
        subtree: true, childList: true, attributes: true, characterData: true,
      });
      requestAnimationFrame(sampleFrame);
    })()` });
    await run({
      go: path => call('Page.navigate', { url: origin + path }),
      setCookie: async (url, pair) => {
        const separator = pair.indexOf('=');
        const { success } = await call('Network.setCookie', {
          url, name: pair.slice(0, separator), value: pair.slice(separator + 1), secure: true, httpOnly: true, path: '/',
        });
        if (!success) throw new Error('Chrome rejected the session cookie');
      },
      blockResources: urls => call('Network.setBlockedURLs', { urls }),
      traverse: async offset => {
        const { currentIndex, entries } = await call('Page.getNavigationHistory');
        await call('Page.navigateToHistoryEntry', { entryId: entries[currentIndex + offset].id });
      },
      lifecycle,
      responses,
      cacheMisses,
      evaluate,
      until: async (expression, label) => {
        try {
          await waitFor(() => evaluate('Promise.resolve(' + expression + ').then(Boolean)'), label);
        } catch (error) {
          const page = await evaluate(`({ path: location.pathname, ready: document.readyState,
            resources: performance.getEntriesByType('resource').map(entry => new URL(entry.name).pathname),
            form: Boolean(document.querySelector('form')) })`)
            .catch(() => null);
          throw new Error(error.message + ' on ' + JSON.stringify(page) + ' ' + browserErrors.join('\n'), { cause: error });
        }
      },
    });
  } finally {
    socket?.close();
    if (chrome.exitCode === null && chrome.signalCode === null) chrome.kill();
    await exited.catch(() => {});
    await rm(profile, { recursive: true, force: true, maxRetries: 5 });
  }
}

module.exports = { withChrome };
