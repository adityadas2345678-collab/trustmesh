export const existsSync = () => false;
export const readFileSync = (p: string) => { throw new Error(`no filesystem in browser: ${p}`); };
export const writeFileSync = () => {};
export const mkdirSync = () => {};
export const renameSync = () => {};
export const rmSync = () => {};
export default { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync };
