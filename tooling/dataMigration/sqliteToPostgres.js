/*
Migrates every existing per-guild SQLite database (./guilds/{guildId}.db,
the v2 storage format) into the new shared Postgres schema (v3). This is
the script you want if XPholder has already been running somewhere and has
real guild data to carry over - not the JSON migration in main.js, which
was a one-time v1->v2 step that already happened historically.

Usage
-----
1. Apply xpholder/database/schema.sql to your Supabase database first.
2. Put the guild .db files you want to migrate in a folder (defaults to
   ../../guilds relative to this script - override with SOURCE_DIR).
3. Set DATABASE_URL in your .env (same variable main.js uses).
4. Run:  node tooling/dataMigration/sqliteToPostgres.js
   or:   npm run migrate

This does NOT delete or modify the source .db files - it only reads them.
Safe to re-run: every insert uses ON CONFLICT DO UPDATE, so re-running
against the same source files won't create duplicates.
*/
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const dotenv = require('dotenv');
dotenv.config();

const { pool } = require('../../xpholder/database/pool');

const SOURCE_DIR = process.env.SOURCE_DIR || path.join(__dirname, '..', '..', 'guilds');

function openSqlite(filePath) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY, (err) => {
            if (err) { reject(err); return; }
            resolve(db);
        });
    });
}

function allRows(db, query) {
    return new Promise((resolve, reject) => {
        db.all(query, (err, rows) => {
            if (err) { reject(err); return; }
            resolve(rows || []);
        });
    });
}

async function migrateGuild(guildId, filePath) {
    console.log(`\n--- Migrating guild ${guildId} (${filePath}) ---`);
    const db = await openSqlite(filePath);

    const [config, levels, roles, channels, characters] = await Promise.all([
        allRows(db, 'SELECT * FROM config;'),
        allRows(db, 'SELECT * FROM levels;'),
        allRows(db, 'SELECT * FROM roles;'),
        allRows(db, 'SELECT * FROM channels;'),
        allRows(db, 'SELECT * FROM characters;'),
    ]);

    db.close();

    for (const row of config) {
        await pool.query(
            `INSERT INTO config (guild_id, name, value) VALUES ($1, $2, $3)
             ON CONFLICT (guild_id, name) DO UPDATE SET value = EXCLUDED.value;`,
            [guildId, row.name, row.value]
        );
    }
    console.log(`  config: ${config.length} rows`);

    for (const row of levels) {
        await pool.query(
            `INSERT INTO levels (guild_id, level, xp_to_next) VALUES ($1, $2, $3)
             ON CONFLICT (guild_id, level) DO UPDATE SET xp_to_next = EXCLUDED.xp_to_next;`,
            [guildId, row.level, row.xp_to_next]
        );
    }
    console.log(`  levels: ${levels.length} rows`);

    for (const row of roles) {
        await pool.query(
            `INSERT INTO roles (guild_id, role_id, xp_bonus) VALUES ($1, $2, $3)
             ON CONFLICT (guild_id, role_id) DO UPDATE SET xp_bonus = EXCLUDED.xp_bonus;`,
            [guildId, row.role_id, row.xp_bonus]
        );
    }
    console.log(`  roles: ${roles.length} rows`);

    for (const row of channels) {
        await pool.query(
            `INSERT INTO channels (guild_id, channel_id, xp_per_post) VALUES ($1, $2, $3)
             ON CONFLICT (guild_id, channel_id) DO UPDATE SET xp_per_post = EXCLUDED.xp_per_post;`,
            [guildId, row.channel_id, row.xp_per_post]
        );
    }
    console.log(`  channels: ${channels.length} rows`);

    for (const row of characters) {
        await pool.query(
            `INSERT INTO characters
                (guild_id, character_id, character_index, name, sheet_url, picture_url, player_id, xp)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (guild_id, character_id) DO UPDATE SET
                character_index = EXCLUDED.character_index,
                name = EXCLUDED.name,
                sheet_url = EXCLUDED.sheet_url,
                picture_url = EXCLUDED.picture_url,
                player_id = EXCLUDED.player_id,
                xp = EXCLUDED.xp;`,
            [
                guildId,
                row.character_id,
                row.character_index,
                row.name,
                row.sheet_url,
                row.picture_url,
                row.player_id,
                row.xp
            ]
        );
    }
    console.log(`  characters: ${characters.length} rows`);
}

(async () => {
    if (!fs.existsSync(SOURCE_DIR)) {
        console.error(`Source directory not found: ${SOURCE_DIR}`);
        console.error('Set SOURCE_DIR to the folder containing your {guildId}.db files.');
        process.exit(1);
    }

    const dbFiles = fs.readdirSync(SOURCE_DIR).filter(file => file.endsWith('.db'));
    if (dbFiles.length === 0) {
        console.log(`No .db files found in ${SOURCE_DIR}. Nothing to migrate.`);
        await pool.end();
        return;
    }

    console.log(`Found ${dbFiles.length} guild database(s) in ${SOURCE_DIR}`);

    for (const file of dbFiles) {
        const guildId = file.replace(/\.db$/, '');
        try {
            await migrateGuild(guildId, path.join(SOURCE_DIR, file));
        } catch (error) {
            console.error(`  FAILED to migrate ${guildId}:`, error.message);
        }
    }

    console.log('\nMigration complete.');
    await pool.end();
})();
