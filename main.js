const dotenv = require('dotenv');
const fs = require('fs');

const { Client, Collection, GatewayIntentBits, Partials, EmbedBuilder, InteractionType, ChannelType } = require('discord.js');

const { guildService } = require("./xpholder/services/guild");
const { postgresDatabaseService } = require("./xpholder/database/postgres");
const { pool } = require("./xpholder/database/pool");

const { getActiveCharacterIndex, getXp, getRoleMultiplier, getLevelInfo, getTier, logCommand, logError } = require("./xpholder/utils");
const { XPHOLDER_COLOUR, XPHOLDER_ICON_URL } = require("./xpholder/config.json")
/*
-----------------------
LOADING ENV VARS (.env)
-----------------------
*/
dotenv.config();
/*
------------------------------------
SHARED DATABASE (all guilds, one db)
------------------------------------
One postgresDatabaseService wraps the one pool for the whole process. Each
interaction/message still builds its own `guildService`, scoped by
guildId, so per-guild call sites elsewhere in the codebase didn't need to
change - only how the service is constructed.
*/
const database = new postgresDatabaseService(pool);
/*
---------------------------
LOADING DISCORD PREMISSIONS
---------------------------
*/
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel]
});
client.commands = new Collection();
/*
----------------
LOADING COMMANDS
----------------
*/
const commandsPath = [
    "everyone",
    "mod",
    "owner",
];
for (const path of commandsPath) {
    const commandCollection = fs.readdirSync(`./xpholder/commands/${path}`).filter(file => file.endsWith('.js'));
    for (const file of commandCollection) {
        const command = require(`./xpholder/commands/${path}/${file}`);
        client.commands.set(command.data.name, command);
    }
}

/*
------------
BOT COMMANDS
------------
*/
client.once('ready', () => {
    //clearGuildCache();
    console.log("ready");
    console.log(client.commands);
});

