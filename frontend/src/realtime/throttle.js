export function throttle(callback, delay) {
  let lastCall = 0;
  let timer = null;
  let lastArgs = null;

  return (...args) => {
    const now = Date.now();
    const remaining = delay - (now - lastCall);

    lastArgs = args;

    if (remaining <= 0) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }

      lastCall = now;
      callback(...lastArgs);
      lastArgs = null;
      return;
    }

    if (!timer) {
      timer = setTimeout(() => {
        lastCall = Date.now();
        timer = null;

        if (lastArgs) {
          callback(...lastArgs);
          lastArgs = null;
        }
      }, remaining);
    }
  };
}
