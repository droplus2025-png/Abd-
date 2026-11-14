// Durable storage in IndexedDB. The engine keeps everything in memory (fast) and calls persist()
// with the changed rows only; the answer is given AFTER IndexedDB confirmed the write (one transaction).
const STORE = 'rows';

function req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
function done(tx) { return new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('IndexedDB aborted')); }); }

export async function openPersist(dbName = 'pos-db') {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open(dbName, 1);
    r.onupgradeneeded = () => {
      const s = r.result.createObjectStore(STORE, { keyPath: 'k' });
      s.createIndex('table', 'table');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});     // ask the browser not to evict our data

  return {
    async load() {
      const all = await req(db.transaction(STORE).objectStore(STORE).getAll());
      const state = {};
      for (const { table, row } of all) (state[table] ||= []).push(row);
      return state;
    },
    async persist(changes) {
      const tx = db.transaction(STORE, 'readwrite');
      const os = tx.objectStore(STORE);
      for (const c of changes) {
        if (c.op === 'clear') {
          const cur = os.index('table').openKeyCursor(IDBKeyRange.only(c.table));
          cur.onsuccess = () => { const k = cur.result; if (k) { os.delete(k.primaryKey); k.continue(); } };
        } else {
          const pk = c.table === 'settings' ? c.row.key : c.table === 'sku_registry' ? c.row.sku : c.row.id;
          os.put({ k: `${c.table}|${pk}`, table: c.table, row: c.row });
        }
      }
      await done(tx);
    },
    async wipeAll() { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).clear(); await done(tx); },
  };
}
