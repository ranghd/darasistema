import os from "node:os";

export function listarIpsLocales(): string[] {
  const interfaces = os.networkInterfaces();
  const ips: string[] = [];
  for (const nombre of Object.keys(interfaces)) {
    for (const info of interfaces[nombre] ?? []) {
      if (info.family === "IPv4" && !info.internal) {
        ips.push(info.address);
      }
    }
  }
  return ips;
}
