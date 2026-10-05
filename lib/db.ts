import * as SQLite from 'expo-sqlite'

/**
 * Local storage. One on-device database — this app doesn't need the
 * read-only-corpus / writable-user-data split nut-ai uses, because the MVP
 * has no bundled nutrition database yet (Phase 2). If/when one ships, it
 * follows the same reasoning nut-ai's comments describe: a bundled corpus
 * update must never retroactively change a historical log entry, so it'll
 * get its own separate, read-only database file at that point.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS profile (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  sex            TEXT,
  weight_kg      REAL,
  height_cm      REAL,
  birth_date     INTEGER,
  activity_level TEXT,
  units          TEXT NOT NULL DEFAULT 'imperial',
  created_at     INTEGER NOT NULL
);

-- Append-only: a changed fight goal is a new row, so historical days can
-- still be read against whatever target was actually in force that day.
-- goal_type's DEFAULT only applies to a brand-new install — a device that
-- already had this table gets goal_type backfilled by
-- migrateFightGoalsGoalType() below instead, since CREATE TABLE IF NOT
-- EXISTS never touches an existing table's columns.
-- source distinguishes a goal row set from the onboarding formula
-- ('formula') from one produced by adaptive recalibration ('adaptive',
-- see lib/adaptiveTarget.ts) — lets the Progress screen say *why* today's
-- number differs from what the fighter originally set up.
CREATE TABLE IF NOT EXISTS fight_goals (
  id                 INTEGER PRIMARY KEY,
  effective_from     INTEGER NOT NULL,
  goal_type          TEXT NOT NULL DEFAULT 'lose',
  weigh_in_target_kg REAL NOT NULL,
  weigh_in_date      INTEGER NOT NULL,
  target_kcal        REAL NOT NULL,
  protein_g          REAL NOT NULL,
  fat_g              REAL NOT NULL,
  carbs_g            REAL NOT NULL,
  source             TEXT NOT NULL DEFAULT 'formula'
);

CREATE TABLE IF NOT EXISTS weight_entries (
  id         INTEGER PRIMARY KEY,
  local_date TEXT NOT NULL UNIQUE,
  weight_kg  REAL NOT NULL,
  logged_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meals (
  id              INTEGER PRIMARY KEY,
  photo_uri       TEXT,
  local_date      TEXT NOT NULL,
  logged_at       INTEGER NOT NULL,
  analysis_status TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS idx_meals_date ON meals(local_date);

-- MVP logs the AI's direct estimate — no local food-database match yet
-- (that's a Phase 2 accuracy upgrade, not an MVP blocker).
-- serving_label is a human-readable serving description ("1 cup", "2
-- tablespoons", "1 medium") alongside grams, not a substitute for it —
-- grams stays the number the macro math actually runs on.
CREATE TABLE IF NOT EXISTS log_items (
  id            INTEGER PRIMARY KEY,
  meal_id       INTEGER NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  serving_label TEXT,
  grams         REAL,
  calories      REAL NOT NULL,
  protein_g     REAL NOT NULL,
  carbs_g       REAL NOT NULL,
  fat_g         REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_log_items_meal ON log_items(meal_id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Append-only (like log_items) rather than one running total per day, so
-- multiple "+8 oz" taps just insert more rows instead of needing a
-- read-modify-write on a single counter.
CREATE TABLE IF NOT EXISTS water_entries (
  id         INTEGER PRIMARY KEY,
  local_date TEXT NOT NULL,
  ml         REAL NOT NULL,
  logged_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_water_date ON water_entries(local_date);

CREATE TABLE IF NOT EXISTS exercise_entries (
  id         INTEGER PRIMARY KEY,
  local_date TEXT NOT NULL,
  label      TEXT NOT NULL,
  calories   REAL NOT NULL,
  logged_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exercise_date ON exercise_entries(local_date);

-- Manual entry, not a parsed import: DEXA/BodPod/InBody providers each
-- issue their own PDF report with no shared machine-readable format, so
-- there's nothing honest to auto-parse. This just gives fighters a place to
-- log the real body-fat/lean-mass numbers from a scan they already got
-- done elsewhere — a much better number than BMI, which the Progress
-- screen's own BMI card explicitly says can't tell muscle from fat.
CREATE TABLE IF NOT EXISTS body_composition_entries (
  id            INTEGER PRIMARY KEY,
  local_date    TEXT NOT NULL,
  source        TEXT NOT NULL,
  body_fat_pct  REAL,
  lean_mass_kg  REAL,
  notes         TEXT,
  logged_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bodycomp_date ON body_composition_entries(local_date);

-- Single row, like profile -- there's only ever one "current" plan
-- (Jean's call: fixed for the week, manual regenerate replaces it rather
-- than tracking a history of past plans). plan_json holds the whole
-- 7-day structure; nothing else needs to query into individual days/meals
-- at the SQL level, so there's no reason to normalize it into rows.
-- feedback is free text on the CURRENT plan ("too much rice, more
-- variety") -- fed into the prompt on the next regenerate, so tapping
-- Regenerate after leaving feedback actually produces a different plan,
-- not just a vanity comment box.
CREATE TABLE IF NOT EXISTS meal_plan (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  generated_at INTEGER NOT NULL,
  plan_json    TEXT NOT NULL,
  feedback     TEXT
);

-- Asked once before the first plan is generated, editable after --
-- restrictions/notes are free text on purpose (an allergy or dietary
-- rule is too varied to cover with a fixed checkbox list without missing
-- the real case).
CREATE TABLE IF NOT EXISTS meal_plan_preferences (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  restrictions  TEXT,
  meals_per_day INTEGER,
  notes         TEXT,
  plan_days     INTEGER NOT NULL DEFAULT 7
);
`

/**
 * `CREATE TABLE IF NOT EXISTS` never retroactively changes an existing
 * table's columns — a device that already ran the app under the old
 * birth_year-based schema keeps that column forever unless something here
 * fixes it up. birth_year only ever stored a bare year (no month/day was
 * ever captured), so there's no honest way to convert an old value into a
 * real date of birth — clearing the row and asking the user to redo the
 * one screen is safer than inventing a fake date. Pre-launch, no real user
 * data at stake yet; this is a one-time cleanup, not a general migration
 * framework.
 */
