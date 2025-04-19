// public/js/payment.js

// Expose init globally for inline bootstrapper
window.initPaymentHandlers = function () {
  setupCustomAmountFlow();
  setupBuyButtonsFlow();
};

function setupCustomAmountFlow() {
  const amountInput = document.getElementById("custom-amount");
  const payButton = document.getElementById("pay-btn");
  const btnText = document.getElementById("btn-text");
  const spinner = document.getElementById("btn-spinner");
  const feedback = document.getElementById("feedback");

  const validateAmount = () => {
    const raw = amountInput.value.replace(',', '.');
    const num = parseFloat(raw);
    payButton.disabled = isNaN(num) || num < 0.01;
  };

  amountInput?.addEventListener("input", validateAmount);
  validateAmount();

  payButton?.addEventListener("click", async e => {
    e.preventDefault();
    const value = parseFloat(amountInput.value.replace(',', '.')).toFixed(2);
    renderPayPalButtons(value, "Custom Payment", feedback, btnText, spinner, payButton);
  });
}

function setupBuyButtonsFlow() {
  const buttons = document.querySelectorAll(".buy-btn");
  buttons.forEach(button => {
    button.addEventListener("click", e => {
      e.preventDefault();
      const amount = button.getAttribute("data-amount");
      const description = button.getAttribute("data-desc") || "Purchase";

      const container = button.closest(".service")?.querySelector(".paypal-button-container");
      if (!container) return;

      container.innerHTML = "";
      container.style.display = "block";

      renderPayPalButtons(amount, description, container, button, null, button);
    });
  });
}

function renderPayPalButtons(amount, description, feedbackEl, btnTextEl, spinnerEl, disableBtn) {
  if (!window.paypal) {
    console.error("PayPal SDK not loaded");
    return;
  }

  window.paypal.Buttons({
    style: {
      layout: 'vertical',
      color: 'blue',
      shape: 'pill',
      label: 'pay'
    },
    createOrder: (data, actions) => {
      return actions.order.create({
        purchase_units: [{
          amount: { value: amount },
          description
        }]
      });
    },
    onClick: () => {
      if (disableBtn) disableBtn.disabled = true;
      if (btnTextEl) btnTextEl.textContent = "Processing…";
      if (spinnerEl) spinnerEl.hidden = false;
      if (feedbackEl) feedbackEl.textContent = "";
    },
    onApprove: (data, actions) => {
      return actions.order.capture().then(details => {
        if (feedbackEl) {
          feedbackEl.className = "success";
          feedbackEl.textContent = `Payment of $${details.purchase_units[0].amount.value} successful!`;
        }
      });
    },
    onError: err => {
      console.error(err);
      if (disableBtn) disableBtn.disabled = false;
      if (btnTextEl) btnTextEl.textContent = "Pay Now";
      if (spinnerEl) spinnerEl.hidden = true;
      if (feedbackEl) {
        feedbackEl.className = "error";
        feedbackEl.textContent = "Something went wrong. Please try again.";
      }
    }
  }).render(feedbackEl.closest(".paypal-button-container") || feedbackEl);
}
