import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const folder = fileURLToPath(new URL("../docs/capturas/", import.meta.url));
const types = {
  html: "text/html; charset=utf-8",
  png: "image/png",
  pdf: "application/pdf",
  json: "application/json; charset=utf-8",
  md: "text/plain; charset=utf-8",
};
const port = Number(process.env.CAPTURES_PORT || 3002);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw Error("Porta inválida");
createServer((req, res) => {
  const name =
    new URL(req.url, "http://localhost").pathname.slice(1) || "index.html";
  // Only the generated, flat documentation folder is served.
  if (
    !/^[a-zA-Z0-9-]+\.(html|png|pdf|json|md)$/.test(name) ||
    !["GET", "HEAD"].includes(req.method)
  ) {
    res.writeHead(404).end();
    return;
  }
  const filename = path.join(folder, name);
  if (!existsSync(filename) || !statSync(filename).isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    "Content-Type": types[name.split(".").at(-1)],
    "Content-Length": statSync(filename).size,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (req.method === "HEAD") res.end();
  else
    createReadStream(filename)
      .on("error", () => res.destroy())
      .pipe(res);
}).listen(port, "127.0.0.1", () =>
  console.log(`Galeria de capturas: http://localhost:${port}`),
);
