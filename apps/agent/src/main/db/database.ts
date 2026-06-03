import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema';

export function openDatabase(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA_SQL);
  return db;
}
