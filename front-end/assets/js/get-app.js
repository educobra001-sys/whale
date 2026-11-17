// The download page: shows whether the APK is ready, and the address + QR the app connects to.
(function () {
  var address = window.location.origin;
  document.getElementById("address").textContent = address;

  try {
    var qr = window.qrcode(0, "M");
    qr.addData(address);
    qr.make();
    document.getElementById("server-qr").src = qr.createDataURL(6, 2);
  } catch (error) {
    document.getElementById("server-qr").hidden = true;
  }

  var state = document.getElementById("apk-state");
  var link = document.getElementById("apk-link");
  fetch("download-info")
    .then(function (response) { return response.json(); })
    .then(function (result) {
      var info = result.data || {};
      if (!info.available) {
        state.textContent = "The app hasn't been built on this computer yet. Run mobile\\build-apk.bat, then reload this page.";
        return;
      }
      var size = (info.size / 1024 / 1024).toFixed(1);
      var when = info.updatedAt ? new Date(info.updatedAt).toLocaleString() : "";
      state.textContent = "Version from " + when + " · " + size + " MB";
      link.hidden = false;
    })
    .catch(function () {
      state.textContent = "Couldn't check the download. Reload the page.";
    });
})();
