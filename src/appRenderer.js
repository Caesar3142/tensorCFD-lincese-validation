// appRenderer.js - attaches logout button handler
(function () {
  const btn = document.getElementById('logoutBtn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = 'Logging out...';
    try {
      if (!window.api || typeof window.api.logout !== 'function') {
        console.error('window.api.logout is not available');
        return;
      }
      const res = await window.api.logout();
      if (!res || !res.ok) {
        console.warn('Logout returned:', res);
      }
      // main process loads login page; no further action required here
    } catch (err) {
      console.error('Logout failed', err);
    } finally {
      btn.disabled = false;
      btn.textContent = prev;
    }
  });
})();
