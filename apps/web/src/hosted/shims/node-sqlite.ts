// node:sqlite's DatabaseSync API implemented on sql.js (SQLite compiled to WebAssembly) — same SQL, same schema.
import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
let SQL: any = null;
export async function initSqlite() { if (!SQL) SQL = await initSqlJs({ locateFile: () => wasmUrl }); }
const norm = (a: any[]) => a.map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : typeof v === "bigint" ? Number(v) : v));
export class DatabaseSync {
  private db: any;
  constructor(_path?: string) { if (!SQL) throw new Error("initSqlite() first"); this.db = new SQL.Database(); }
  exec(sql: string) { this.db.exec(sql); }
  prepare(sql: string) {
    const db = this.db;
    return {
      get: (...a: any[]) => { const st = db.prepare(sql); try { st.bind(norm(a)); return st.step() ? st.getAsObject() : undefined; } finally { st.free(); } },
      all: (...a: any[]) => { const st = db.prepare(sql); const rows: any[] = []; try { st.bind(norm(a)); while (st.step()) rows.push(st.getAsObject()); } finally { st.free(); } return rows; },
      run: (...a: any[]) => { db.run(sql, norm(a)); const changes = db.getRowsModified(); const id = db.exec("SELECT last_insert_rowid()")[0]?.values?.[0]?.[0] ?? 0; return { changes, lastInsertRowid: id }; },
    };
  }
  close() { this.db.close(); }
}
