// node:path / node:url / node:os stand-ins (only used for config paths and LAN IP listing).
export const resolve = (...p: string[]) => p.filter(Boolean).join("/").replace(/\/+/g, "/");
export const dirname = (p: string) => p.replace(/\/[^/]*$/, "") || "/";
export const join = resolve;
export const extname = (p: string) => (p.match(/\.[^./]+$/) ?? [""])[0];
export const fileURLToPath = (u: string) => String(u).replace(/^file:\/\//, "");
export const pathToFileURL = (p: string) => ({ href: `file://${p}` });
export const networkInterfaces = () => ({});
export default { resolve, dirname, join, extname, fileURLToPath, pathToFileURL, networkInterfaces };
