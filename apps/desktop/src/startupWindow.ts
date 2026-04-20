const STARTUP_REDIRECT_POLL_INTERVAL_MS = 250;

function buildStartupSplashHtml(targetUrl: string, backendWsUrl: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Starting Beppo</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #0f172a;
        --panel: rgba(15, 23, 42, 0.9);
        --panel-border: rgba(148, 163, 184, 0.18);
        --text: #e2e8f0;
        --muted: #94a3b8;
        --accent: #38bdf8;
      }
      html, body {
        width: 100%;
        height: 100%;
        margin: 0;
        background:
          radial-gradient(circle at top, rgba(56, 189, 248, 0.2), transparent 35%),
          linear-gradient(135deg, #020617, var(--bg));
        color: var(--text);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body {
        display: grid;
        place-items: center;
      }
      .card {
        width: min(92vw, 420px);
        border-radius: 24px;
        border: 1px solid var(--panel-border);
        background: var(--panel);
        box-shadow: 0 24px 80px rgba(2, 6, 23, 0.45);
        padding: 28px 30px;
      }
      .eyebrow {
        text-transform: uppercase;
        letter-spacing: 0.18em;
        font-size: 11px;
        color: var(--muted);
        margin-bottom: 10px;
      }
      h1 {
        margin: 0;
        font-size: 30px;
        line-height: 1.05;
      }
      p {
        margin: 12px 0 0;
        color: var(--muted);
        font-size: 14px;
        line-height: 1.5;
      }
      .row {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-top: 22px;
        color: var(--muted);
        font-size: 13px;
      }
      .spinner {
        width: 14px;
        height: 14px;
        border-radius: 999px;
        border: 2px solid rgba(148, 163, 184, 0.25);
        border-top-color: var(--accent);
        animation: spin 0.8s linear infinite;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    </style>
  </head>
  <body>
    <main class="card" aria-live="polite">
      <div class="eyebrow">Beppo</div>
      <h1>Starting up</h1>
      <p>The app window opens immediately while Beppo finishes bringing its backend online.</p>
      <div class="row">
        <div class="spinner" aria-hidden="true"></div>
        <span>Waiting for the local server to respond...</span>
      </div>
    </main>
    <script>
      (() => {
        const targetUrl = ${JSON.stringify(targetUrl)};
        const backendWsUrl = ${JSON.stringify(backendWsUrl)};
        let redirected = false;
        let retryTimer = null;

        const cleanup = (socket) => {
          if (!socket) return;
          try {
            socket.onopen = null;
            socket.onerror = null;
            socket.onclose = null;
            socket.close();
          } catch {
            // Ignore shutdown races while the backend is starting.
          }
        };

        const redirect = (socket) => {
          if (redirected) return;
          redirected = true;
          if (retryTimer !== null) {
            clearTimeout(retryTimer);
            retryTimer = null;
          }
          cleanup(socket);
          window.location.replace(targetUrl);
        };

        const scheduleRetry = () => {
          if (redirected || retryTimer !== null) return;
          retryTimer = setTimeout(() => {
            retryTimer = null;
            connect();
          }, ${STARTUP_REDIRECT_POLL_INTERVAL_MS});
        };

        const connect = () => {
          if (redirected) return;

          let socket;
          try {
            socket = new WebSocket(backendWsUrl);
          } catch {
            scheduleRetry();
            return;
          }

          socket.onopen = () => redirect(socket);
          socket.onerror = () => {
            cleanup(socket);
            if (!redirected) {
              scheduleRetry();
            }
          };
          socket.onclose = () => {
            if (!redirected) {
              scheduleRetry();
            }
          };
        };

        connect();
      })();
    </script>
  </body>
</html>`;
}

export function createStartupRedirectWindowUrl(targetUrl: string, backendWsUrl: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(
    buildStartupSplashHtml(targetUrl, backendWsUrl),
  )}`;
}
