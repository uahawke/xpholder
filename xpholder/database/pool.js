const { Pool } = require('pg');

/*
One shared connection pool for the whole process. Unlike the old SQLite
service (which opened/closed a file handle per guild, per query), Postgres
over the network wants a small number of persistent connections reused
across every query, guild, and command.
*/
// Supabase requires SSL; a local/self-hosted Postgres usually isn't
// configured for it at all, so forcing `ssl: {...}` unconditionally breaks
// local dev. Default to SSL on (Supabase), opt out with PGSSL=false.
const useSSL = process.env.PGSSL !== 'false';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: useSSL
        ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== 'false' }
        : false
});

pool.on('error', (err) => {
    // Fires for idle clients that error out in the background (dropped
    // connections, etc). Without this handler, an idle-client error would
    // crash the whole bot process.
    console.error('Unexpected Postgres pool error', err);
});

module.exports = { pool };
