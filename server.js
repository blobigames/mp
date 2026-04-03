const http = require("http");
const https = require("https");
const { URL } = require("url");

const TARGET_ORIGIN = "https://melon-sandbox.io";
const GAME_PATH = "/melon-sandbox.embed";

const SW_UNREGISTER = `<script>
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    for (let reg of regs) reg.unregister();
  });
}
</script>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const workerOrigin = `https://${req.headers.host}`;

  if (url.pathname.includes("service-worker") || url.pathname.includes("sw.js")) {
    res.writeHead(200, { "Content-Type": "application/javascript" });
    return res.end("// service worker blocked");
  }

  const targetURL = url.pathname === "/" || url.pathname === ""
    ? TARGET_ORIGIN + GAME_PATH + url.search
    : TARGET_ORIGIN + url.pathname + url.search;

  const parsedTarget = new URL(targetURL);
  const options = {
    hostname: parsedTarget.hostname,
    path: parsedTarget.pathname + parsedTarget.search,
    method: req.method,
    headers: {
      ...req.headers,
      host: "melon-sandbox.io",
      referer: TARGET_ORIGIN + GAME_PATH,
      origin: TARGET_ORIGIN,
    },
  };

  const proxyReq = https.request(options, (proxyRes) => {
    const headers = { ...proxyRes.headers };
    delete headers["x-frame-options"];
    delete headers["content-security-policy"];
    delete headers["cross-origin-opener-policy"];
    delete headers["cross-origin-embedder-policy"];
    headers["access-control-allow-origin"] = "*";

    const contentType = headers["content-type"] || "";
    if (contentType.includes("text/html")) {
      let body = "";
      proxyRes.on("data", chunk => body += chunk);
      proxyRes.on("end", () => {
        body = body.replace(new RegExp(TARGET_ORIGIN.replace(/\./g, "\\."), "g"), workerOrigin);
        body = body.replace("<head>", "<head>" + SW_UNREGISTER);
        body = body.replace(/navigator\.serviceWorker\.register\([^)]+\)/g, "Promise.resolve()");
        delete headers["content-length"];
        res.writeHead(proxyRes.statusCode, headers);
        res.end(body);
      });
    } else {
      res.writeHead(proxyRes.statusCode, headers);
      proxyRes.pipe(res);
    }
  });

  proxyReq.on("error", (e) => {
    res.writeHead(502);
    res.end("Fetch failed: " + e.message);
  });

  if (req.method !== "GET" && req.method !== "HEAD") {
    req.pipe(proxyReq);
  } else {
    proxyReq.end();
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
