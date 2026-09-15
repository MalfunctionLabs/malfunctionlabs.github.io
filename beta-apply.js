(function () {
  'use strict';
  var form = document.getElementById('beta-form');
  var button = document.getElementById('beta-submit');
  var status = document.getElementById('beta-status');
  var config = window.ML_BETA_CONFIG || {};
  var token = '', widget, submitting = false, completed = false;
  function say(message, kind) {
    status.textContent = message;
    status.className = 'form-status ' + (kind || '');
  }
  function updateButton() { button.disabled = submitting || completed || !token; }
  // Prevent a default GET from ever putting an applicant's details into the URL.
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (submitting || completed || !token || !config.endpoint || !form.reportValidity()) return;
    var payload = {};
    ['display_name', 'email', 'discord', 'platform', 'specs', 'availability', 'experience', 'motivation', 'company'].forEach(function (name) {
      payload[name] = form.elements.namedItem(name).value.trim();
    });
    payload.contact_consent = form.elements.namedItem('contact_consent').checked;
    payload.turnstile_token = token;
    submitting = true; updateButton(); say('Sending your application…', 'busy');
    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 25000);
    try {
      var response = await fetch(config.endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: controller.signal,
      });
      var result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Application could not be saved. Please try again.');
      if (typeof result.message !== 'string') throw new Error('We could not confirm receipt. Please retry.');
      completed = true;
      say(result.message, 'ok'); form.reset(); button.textContent = 'Application received';
      window.turnstile.remove(widget);
    } catch (error) {
      say(error.name === 'AbortError' || error instanceof TypeError
        ? 'We could not confirm receipt. Check your connection and try again; retries will not create another application.'
        : error.message, 'err');
    } finally {
      clearTimeout(timeout); submitting = false; token = '';
      if (!completed && window.turnstile && widget !== undefined) window.turnstile.reset(widget);
      updateButton();
    }
  });
  if (!config.endpoint || !config.turnstileSiteKey) {
    say('Applications are not open yet. Please check back soon.', 'busy');
    return;
  }
  window.mlBetaTurnstileReady = function () {
    try {
      widget = window.turnstile.render('#beta-challenge', {
        sitekey: config.turnstileSiteKey, action: 'beta_apply', theme: 'dark', size: window.innerWidth < 360 ? 'compact' : 'flexible',
        callback: function (value) {
          token = value; updateButton();
          if (!submitting && !completed && !status.classList.contains('err')) say('Ready to submit.');
        },
        'expired-callback': function () { token = ''; updateButton(); if (!submitting) say('Please complete the anti-spam check again.'); },
        'error-callback': function () { token = ''; updateButton(); if (!submitting) say('Anti-spam check could not load. Please refresh and try again.', 'err'); },
      });
      say('Complete the form and anti-spam check.');
    } catch { say('Anti-spam check could not load. Please refresh and try again.', 'err'); }
  };
  var script = document.createElement('script');
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=mlBetaTurnstileReady&render=explicit';
  script.async = true;
  script.onerror = function () { say('Anti-spam check could not load. Please refresh and try again.', 'err'); };
  document.head.appendChild(script);
})();
