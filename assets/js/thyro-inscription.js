(function () {
  let mode = "email"; // 'email' | 'phone'
  let createdUser = null; // { id, username }

  const identifierField = document.getElementById("signupIdentifierField");
  const toggleBtn = document.getElementById("toggleSignupMode");
  const alertBox = document.getElementById("signupAlert");
  const form = document.getElementById("signupForm");
  const submitBtn = document.getElementById("signupSubmit");

  const usernameInput = document.getElementById("suUsername");
  const firstNameInput = document.getElementById("suFirstName");
  const lastNameInput = document.getElementById("suLastName");
  const passwordInput = document.getElementById("suPassword");
  const birthdateInput = document.getElementById("suBirthdate");
  const pinInput = document.getElementById("suPin");

  birthdateInput.min = ThyroValidate.minBirthdate();
  birthdateInput.max = ThyroValidate.maxBirthdate();

  // ---- Bascule email / téléphone ----
  function renderIdentifierField() {
    if (mode === "email") {
      identifierField.innerHTML = `
        <label for="suEmail">Email</label>
        <input type="email" id="suEmail" name="suEmail" autocomplete="email" required>
        <span class="thyro-hint" id="signupIdentifierHint"></span>
      `;
      toggleBtn.textContent = "S'inscrire avec un numéro de téléphone";
    } else {
      identifierField.innerHTML = `
        <label for="suPhone">Numéro de téléphone</label>
        <input type="tel" id="suPhone" name="suPhone" autocomplete="tel" required>
        <span class="thyro-hint" id="signupIdentifierHint"></span>
      `;
      toggleBtn.textContent = "S'inscrire avec un courriel";
    }
    attachIdentifierCheck();
  }

  function attachIdentifierCheck() {
    const hint = document.getElementById("signupIdentifierHint");
    const input = mode === "email"
      ? document.getElementById("suEmail")
      : document.getElementById("suPhone");

    input.addEventListener("input", thyroDebounce(async () => {
      const value = input.value.trim();
      if (!value) { thyroSetHint(hint, ""); return; }

      if (mode === "email" && !ThyroValidate.email(value)) {
        thyroSetHint(hint, "Format de courriel invalide.", "error");
        return;
      }
      if (mode === "phone" && !ThyroValidate.phone(value)) {
        thyroSetHint(hint, "Format de numéro invalide.", "error");
        return;
      }

      const rpcName = mode === "email" ? "thyro_email_available" : "thyro_phone_available";
      const rpcArg = mode === "email" ? { p_email: value } : { p_phone: value };
      const { data, error } = await thyroSupabase.rpc(rpcName, rpcArg);
      if (error) return;
      thyroSetHint(hint, data ? "Disponible." : "Déjà utilisé.", data ? "ok" : "error");
    }));
  }

  toggleBtn.addEventListener("click", () => {
    mode = mode === "email" ? "phone" : "email";
    renderIdentifierField();
  });

  // ---- Vérification du nom d'utilisateur en direct ----
  usernameInput.addEventListener("input", thyroDebounce(async () => {
    const value = usernameInput.value.trim();
    const hint = document.getElementById("usernameHint");
    if (!value) { thyroSetHint(hint, ""); return; }
    if (!ThyroValidate.username(value)) {
      thyroSetHint(hint, "3 à 20 caractères : lettres, chiffres, . _ -", "error");
      return;
    }
    const { data, error } = await thyroSupabase.rpc("thyro_username_available", { p_username: value });
    if (error) return;
    thyroSetHint(hint, data ? "Disponible." : "Déjà pris.", data ? "ok" : "error");
  }));

  // ---- Prénom / nom : lettres latines seulement, pas de chiffres ----
  function attachNameFilter(input, hintId) {
    input.addEventListener("input", () => {
      const hint = document.getElementById(hintId);
      const cleaned = input.value.replace(/[^A-Za-zÀ-ÖØ-öø-ÿĀ-ſ]/g, "").slice(0, 20);
      if (cleaned !== input.value) input.value = cleaned;
      if (input.value && !ThyroValidate.name(input.value)) {
        thyroSetHint(hint, "Lettres seulement, 20 caractères max.", "error");
      } else {
        thyroSetHint(hint, "");
      }
    });
  }
  attachNameFilter(firstNameInput, "firstNameHint");
  attachNameFilter(lastNameInput, "lastNameHint");

  // ---- Mot de passe : longueur + ne doit pas contenir le username ----
  passwordInput.addEventListener("input", () => {
    const hint = document.getElementById("passwordHint");
    const check = ThyroValidate.password(passwordInput.value, usernameInput.value.trim());
    if (!check.ok) {
      thyroSetHint(hint, THYRO_ERROR_MESSAGES[check.reason], "error");
    } else {
      thyroSetHint(hint, "Mot de passe valide.", "ok");
    }
  });

  birthdateInput.addEventListener("change", () => {
    const hint = document.getElementById("birthdateHint");
    if (!ThyroValidate.birthdate(birthdateInput.value)) {
      thyroSetHint(hint, "Doit être après 1926 et tu dois avoir 13 ans minimum.", "error");
    } else {
      thyroSetHint(hint, "");
    }
  });

  pinInput.addEventListener("input", () => {
    const hint = document.getElementById("pinHint");
    if (pinInput.value && !ThyroValidate.pin(pinInput.value)) {
      thyroSetHint(hint, "Entre 6 et 12 caractères, sans espace.", "error");
    } else {
      thyroSetHint(hint, "");
    }
  });

  // ---- Soumission du formulaire ----
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    thyroHideAlert(alertBox);

    const username = usernameInput.value.trim();
    const firstName = firstNameInput.value.trim();
    const lastName = lastNameInput.value.trim();
    const password = passwordInput.value;
    const birthdate = birthdateInput.value;
    const pin = pinInput.value;

    const identifierInput = mode === "email"
      ? document.getElementById("suEmail")
      : document.getElementById("suPhone");
    const identifier = identifierInput.value.trim();

    const errors = [];
    if (!ThyroValidate.username(username)) errors.push("Nom d'utilisateur invalide.");
    if (!ThyroValidate.name(firstName)) errors.push("Prénom invalide.");
    if (!ThyroValidate.name(lastName)) errors.push("Nom invalide.");
    if (mode === "email" && !ThyroValidate.email(identifier)) errors.push("Courriel invalide.");
    if (mode === "phone" && !ThyroValidate.phone(identifier)) errors.push("Numéro de téléphone invalide.");
    const pwCheck = ThyroValidate.password(password, username);
    if (!pwCheck.ok) errors.push(THYRO_ERROR_MESSAGES[pwCheck.reason]);
    if (!ThyroValidate.birthdate(birthdate)) errors.push("Date de naissance invalide.");
    if (!ThyroValidate.pin(pin)) errors.push("NIP invalide.");

    if (errors.length) {
      thyroShowAlert(alertBox, errors[0]);
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Création…";

    const { data, error } = await thyroSupabase.rpc("thyro_signup", {
      p_username: username,
      p_first_name: firstName,
      p_last_name: lastName,
      p_email: mode === "email" ? identifier : null,
      p_phone: mode === "phone" ? identifier : null,
      p_password: password,
      p_pin: pin,
      p_birthdate: birthdate,
    });

    submitBtn.disabled = false;
    submitBtn.textContent = "Créer mon compte";

    if (error) {
      thyroShowAlert(alertBox, thyroErrorMessage(error));
      return;
    }

    const row = Array.isArray(data) ? data[0] : data;
    createdUser = { id: row.thyro_id, username: row.thyro_username };
    goToStep("stepRecovery");
  });

  function goToStep(stepId) {
    document.querySelectorAll(".thyro-step").forEach((el) => el.classList.remove("is-visible"));
    document.getElementById(stepId).classList.add("is-visible");
    document.getElementById("railStep1")?.classList.toggle("active", stepId === "stepForm");
    document.getElementById("railStep2")?.classList.toggle("active", stepId === "stepRecovery");
  }

  // ---- Étape 2 : télécharger le code ou passer ----
  const recoveryAlert = document.getElementById("recoveryAlert");
  const btnDownload = document.getElementById("btnDownloadRecovery");
  const btnSkip = document.getElementById("btnSkipRecovery");

  btnSkip.addEventListener("click", () => goToStep("stepDone"));

  btnDownload.addEventListener("click", async () => {
    thyroHideAlert(recoveryAlert);
    btnDownload.disabled = true;
    btnDownload.textContent = "Génération du fichier…";

    const { data: code, error } = await thyroSupabase.rpc("thyro_generate_recovery_code", {
      p_user_id: createdUser.id,
    });

    btnDownload.disabled = false;
    btnDownload.textContent = "Télécharger mon code au cas où je perds mon mot de passe";

    if (error || !code) {
      thyroShowAlert(recoveryAlert, "Impossible de générer le fichier pour l'instant. Réessaie.");
      return;
    }

    await buildRecoveryPdf(createdUser.username, code);
    goToStep("stepDone");
  });

  async function loadLogoDataUrl() {
    const candidates = [THYRO_CONFIG.logos.logo2, "assets/img/logo2.svg"];
    for (const src of candidates) {
      try {
        const dataUrl = await new Promise((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth || 200;
            canvas.height = img.naturalHeight || 200;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL("image/png"));
          };
          img.onerror = reject;
          img.src = src;
        });
        return dataUrl;
      } catch (_) { /* essaie le suivant */ }
    }
    return null;
  }

  async function buildRecoveryPdf(username, code) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "letter" });
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 60;

    const logoDataUrl = await loadLogoDataUrl();
    if (logoDataUrl) {
      const size = 64;
      doc.addImage(logoDataUrl, "PNG", (pageWidth - size) / 2, y, size, size);
      y += size + 24;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Fichier pour restaurer le compte Thyro", pageWidth / 2, y, { align: "center" });
    y += 28;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text(`Nom d'utilisateur : ${username}`, 60, y);
    y += 26;

    const instructions = [
      "1. Aller sur le site Thyro.",
      "2. Cliquer sur \"j'ai oublié mon mot de passe\".",
      "3. Appuyer sur l'option 2, joindre ce fichier et réinitialiser le mot de passe s'il est accepté.",
    ];
    instructions.forEach((line) => {
      doc.text(line, 60, y, { maxWidth: pageWidth - 120 });
      y += 18;
    });
    y += 16;

    doc.setFont("courier", "normal");
    doc.setFontSize(8);
    const wrapped = doc.splitTextToSize(code, pageWidth - 120);
    doc.text(wrapped, 60, y);

    doc.save("Thyro-reset-password.pdf");
  }

  renderIdentifierField();
})();
