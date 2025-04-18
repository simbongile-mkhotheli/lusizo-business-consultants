// paypal.js
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await loadPayPalSDK();
    attachBuyButtonHandlers();
  } catch (e) {
    console.error("❌ Failed to load PayPal SDK:", e);
    alert("Could not load PayPal. Please try again later.");
  }
});

// 1) Load SDK once, as a Promise
function loadPayPalSDK() {
  return new Promise(async (resolve, reject) => {
    try {
      const { clientId } = await fetch("/config/paypal").then(r => r.json());
      if (!clientId) throw new Error("Missing PayPal Client ID");

      const s = document.createElement("script");
      s.src = `https://www.paypal.com/sdk/js?client-id=${clientId}&currency=USD`;
      s.onload = () => resolve();
      s.onerror = reject;
      document.head.appendChild(s);
    } catch (err) {
      reject(err);
    }
  });
}

// 2) Wire up the “Pay Custom” button
function attachBuyButtonHandlers() {
  document.querySelectorAll(".buy-btn").forEach(btn => {
    btn.addEventListener("click", async e => {
      e.preventDefault();
      console.log("👉 Pay Custom clicked", btn);

      const card      = btn.closest(".service-card");
      const container = card.querySelector(".paypal-button-container");
      const raw       = card.querySelector("#custom-amount").value;
      const num       = parseFloat(raw);

      // validate
      if (isNaN(num) || num <= 0) {
        return alert("Enter a valid amount above zero.");
      }

      // server‑side validation
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

      // show & clear container
      document.querySelectorAll(".paypal-button-container")
              .forEach(c => c.style.display = "none");
      container.style.display = "block";
      container.innerHTML = "";

      // finally render
      paypal.Buttons({
        createOrder: (_, actions) =>
          actions.order.create({
            purchase_units: [{
              amount: { currency_code: "USD", value: amount },
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

// 3) Save transaction
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
  .then(r => alert(r.success ? "Saved!" : "Paid—but not saved."))
  .catch(e => { console.error(e); alert("Error saving transaction."); })
  .finally(() => {
    container.style.display = "none";
  });
}
