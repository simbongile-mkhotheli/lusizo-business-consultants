document.addEventListener('DOMContentLoaded', () => {
  const amtInput  = document.getElementById('custom-amount');
  const payBtn    = document.getElementById('pay-btn');
  const btnText   = document.getElementById('btn-text');
  const spinner   = document.getElementById('btn-spinner');
  const feedback  = document.getElementById('feedback');

  // Initial validation
  validateAmount();

  amtInput.addEventListener('input', validateAmount);

  function validateAmount() {
    const raw = amtInput.value.replace(',', '.');
    const num = parseFloat(raw);
    payBtn.disabled = isNaN(num) || num < 0.01;
  }

  function showFeedback(type, msg) {
    feedback.className = type;
    feedback.textContent = msg;
  }

  paypal.Buttons({
    style: {
      layout: 'vertical',
      color: 'blue',
      shape: 'pill',
      label: 'pay',
    },
    funding: {
      disallowed: [paypal.FUNDING.CREDIT],
    },
    createOrder: (data, actions) => {
      const raw = amtInput.value.replace(',', '.');
      const value = parseFloat(raw).toFixed(2);
      return actions.order.create({
        purchase_units: [{ amount: { value } }],
      });
    },
    onClick: () => {
      payBtn.disabled = true;
      btnText.textContent = 'Processing…';
      spinner.hidden = false;
      feedback.textContent = '';
    },
    onApprove: (data, actions) =>
      actions.order.capture().then((details) => {
        showFeedback(
          'success',
          `Payment of $${details.purchase_units[0].amount.value} successful!`
        );
      }),
    onError: (err) => {
      payBtn.disabled = false;
      btnText.textContent = 'Pay Now';
      spinner.hidden = true;
      showFeedback(
        'error',
        'Oops, something went wrong. Please try again.'
      );
      console.error(err);
    },
  }).render('.paypal-button-container');
});