client.on('interactionCreate', async interaction => {
    /*
    -------------------------------------
    VALIDATIONS FOR INTERACTION EXECUTION
    -------------------------------------
    */
    if (!interaction.isCommand() ||
        !interaction.inGuild()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    const guildId = `${interaction.guildId}`;

    // LOADING GUILD SERVICE
    const gService = new guildService(guildId, database);
    await gService.init();
    if (!gService.registered && command.data.name != "register") {
        // Try Catch on the reply, because this is a restful call, and errors can be found
        try {
            await interaction.reply({
                content: `Sorry, but your server is not registerd, please contact <@${interaction.guild.ownerId}> and ask them todo \`/register\`.`,
                ephemeral: true
            });
        } catch (error) { };
        return;
    }
    /*
    -----------------
    EXECUTING COMMAND
    -----------------
    */
    // logCommand()/logError() are intentionally fire-and-forget - logging
    // shouldn't block or fail the actual command. But without .catch()
    // here, a failure inside them (e.g. LOGING_CHANNEL_ID / ERROR_CHANNEL_ID
    // in config.json pointing at a channel this bot isn't in) becomes an
    // unhandled promise rejection - which crashes the whole Node process by
    // default. That looks like "the application did not respond" from
    // Discord's side, followed by Railway silently restarting the bot.
    logCommand(interaction).catch(error => console.log(error));

    try {
        let is_public = !interaction.options.getBoolean("public");
        await interaction.deferReply({ ephemeral: is_public });
        await command.execute(gService, interaction);
    } catch (error) {
        logError(interaction, error).catch(err => console.log(err));
        console.log(error);
    }
});

/*
-----------------------------------------------
REGISTRATION CACHE (fast-path for messageCreate)
-----------------------------------------------
Passive XP-per-post runs on every qualifying message in every server the
bot is in. The old SQLite version cheaply pre-filtered unregistered guilds
with fs.existsSync() before touching a database at all. There's no
filesystem equivalent with a shared Postgres database, so this keeps the
same intent with a short-lived in-memory cache instead of a DB round trip
on every message in every unregistered/other-bot's server. TTL is kept
short (1 min) so a freshly-registered server doesn't wait long for XP to
start working.
*/
const REGISTRATION_CACHE_TTL_MS = 60 * 1000;
const registrationCache = new Map(); // guildId -> { registered, expiresAt }

async function isGuildRegisteredCached(guildId) {
    const cached = registrationCache.get(guildId);
    if (cached && cached.expiresAt > Date.now()) { return cached.registered; }

    const registered = await new guildService(guildId, database).isRegistered();
    registrationCache.set(guildId, { registered, expiresAt: Date.now() + REGISTRATION_CACHE_TTL_MS });
    return registered;
}

/*
-----------
XP PER POST
-----------
*/
client.on('messageCreate', async message => {
    try {

        /*
        ----------
        VALIDATION
        ----------
        */
        if (!message.inGuild()) { return; }
        if (message.author.bot) { return; }
        if ((message.content.split(/\s+/).length <= 10) && !message.content.startsWith('!')) { return; }
        /*
        --------------------------------
        LOADING GUILD INTO CACHED GUILDS
        --------------------------------
        */
        const guildId = `${message.guildId}`;
        if (!await isGuildRegisteredCached(guildId)) { return; }

        const gService = new guildService(guildId, database);
        await gService.init();
        if (!gService.registered) { return; }
        /*
        --------------
        INITALIZATIONS
        --------------
        */
        const messageCount = message.content.split(/\s+/).length;
        const guild = await client.guilds.fetch(guildId);
        const player = await guild.members.fetch(message.author.id);

        const roleBonus = getRoleMultiplier(gService.config["roleBonus"], gService.roles, player._roles);

        const characterIndex = getActiveCharacterIndex(gService.config, player._roles);
        const character = await gService.getCharacter(`${player.id}-${characterIndex}`)
        if (!character) { return; }


        let channel = await guild.channels.fetch(message.channelId);

        while (channel) {
            if (channel.id in gService.channels) { break; }
            channel = await guild.channels.fetch(channel.parentId);
        }
        if (!channel) { return; }

        if (gService.channels[channel.id] == 0){ return; }


        const xp = getXp(messageCount, roleBonus, gService.channels[channel.id], gService.config["xpPerPostDivisor"], gService.config["xpPerPostFormula"]);

        if (player._roles.includes(gService.config["xpShareRoleId"])){
            const playerCharacters = await gService.getAllCharacters(player.id);
            for (let subCharacter of playerCharacters) {
                await updateCharacterXpAndMessage(guild, gService, subCharacter, xp / playerCharacters.length, player)
            }
        }else{
            await updateCharacterXpAndMessage(guild, gService, character, xp, player)
        }
        

    } catch (error) { console.log(error); }
});

async function updateCharacterXpAndMessage(guild, gService, character, xp, player){
    try{
        await gService.updateCharacterXP(character, xp);

        const oldLevelInfo = getLevelInfo(gService.levels, character["xp"]);
        const newLevelInfo = getLevelInfo(gService.levels, character["xp"] + xp);

        if (oldLevelInfo["level"] != newLevelInfo["level"]) {
            const newTier = getTier(newLevelInfo["level"]);

            const tierRoles = []
            for (let tierIndex = 1; tierIndex <= 4; tierIndex++){
                if (tierIndex == newTier["tier"]){ continue; }
                tierRoles.push(await guild.roles.fetch(gService.config[`tier${tierIndex}RoleId`]));
            }

            const newTierRole = await guild.roles.fetch(gService.config[`tier${newTier["tier"]}RoleId`]);

            try{
                const updatedPlayer = await player.roles.remove(tierRoles);
                await updatedPlayer.roles.add(newTierRole);
            }catch(error){
                console.log(error);
            }
            

            let awardChannel;
            try {
                awardChannel = await guild.channels.fetch(gService.config["levelUpChannelId"]);
            } catch (error) { return; }

            let levelUpEmbed = new EmbedBuilder()
                .setTitle(`${character["name"]} Leveled Up`)
                .setFields(
                    { name: "Level Up!", value: `${oldLevelInfo["level"]} --> **${newLevelInfo["level"]}**`, inline: true },
                    { name: "Total Character XP", value: `${Math.floor(character["xp"] + xp)}`, inline: true },
                    { name: "Tier", value: `<@&${gService.config[`tier${newTier["tier"]}RoleId`]}>`, inline: true }
                )
                .setThumbnail((character["picture_url"] != "" && character["picture_url"] !== "null")? character["picture_url"] : XPHOLDER_ICON_URL )
                .setColor(XPHOLDER_COLOUR)
                .setFooter({ text: "You can view your characters with /xp" })

            if (character["sheet_url"] != "") {
                levelUpEmbed.setURL(character["sheet_url"]);
            }

            awardChannel.send({ content: `${player}`, embeds: [levelUpEmbed] });
        }
    }catch(error){ console.log(error) }
}

/*
---------------------
LOGING THE BOT ONLINE
---------------------
*/
client.login(process.env.DISCORD_TOKEN);
