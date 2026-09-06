// Client Supabase partagé — Thyro (valeurs lues depuis assets/config.js)
const thyroSupabase = supabase.createClient(
  THYRO_CONFIG.supabaseUrl,
  THYRO_CONFIG.publishableKey
);

// ---- Validation partagée (miroir des contraintes SQL) ----
const ThyroValidate = {
  NAME_RE: /^[A-Za-zÀ-ÖØ-öø-ÿĀ-ſ]{1,20}$/,
  USERNAME_RE: /^[A-Za-z0-9_.-]{3,20}$/,
  EMAIL_RE: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  PHONE_RE: /^\+?[0-9][0-9\s().-]{7,18}$/,

  name(v) { return this.NAME_RE.test(v || ""); },
  username(v) { return this.USERNAME_RE.test(v || ""); },
  email(v) { return this.EMAIL_RE.test(v || ""); },
  phone(v) { return this.PHONE_RE.test(v || ""); },
  pin(v) { return typeof v === "string" && v.length >= 6 && v.length <= 12 && !/\s/.test(v); },

  password(pw, username) {
    if (!pw || pw.length < 8) return { ok: false, reason: "password_too_short" };
    if (username && pw.toLowerCase().includes(username.toLowerCase())) {
      return { ok: false, reason: "password_contains_username" };
    }
    return { ok: true };
  },

  minBirthdate() { return "1926-01-01"; },
  maxBirthdate() {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 13);
    return d.toISOString().slice(0, 10);
  },
  birthdate(v) {
    if (!v) return false;
    return v >= this.minBirthdate() && v <= this.maxBirthdate();
  },
};

function thyroDebounce(fn, delay = 400) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

function thyroSetHint(el, message, state) {
  el.textContent = message || "";
  el.classList.remove("is-error", "is-ok");
  if (state) el.classList.add(state === "ok" ? "is-ok" : "is-error");
}

function thyroShowAlert(el, message, kind = "error") {
  el.textContent = message;
  el.classList.remove("is-error", "is-success");
  el.classList.add(kind === "error" ? "is-error" : "is-success", "is-visible");
}

function thyroHideAlert(el) {
  el.classList.remove("is-visible");
}

// Traduction des erreurs renvoyées par les fonctions Postgres (RPC)
const THYRO_ERROR_MESSAGES = {
  password_too_short: "Le mot de passe doit contenir au moins 8 caractères.",
  pin_invalid_length: "Le NIP doit contenir entre 6 et 12 caractères.",
  password_contains_username: "Le mot de passe ne doit pas contenir le nom d'utilisateur.",
  email_or_phone_required: "Un courriel ou un numéro de téléphone est requis.",
  already_taken: "Ce nom d'utilisateur, ce courriel ou ce numéro est déjà utilisé.",
  invalid_credentials: "Identifiants invalides.",
};

function thyroErrorMessage(err) {
  const raw = err?.message || err?.details || "";
  for (const key of Object.keys(THYRO_ERROR_MESSAGES)) {
    if (raw.includes(key)) return THYRO_ERROR_MESSAGES[key];
  }
  return "Une erreur est survenue. Réessaie dans un instant.";
}
