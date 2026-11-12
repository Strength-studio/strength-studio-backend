export function ClientHistoryGuard() {
  // Client HTML can be visible and enter BFCache before React hydrates.
  return <script dangerouslySetInnerHTML={{ __html: `
    (() => {
      let concealed = false;
      addEventListener('pagehide', event => {
        if (!event.persisted) return;
        const root = document.documentElement;
        if (!root.hasAttribute('data-client-history') && !document.querySelector('[data-client-workspace]')) return;
        root.style.visibility = 'hidden';
        concealed = true;
      });
      addEventListener('pageshow', event => {
        if (event.persisted && concealed) location.reload();
      });
    })();
  ` }} />;
}
