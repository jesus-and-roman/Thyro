(function () {
  let mode = "email"; // 'email' | 'phone'

  const identifierField = document.getElementById("loginIdentifierField");
  const toggleBtn = document.getElementById("toggleLoginMode");
  const alertBox = document.getElementById("loginAlert");
  const form = document.getElementById("loginForm");
  const submitBtn = document.getElementById("loginSubmit");

  function renderIdentifierField() {
    if (mode === "email") {
      identifierField.innerHTML = `
        <label for="loginEmail">Email</label>
        <input type="email" id="loginEmail" name="loginEmail" autocomplete="email" required>
        <span class="thyro-hint" id="loginIdentifierHint"></span>
      `;
      toggleBtn.textContent = "Se connecter avec un numéro de téléphone";
    } else {
      identifierField.innerHTML = `
        <label for="loginPhone">Numéro de téléphone</label>
        <input type="tel" id="loginPhone" name="loginPhone" autocomplete="tel" required>
        <span class="thyro-hint" id="loginIdentifierHint"></span>
      `;
      toggleBtn.textContent = "Se connecter avec un courriel";
    }
  }

  toggleBtn.addEventListener("click", () => {
    mode = mode === "email" ? "phone" : "email";
    renderIdentifierField();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    thyroHideAlert(alertBox);

    const identifier = mode === "email"
      ? document.getElementById("loginEmail").value.trim()
      : document.getElementById("loginPhone").value.trim();
    const password = document.getElementById("loginPassword").value;

    if (mode === "email" && !ThyroValidate.email(identifier)) {
      thyroShowAlert(alertBox, "Entre un courriel valide.");
      return;
    }
    if (mode === "phone" && !ThyroValidate.phone(identifier)) {
      thyroShowAlert(alertBox, "Entre un numéro de téléphone valide.");
      return;
    }
    if (!password) {
      thyroShowAlert(alertBox, "Entre ton mot de passe.");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Connexion…";

    const { data, error } = await thyroSupabase.rpc("thyro_login", {
      p_mode: mode,
      p_identifier: identifier,
      p_password: password,
    });

    submitBtn.disabled = false;
    submitBtn.textContent = "Se connecter";

    if (error) {
      thyroShowAlert(alertBox, thyroErrorMessage(error));
      return;
    }

    const session = Array.isArray(data) ? data[0] : data;
    if (!session || !session.thyro_token) {
      thyroShowAlert(alertBox, "Identifiants invalides.");
      return;
    }

    localStorage.setItem("thyro_session_token", session.thyro_token);
    localStorage.setItem("thyro_username", session.thyro_username);
    thyroShowAlert(alertBox, "Connexion réussie. Redirection…", "success");
    // window.location.href = "compte.html";
  });

  renderIdentifierField();
})();
