// Append-only JSON Lines storage for form submissions.
// One file per submission type in DATA_DIR. Each line is a self-contained
// record with an id and timestamp, so the file can be tailed, grepped, or
// imported into a CRM without a database.

import { mkdir, appendFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export function createStore(dataDir) {
  let ready = null;

  function prepare(record) {
    return {
      id: randomUUID(),
      receivedAt: new Date().toISOString(),
      ...record,
    };
  }

  async function save(entry) {
    // Lazily create the directory so a read-only filesystem fails at save
    // time (where it is handled) rather than at import time.
    if (!ready) ready = mkdir(dataDir, { recursive: true }).catch((err) => { ready = null; throw err; });
    await ready;
    const file = path.join(dataDir, `${entry.type}-submissions.jsonl`);
    await appendFile(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    return entry;
  }

  return { prepare, save };
}
