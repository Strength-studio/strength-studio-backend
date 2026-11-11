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

async function withChrome(origin, run) {
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
    socket.addEventListener('message', event => {
      const { id, result, error, method, params } = JSON.parse(event.data);
      if (method === 'Runtime.exceptionThrown') {
        browserErrors.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text);
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

    await call('Runtime.enable');
    await run({
      go: path => call('Page.navigate', { url: origin + path }),
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
