-- XPholder v3 schema (Postgres / Supabase)
--
-- The old SQLite version gave every guild its own database file, so a bare
-- "characters" table with no guild reference was fine - the guild boundary
-- was the file itself. On Supabase everyone shares one database, so every
-- table gets a guild_id column and every primary/foreign key is scoped by
-- it. Run this once against your Supabase database before starting the
-- bot (e.g. via the Supabase SQL editor, or `psql "$DATABASE_URL" -f
-- xpholder/database/schema.sql`). It's idempotent - safe to re-run.

CREATE TABLE IF NOT EXISTS config (
    guild_id VARCHAR(32)   NOT NULL,
    name     VARCHAR(100)  NOT NULL,
    value    VARCHAR(2000),
    PRIMARY KEY (guild_id, name)
);

CREATE TABLE IF NOT EXISTS levels (
    guild_id   VARCHAR(32) NOT NULL,
    level      INTEGER     NOT NULL,
    xp_to_next NUMERIC     NOT NULL,
    PRIMARY KEY (guild_id, level)
);

CREATE TABLE IF NOT EXISTS roles (
    guild_id VARCHAR(32) NOT NULL,
    role_id  VARCHAR(32) NOT NULL,
    xp_bonus NUMERIC     NOT NULL,
    PRIMARY KEY (guild_id, role_id)
);

CREATE TABLE IF NOT EXISTS channels (
    guild_id     VARCHAR(32) NOT NULL,
    channel_id   VARCHAR(32) NOT NULL,
    xp_per_post  NUMERIC     NOT NULL,
    PRIMARY KEY (guild_id, channel_id)
);

CREATE TABLE IF NOT EXISTS characters (
    guild_id        VARCHAR(32)  NOT NULL,
    character_id    VARCHAR(64)  NOT NULL, -- "{player_id}-{character_index}"
    character_index INTEGER      NOT NULL,
    name            VARCHAR(100),
    sheet_url       VARCHAR(200),
    picture_url     VARCHAR(300),
    player_id       VARCHAR(32)  NOT NULL,
    xp              NUMERIC      NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, character_id)
);

-- /xp, /award_xp, /request_xp, /purge_player, and passive XP-per-post all
-- look characters up by (guild_id, player_id) - this is the hot path.
CREATE INDEX IF NOT EXISTS idx_characters_guild_player
    ON characters (guild_id, player_id);
