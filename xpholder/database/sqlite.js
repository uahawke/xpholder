/*
LEGACY - no longer used by main.js (see postgres.js). Kept only so the
historical v1->v2 migration script in tooling/dataMigration/main.js still
has something to import if you ever need to re-run it against archived
legacyData/. The live bot now reads/writes Postgres exclusively.
*/
class sqlLite3DatabaseService {
    constructor(sqlite3, databaseName) {
        this.sqlite3 = sqlite3;
        this.databaseName = databaseName;
        this.database;
    }

    async openDatabase() {
        return await new Promise(async resolve => {
            this.database = await new this.sqlite3.Database(this.databaseName, (err) => {
                if (err) { console.error(err.message); resolve(false); return; }
                resolve(this);
            });
        })
    }

    async closeDatabase() {
        return await new Promise(async resolve => {
            this.database.close((err) => {
                if (err) { console.error(err.message); resolve(false); return; }
                resolve(this);
            });
            
        })
    }

    async execute(query) {
        return await new Promise((resolve, reject) => {
            this.database.run(query, (err, data) => {
                if (err) { console.error(err.message); resolve(false); return; }
                resolve(true);
            })
        });
    }

    async getAll(query) {
        return await new Promise((resolve, reject) => {
            this.database.all(query, (err, data) => {
                if (err) { console.error(err.message); resolve(false); return; }
                resolve(data);
            })
        });
    }
    async get(query) {
        return await new Promise((resolve, reject) => {
            this.database.get(query, (err, data) => {
                if (err) { console.error(err.message); resolve(false); return; }
                resolve(data);
            })
        });
    }
}

module.exports = { sqlLite3DatabaseService }