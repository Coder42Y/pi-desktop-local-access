"use strict";
exports.launchBrowser = (chromium) => chromium.launch({
  headless: true,
  ...(process.env.SSH_UPLOAD_TEST_BROWSER_EXECUTABLE
    ? { executablePath: process.env.SSH_UPLOAD_TEST_BROWSER_EXECUTABLE }
    : { channel: process.env.SSH_UPLOAD_TEST_BROWSER || "chrome" }),
});
