(function () {
  var preference = "system";
  try { preference = localStorage.getItem("carsage.theme") || "system"; } catch (_) {}
  var dark = preference === "dark" || (preference !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
})();
