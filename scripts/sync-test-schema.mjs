import { readFileSync, writeFileSync } from 'node:fs';
const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));
const sql = journal.entries.map(({tag}) => readFileSync(`drizzle/${tag}.sql`, 'utf8')).join('\n');
writeFileSync('sites/schema.sql', '-- GENERATED from Drizzle migrations for Node/SQLite tests. Production uses drizzle/*.sql.\nPRAGMA foreign_keys=ON;\n' + sql);
