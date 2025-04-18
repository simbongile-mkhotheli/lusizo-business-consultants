document.addEventListener("DOMContentLoaded", async () => {
  // Modal controls
  const modal = document.getElementById("payment-modal");
  const openBtn = document.getElementById("open-payment-modal");
  const closeBtn = modal.querySelector(".modal-close");
  const backdrop = modal.querySelector(".modal-backdrop");

  function showModal() {
    modal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  function hideModal() {
    modal.classList.add("hidden");
    document.body.style.overflow = "";
  }

  openBtn.addEventListener("click", e => {
    e.preventDefault();
    showModal();
  });

  closeBtn.addEventListener("click", hideModal);
  backdrop.addEventListener("click", hideModal);

  modal.addEventListener("keydown", e => {
    if (e.key === "Escape") hideModal();
  });

  // Load PayPal SDK
  await loadPayPalSDK();
  attachBuyButtonHandlers();
});

// Load PayPal SDK dynamically
async function loadPayPalSDK() {
  const { clientId } = await fetch("/config/paypal").then(res => res.json());

  if (!clientId) throw new Error("Missing clientId");

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?client-id=${clientId}&currency=USD`;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// Pay Custom logic
function attachBuyButtonHandlers() {
  document.querySelectorAll(".buy-btn").forEach(button => {
    button.addEventListener("click", async () => {
      const container = document.querySelector(".paypal-button-container");
      const rawAmount = document.querySelector("#custom-amount").value;
      const num = parseFloat(rawAmount);

      if (isNaN(num) || num <= 0) return alert("Enter a valid amount.");

      const response = await fetch("/api/validate-custom", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": document.querySelector("meta[name='csrf-token']").content
        },
        body: JSON.stringify({ amount: num })
      });

      if (!response.ok) {
        const err = await response.json();
        return alert(err.error?.message || "Invalid amount.");
      }

      const { amount } = await response.json();

      // Hide Pay button, show PayPal
      button.style.display = "none";
      container.style.display = "block";
      container.innerHTML = "";

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
            saveTransaction(details)
          ),
        onError: err => {
          console.error(err);
          alert("PayPal error. Please try again.");
        }
      }).render(container);
    });
  });
}

function saveTransaction(details) {
  const payload = {
    transaction_id: details.id,
    payer_name: details.payer.name.given_name,
    payer_email: details.payer.email_address,
    amount: details.purchase_units[0].amount.value,
    currency: details.purchase_units[0].amount.currency_code,
    payment_status: details.status,
    service_type: details.purchase_units[0].description
  };

  fetch("/save-transaction", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-csrf-token": document.querySelector("meta[name='csrf-token']").content
    },
    body: JSON.stringify(payload)
  })
    .then(res => res.json())
    .then(r => {
      alert(r.success
        ? "✅ Payment successful! Redirecting..."
        : "⚠️ Payment succeeded but not saved. Redirecting...");
      window.location.href = "/";
    })
    .catch(err => {
      console.error(err);
      alert("⚠️ Error saving transaction. Redirecting...");
      window.location.href = "/";
    });
}
