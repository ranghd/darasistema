import http from "node:http";

export type HandlerRegistry = Record<string, (...args: any[]) => any>;

function leerCuerpo(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export function iniciarServidorHttp(handlerRegistry: HandlerRegistry, puerto: number): http.Server {
  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "POST" && req.url === "/api/invoke") {
      try {
        const body = JSON.parse(await leerCuerpo(req)) as { canal: string; args: unknown[] };
        const handler = handlerRegistry[body.canal];
        if (!handler) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Canal desconocido: ${body.canal}` }));
          return;
        }
        const resultado = await handler({}, ...(body.args ?? []));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ resultado }));
      } catch (err: any) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err?.message ?? "Error desconocido en el servidor" }));
      }
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(puerto, "0.0.0.0");
  return server;
}
