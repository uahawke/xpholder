const { listOfObjsToObj } = require("../utils")
const { LEVELS } = require("../config.json")

class guildService {
    /*
    Parameters
    ----------
    guildId : string
        The Discord guild this service instance acts on. Every query below
        is scoped to it - this is what replaces "one SQLite file per guild"
        now that everyone shares one Postgres database.

    database : postgresDatabaseService
        See xpholder/database/postgres.js. Shared across all guilds - it
        wraps one connection pool, not a per-guild file handle.
    */
    constructor(guildId, database) {
        this.guildId = `${guildId}`;
        this.database = database;

        this.registered = false;
        this.last_touched = Date.now();
    }

    /*
    -------------
    INITALIZATION
    -------------
    */
    async init() {
        if (!await this.isRegistered()) { return }
        this.config = await this.loadInit("config", "name", "value");
        this.levels = await this.loadInit("levels", "level", "xp_to_next");
        this.roles = await this.loadInit("roles", "role_id", "xp_bonus");
        this.channels = await this.loadInit("channels", "channel_id", "xp_per_post");
    }

    async loadInit(table, primaryKey, value) {
        const rows = await this.database.getAll(
            `SELECT * FROM ${table} WHERE guild_id = $1;`,
            [this.guildId]
        );
        return listOfObjsToObj(rows || [], primaryKey, value);
    }

    /*
    ---------
    VALIDATOR
    ---------
    */
    isMod(listOfRoles) {
        return listOfRoles.includes(this.config["moderationRoleId"]);
    }

    async isRegistered() {
        const row = await this.database.get(
            `SELECT 1 FROM config WHERE guild_id = $1 LIMIT 1;`,
            [this.guildId]
        );
        this.registered = !!row;
        return this.registered;
    }

    /*
    ---------
    CHARACTER
    ---------
    */
    async deleteCharacter(character) {
        return await this.database.execute(
            `DELETE FROM characters WHERE guild_id = $1 AND character_id = $2;`,
            [this.guildId, character["character_id"]]
        );
    }

    async getAllCharacters(playerId) {
        return await this.database.getAll(
            `SELECT * FROM characters WHERE guild_id = $1 AND player_id = $2;`,
            [this.guildId, playerId]
        );
    }

    async getAllGuildCharacters() {
        return await this.database.getAll(
            `SELECT * FROM characters WHERE guild_id = $1;`,
            [this.guildId]
        );
    }

    async getCharacter(characterId) {
        return await this.database.get(
            `SELECT * FROM characters WHERE guild_id = $1 AND character_id = $2;`,
            [this.guildId, characterId]
        );
    }

    async insertCharacter(character) {
        return await this.database.execute(
            `INSERT INTO characters
                (guild_id, character_id, character_index, name, sheet_url, picture_url, player_id, xp)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`,
            [
                this.guildId,
                character.character_id,
                character.character_index,
                character.name,
                character.sheet_url,
                character.picture_url,
                character.player_id,
                character.xp
            ]
        );
    }

    async updateCharacterInfo(character) {
        return await this.database.execute(
            `UPDATE characters
             SET name = $1, sheet_url = $2, picture_url = $3
             WHERE guild_id = $4 AND character_id = $5;`,
            [character.name, character.sheet_url, character.picture_url, this.guildId, character.character_id]
        );
    }

    async updateCharacterXP(character, deltaXp) {
        return await this.database.execute(
            `UPDATE characters SET xp = xp + $1 WHERE guild_id = $2 AND character_id = $3;`,
            [deltaXp, this.guildId, character.character_id]
        );
    }

    async setCharacterXP(character) {
        return await this.database.execute(
            `UPDATE characters SET xp = $1 WHERE guild_id = $2 AND character_id = $3;`,
            [character.xp, this.guildId, character.character_id]
        );
    }

