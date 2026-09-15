// PUBLIC configuration. Never put service-role keys or the Turnstile secret here.
window.ML_BETA_CONFIG = Object.freeze({
  endpoint: 'https://rgptpqjdxwpshiqolksa.supabase.co/functions/v1/beta-apply',
  // Set the public Turnstile site key after deploying the backend.
  turnstileSiteKey: '',
});
