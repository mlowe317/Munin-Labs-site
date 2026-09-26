// Append-only JSON Lines storage for form submissions.
// One file per submission type in DATA_DIR. Each line is a self-contained
// record with an id and timestamp, so the file can be tailed, grepped, or
// imported into a CRM without a database.

import { mkdir, appendFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export function createStore(dataDir) {
  const ready = mkdir(dataDir, { recursive: true });

  async function save(record) {
    await ready;
    const entry = {
      id: randomUUID(),
      receivedAt: new Date().toISOString(),
      ...record,
    };
    const file = path.join(dataDir, `${entry.type}-submissions.jsonl`);
    await appendFile(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    return entry;
  }

  return { save };
}
