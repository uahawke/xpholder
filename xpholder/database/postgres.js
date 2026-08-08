/*
Drop-in replacement for the old sqlLite3DatabaseService.

Keeps the same four-method interface (openDatabase / closeDatabase / execute
/ getAll / get) so guild.js and main.js only needed to change how the
service is constructed, not how it's called. open/closeDatabase are no-ops
here on purpose: the old versions opened/closed a *file handle* per guild
per query, which made sense for one-SQLite-file-per-guild. With a shared
Postgres pool there's nothing to open or close per call - the pool itself
manages connection lifecycles.

The other behavior change is real, not cosmetic: every query now takes a
`params` array and uses $1/$2/... placeholders instead of the old
string-interpolated SQL. That removes the SQL-injection surface that used
to be patched over by the sqlInjectionCheck() blocklist in utils.js.
*/
class postgresDatabaseService {
    constructor(pool) {
        this.pool = pool;
    }

    async openDatabase() { return this; }
    async closeDatabase() { return this; }

    async execute(query, params = []) {
        try {
            await this.pool.query(query, params);
            return true;
        } catch (error) {
            console.error(error.message);
            return false;
        }
    }

    async getAll(query, params = []) {
        try {
            const { rows } = await this.pool.query(query, params);
            return rows;
        } catch (error) {
            console.error(error.message);
            return false;
        }
    }

    async get(query, params = []) {
        try {
            const { rows } = await this.pool.query(query, params);
            return rows[0];
        } catch (error) {
            console.error(error.message);
            return false;
        }
    }
}

module.exports = { postgresDatabaseService };
