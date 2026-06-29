const { createProxyMiddleware } = require("http-proxy-middleware");

const apiBaseUrl = process.env.REACT_APP_API_BASE_URL || "/api/v1";
const isRelativeApiBase = !/^https?:\/\//i.test(apiBaseUrl);
const proxyTarget = process.env.DEV_BACKEND_PROXY_TARGET || "http://127.0.0.1:8000";

module.exports = function setupProxy(app) {
  if (!isRelativeApiBase) {
    return;
  }

  app.use(
    ["/api", "/media"],
    createProxyMiddleware({
      target: proxyTarget,
      changeOrigin: true,
      secure: false,
    })
  );
};
