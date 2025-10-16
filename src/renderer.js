const emailInput = document.getElementById('email');
const keyInput = document.getElementById('productKey');
const submitBtn = document.getElementById('submit');
const msg = document.getElementById('msg');

submitBtn.addEventListener('click', async () => {
  msg.textContent = 'Validating…';
  submitBtn.disabled = true;
  try {
    const email = emailInput.value;
    const productKey = keyInput.value;
    const res = await window.api.validateLicense(email, productKey);
    msg.textContent = res.message;
    if (res.ok) {
      setTimeout(async () => { await window.api.proceedToApp(); }, 500);
    }
  } catch (e) {
    msg.textContent = String(e);
  } finally {
    submitBtn.disabled = false;
  }
});
