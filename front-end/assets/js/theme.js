try {
  const theme = localStorage.getItem("lc.theme");
  if (theme) document.documentElement.dataset.theme = theme;
} catch {
  /* storage unavailable */
}
