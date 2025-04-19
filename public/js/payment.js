
// Immediately-Invoked Function to expose initPaymentHandlers
en(function(window) {
  function initPaymentHandlers() {
    document.querySelectorAll('.buy-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.preventDefault();
        const svc    = btn.dataset.service;
        const card   = btn.closest('.service-card');
        const container = card.querySelector('.paypal-button-container');

        // Hide previous containers
        document.querySelectorAll('.paypal-button-container')
                .forEach(c => c.style.display = 'none');

        container.style.display = 'block';
        container.innerHTML = '';

        // Fetch & validate amount via your API
        let amount, description;
        if (svc === 'custom') {
          const raw = card.querySelector('#custom-amount').value.replace(',', '.');
          const num = parseFloat(raw);
          if (isNaN(num) || num < 0.01) {
            alert('Enter a valid amount above zero.');
            return;
          }

          const resp = await fetch('/api/validate-custom', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-csrf-token': document.querySelector('meta[name="csrf-token"]').content
            },
            body: JSON.stringify({ amount: num })
          });

          if (!resp.ok) {
            const err = await resp.json();
            alert(err.error?.message || 'Invalid amount');
            return;
          }

          amount = (await resp.json()).amount;
          description = 'Custom Payment';
        }

        // Render PayPal Buttons now that SDK is loaded
        window.paypal.Buttons({
          createOrder: (data, actions) =>
            actions.order.create({
              purchase_units: [{ amount: { value: amount.toString(), currency_code: 'USD' }, description }]
            }),
          onApprove: (data, actions) =>
            actions.order.capture().then(details => {
              alert(`Payment of $${details.purchase_units[0].amount.value} successful!`);
              container.style.display = 'none';
            }),
          onError: err => {
            console.error('PayPal error:', err);
            alert('Payment error—please try again.');
          }
        }).render(container);
      });
    });
  }

  // Expose for index.ejs to call
  window.initPaymentHandlers = initPaymentHandlers;
})(window);