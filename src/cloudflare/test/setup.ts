import { beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import schema from '../migrations/0001_marketplace.sql?raw';
import notifications from '../migrations/0002_booking_notifications.sql?raw';

beforeAll(async () => {
  const applied = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'").first();
  if (!applied) await env.DB.batch(splitSql(schema).filter(query => !/^PRAGMA\s+foreign_keys/i.test(query)).map(query => env.DB.prepare(query)));
  const notificationsApplied = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notifications'").first();
  if (!notificationsApplied) await env.DB.batch(splitSql(notifications).filter(query => !/^PRAGMA\s+foreign_keys/i.test(query)).map(query => env.DB.prepare(query)));
});

function splitSql(source: string): string[] {
  const queries: string[] = [];
  let query = '';
  let quote = '';
  let triggerDepth = 0;
  let caseDepth = 0;
  let isTrigger = false;
  for (let i = 0; i < source.length;) {
    const char = source[i];
    if (quote) {
      query += char;
      if (char === quote && source[i + 1] === quote) {
        query += source[i + 1]; i += 2; continue;
      }
      if (char === quote) quote = '';
      i++; continue;
    }
    if (char === '-' && source[i + 1] === '-') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (char === "'" || char === '"' || char === '`' || char === '[') {
      quote = char === '[' ? ']' : char;
      query += char; i++; continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      let end = i + 1;
      while (end < source.length && /[A-Za-z_]/.test(source[end])) end++;
      const word = source.slice(i, end).toUpperCase();
      query += source.slice(i, end);
      if (!isTrigger && /^\s*CREATE\s+TRIGGER\b/i.test(query)) isTrigger = true;
      if (isTrigger) {
        if (word === 'CASE') caseDepth++;
        else if (word === 'BEGIN') triggerDepth++;
        else if (word === 'END' && caseDepth > 0) caseDepth--;
        else if (word === 'END' && triggerDepth > 0) triggerDepth--;
      }
      i = end; continue;
    }
    if (char === ';' && (!isTrigger || triggerDepth === 0)) {
      const statement = query.trim();
      if (statement) queries.push(statement);
      query = ''; isTrigger = false; caseDepth = 0;
    } else query += char;
    i++;
  }
  if (query.trim()) queries.push(query.trim());
  return queries;
}
