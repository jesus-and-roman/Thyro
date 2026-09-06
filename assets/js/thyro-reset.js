(function () {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  const CODE_CHARSET_RE = /^[A-Za-z0-9#!"/$%?&*()+_=-]+$/;

  let activeChannel = null; // 'email' | 'sms'
  let pendingIdentifier = null;
  let parsedRecovery = null; // { username, code }

  const choiceAlert = document.getElementById("choiceAlert");
  const btnEmail = document.getElementById("btnChooseEmail");
  const btnSms = document.getElementById("btnChooseSms");
  const btnFile = document.getElementById("btnChooseFile");

  function goToStep(id) {
    document.querySelectorAll(".thyro-step").forEach((el) => el.classList.remove("is-visible"));
    document.getElementById(id).classList.add("is-visible");
  }

  function disableButton(btn, label) {
    btn.disabled = true;
    btn.textContent = label;
  }

  // ---- Vérifie la disponibilité "maison" de chaque canal au chargement ----
  async function checkChannelAvailability() {
    const [emailRes, smsRes] = await Promise.all([
      thyroSupabase.rpc("thyro_reset_channel_available", { p_channel: "email" }),
      thyroSupabase.rpc("thyro_reset_channel_available", { p_channel: "sms" }),
    ]);
    if (emailRes.data === false) disableButton(btnEmail, "Non disponible");
    if (smsRes.data === false) disableButton(btnSms, "Non disponible");
  }
  checkChannelAvailability();

  // ---- Choix du canal ----
  btnEmail.addEventListener("click", () => openRequestStep("email"));
  btnSms.addEventListener("click", () => openRequestStep("sms"));
  btnFile.addEventListener("click", () => goToStep("stepFile"));

  function openRequestStep(channel) {
    activeChannel = channel;
    thyroHideAlert(choiceAlert);
    const label = document.getElementById("requestLabel");
    const input = document.getElementById("requestIdentifier");
    if (channel === "email") {
      label.textContent = "Email";
      input.type = "email";
      input.autocomplete = "email";
    } else {
      label.textContent = "Numéro de téléphone";
      input.type = "tel";
      input.autocomplete = "tel";
    }
    input.value = "";
    goToStep("stepRequestCode");
  }

  document.getElementById("backToChoiceFromRequest").addEventListener("click", () => goToStep("stepChoice"));
  document.getElementById("backToChoiceFromFile").addEventListener("click", () => goToStep("stepChoice"));

  // ---- Étape 1a : demander le code ----
  const requestForm = document.getElementById("requestForm");
  const requestAlert = document.getElementById("requestAlert");
  const requestSubmit = document.getElementById("requestSubmit");

  requestForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    thyroHideAlert(requestAlert);

    const identifier = document.getElementById("requestIdentifier").value.trim();
    if (activeChannel === "email" && !ThyroValidate.email(identifier)) {
      thyroShowAlert(requestAlert, "Entre un courriel valide.");
      return;
    }
    if (activeChannel === "sms" && !ThyroValidate.phone(identifier)) {
      thyroShowAlert(requestAlert, "Entre un numéro de téléphone valide.");
      return;
    }

    requestSubmit.disabled = true;
    requestSubmit.textContent = "Envoi…";

    const { data: status, error } = await thyroSupabase.rpc("thyro_request_reset", {
      p_channel: activeChannel,
      p_identifier: identifier,
    });

    requestSubmit.disabled = false;
    requestSubmit.textContent = "Envoyer le code";

    if (error) {
      thyroShowAlert(requestAlert, "Une erreur est survenue. Réessaie.");
      return;
    }

    if (status === "not_found") {
      thyroShowAlert(
        requestAlert,
        activeChannel === "email"
          ? "Ce courriel n'est associé à aucun compte."
          : "Ce numéro de téléphone n'est associé à aucun compte."
      );
      return;
    }
    if (status === "rate_limited") {
      thyroShowAlert(requestAlert, "Trop de demandes pour l'instant. Réessaie plus tard.");
      return;
    }

    pendingIdentifier = identifier;
    thyroHideAlert(requestAlert);
    goToStep("stepConfirmCode");
  });

  // ---- Étape 2 : confirmer le code + nouveau mot de passe ----
  const confirmForm = document.getElementById("confirmForm");
  const confirmAlert = document.getElementById("confirmAlert");
  const confirmSubmit = document.getElementById("confirmSubmit");

  confirmForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    thyroHideAlert(confirmAlert);

    const code = document.getElementById("confirmCode").value.trim();
    const pw = document.getElementById("confirmPassword").value;
    const pwConfirm = document.getElementById("confirmPasswordConfirm").value;

    if (!/^[0-9]{6}$/.test(code)) {
      thyroShowAlert(confirmAlert, "Le code doit contenir 6 chiffres.");
      return;
    }
    if (pw.length < 8) {
      thyroShowAlert(confirmAlert, "Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    if (pw !== pwConfirm) {
      thyroShowAlert(confirmAlert, "Les mots de passe ne correspondent pas.");
      return;
    }

    confirmSubmit.disabled = true;
    confirmSubmit.textContent = "Réinitialisation…";

    const { error } = await thyroSupabase.rpc("thyro_confirm_reset", {
      p_channel: activeChannel,
      p_identifier: pendingIdentifier,
      p_code: code,
      p_new_password: pw,
    });

    confirmSubmit.disabled = false;
    confirmSubmit.textContent = "Réinitialiser le mot de passe";

    if (error) {
      thyroShowAlert(confirmAlert, "Code invalide ou expiré.");
      return;
    }

    goToStep("stepSuccess");
  });

  // ---- Étape 1b : lecture et validation du fichier de récupération ----
  const fileForm = document.getElementById("fileForm");
  const fileAlert = document.getElementById("fileAlert");
  const fileHint = document.getElementById("fileHint");
  const fileInput = document.getElementById("recoveryFile");
  const fileSubmit = document.getElementById("fileSubmit");

  fileInput.addEventListener("change", async () => {
    parsedRecovery = null;
    thyroSetHint(fileHint, "");
    thyroHideAlert(fileAlert);

    const file = fileInput.files[0];
    if (!file) return;

    thyroSetHint(fileHint, "Lecture du fichier…");

    try {
      const buffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

      const lines = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        content.items.forEach((item) => lines.push(item.str));
      }

      const usernameLine = lines.find((l) => l.includes("Nom d'utilisateur"));
      const usernameMatch = usernameLine && usernameLine.match(/Nom d'utilisateur\s*:\s*(.+)/);
      const username = usernameMatch ? usernameMatch[1].trim() : null;

      const code = lines.filter((l) => CODE_CHARSET_RE.test(l)).join("");

      if (!username || code.length !== 520) {
        thyroSetHint(fileHint, "Ce fichier n'est pas correctement formulé.", "error");
        return;
      }

      parsedRecovery = { username, code };
      thyroSetHint(fileHint, "Fichier reconnu.", "ok");
    } catch (err) {
      thyroSetHint(fileHint, "Ce fichier n'est pas correctement formulé.", "error");
    }
  });

  fileForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    thyroHideAlert(fileAlert);

    if (!parsedRecovery) {
      thyroShowAlert(fileAlert, "Choisis d'abord un fichier de récupération valide.");
      return;
    }

    const pw = document.getElementById("filePassword").value;
    const pwConfirm = document.getElementById("filePasswordConfirm").value;

    if (pw.length < 8) {
      thyroShowAlert(fileAlert, "Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    if (pw !== pwConfirm) {
      thyroShowAlert(fileAlert, "Les mots de passe ne correspondent pas.");
      return;
    }

    fileSubmit.disabled = true;
    fileSubmit.textContent = "Réinitialisation…";

    const { error } = await thyroSupabase.rpc("thyro_confirm_reset_with_file", {
      p_username: parsedRecovery.username,
      p_code: parsedRecovery.code,
      p_new_password: pw,
    });

    fileSubmit.disabled = false;
    fileSubmit.textContent = "Réinitialiser le mot de passe";

    if (error) {
      thyroShowAlert(fileAlert, "Ce fichier n'est pas correctement formulé, ou ne correspond à aucun compte.");
      return;
    }

    goToStep("stepSuccess");
  });
})();
