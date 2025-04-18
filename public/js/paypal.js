// /public/js/paypal.js
document.addEventListener("DOMContentLoaded", async () => {
  // 0) Modal Open/Close
  initPaymentModal();

  // 1) Load PayPal SDK
  try {
    await loadPayPalSDK();
  } catch (e) {
    console.error("❌ Failed to load PayPal SDK:", e);
    return alert("Could not load PayPal. Please try again later.");
  }

  // 2) Wire up your “Pay Custom” button inside the modal
  attachBuyButtonHandlers();
});


/** Initialize the payment modal open/close behavior **/
function initPaymentModal() {
  const modal    = document.getElementById("payment-modal");
  const openBtn  = document.getElementById("open-payment-modal");
  const closeBtn = modal.querySelector(".modal-close");
  const backdrop = modal.querySelector(".modal-backdrop");

  const show = () => {
    modal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  };
  const hide = () => {
    modal.classList.add("hidden");
    document.body.style.overflow = "";
  };

  openBtn.addEventListener("click", e => {
    e.preventDefault();
    show();
  });
  closeBtn.addEventListener("click", hide);
  backdrop.addEventListener("click", hide);
  modal.addEventListener("keydown", e => {
    if (e.key === "Escape") hide();
  });
}


/** Load PayPal SDK once **/
function loadPayPalSDK() {
  return new Promise(async (resolve, reject) => {
    try {
      const { clientId } = await fetch("/config/paypal").then(r => r.json());
      if (!clientId) throw new Error("Missing PayPal Client ID");

      const s = document.createElement("script");
      s.src = `https://www.paypal.com/sdk/js?client-id=${clientId}&currency=USD`;
      s.onload  = () => resolve();
      s.onerror = () => reject(new Error("PayPal SDK failed to load"));
      document.head.appendChild(s);
    } catch (err) {
      reject(err);
    }
  });
}


/** Handle “Pay Custom” clicks and render the PayPal button **/
function attachBuyButtonHandlers() {
  document.querySelectorAll(".buy-btn").forEach(btn => {
    btn.addEventListener("click", async e => {
      e.preventDefault();
      console.log("👉 Pay Custom clicked", btn);

      const card      = btn.closest(".service-card");
      const container = card.querySelector(".paypal-button-container");
      const raw       = card.querySelector("#custom-amount").value;
      const num       = parseFloat(raw);

      // Client‑side validation
      if (isNaN(num) || num <= 0) {
        return alert("Enter a valid amount above zero.");
      }

      // Server‑side validation
      const resp = await fetch("/api/validate-custom", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": document.querySelector('meta[name="csrf-token"]').content
        },
        body: JSON.stringify({ amount: num })
      });
      if (!resp.ok) {
        const err = await resp.json();
        return alert(err.error?.message || "Invalid amount");
      }
      const { amount } = await resp.json();

      // Show & clear the PayPal container
      document.querySelectorAll(".paypal-button-container")
              .forEach(c => c.style.display = "none");
      container.style.display = "block";
      container.innerHTML = "";

      // Hide the “Pay Custom” button itself
      btn.style.display = "none";

      // Render the PayPal Smart Button
      paypal.Buttons({
        createOrder: (_, actions) =>
          actions.order.create({
            purchase_units: [{
              amount:      { currency_code: "USD", value: amount },
              description: "Custom Payment"
            }]
          }),
        onApprove: (_, actions) =>
          actions.order.capture().then(details =>
            saveTransaction(details, container)
          ),
        onError: err => {
          console.error("PayPal error:", err);
          alert("Payment error—please try again.");
        }
      }).render(container);
    });
  });
}


/** Save transaction and then redirect home **/
function saveTransaction(details, container) {
  const payload = {
    transaction_id: details.id,
    payer_name:     details.payer.name.given_name,
    payer_email:    details.payer.email_address,
    amount:         details.purchase_units[0].amount.value,
    currency:       details.purchase_units[0].amount.currency_code,
    payment_status: details.status,
    service_type:   details.purchase_units[0].description
  };

  return fetch("/save-transaction", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-csrf-token": document.querySelector('meta[name="csrf-token"]').content
    },
    body: JSON.stringify(payload)
  })
  .then(r => r.json())
  .then(r => {
    alert(r.success
      ? "Payment successful! Redirecting home…"
      : "Paid—but not saved. Redirecting home…");
    window.location.href = "/";
  })
  .catch(e => {
    console.error(e);
    alert("Error saving—but payment completed. Redirecting home…");
    window.location.href = "/";
  });
}
