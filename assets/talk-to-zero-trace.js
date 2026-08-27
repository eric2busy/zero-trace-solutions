(() => {
  const STORAGE_KEY = 'ztTalkSession.v2';
  const OPEN_KEY = 'ztTalkOpen.v2';
  const MAX_MESSAGES = 12;
  const quickActions = [
    { number: '01', label: 'How treatment works', message: 'How does the Zero Trace treatment process work?' },
    { number: '02', label: 'Pricing & estimates', message: 'How does pricing work, and how can I get an estimate?' },
    { number: '03', label: 'Is Zero Trace right for my facility?', message: 'Can you help me understand whether Zero Trace is a fit for my facility?' },
    { number: '04', label: 'Schedule a walkthrough', booking: true },
  ];

  const safeId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const readSession = () => {
    try {
      const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
      if (stored && typeof stored.id === 'string' && Array.isArray(stored.messages)) {
        return { id: stored.id, messages: stored.messages.slice(-MAX_MESSAGES).filter((item) => item && ['user', 'assistant'].includes(item.role) && typeof item.text === 'string') };
      }
    } catch {}
    return { id: safeId(), messages: [] };
  };

  const session = readSession();
  let lastFocus = null;
  let sending = false;
  let lastFailedText = '';
  let leadId = null;
  let leadData = null;
  let selectedSlot = null;

  const root = document.createElement('div');
  root.id = 'zt-talk-root';
  root.innerHTML = `
    <button class="zt-talk-launcher" type="button" aria-label="Questions?" aria-haspopup="dialog" aria-expanded="false" aria-controls="zt-talk-panel">
      <span class="zt-talk-launcher-mark" aria-hidden="true">ZT</span><span>Questions?</span>
    </button>
    <div class="zt-talk-backdrop" data-open="false" aria-hidden="true"></div>
    <section id="zt-talk-panel" class="zt-talk-panel" data-open="false" role="dialog" aria-modal="true" aria-labelledby="zt-talk-title" aria-hidden="true">
      <header class="zt-talk-topbar">
        <div class="zt-talk-brand"><span class="zt-talk-brand-mark" aria-hidden="true">ZT</span><div><h2 id="zt-talk-title" class="zt-talk-brand-title">Zero Trace</h2><p class="zt-talk-brand-status">Here when you need us</p></div></div>
        <div class="zt-talk-top-actions"><button class="zt-talk-reset" type="button" hidden>Start over</button><button class="zt-talk-close" type="button" aria-label="Close"></button></div>
      </header>
      <div class="zt-talk-body">
        <div class="zt-talk-scroll">
          <section class="zt-talk-view zt-talk-welcome">
            <p class="zt-talk-eyebrow">Talk to Zero Trace</p><h3 class="zt-talk-heading">How can we help?</h3>
            <p class="zt-talk-intro">Get clear answers about treatment, estimates, facility fit, or planning a walkthrough.</p>
            <div class="zt-talk-guides"></div>
          </section>
          <section class="zt-talk-view zt-talk-conversation" hidden aria-live="polite"><div class="zt-talk-thread"></div></section>
          <section class="zt-talk-view zt-talk-booking" hidden></section>
        </div>
        <footer class="zt-talk-composer">
          <form class="zt-talk-form"><label class="sr-only" for="zt-talk-input">Ask Zero Trace a question</label><textarea id="zt-talk-input" class="zt-talk-input" rows="1" maxlength="1200" placeholder="Ask about your space…" required></textarea><button class="zt-talk-send" type="submit" aria-label="Send message"></button></form>
          <p class="zt-talk-privacy">Please don’t share passwords, card numbers, IDs, or medical records.</p>
        </footer>
      </div>
    </section>`;
  document.body.appendChild(root);

  const launcher = root.querySelector('.zt-talk-launcher');
  const backdrop = root.querySelector('.zt-talk-backdrop');
  const panel = root.querySelector('.zt-talk-panel');
  const closeButton = root.querySelector('.zt-talk-close');
  const resetButton = root.querySelector('.zt-talk-reset');
  const scroll = root.querySelector('.zt-talk-scroll');
  const welcomeView = root.querySelector('.zt-talk-welcome');
  const conversationView = root.querySelector('.zt-talk-conversation');
  const bookingView = root.querySelector('.zt-talk-booking');
  const thread = root.querySelector('.zt-talk-thread');
  const composer = root.querySelector('.zt-talk-composer');
  const chatForm = root.querySelector('.zt-talk-form');
  const input = root.querySelector('.zt-talk-input');
  const sendButton = root.querySelector('.zt-talk-send');

  const saveSession = () => sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ id: session.id, messages: session.messages.slice(-MAX_MESSAGES) }));
  const scrollToEnd = () => requestAnimationFrame(() => { scroll.scrollTop = scroll.scrollHeight; });
  const makeButton = (text, style, handler) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'zt-talk-inline-action';
    if (style) button.dataset.style = style;
    button.textContent = text;
    button.addEventListener('click', handler);
    return button;
  };

  function showView(name) {
    welcomeView.hidden = name !== 'welcome';
    conversationView.hidden = name !== 'conversation';
    bookingView.hidden = name !== 'booking';
    composer.hidden = name === 'booking';
    resetButton.hidden = name === 'welcome';
    scroll.scrollTop = 0;
  }

  function openPanel() {
    lastFocus = document.activeElement;
    launcher.setAttribute('aria-expanded', 'true');
    panel.dataset.open = 'true';
    panel.setAttribute('aria-hidden', 'false');
    backdrop.dataset.open = 'true';
    document.body.classList.add('zt-talk-locked');
    sessionStorage.setItem(OPEN_KEY, 'true');
    requestAnimationFrame(() => (session.messages.length ? input : root.querySelector('.zt-talk-guide'))?.focus());
  }

  function closePanel() {
    launcher.setAttribute('aria-expanded', 'false');
    panel.dataset.open = 'false';
    panel.setAttribute('aria-hidden', 'true');
    backdrop.dataset.open = 'false';
    document.body.classList.remove('zt-talk-locked');
    sessionStorage.removeItem(OPEN_KEY);
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus(); else launcher.focus();
  }

  function renderMessages() {
    thread.innerHTML = '';
    session.messages.forEach(({ role, text }) => addBubble(role, text, false));
  }

  function addBubble(role, text, persist = true) {
    const bubble = document.createElement('div');
    bubble.className = 'zt-talk-message';
    bubble.dataset.role = role === 'user' ? 'user' : 'service';
    bubble.textContent = text;
    thread.appendChild(bubble);
    if (persist) {
      session.messages.push({ role: role === 'user' ? 'user' : 'assistant', text });
      session.messages.splice(0, Math.max(0, session.messages.length - MAX_MESSAGES));
      saveSession();
    }
    scrollToEnd();
  }

  function addHandoff() {
    if (thread.querySelector('.zt-talk-handoff')) return;
    const card = document.createElement('div');
    card.className = 'zt-talk-handoff';
    card.innerHTML = '<h3>Ready for the next step?</h3><p>Share a few details, view verified availability, and confirm only after your selected time is re-checked.</p>';
    const actions = document.createElement('div');
    actions.className = 'zt-talk-handoff-actions';
    actions.append(makeButton('Plan a walkthrough', '', openBooking));
    card.appendChild(actions);
    thread.appendChild(card);
    scrollToEnd();
  }

  function addUnavailable(message) {
    const existing = thread.querySelector('.zt-talk-unavailable');
    if (existing) existing.remove();
    const card = document.createElement('div');
    card.className = 'zt-talk-unavailable';
    const title = document.createElement('h3');
    title.textContent = 'We’re briefly unavailable';
    const copy = document.createElement('p');
    copy.textContent = message || 'Please try again in a moment, or email the Zero Trace team for a direct answer.';
    const actions = document.createElement('div');
    actions.className = 'zt-talk-unavailable-actions';
    actions.append(makeButton('Try again', '', () => lastFailedText && sendMessage(lastFailedText, true)));
    const email = document.createElement('a');
    email.className = 'zt-talk-inline-action';
    email.dataset.style = 'quiet';
    email.href = 'mailto:support@zerotraceusa.com';
    email.textContent = 'Email the team';
    actions.append(email);
    card.append(title, copy, actions);
    thread.appendChild(card);
    scrollToEnd();
  }

  async function sendMessage(rawText, retry = false) {
    const text = rawText.trim();
    if (!text || sending) return;
    showView('conversation');
    if (!retry) addBubble('user', text);
    root.querySelector('.zt-talk-unavailable')?.remove();
    sending = true;
    sendButton.disabled = true;
    input.disabled = true;
    const pending = document.createElement('div');
    pending.className = 'zt-talk-pending';
    pending.textContent = 'Checking approved information';
    thread.appendChild(pending);
    scrollToEnd();
    try {
      const response = await fetch('/api/concierge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: session.id, messages: session.messages }) });
      const data = await response.json().catch(() => ({}));
      pending.remove();
      if (!response.ok) throw new Error(data.error || 'Please try again in a moment, or email the Zero Trace team.');
      session.id = data.sessionId || session.id;
      addBubble('assistant', data.message.text);
      lastFailedText = '';
      if (['lead', 'availability', 'booking'].includes(data.handoff?.type)) addHandoff();
      if (data.escalation?.required && data.handoff?.type === 'support') {
        const note = document.createElement('div');
        note.className = 'zt-talk-handoff';
        note.innerHTML = '<h3>A person should confirm this.</h3><p>We won’t make an unsupported promise. Email support@zerotraceusa.com for a direct answer.</p>';
        const actions = document.createElement('div');
        actions.className = 'zt-talk-handoff-actions';
        const email = document.createElement('a');
        email.className = 'zt-talk-inline-action'; email.href = 'mailto:support@zerotraceusa.com'; email.textContent = 'Email the team';
        actions.append(email); note.append(actions); thread.append(note);
      }
    } catch (error) {
      pending.remove();
      lastFailedText = text;
      addUnavailable(error.message);
    } finally {
      sending = false;
      sendButton.disabled = false;
      input.disabled = false;
      input.focus();
    }
  }

  function resetConversation() {
    session.id = safeId();
    session.messages = [];
    sessionStorage.removeItem(STORAGE_KEY);
    thread.innerHTML = '';
    input.value = '';
    lastFailedText = '';
    leadId = null; leadData = null; selectedSlot = null;
    showView('welcome');
    root.querySelector('.zt-talk-guide')?.focus();
  }

  function prettyDate(value) {
    const [year, month, day] = value.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(year, month - 1, day, 12));
  }

  function openBooking() {
    showView('booking');
    bookingView.innerHTML = `
      <div class="zt-talk-booking-head"><button class="zt-talk-back" type="button" aria-label="Back to conversation">←</button><div><h3 class="zt-talk-booking-title">Plan a walkthrough</h3><p class="zt-talk-booking-copy">Tell us about your space, then choose from verified times.</p></div></div>
      <form class="zt-talk-lead-form zt-talk-fields">
        <input class="zt-talk-field" name="name" required maxlength="120" autocomplete="name" placeholder="Full name *">
        <div class="zt-talk-field-row"><input class="zt-talk-field" name="email" type="email" required maxlength="120" autocomplete="email" placeholder="Email *"><input class="zt-talk-field" name="phone" type="tel" required maxlength="40" autocomplete="tel" placeholder="Phone *"></div>
        <select class="zt-talk-select" name="businessType" required><option value="">Facility type *</option><option>Office</option><option>Classroom</option><option>Commercial</option><option>Other</option></select>
        <input class="zt-talk-field" name="location" required maxlength="200" autocomplete="street-address" placeholder="Service location / city *">
        <div class="zt-talk-field-row"><input class="zt-talk-field" name="preferredDate" type="date" required><select class="zt-talk-select" name="preferredTime"><option>Flexible</option><option>Morning</option><option>Afternoon</option></select></div>
        <textarea class="zt-talk-textarea" name="notes" rows="3" maxlength="1000" placeholder="Areas of concern, access needs, or restrictions"></textarea>
        <button class="zt-talk-primary zt-talk-lead-submit" type="submit">See verified times</button><p class="zt-talk-form-message" aria-live="polite"></p>
      </form>`;
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    bookingView.querySelector('[name="preferredDate"]').min = tomorrow.toISOString().slice(0, 10);
    bookingView.querySelector('.zt-talk-back').addEventListener('click', () => showView(session.messages.length ? 'conversation' : 'welcome'));
    bookingView.querySelector('form').addEventListener('submit', submitLead);
    scroll.scrollTop = 0;
    bookingView.querySelector('[name="name"]').focus();
  }

  async function submitLead(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('.zt-talk-lead-submit');
    const message = form.querySelector('.zt-talk-form-message');
    button.disabled = true; button.textContent = 'Saving request…'; message.textContent = '';
    try {
      leadData = Object.fromEntries(new FormData(form).entries());
      const response = await fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(leadData) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'We could not save the request.');
      leadId = data.id;
      await loadAvailability();
    } catch (error) {
      message.textContent = error.message || 'Something went wrong. Please try again.';
      button.disabled = false; button.textContent = 'See verified times';
    }
  }

  async function loadAvailability() {
    selectedSlot = null;
    bookingView.innerHTML = `<div class="zt-talk-booking-head"><button class="zt-talk-back" type="button" aria-label="Back to walkthrough details">←</button><div><h3 class="zt-talk-booking-title">Choose a verified time</h3><p class="zt-talk-booking-copy">${prettyDate(leadData.preferredDate)} · ${leadData.preferredTime || 'Flexible'}</p></div></div><p class="zt-talk-booking-copy zt-talk-slot-message" aria-live="polite">Checking the live schedule…</p><div class="zt-talk-slots"></div><button class="zt-talk-primary zt-talk-book" type="button" disabled>Confirm walkthrough</button>`;
    bookingView.querySelector('.zt-talk-back').addEventListener('click', openBooking);
    const params = new URLSearchParams({ date: leadData.preferredDate, window: leadData.preferredTime || 'Flexible' });
    const message = bookingView.querySelector('.zt-talk-slot-message');
    const slots = bookingView.querySelector('.zt-talk-slots');
    const book = bookingView.querySelector('.zt-talk-book');
    try {
      const response = await fetch(`/api/availability?${params}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'We could not load availability.');
      if (!data.slots?.length) { message.textContent = 'No verified times match. Go back and choose another date.'; return; }
      message.textContent = 'Your choice will be re-checked before confirmation.';
      data.slots.forEach((slot) => {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'zt-talk-slot'; button.textContent = slot.label; button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => { slots.querySelectorAll('.zt-talk-slot').forEach((item) => item.setAttribute('aria-pressed', 'false')); button.setAttribute('aria-pressed', 'true'); selectedSlot = slot; book.disabled = false; });
        slots.appendChild(button);
      });
      book.addEventListener('click', confirmBooking);
    } catch (error) {
      message.textContent = error.message || 'We could not load availability. Please go back and try another date.';
    }
    scroll.scrollTop = 0;
  }

  async function confirmBooking() {
    if (!leadId || !selectedSlot) return;
    const button = bookingView.querySelector('.zt-talk-book');
    const message = bookingView.querySelector('.zt-talk-slot-message');
    button.disabled = true; button.textContent = 'Re-checking…';
    try {
      const response = await fetch('/api/book', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...leadData, leadId, start: selectedSlot.start, end: selectedSlot.end }) });
      const data = await response.json().catch(() => ({}));
      if (response.status === 409) { message.textContent = data.error || 'That time is no longer open.'; await loadAvailability(); return; }
      if (!response.ok) throw new Error(data.error || 'We could not confirm the walkthrough.');
      bookingView.innerHTML = `<div class="zt-talk-confirmed" aria-live="polite"><div class="zt-talk-check" aria-hidden="true">✓</div><p class="zt-talk-eyebrow">Confirmed</p><h3 class="zt-talk-booking-title">Your walkthrough is booked.</h3><p class="zt-talk-booking-copy">${prettyDate(leadData.preferredDate)} at ${selectedSlot.label} · ${leadData.location}</p><button class="zt-talk-primary zt-talk-done" type="button" style="margin-top:20px">Back to conversation</button></div>`;
      bookingView.querySelector('.zt-talk-done').addEventListener('click', () => showView(session.messages.length ? 'conversation' : 'welcome'));
    } catch (error) {
      message.textContent = error.message || 'We could not confirm this time. Please try again.';
      button.disabled = false;
    } finally { if (button.isConnected) button.textContent = 'Confirm walkthrough'; }
  }

  root.querySelector('.zt-talk-guides').append(...quickActions.map((item) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'zt-talk-guide';
    button.innerHTML = `<span class="zt-talk-guide-number">${item.number}</span><span>${item.label}</span><span class="zt-talk-guide-arrow" aria-hidden="true">↗</span>`;
    button.addEventListener('click', () => item.booking ? openBooking() : sendMessage(item.message));
    return button;
  }));

  launcher.addEventListener('click', openPanel);
  document.querySelectorAll('[data-zt-talk-open]').forEach((element) => element.addEventListener('click', (event) => { event.preventDefault(); openPanel(); }));
  closeButton.addEventListener('click', closePanel);
  backdrop.addEventListener('click', closePanel);
  resetButton.addEventListener('click', resetConversation);
  chatForm.addEventListener('submit', (event) => { event.preventDefault(); const text = input.value; input.value = ''; sendMessage(text); });
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); chatForm.requestSubmit(); } });
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { closePanel(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...panel.querySelectorAll('button:not([disabled]):not([hidden]),a[href],textarea:not([disabled]),input:not([disabled]),select:not([disabled])')].filter((element) => !element.closest('[hidden]'));
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  if (session.messages.length) { renderMessages(); showView('conversation'); } else showView('welcome');
  const params = new URLSearchParams(location.search);
  if (params.get('talk') === 'open' || sessionStorage.getItem(OPEN_KEY) === 'true') openPanel();
})();
