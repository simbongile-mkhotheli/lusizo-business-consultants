document.addEventListener("DOMContentLoaded", function () {
  const heroTitle = document.querySelector(".hero-branding");
  const heroHeading = document.querySelector(".hero-heading-wrapper");
  const heroDescription = document.querySelector(".hero-description");
  const heroButtonWrapper = document.querySelector(".button__group");
  const heroImage = document.querySelector(".hero-main-image");
  const happyClient = document.querySelector(".happy-clients");
  const totalUser = document.querySelector(".total-users");
  const heroDecoration = document.querySelector(".hero-decoration");

  let titleVisible = false;
  let headingVisible = false;
  let descriptionVisible = false;

  function revealTitle() {
    if (titleVisible) return;

    const rect = heroTitle.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.8) {
      heroTitle.classList.add("visible");
      titleVisible = true;
      document.removeEventListener("scroll", revealTitle);
      setTimeout(revealHeading, 500);
    }
  }

  function revealHeading() {
    if (headingVisible) return;

    const rect = heroHeading.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.8) {
      heroHeading.classList.add("visible");
      headingVisible = true;
      setTimeout(revealDescription, 500);
    }
  }

  function revealDescription() {
    if (descriptionVisible) return;

    const rect = heroDescription.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.8) {
      heroDescription.classList.add("visible");
      descriptionVisible = true;
      setTimeout(revealButtons, 500);
    }
  }

  function revealButtons() {
    const rect = heroButtonWrapper.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.9) {
      heroButtonWrapper.classList.add("visible");
    }
  }

  function revealImage() {
    const rect = heroImage.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.8) {
      heroImage.classList.add("visible");
    }
  }

  function revealAnimatedImageOne() {
    if (!happyClient) return;
    
    const rect = happyClient.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.9) {
      happyClient.classList.add("visible");
      document.removeEventListener("scroll", revealAnimatedImageOne);
    }
  }

  function revealAnimatedImageTwo() {
    if (!totalUser) return;
    
    const rect = totalUser.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.8) {
      totalUser.classList.add("visible");
      document.removeEventListener("scroll", revealAnimatedImageTwo);
    }
  }

  function revealAnimatedImageThree() {
    if (!heroDecoration) return;
    
    const rect = heroDecoration.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.8) {
      heroDecoration.classList.add("visible");
      document.removeEventListener("scroll", revealAnimatedImageThree);
    }
  }

  document.addEventListener("scroll", revealTitle);
  document.addEventListener("scroll", revealImage);
  document.addEventListener("scroll", revealAnimatedImageOne, { passive: true });
  document.addEventListener("scroll", revealAnimatedImageTwo, { passive: true });
  document.addEventListener("scroll", revealAnimatedImageThree, { passive: true });

  revealTitle();
  revealImage();
  revealAnimatedImageOne();
  revealAnimatedImageTwo();
  revealAnimatedImageThree();
});




