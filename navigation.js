(() => {
  const normalise = (value = {}) => ({
    navigationLayout: value.navigationLayout === 'topbar' ? 'topbar' : 'sidebar',
    sidebarCollapsed: value.sidebarCollapsed === true
  });

  // Coalesce rapid edits while keeping only one account write in flight.
  function preferenceQueue({ save, apply, status }) {
    let confirmed = normalise(), desired = confirmed, ready = false, running = false, revision = 0;
    async function flush() {
      if (running) return;
      running = true;
      while (JSON.stringify(desired) !== JSON.stringify(confirmed)) {
        const sent = { ...desired }, sentRevision = revision;
        status('Saving navigation…');
        try {
          confirmed = normalise(await save(sent));
          if (revision === sentRevision) { desired = confirmed; apply(confirmed); }
        } catch {
          if (revision === sentRevision) {
            desired = confirmed;
            apply(confirmed);
            status('Navigation could not be saved. Your previous setting has been restored.', true);
            running = false;
            return;
          }
        }
      }
      running = false;
      status('Navigation saved to your account.');
    }
    return {
      load(value) {
        if (ready || running) return;
        ready = true;
        confirmed = desired = normalise(value);
        apply(desired);
      },
      change(patch) {
        if (!ready) return;
        desired = normalise({ ...desired, ...patch });
        revision += 1;
        apply(desired);
        void flush();
      }
    };
  }

  function initialise({ api, toast, setIcon, closeAccountMenu, onSaved }) {
    const shell = document.querySelector('.app-shell');
    const rail = document.querySelector('.rail');
    const nav = document.querySelector('.rail-nav');
    const toggle = document.querySelector('#rail-toggle');
    const mobileToggle = document.querySelector('#mobile-nav-toggle');
    const choice = document.querySelector('#navigation-choice');
    const statusText = document.querySelector('#navigation-status');
    const buttons = [...nav.querySelectorAll('[data-view]')];
    const indicator = document.querySelector('.nav-indicator');
    const tooltip = document.querySelector('#navigation-tooltip');
    const phone = matchMedia('(max-width: 720px)');
    let current = normalise(), tooltipButton = null, frame;

    function hideTooltip() { tooltip.hidden = true; tooltipButton = null; }
    function measure() {
      shell.style.setProperty('--nav-height', `${phone.matches || current.navigationLayout === 'topbar' ? rail.getBoundingClientRect().height : 0}px`);
      const selected = nav.querySelector('[aria-current="page"]');
      if (selected && nav.getClientRects().length) {
        indicator.style.width = `${selected.offsetWidth}px`;
        indicator.style.height = `${selected.offsetHeight}px`;
        indicator.style.transform = `translate(${selected.offsetLeft}px, ${selected.offsetTop}px)`;
      }
    }
    function scheduleMeasure() { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); }
    function closeMobile({ restoreFocus = false } = {}) {
      const wasOpen = shell.classList.contains('mobile-nav-open');
      shell.classList.remove('mobile-nav-open');
      mobileToggle.setAttribute('aria-expanded', 'false');
      mobileToggle.setAttribute('aria-label', 'Open navigation menu');
      hideTooltip();
      if (wasOpen && restoreFocus) mobileToggle.focus();
    }
    function apply(value) {
      current = value;
      shell.dataset.navigationLayout = value.navigationLayout;
      shell.classList.toggle('rail-open', !value.sidebarCollapsed);
      toggle.setAttribute('aria-expanded', String(!value.sidebarCollapsed));
      toggle.setAttribute('aria-label', value.sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation');
      setIcon(toggle, value.sidebarCollapsed ? 'panel-left-open' : 'panel-left-close');
      choice.querySelectorAll('input').forEach(input => { input.checked = input.value === value.navigationLayout; });
      closeMobile();
      closeAccountMenu();
      scheduleMeasure();
    }
    const queue = preferenceQueue({
      save: async value => {
        const result = await api('/api/account', { method: 'PATCH', body: JSON.stringify(value) });
        onSaved(normalise(result.account));
        return result.account;
      },
      apply,
      status: (message, failed) => { statusText.textContent = message; if (failed) toast(message); }
    });
    toggle.addEventListener('click', () => queue.change({ sidebarCollapsed: !current.sidebarCollapsed }));
    choice.addEventListener('change', event => { if (event.target.matches('input')) queue.change({ navigationLayout: event.target.value }); });
    mobileToggle.addEventListener('click', () => {
      if (shell.classList.contains('mobile-nav-open')) { closeMobile(); return; }
      closeAccountMenu();
      shell.classList.add('mobile-nav-open');
      mobileToggle.setAttribute('aria-expanded', 'true');
      mobileToggle.setAttribute('aria-label', 'Close navigation menu');
      measure();
      (nav.querySelector('[aria-current="page"]') || buttons[0]).focus();
    });
    document.querySelector('#avatar').addEventListener('click', () => closeMobile());
    buttons.forEach(button => {
      button.addEventListener('click', () => closeMobile({ restoreFocus: true }));
      const showTooltip = () => {
        if (phone.matches || current.navigationLayout !== 'sidebar' || !current.sidebarCollapsed) return;
        tooltip.textContent = button.querySelector('.rail-label').textContent;
        tooltip.hidden = false;
        tooltipButton = button;
        const rect = button.getBoundingClientRect();
        tooltip.style.left = `${rect.right + 20}px`;
        tooltip.style.top = `${Math.max(8, Math.min(innerHeight - tooltip.offsetHeight - 8, rect.top + (rect.height - tooltip.offsetHeight) / 2))}px`;
      };
      button.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') showTooltip(); });
      button.addEventListener('focus', showTooltip);
      button.addEventListener('pointerleave', () => { if (document.activeElement !== button) hideTooltip(); });
      button.addEventListener('blur', hideTooltip);
    });
    document.addEventListener('click', event => { if (!nav.contains(event.target) && !mobileToggle.contains(event.target)) closeMobile(); });
    document.addEventListener('focusin', event => { if (!rail.contains(event.target)) closeMobile(); });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        if (shell.classList.contains('mobile-nav-open')) event.preventDefault();
        closeMobile({ restoreFocus: true }); hideTooltip();
      }
    });
    phone.addEventListener('change', () => {
      const focused = document.activeElement;
      closeMobile(); closeAccountMenu();
      if (phone.matches && (nav.contains(focused) || focused === toggle)) mobileToggle.focus();
      if (!phone.matches && focused === mobileToggle) (nav.querySelector('[aria-current="page"]') || buttons[0]).focus();
      scheduleMeasure();
    });
    window.addEventListener('hashchange', () => { closeMobile(); scheduleMeasure(); });
    window.addEventListener('resize', () => { if (tooltipButton) hideTooltip(); scheduleMeasure(); });
    new ResizeObserver(scheduleMeasure).observe(rail);
    new ResizeObserver(scheduleMeasure).observe(nav);
    new MutationObserver(scheduleMeasure).observe(nav, { subtree: true, attributes: true, attributeFilter: ['aria-current'] });
    document.fonts?.ready.then(scheduleMeasure);
    apply(current);
    return {
      load(value) { queue.load(value); choice.disabled = false; toggle.disabled = false; },
      closeMobile
    };
  }
  window.ArcadiaNavigation = { initialise, preferenceQueue };
})();
