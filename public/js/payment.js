export function initPaymentHandlers(paypal) {
  const amountInput = document.getElementById("custom-amount");
  const payButton = document.getElementById("pay-btn");
  const feedback = document.getElementById("feedback");
  const container = document.querySelector(".paypal-button-container");

  if (!amountInput || !payButton || !container) return;

  function validateAmount() {
    const raw = amountInput.value.replace(',', '.').trim();
    const num = Number(raw);

    if (!raw || isNaN(num) || num <= 0) {
      payButton.disabled = true;
    } else {
      payButton.disabled = false;
    }
  }

  async function handlePaymentClick() {
    const raw = amountInput.value.replace(',', '.').trim();
    const amount = Number(raw);

    if (!raw || isNaN(amount) || amount <= 0) {
      return alert("Please enter a valid amount.");
    }

    payButton.disabled = true;
    document.getElementById("btn-text").hidden = true;
    document.getElementById("btn-spinner").hidden = false;

    try {
      const res = await fetch("/api/validate-custom", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": document.querySelector('meta[name="csrf-token"]').content
        },
        body: JSON.stringify({ amount })
      });

      const data = await res.json();
      if (!res.ok) {
        feedback.textContent = data.error?.message || "Invalid amount";
        return;
      }

      container.innerHTML = "";
      container.style.display = "block";

      paypal.Buttons({
        createOrder: (_, actions) =>
          actions.order.create({
            purchase_units: [{
              amount: {
                value: data.amount,
                currency_code: "USD"
              },
              description: "Custom Payment"
            }]
          }),
        onApprove: (_, actions) =>
          actions.order.capture().then(details => {
            saveTransaction(details);
          }),
        onError: err => {
          console.error("PayPal error:", err);
          alert("Something went wrong with the payment.");
        }
      }).render(container);

    } catch (err) {
      console.error(err);
      alert("Something went wrong.");
    } finally {
      payButton.disabled = false;
      document.getElementById("btn-text").hidden = false;
      document.getElementById("btn-spinner").hidden = true;
    }
  }

  async function saveTransaction(details) {
    const payload = {
      transaction_id: details.id,
      payer_name: details.payer.name.given_name,
      payer_email: details.payer.email_address,
      amount: details.purchase_units[0].amount.value,
      currency: details.purchase_units[0].amount.currency_code,
      payment_status: details.status,
      service_type: details.purchase_units[0].description
    };

    try {
      const res = await fetch("/save-transaction", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": document.querySelector('meta[name="csrf-token"]').content
        },
        body: JSON.stringify(payload)
      });

      const r = await res.json();
      feedback.textContent = r.success ? "Payment saved successfully!" : "Payment succeeded but save failed. Please contact support.";
    } catch (e) {
      console.error("Error saving transaction:", e);
      feedback.textContent = "Error saving transaction.";
    } finally {
      container.style.display = "none";
    }
  }

  // Validate on input
  amountInput.addEventListener("input", validateAmount);
  amountInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && !payButton.disabled) {
      payButton.click();
    }
  });

  payButton.addEventListener("click", handlePaymentClick);

  validateAmount(); // Run once on load
}
