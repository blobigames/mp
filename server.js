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
      "host": "melon-sandbox.io",
      "referer": TARGET_ORIGIN + GAME_PATH,
      "origin": TARGET_ORIGIN,
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "accept-encoding": "gzip, deflate, br",
      "connection": "keep-alive",
      "upgrade-insecure-requests": "1",
    },
  };

  const proxyReq = https.request(options, (proxyRes) => {
    // Handle redirects
    if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
      res.writeHead(302, { "Location": proxyRes.headers.location.replace(TARGET_ORIGIN, workerOrigin) });
      return res.end();
    }

    const headers = { ...proxyRes.headers };
    delete headers["x-frame-options"];
    delete headers["content-security-policy"];
    delete headers["cross-origin-opener-policy"];
    delete headers["cross-origin-embedder-policy"];
    headers["access-control-allow-origin"] = "*";

    const contentType = headers["content-type"] || "";
    if (contentType.includes("text/html")) {
      let chunks = [];
      proxyRes.on("data", chunk => chunks.push(chunk));
      proxyRes.on("end", () => {
        let body = Buffer.concat(chunks).toString("utf8");
        body = body.replace(new RegExp(TARGET_ORIGIN.replace(/\./g, "\\."), "g"), workerOrigin);
        body = body.replace("<head>", "<head>" + SW_UNREGISTER);
        body = body.replace(/navigator\.serviceWorker\.register\([^)]+\)/g, "Promise.resolve()");
        delete headers["content-length"];
        delete headers["content-encoding"];
        res.writeHead(proxyRes.statusCode, headers);
        res.end(body);
      });
    } else {
      res.writeHead(proxyRes.statusCode, headers);
      proxyRes.pipe(res);
    }
  });

  proxyReq.on("error", (e) => {
    console.error("Fetch failed:", e.message);
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
