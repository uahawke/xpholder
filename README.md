# XPholder

> A Discord bot that tracks character XP and level progression for play-by-post / Adventure League style roleplay servers.

XPholder lets a Discord server run a leveling system for tabletop RPG characters (D&D 5e tiers of play, 1–20) directly in-server. Players earn XP passively by posting in designated roleplay channels, mods can award or approve XP manually, and the bot manages level-up announcements, tier roles, and character sheets — so it can sit alongside dice-rolling / character-sheet bots as the XP layer.

---

## What it does

- **Passive XP-per-post.** Any message over 10 words in a channel you've configured earns XP, using a formula (exponential / linear / flat) you choose per server.
- **Up to 10 characters per player**, each tracked separately, switchable via Discord roles, with a name, character-sheet link, and portrait.
- **Automatic tiering.** Characters move through Tier 1–4 roles (D&D's 5e tiers of play) as they level, with old tier roles swapped out automatically.
- **Manual & requested XP.** Mods can `/award_xp` directly (with a one-click undo), or players can `/request_xp` and have it approved/rejected by a mod — or auto-approved, if the server enables it.
- **CXP support.** XP can be granted as raw XP or as "CXP" (milestone/chapter XP, converted into the right amount of raw XP for the character's current level).
- **Per-channel and per-role XP tuning.** Different channels can award different base XP; roles can grant multiplier bonuses (stacked as "highest" or "sum").
- **CSV import/export** of all characters in a server, for backup or bulk edits.
- **XP Freeze and XP Share** opt-in roles (pause your own XP gain, or split incoming XP across all your characters).

## Commands

Every command has a `public` option to control whether the reply is visible to the whole channel or just the caller.

### Everyone
| Command | Description |
|---|---|
| `/xp` | View a character's XP/level, with buttons to page through characters, set your active one, freeze XP, or retire a character |
| `/edit_character` | Update a character's name, sheet link, or picture |
| `/request_xp` | Request XP/CXP be added to one of your characters (goes to mod approval unless auto-approve is on) |
| `/calculate_xp` | Preview how much XP a post would earn under each formula |
| `/export_characters_csv` | Download all characters in the server as a CSV |
| `/toggle_xp_roles` | Toggle your XP Freeze or XP Share role |
| `/help` | In-bot help pages |
| `/ping` | Health check |

### Mod
| Command | Description |
|---|---|
| `/approve_player` | Approve a new character for a player, setting their starting level |
| `/award_xp` | Directly grant XP/CXP/level to a character (with an Undo button) |
| `/edit_channels` | Set or remove a channel's XP-per-post value |
| `/edit_roles` | Set or remove a role's XP multiplier |
| `/view_game_rules` | Inspect the server's current config, channels, levels, and roles |

### Owner
| Command | Description |
|---|---|
| `/register` | One-time server setup — creates tier/character/freeze/share roles and initializes config |
| `/edit_config` | Change server-wide settings (level-up channel/message, approval rules, XP formula, tier roles, etc.) |
| `/edit_levels` | Change the XP required to reach a given level |
| `/import_characters_csv` | Bulk-load characters from a CSV (see `/export_characters_csv`) |
| `/purge_player` | Delete all of a player's characters |

---

## Project structure

```
.
├── main.js                        # bot entry point: command loading, interaction + message handlers
├── deploy-commands.js              # registers slash commands with Discord
├── railway.json                    # Railway deploy config
├── xpholder/
│   ├── config.json                 # non-secret bot config (colors, default level curve, etc.)
│   ├── utils.js                    # XP/level/tier math, embed builders, logging
│   ├── services/guild.js           # data-access layer, one instance per guild per request
│   ├── database/
│   │   ├── pool.js                 # shared Postgres connection pool
│   │   ├── postgres.js             # database service used by guild.js
│   │   ├── schema.sql              # Postgres schema — run this once against Supabase
│   │   └── sqlite.js               # legacy, no longer used at runtime (see below)
│   └── commands/
│       ├── everyone/
│       ├── mod/
│       └── owner/
└── tooling/dataMigration/
    ├── main.js                     # archived v1(JSON)->v2(SQLite) migration
    └── sqliteToPostgres.js         # v2(SQLite)->v3(Postgres) migration
```

---

## Setup

### 1. Discord application

1. Create an application at the [Discord Developer Portal](https://discord.com/developers/applications) and add a Bot.
2. Under **Bot**, enable the **Message Content Intent** (required — passive XP-per-post reads message text).
3. Copy the bot token for `DISCORD_TOKEN`, and the application's Client ID into `xpholder/config.json`'s `CLIENT_ID`.
4. Invite the bot to your server with the `applications.commands` and `bot` scopes, and at minimum `Manage Roles`, `Send Messages`, and `Read Message History` permissions.

### 2. Database (Supabase)

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL Editor, run `xpholder/database/schema.sql` once. It's idempotent, so it's safe to re-run.
3. Go to **Project Settings > Database > Connection string**, and copy the **Session pooler** string (port `5432`) — not the direct `db.<ref>.supabase.co` host (IPv6-only, won't reach from most hosts) and not the transaction pooler on `6543` (this bot is a single long-running process, not serverless, so it doesn't need transaction-mode connection recycling). It looks like:
   ```
   postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
   ```

### 3. Local install

```bash
git clone https://github.com/JTexpo/XPholder.git
cd XPholder
npm install
cp .env.example .env
# fill in DISCORD_TOKEN and DATABASE_URL in .env
npm run deploy-commands   # registers slash commands to xpholder/config.json's TESTING_SERVER_ID
npm start
```

Once the bot is online, an owner runs `/register` in their server to initialize it, then `/edit_config` and `/edit_channels` to set up XP rewards.

### 4. Migrating existing data

If XPholder has already been running somewhere and has real per-guild SQLite databases (the old `./guilds/{guildId}.db` files), migrate them into Supabase with:

```bash
SOURCE_DIR=/path/to/guilds npm run migrate
```

This only reads the `.db` files and is safe to re-run.

---

## Deploying (Railway + Supabase)

1. Push this repo to GitHub, and create a new Railway project from it (Railway auto-detects Node via Nixpacks; `railway.json` sets the start command).
2. In the Railway service's **Variables**, set `DISCORD_TOKEN` and `DATABASE_URL` (the same Supabase session-pooler string from setup above).
3. Deploy. This is a background worker, not a web server — it doesn't need a public domain or a bound `PORT`, so you can leave Railway's networking/health-check settings off.
4. Run `node deploy-commands.js` once (locally, or via `railway run`) any time you add or change a slash command — Discord needs commands registered explicitly; it doesn't infer them from what the bot process is doing.

---

## Contributing

1. Fork the repository.
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m "Add awesome feature"`
4. Push to your fork and open a Pull Request.

There's no test suite yet — if you're touching `xpholder/services/guild.js` or the XP math in `xpholder/utils.js`, please describe how you verified the change manually in your PR.

## Issues

If you find a bug or want a feature, please open an issue with what you expected, what happened instead, and steps to reproduce.

## License

MIT — see the license block below.

```
MIT License

Copyright (c) 2026 JT Expo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Author

Originally created by **JT Expo**.
