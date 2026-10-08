// Lets non-button elements with onClick be used from the keyboard (Enter / Space).
export const onActivate = (fn) => (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn && fn(e); }
};
