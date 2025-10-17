// appRenderer.js — renderer for app.html
// Attaches button handlers for launching Pro, revalidating license, and logout

(function () {
  const launchBtn = document.getElementById("launchProBtn");
  const revalidateBtn = document.getElementById("revalidateBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const statusEl = document.getElementById("status");

  function setStatus(message) {
    if (statusEl) statusEl.textContent = message;
  }

  // Helper for safe IPC calls
  async function invoke(channel) {
    if (!window.api || typeof window.api.invoke !== "function") {
      console.error(`window.api.invoke not available for ${channel}`);
      setStatus("Internal API unavailable.");
      return { ok: false };
    }
    try {
      return await window.api.invoke(channel);
    } catch (err) {
      console.error(`${channel} failed:`, err);
      setStatus(err?.message || `${channel} failed`);
      return { ok: false, message: err?.message };
    }
  }

  // ── Launch Pro App
  if (launchBtn) {
    launchBtn.addEventListener("click", async () => {
      launchBtn.disabled = true;
      const prev = launchBtn.textContent;
      launchBtn.textContent = "Launching…";
      setStatus("Launching tensorHVAC-Pro-2025…");

      const res = await invoke("pro:launch");
      if (res.ok) setStatus("tensorHVAC-Pro-2025 launched successfully.");
      else setStatus(res.message || "Failed to launch Pro app.");

      launchBtn.textContent = prev;
      launchBtn.disabled = false;
    });
  }

  // ── Revalidate License
  if (revalidateBtn) {
    revalidateBtn.addEventListener("click", async () => {
      revalidateBtn.disabled = true;
      const prev = revalidateBtn.textContent;
      revalidateBtn.textContent = "Checking…";
      setStatus("Revalidating license…");

      const res = await invoke("license:revalidateNow");
      if (res.ok) setStatus("License is valid.");
      else setStatus(res.message || "License invalid or expired.");

      revalidateBtn.textContent = prev;
      revalidateBtn.disabled = false;
    });
  }

  // ── Logout
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      logoutBtn.disabled = true;
      const prev = logoutBtn.textContent;
      logoutBtn.textContent = "Logging out…";
      setStatus("Logging out…");

      const res = await invoke("app:logout");
      if (!res.ok) console.warn("Logout returned:", res);

      logoutBtn.textContent = prev;
      logoutBtn.disabled = false;
    });
  }
})();