    /*
    ---------------
    UPDATING TABLES
    ---------------
    */
    async updateConfig(config) {
        for (const [name, value] of Object.entries(config)) {
            await this.database.execute(
                `INSERT INTO config (guild_id, name, value) VALUES ($1, $2, $3)
                 ON CONFLICT (guild_id, name) DO UPDATE SET value = EXCLUDED.value;`,
                [this.guildId, name, `${value}`]
            );
        }
        this.config = await this.loadInit("config", "name", "value");
    }

    async updateChannel(channelId, xpPerPost) {
        // IF THE XP IS POSITIVE ( ZERO INCLUDED ) WE WANT TO ADD THE CHANNEL TO THE DATABASE; ELSE, DELETE IT
        if (xpPerPost >= 0) {
            await this.database.execute(
                `INSERT INTO channels (guild_id, channel_id, xp_per_post) VALUES ($1, $2, $3)
                 ON CONFLICT (guild_id, channel_id) DO UPDATE SET xp_per_post = EXCLUDED.xp_per_post;`,
                [this.guildId, channelId, xpPerPost]
            );
        } else {
            await this.database.execute(
                `DELETE FROM channels WHERE guild_id = $1 AND channel_id = $2;`,
                [this.guildId, channelId]
            );
        }
        this.channels = await this.loadInit("channels", "channel_id", "xp_per_post");
    }

    async updateLevel(level, xpToNext) {
        await this.database.execute(
            `UPDATE levels SET xp_to_next = $1 WHERE guild_id = $2 AND level = $3;`,
            [xpToNext, this.guildId, level]
        );
        this.levels = await this.loadInit("levels", "level", "xp_to_next");
    }

    async updateRole(roleId, xpBonus) {
        // IF THE XP IS POSITIVE ( ZERO INCLUDED ) WE WANT TO ADD THE ROLE TO THE DATABASE; ELSE, DELETE IT
        if (xpBonus >= 0) {
            await this.database.execute(
                `INSERT INTO roles (guild_id, role_id, xp_bonus) VALUES ($1, $2, $3)
                 ON CONFLICT (guild_id, role_id) DO UPDATE SET xp_bonus = EXCLUDED.xp_bonus;`,
                [this.guildId, roleId, xpBonus]
            );
        } else {
            await this.database.execute(
                `DELETE FROM roles WHERE guild_id = $1 AND role_id = $2;`,
                [this.guildId, roleId]
            );
        }
        this.roles = await this.loadInit("roles", "role_id", "xp_bonus");
    }

    /*
    --------------------
    REGISTERING A SERVER
    --------------------
    Note: this no longer creates tables (createDatabases/createXTable are
    gone). The schema is shared across all guilds and lives in
    xpholder/database/schema.sql, applied once up front. Registering a
    server now just means: insert its config/levels/roles rows.
    */
    async registerServer(configDetails) {
        for (const [name, value] of Object.entries(configDetails)) {
            await this.database.execute(
                `INSERT INTO config (guild_id, name, value) VALUES ($1, $2, $3)
                 ON CONFLICT (guild_id, name) DO UPDATE SET value = EXCLUDED.value;`,
                [this.guildId, name, `${value}`]
            );
        }

        for (const [level, xp_to_next] of Object.entries(LEVELS)) {
            await this.database.execute(
                `INSERT INTO levels (guild_id, level, xp_to_next) VALUES ($1, $2, $3)
                 ON CONFLICT (guild_id, level) DO UPDATE SET xp_to_next = EXCLUDED.xp_to_next;`,
                [this.guildId, level, xp_to_next]
            );
        }

        await this.database.execute(
            `INSERT INTO roles (guild_id, role_id, xp_bonus) VALUES ($1, $2, 0)
             ON CONFLICT (guild_id, role_id) DO UPDATE SET xp_bonus = 0;`,
            [this.guildId, configDetails["xpFreezeRoleId"]]
        );
    }
}

module.exports = { guildService }
