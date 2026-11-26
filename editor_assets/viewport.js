// Mobile Safari can resize only the visual viewport while a field has focus.
(() => {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  let restingHeight = viewport?.height ?? innerHeight;
  let frame;
  function update() {
    frame = 0;
    const field = document.activeElement?.matches('textarea, input:not([type=checkbox],[type=radio],[type=range],[type=file],[readonly])');
    const height = viewport?.height ?? innerHeight;
    if (!field) restingHeight = height;
    const keyboard = field && (viewport?.scale ?? 1) === 1 &&
      Math.max(restingHeight, innerHeight) - height > 100;
    root.toggleAttribute('data-keyboard', keyboard);
    if (keyboard) {
      root.style.setProperty('--keyboard-height', height + 'px');
      root.style.setProperty('--keyboard-inset', Math.max(0, innerHeight - height - (viewport?.offsetTop ?? 0)) + 'px');
    } else {
      root.style.removeProperty('--keyboard-height');
      root.style.removeProperty('--keyboard-inset');
    }
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(update);
  }
  viewport?.addEventListener('resize', schedule);
  window.addEventListener('resize', schedule);
  document.addEventListener('focusin', schedule);
  document.addEventListener('focusout', schedule);
  window.addEventListener('pageshow', schedule);
})();
