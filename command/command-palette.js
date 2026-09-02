(() => {
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  let controller;

  function openPalette() {
    const dialog = document.getElementById('commandPalette');
    if (!dialog) return;
    dialog.hidden = false;
    dialog.querySelector('input')?.focus();
  }

  function closePalette() {
    const dialog = document.getElementById('commandPalette');
    if (dialog) dialog.hidden = true;
    controller?.abort();
  }

  function render(container, data) {
    const groups = data.groups || [];
    container.innerHTML = groups.length ? groups.map(group => `<section class="command-palette-group"><h3>${escapeHtml(group.type)}</h3>${group.items.map(item => `<button type="button" class="command-result" data-command-section="${escapeHtml(item.section)}"><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.subtitle)}</small></span><em>${escapeHtml(item.type)}</em></button>`).join('')}</section>`).join('') : '<div class="command-palette-empty"><strong>No matching Command records</strong><span>Try a customer, organization, job, booking, or approval.</span></div>';
    container.querySelectorAll('[data-command-section]').forEach(button => button.addEventListener('click', () => {
      closePalette();
      window.CommandNavigation?.show(button.dataset.commandSection);
    }));
  }

  async function search(value, container) {
    const query = value.trim();
    if (!query) { container.innerHTML = '<div class="command-palette-empty"><strong>Search Command</strong><span>Customers, organizations, jobs, bookings, and approvals.</span></div>'; return; }
    controller?.abort(); controller = new AbortController();
    container.innerHTML = '<div class="command-palette-empty"><strong>Searching Command</strong><span>Retrieving authorized records.</span></div>';
    try {
      const response = await fetch(`/api/command-data?resource=search&q=${encodeURIComponent(query)}`, { credentials: 'same-origin', headers: { Accept: 'application/json' }, signal: controller.signal });
      if (response.status === 401) { window.location.assign('/command/login/'); return; }
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'command_search_read_failed');
      render(container, payload.data || {});
    } catch (error) {
      if (error.name !== 'AbortError') container.innerHTML = '<div class="command-palette-empty"><strong>Search unavailable</strong><span>Command did not substitute fixture data. Please try again.</span></div>';
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    const dialog = document.getElementById('commandPalette');
    const input = document.getElementById('commandPaletteInput');
    const results = document.getElementById('commandPaletteResults');
    document.querySelectorAll('[data-command-trigger]').forEach(button => button.addEventListener('click', openPalette));
    dialog?.querySelector('[data-command-close]')?.addEventListener('click', closePalette);
    dialog?.addEventListener('click', event => { if (event.target === dialog) closePalette(); });
    input?.addEventListener('input', () => search(input.value, results));
    document.addEventListener('keydown', event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openPalette(); }
      if (event.key === 'Escape' && !dialog.hidden) closePalette();
    });
  }, { once: true });
})();