async function migrateLegacyBirthYear(db: SQLite.SQLiteDatabase): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(profile)')
  const hasBirthYear = columns.some((c) => c.name === 'birth_year')
  const hasBirthDate = columns.some((c) => c.name === 'birth_date')
  if (hasBirthYear && !hasBirthDate) {
    await db.execAsync('DELETE FROM profile')
    await db.execAsync('ALTER TABLE profile ADD COLUMN birth_date INTEGER')
  }
}

/**
 * Same class of problem as migrateLegacyBirthYear: `CREATE TABLE IF NOT
 * EXISTS` is a no-op against a table that already exists, so a device that
 * already has a `fight_goals` table from before `goal_type` existed would
 * otherwise keep missing that column forever, and every INSERT into it
 * would start throwing. Unlike birth_year, there's nothing to clear — every
 * pre-existing row genuinely was a 'lose' goal (it's the only kind that
 * could exist), so a plain ADD COLUMN with its own DEFAULT backfills them
 * correctly with no data loss.
 */
async function migrateFightGoalsGoalType(db: SQLite.SQLiteDatabase): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(fight_goals)')
  const hasGoalType = columns.some((c) => c.name === 'goal_type')
  if (!hasGoalType) {
    await db.execAsync("ALTER TABLE fight_goals ADD COLUMN goal_type TEXT NOT NULL DEFAULT 'lose'")
  }
}

/** Same class of problem as the two migrations above — nullable and no DEFAULT needed, so existing rows just backfill to NULL (no serving description available for anything logged before this column existed, which is honest: there isn't one to invent). */
async function migrateLogItemsServingLabel(db: SQLite.SQLiteDatabase): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(log_items)')
  const hasServingLabel = columns.some((c) => c.name === 'serving_label')
  if (!hasServingLabel) {
    await db.execAsync('ALTER TABLE log_items ADD COLUMN serving_label TEXT')
  }
}

/** Same class of problem as the two fight_goals/log_items migrations above. Existing rows all came from the pre-adaptive-recalibration formula flow, so backfilling to 'formula' is accurate, not a guess. */
async function migrateFightGoalsSource(db: SQLite.SQLiteDatabase): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(fight_goals)')
  const hasSource = columns.some((c) => c.name === 'source')
  if (!hasSource) {
    await db.execAsync("ALTER TABLE fight_goals ADD COLUMN source TEXT NOT NULL DEFAULT 'formula'")
  }
}

// Caches the in-flight PROMISE, not just the resolved database -- caching
// only the resolved value (the original version of this function) let two
// concurrent first callers (a real pattern here: several screens fire
// Promise.all([...]) on mount) both see `db === null` and both open the
// database and re-run every migration concurrently (found by an
// independent code review). Every caller now awaits the same open+migrate
// work exactly once, whether they arrive before or after it settles.
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const database = await SQLite.openDatabaseAsync('weightcut.db')
      await database.execAsync(SCHEMA)
      await migrateLegacyBirthYear(database)
      await migrateFightGoalsGoalType(database)
      await migrateLogItemsServingLabel(database)
      await migrateFightGoalsSource(database)
      return database
    })()
  }
  return dbPromise
}
