// Motion and the showreel player. The page is complete without this file: .reveal only hides content once the
// inline head script has added the .js class, and the reel link falls back to opening the MP4 directly.
(() => {
  const reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -8% 0px' });
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add('in'));
  }

  const play = document.querySelector('[data-play-reel]');
  const media = document.querySelector('.reel-media');
  if (play && media) {
    play.addEventListener('click', (ev) => {
      ev.preventDefault();
      const video = document.createElement('video');
      video.src = play.getAttribute('href');
      video.controls = true;
      video.playsInline = true;
      video.setAttribute('aria-label', 'Daylens showreel');
      media.replaceChildren(video);
      video.focus();
      video.play().catch(() => {}); // autoplay refused: the controls are there to press play
    }, { once: true });
  }
})();
