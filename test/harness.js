// Shared setup for the browser test pages: assertions, timing, fetch stubs and result reporting.
// Each page keeps its own scenario; Playwright reads `#results[data-status]`.

const results = document.getElementById('results');

/** The page's real fetch, for loading files a stub would otherwise intercept. */
export const originalFetch = window.fetch;

export function assert(condition, message) {
  if (!condition) throw Error(message);
}

export const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Resolves after `count` animation frames. */
export const frame = (count = 1) => new Promise((resolve) => {
  const step = (left) => requestAnimationFrame(() => (left > 1 ? step(left - 1) : resolve()));
  step(count);
});

/**
 * Routes fetches by URL: `route(url, options)` returns a response (or its promise) to stub a
 * request, or nothing to let it through. Calling it again replaces the previous routes.
 */
export function stubFetch(route) {
  window.fetch = (input, options) => {
    const url = new URL(input instanceof Request ? input.url : input, window.location.href);
    return route(url, options) ?? originalFetch(input, options);
  };
}

/** Reports the page as passed, one `PASS:` line per check. */
export function pass(lines) {
  results.textContent = [lines].flat().map((line) => `PASS: ${line}`).join('\n');
  results.dataset.status = 'passed';
}

/** Reports the page as failed with the error's stack. */
export function fail(error) {
  results.textContent = `FAIL: ${error.stack}`;
  results.dataset.status = 'failed';
}

/**
 * Runs a page's scenario and reports the lines it returns, or its error. Afterwards the original
 * fetch is restored and `cleanup` runs.
 */
export async function run(scenario, cleanup = () => {}) {
  try {
    pass(await scenario());
  } catch (error) {
    fail(error);
    throw error;
  } finally {
    window.fetch = originalFetch;
    cleanup();
  }
}
