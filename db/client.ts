import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';

import { SCHEMA_DDL } from './migrate';
import * as schema from './schema';

// enableChangeListener: true is what makes drizzle-orm/expo-sqlite's
// useLiveQuery re-render screens automatically when the underlying tables change.
export const expoDb = openDatabaseSync('flashapp.db', { enableChangeListener: true });

// Apply the schema on first import. execSync is synchronous and idempotent
// (CREATE TABLE IF NOT EXISTS), so every table exists before any query runs.
expoDb.execSync(SCHEMA_DDL);

// Passing { schema } gives us typed results and the relational query API.
export const db = drizzle(expoDb, { schema });
