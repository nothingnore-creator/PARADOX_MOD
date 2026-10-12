const {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionsBitField,
    EmbedBuilder
} = require("discord.js");

const fs = require("fs");

const TOKEN = process.env.DISCORD_TOKEN;
const PREFIX = ".";

const LOG_CHANNEL_ID = "1555194792227373086";
const MUTE_ROLE_ID = "MUTE_ROLE_ID_HERE";

const MAX_WARNS = 3;
const AUTO_TIMEOUT_MS = 10 * 60 * 1000;

const SPAM_LIMIT = 3;
const SPAM_TIME = 10 * 1000;

const MENTION_LIMIT = 30;


// ================= PROTECTED TAGS =================

const PROTECTED_TAG_USERS = [
    {
        userId: "",
        action: "timeout",
        duration: 10 * 60 * 1000,
        message: "❌ Greetings, Don't Tag him again."
    }

    // {
    //     userId: "ANOTHER_USER_ID",
    //     action: "warn",
    //     duration: 0,
    //     message: "⚠️ Please do not tag this person."
    // }
];

const PROTECTED_TAG_ROLES = [
    {
        roleId: "1528773943698260119",
        action: "warn",
        duration: 20 * 60 * 1000,
        message: "❌ Greetings, Follow Hierarchy."
    },

    {
        roleId: "1546466716186578964",
        action: "warn",
        duration: 20 * 60 * 1000,
        message: "❌ Greetings, Follow Hierarchy."
    }
];


// ================= DATABASE =================

const DB_FILE = "./database.json";

let db = {
    warnings: {},
    whitelistRoles: {}
};

function loadDB() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
            return;
        }

        const data = fs.readFileSync(DB_FILE, "utf8");

        if (data.trim()) {
            db = JSON.parse(data);
        }

        if (!db.warnings) db.warnings = {};
        if (!db.whitelistRoles) db.whitelistRoles = {};

    } catch {
        db = {
            warnings: {},
            whitelistRoles: {}
        };
    }
}

function saveDB() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    } catch {}
}

loadDB();


// ================= CLIENT =================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [
        Partials.Channel,
        Partials.Message,
        Partials.User,
        Partials.GuildMember
    ]
});


// ================= WARNINGS =================

function getWarnings(guildId, userId) {
    if (!db.warnings[guildId]) {
        db.warnings[guildId] = {};
    }

    return db.warnings[guildId][userId] || 0;
}

function setWarnings(guildId, userId, amount) {
    if (!db.warnings[guildId]) {
        db.warnings[guildId] = {};
    }

    if (amount <= 0) {
        delete db.warnings[guildId][userId];
    } else {
        db.warnings[guildId][userId] = amount;
    }

    saveDB();
}

function addWarning(guildId, userId) {
    const current = getWarnings(guildId, userId);
    const count = current + 1;

    setWarnings(guildId, userId, count);

    return count;
}

function removeWarning(guildId, userId) {
    const current = getWarnings(guildId, userId);

    if (current <= 0) return 0;

    const count = current - 1;

    setWarnings(guildId, userId, count);

    return count;
}

function clearWarnings(guildId, userId) {
    setWarnings(guildId, userId, 0);
}


// ================= WHITELIST =================

function getWhitelistRoles(guildId) {
    if (!db.whitelistRoles[guildId]) {
        db.whitelistRoles[guildId] = [];
        saveDB();
    }

    return db.whitelistRoles[guildId];
}

function isWhitelisted(member) {
    if (!member) return false;

    const roles = getWhitelistRoles(member.guild.id);

    return member.roles.cache.some(role =>
        roles.includes(role.id)
    );
}


// ================= PERMISSIONS =================

function hasPermission(member, permission) {
    if (!member) return false;

    if (isWhitelisted(member)) {
        return true;
    }

    if (
        member.permissions.has(
            PermissionsBitField.Flags.Administrator
        )
    ) {
        return true;
    }

    return member.permissions.has(permission);
}


// ================= MODERATION =================

function canModerate(message, target) {
    if (!target) {
        return {
            allowed: false,
            reason: "❌ User not found."
        };
    }

    if (target.id === message.author.id) {
        return {
            allowed: false,
            reason: "❌ You cannot moderate yourself."
        };
    }

    if (target.id === client.user.id) {
        return {
            allowed: false,
            reason: "❌ I cannot moderate myself."
        };
    }

    if (!target.moderatable) {
        return {
            allowed: false,
            reason: "❌ I cannot moderate this member. Check my role hierarchy."
        };
    }

    return {
        allowed: true
    };
}


// ================= LOG =================

async function sendLog(guild, {
    action,
    user,
    moderator,
    reason = "No reason provided",
    warningCount = null
}) {
    try {
        const channel = guild.channels.cache.get(LOG_CHANNEL_ID);

        if (!channel) return;

        const embed = new EmbedBuilder()
            .setTitle("🛡️ Moderation Log")
            .addFields(
                {
                    name: "👤 User",
                    value: `${user} (${user.id})`
                },
                {
                    name: "🔨 Action",
                    value: action,
                    inline: true
                },
                {
                    name: "👮 Moderator",
                    value: `${moderator}`,
                    inline: true
                },
                {
                    name: "📝 Reason",
                    value: reason
                }
            )
            .setTimestamp();

        if (warningCount !== null) {
            embed.addFields({
                name: "⚠️ Warnings",
                value: `${warningCount}/${MAX_WARNS}`,
                inline: true
            });
        }

        await channel.send({
            embeds: [embed]
        });

    } catch {}
}


// ================= DM =================

async function sendDM(user, message) {
    try {
        await user.send(message);
    } catch {}
}


// ================= AUTO TIMEOUT =================

async function autoTimeout(member, reason) {
    try {
        if (!member.moderatable) return false;

        await member.timeout(
            AUTO_TIMEOUT_MS,
            reason
        );

        return true;

    } catch {
        return false;
    }
}


// ================= WARNING SYSTEM =================

async function issueWarning(
    message,
    target,
    reason,
    moderator = null,
    automatic = false
) {
    const guild = message.guild;
    const mod = moderator || message.author;

    const count = addWarning(
        guild.id,
        target.id
    );

    await sendDM(
        target.user,
        `⚠️ **Warning Received**

Server: **${guild.name}**

Reason: **${reason}**

Warnings: **${count}/${MAX_WARNS}**`
    );

    await sendLog(guild, {
        action: automatic
            ? "Automatic Warning"
            : "Warning",
        user: target.user,
        moderator: mod,
        reason,
        warningCount: count
    });

    if (count === MAX_WARNS) {

        const success = await autoTimeout(
            target,
            `Reached ${MAX_WARNS}/${MAX_WARNS} warnings`
        );

        if (success) {

            clearWarnings(
                guild.id,
                target.id
            );

            await sendDM(
                target.user,
                `🔇 **Automatic Timeout**

You reached **${MAX_WARNS}/${MAX_WARNS} warnings**.

Timeout: **10 minutes**

Warnings reset to **0/${MAX_WARNS}**.`
            );

            await sendLog(guild, {
                action: "Automatic Timeout",
                user: target.user,
                moderator: client.user,
                reason: `Reached ${MAX_WARNS}/${MAX_WARNS} warnings`,
                warningCount: 0
            });

            try {
                await message.channel.send(
                    `🔇 ${target} reached **${MAX_WARNS}/${MAX_WARNS} warnings** and has been timed out for **10 minutes**.\nWarnings reset to **0/${MAX_WARNS}**.`
                );
            } catch {}

        } else {

            try {
                await message.channel.send(
                    `⚠️ ${target} reached **${MAX_WARNS}/${MAX_WARNS} warnings**, but I could not apply the timeout.`
                );
            } catch {}
        }
    }

    return count;
}


// ================= DURATION =================

function parseDuration(input) {
    if (!input) return null;

    const match = input
        .toLowerCase()
        .match(/^(\d+)(s|m|h|d)$/);

    if (!match) return null;

    const amount = Number(match[1]);
    const unit = match[2];

    let ms;

    if (unit === "s") ms = amount * 1000;
    if (unit === "m") ms = amount * 60 * 1000;
    if (unit === "h") ms = amount * 60 * 60 * 1000;
    if (unit === "d") ms = amount * 24 * 60 * 60 * 1000;

    const max = 28 * 24 * 60 * 60 * 1000;

    if (ms > max) return null;

    return ms;
}


// ================= SPAM =================

const spamTracker = new Map();

function checkSpam(message) {
    const key = `${message.guild.id}-${message.author.id}`;
    const now = Date.now();

    const content = message.content
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();

    const old = spamTracker.get(key);

    if (!old) {
        spamTracker.set(key, {
            content,
            count: 1,
            lastTime: now
        });

        return false;
    }

    if (now - old.lastTime > SPAM_TIME) {
        spamTracker.set(key, {
            content,
            count: 1,
            lastTime: now
        });

        return false;
    }

    if (old.content !== content) {
        spamTracker.set(key, {
            content,
            count: 1,
            lastTime: now
        });

        return false;
    }

    old.count++;
    old.lastTime = now;

    if (old.count >= SPAM_LIMIT) {
        spamTracker.delete(key);
        return true;
    }

    return false;
}


// ================= PROTECTED TAG =================

function getProtectedTagRule(message) {

    for (const user of message.mentions.users.values()) {

        const rule = PROTECTED_TAG_USERS.find(
            x => x.userId === user.id
        );

        if (rule) {
            return {
                type: "user",
                rule
            };
        }
    }

    for (const role of message.mentions.roles.values()) {

        const rule = PROTECTED_TAG_ROLES.find(
            x => x.roleId === role.id
        );

        if (rule) {
            return {
                type: "role",
                rule
            };
        }
    }

    return null;
}

async function handleProtectedTag(message) {

    if (isWhitelisted(message.member)) {
        return false;
    }

    const protectedTag =
        getProtectedTagRule(message);

    if (!protectedTag) {
        return false;
    }

    const rule = protectedTag.rule;

    try {
        await message.delete();
    } catch {}

    if (rule.action === "timeout") {

        try {

            if (!message.member.moderatable) {
                await message.channel.send(
                    `❌ ${message.author}, I cannot timeout you because of role hierarchy.`
                );

                return true;
            }

            await message.member.timeout(
                rule.duration,
                `Protected tag: ${rule.message}`
            );

            await sendDM(
                message.author,
                `🔇 **You have been timed out.**

Reason: **${rule.message}**`
            );

            await sendLog(message.guild, {
                action: "Protected Tag Timeout",
                user: message.author,
                moderator: client.user,
                reason: rule.message
            });

            await message.channel.send(
                `${rule.message}\n🔇 ${message.author} has been timed out.`
            );

        } catch (error) {
            console.error(error);
        }

        return true;
    }

    if (rule.action === "warn") {

        await issueWarning(
            message,
            message.member,
            rule.message,
            client.user,
            true
        );

        try {
            await message.channel.send(
                `${rule.message}\n⚠️ ${message.author} has received a warning.`
            );
        } catch {}

        return true;
    }

    return false;
}


// ================= READY =================

client.once("ready", () => {

    console.log(
        `✅ Bot online as ${client.user.tag}`
    );

    client.user.setActivity(
        `${PREFIX}help | Moderation`
    );
});


// ================= MESSAGE =================

client.on("messageCreate", async message => {

    try {

        if (message.author.bot) return;
        if (!message.guild) return;

        const isCommand =
            message.content.startsWith(PREFIX);


        if (!isCommand) {

            const protectedTag =
                await handleProtectedTag(message);

            if (protectedTag) return;
        }


        if (
            !isCommand &&
            !isWhitelisted(message.member)
        ) {

            const mentions =
                message.mentions.users.size +
                message.mentions.roles.size;

            if (mentions >= MENTION_LIMIT) {

                try {
                    await message.delete();
                } catch {}

                await issueWarning(
                    message,
                    message.member,
                    `Mention spam (${mentions} mentions)`,
                    client.user,
                    true
                );

                try {
                    await message.channel.send(
                        `⚠️ ${message.author}, mention spam is not allowed.`
                    );
                } catch {}

                return;
            }
        }


        if (
            !isCommand &&
            !isWhitelisted(message.member)
        ) {

            if (checkSpam(message)) {

                await issueWarning(
                    message,
                    message.member,
                    "Repeated same message spam",
                    client.user,
                    true
                );

                try {
                    await message.channel.send(
                        `⚠️ ${message.author}, please do not spam the same message.`
                    );
                } catch {}

                return;
            }
        }


        if (!isCommand) return;


        const args = message.content
            .slice(PREFIX.length)
            .trim()
            .split(/\s+/);

        const command =
            args.shift()?.toLowerCase();


        if (!command) return;


        // ================= HELP =================

        if (command === "help") {

            const embed = new EmbedBuilder()
                .setTitle("🛡️ Moderation Commands")
                .setDescription([
                    `\`${PREFIX}warn @user [reason]\``,
                    `\`${PREFIX}unwarn @user\``,
                    `\`${PREFIX}warnings @user\``,
                    `\`${PREFIX}clearuser @user\``,
                    `\`${PREFIX}clear 10\``,
                    "",
                    `\`${PREFIX}mute @user [reason]\``,
                    `\`${PREFIX}unmute @user\``,
                    "",
                    `\`${PREFIX}timeout @user 10m [reason]\``,
                    `\`${PREFIX}untimeout @user\``,
                    "",
                    `\`${PREFIX}kick @user [reason]\``,
                    `\`${PREFIX}ban @user [reason]\``,
                    `\`${PREFIX}unban USER_ID\``,
                    "",
                    `\`${PREFIX}whitelistrole add @Role\``,
                    `\`${PREFIX}whitelistrole remove @Role\``,
                    `\`${PREFIX}whitelistrole list\``
                ].join("\n"))
                .setTimestamp();

            await message.channel.send({
                embeds: [embed]
            });

            return;
        }


        // ================= WARN =================

        if (command === "warn") {

            if (
                !hasPermission(
                    message.member,
                    PermissionsBitField.Flags.ModerateMembers
                )
            ) {
                return message.reply(
                    "❌ You don't have permission to use this command."
                );
            }

            const target =
                message.mentions.members.first();

            if (!target) {
                return message.reply(
                    `Usage: \`${PREFIX}warn @user [reason]\``
                );
            }

            const check =
                canModerate(message, target);

            if (!check.allowed) {
                return message.reply(check.reason);
            }

            const reason =
                args.join(" ") ||
                "No reason provided";

            await issueWarning(
                message,
                target,
                reason,
                message.author,
                false
            );

            await message.channel.send(
                `⚠️ ${target} has been warned.\nReason: **${reason}**`
            );

            return;
        }


        // ================= UNWARN =================

        if (command === "unwarn") {

            if (
                !hasPermission(
                    message.member,
                    PermissionsBitField.Flags.ModerateMembers
                )
            ) {
                return message.reply(
                    "❌ You don't have permission to use this command."
                );
            }

            const target =
                message.mentions.members.first();

            if (!target) {
                return message.reply(
                    `Usage: \`${PREFIX}unwarn @user\``
                );
            }

            const current =
                getWarnings(
                    message.guild.id,
                    target.id
                );

            if (current <= 0) {
                return message.reply(
                    `ℹ️ ${target} has no warnings.`
                );
            }

            const count =
                removeWarning(
                    message.guild.id,
                    target.id
                );

            await sendLog(message.guild, {
                action: "Warning Removed",
                user: target.user,
                moderator: message.author,
                reason: "Warning removed manually",
                warningCount: count
            });

            await message.channel.send(
                `✅ Removed 1 warning from ${target}.\nWarnings: **${count}/${MAX_WARNS}**`
            );

            return;
        }


        // ================= WARNINGS =================

        if (command === "warnings") {

            const target =
                message.mentions.members.first() ||
                message.member;

            const count =
                getWarnings(
                    message.guild.id,
                    target.id
                );

            await message.channel.send(
                `⚠️ ${target} has **${count}/${MAX_WARNS} warnings**.`
            );

            return;
        }


        // ================= CLEAR USER =================

        if (command === "clearuser") {

            if (
                !hasPermission(
                    message.member,
                    PermissionsBitField.Flags.Administrator
                )
            ) {
                return message.reply(
                    "❌ You don't have permission to use this command."
                );
            }

            const target =
                message.mentions.members.first();

            if (!target) {
                return message.reply(
                    `Usage: \`${PREFIX}clearuser @user\``
                );
            }

            clearWarnings(
                message.guild.id,
                target.id
            );

            await sendLog(message.guild, {
                action: "Warnings Cleared",
                user: target.user,
                moderator: message.author,
                reason: "All warnings cleared",
                warningCount: 0
            });

            await message.channel.send(
                `✅ All warnings for ${target} have been cleared.`
            );

            return;
        }


        // ================= CLEAR =================

        if (command === "clear") {

            if (
                !hasPermission(
                    message.member,
                    PermissionsBitField.Flags.ManageMessages
                )
            ) {
                return message.reply(
                    "❌ You don't have permission to use this command."
                );
            }

            const amount =
                parseInt(args[0]);

            if (
                !amount ||
                amount < 1 ||
                amount > 100
            ) {
                return message.reply(
                    `Usage: \`${PREFIX}clear 1-100\``
                );
            }

            try {

                const deleted =
                    await message.channel.bulkDelete(
                        amount,
                        true
                    );

                try {
                    await message.delete();
                } catch {}

                const msg =
                    await message.channel.send(
                        `🧹 Deleted **${deleted.size} messages**.`
                    );

                setTimeout(() => {
                    msg.delete().catch(() => {});
                }, 3000);

            } catch {

                await message.reply(
                    "❌ Failed to delete messages. Messages older than 14 days cannot be bulk deleted."
                );
            }

            return;
        }


        // ================= MUTE =================

        if (command === "mute") {

            if (
                !hasPermission(
                    message.member,
                    PermissionsBitField.Flags.ManageRoles
                )
            ) {
                return message.reply(
                    "❌ You don't have permission to use this command."
                );
            }

            const target =
                message.mentions.members.first();

            if (!target) {
                return message.reply(
                    `Usage: \`${PREFIX}mute @user [reason]\``
                );
            }

            const check =
                canModerate(message, target);

            if (!check.allowed) {
                return message.reply(check.reason);
            }

            const role =
                message.guild.roles.cache.get(
                    MUTE_ROLE_ID
                );

            if (!role) {
                return message.reply(
                    "❌ Mute role not found."
                );
            }

            if (
                role.position >=
                message.guild.members.me.roles.highest.position
            ) {
                return message.reply(
                    "❌ My bot role must be above the Muted role."
                );
            }

            const reason =
                args.join(" ") ||
                "No reason provided";

            try {

                await target.roles.add(
                    role,
                    reason
                );

                await sendDM(
                    target.user,
                    `🔇 You have been muted in **${message.guild.name}**.\nReason: **${reason}**`
                );

                await sendLog(message.guild, {
                    action: "Mute",
                    user: target.user,
                    moderator: message.author,
                    reason
                });

                await message.channel.send(
                    `🔇 ${target} has been muted.`
                );

            } catch {
                await message.reply(
                    "❌ Failed to mute this user."
                );
            }

            return;
        }


        // ================= UNMUTE =================

        if (command === "unmute") {

            if (
                !hasPermission(
                    message.member,
                    PermissionsBitField.Flags.ManageRoles
                )
            ) {
                return message.reply(
                    "❌ You don't have permission to use this command."
                );
            }

            const target =
                message.mentions.members.first();

            if (!target) {
                return message.reply(
                    `Usage: \`${PREFIX}unmute @user\``
                );
            }

            const role =
                message.guild.roles.cache.get(
                    MUTE_ROLE_ID
                );

            if (!role) {
                return message.reply(
                    "❌ Mute role not found."
                );
            }

            try {

                await target.roles.remove(role);

                await sendDM(
                    target.user,
                    `🔊 You have been unmuted in **${message.guild.name}**.`
                );

                await sendLog(message.guild, {
                    action: "Unmute",
                    user: target.user,
                    moderator: message.author,
                    reason: "Manual unmute"
                });

                await message.channel.send(
                    `🔊 ${target} has been unmuted.`
                );

            } catch {
                await message.reply(
                    "❌ Failed to unmute this user."
                );
            }

            return;
        }


        // ================= TIMEOUT =================

        if (command === "timeout") {

            if (
                !hasPermission(
                    message.member,
                    PermissionsBitField.Flags.ModerateMembers
                )
            ) {
                return message.reply(
                    "❌ You don't have permission to use this command."
                );
            }

            const target =
                message.mentions.members.first();

            const durationText =
                args.find(arg =>
                    /^\d+(s|m|h|d)$/i.test(arg)
                );

            if (!target || !durationText) {
                return message.reply(
                    `Usage: \`${PREFIX}timeout @user 10m [reason]\``
                );
            }

            const duration =
                parseDuration(durationText);

            if (!duration) {
                return message.reply(
                    "❌ Invalid duration. Maximum is 28 days."
                );
            }

            const check =
                canModerate(message, target);

            if (!check.allowed) {
                return message.reply(check.reason);
            }

            const reason =
                args
                    .filter(x => x !== durationText)
                    .join(" ") ||
                "No reason provided";

            try {

                await target.timeout(
                    duration,
                    reason
                );

                await sendDM(
                    target.user,
                    `🔇 You have been timed out in **${message.guild.name}**.\nReason: **${reason}**`
                );

                await sendLog(message.guild, {
                    action: `Timeout (${durationText})`,
                    user: target.user,
                    moderator: message.author,
                    reason
                });

                await message.channel.send(
                    `🔇 ${target} has been timed out for **${durationText}**.`
                );

            } catch {
                await message.reply(
                    "❌ Failed to timeout this user."
                );
            }

            return;
        }


        // ================= UNTIMEOUT =================

        if (
            command === "untimeout" ||
            command === "removetimeout"
        ) {

            if (
                !hasPermission(
                    message.member,
                    PermissionsBitField.Flags.ModerateMembers
                )
            ) {
                return message.reply(
                    "❌ You don't have permission to use this command."
                );
            }

            const target =
                message.mentions.members.first();

            if (!target) {
                return message.reply(
                    `Usage: \`${PREFIX}${command} @user\``
                );
            }

            try {

                await target.timeout(
                    null,
                    "Manual timeout removal"
                );

                await sendDM(
                    target.user,
                    `🔊 Your timeout has been removed in **${message.guild.name}**.`
                );

                await sendLog(message.guild, {
                    action: "Timeout Removed",
                    user: target.user,
                    moderator: message.author,
                    reason: "Manual timeout removal"
                });

                await message.channel.send(
                    `🔊 ${target}'s timeout has been removed.`
                );

            } catch {
                await message.reply(
                    "❌ Failed to remove timeout."
                );
            }

            return;
        }


        // ================= KICK =================

        if (command === "kick") {

            if (
                !hasPermission(
                    message.member,
                    PermissionsBitField.Flags.KickMembers
                )
            ) {
                return message.reply(
                    "❌ You don't have permission to use this command."
                );
            }

            const target =
                message.mentions.members.first();

            if (!target) {
                return message.reply(
                    `Usage: \`${PREFIX}kick @user [reason]\``
                );
            }

            const check =
                canModerate(message, target);

            if (!check.allowed) {
                return message.reply(check.reason);
            }

            const reason =
                args.join(" ") ||
                "No reason provided";

            await sendDM(
                target.user,
                `👢 You have been kicked from **${message.guild.name}**.\nReason: **${reason}**`
            );

            try {

                await target.kick(reason);

                await sendLog(message.guild, {
                    action: "Kick",
                    user: target.user,
                    moderator: message.author,
                    reason
                });

                await message.channel.send(
                    `👢 ${target.user.tag} has been kicked.`
                );

            } catch {
                await message.reply(
                    "❌ Failed to kick this user."
                );
            }

            return;
        }


        // ================= BAN =================

        if (command === "ban") {

            if (
                !hasPermission(
                    message.member,
                    PermissionsBitField.Flags.BanMembers
                )
            ) {
                return message.reply(
                    "❌ You don't have permission to use this command."
                );
            }

            const target =
                message.mentions.members.first();

            if (!target) {
                return message.reply(
                    `Usage: \`${PREFIX}ban @user [reason]\``
                );
            }

            const check =
                canModerate(message, target);

            if (!check.allowed) {
                return message.reply(check.reason);
            }

            const reason =
                args.join(" ") ||
                "No reason provided";

            await sendDM(
                target.user,
                `🔨 You have been banned from **${message.guild.name}**.\nReason: **${reason}**`
            );

            try {

                await target.ban({
                    reason
                });

                await sendLog(message.guild, {
                    action: "Ban",
                    user: target.user,
                    moderator: message.author,
                    reason
                });

                await message.channel.send(
                    `🔨 ${target.user.tag} has been banned.`
                );

            } catch {
                await message.reply(
                    "❌ Failed to ban this user."
                );
            }

            return;
        }


        // ================= UNBAN =================

        if (command === "unban") {

            if (
                !hasPermission(
                    message.member,
                    PermissionsBitField.Flags.BanMembers
                )
            ) {
                return message.reply(
                    "❌ You don't have permission to use this command."
                );
            }

            const userId = args[0];

            if (!userId) {
                return message.reply(
                    `Usage: \`${PREFIX}unban USER_ID\``
                );
            }

            try {

                const user =
                    await client.users.fetch(userId);

                await message.guild.members.unban(
                    user.id
                );

                await sendLog(message.guild, {
                    action: "Unban",
                    user,
                    moderator: message.author,
                    reason: "Manual unban"
                });

                await message.channel.send(
                    `🔓 ${user.tag} has been unbanned.`
                );

            } catch {
                await message.reply(
                    "❌ User is not banned or the ID is invalid."
                );
            }

            return;
        }


        // ================= WHITELIST ROLE =================

        if (command === "whitelistrole") {

            if (
                !message.member.permissions.has(
                    PermissionsBitField.Flags.Administrator
                )
            ) {
                return message.reply(
                    "❌ Only Administrators can manage whitelist roles."
                );
            }

            const action =
                args.shift()?.toLowerCase();


            if (action === "add") {

                const role =
                    message.mentions.roles.first();

                if (!role) {
                    return message.reply(
                        `Usage: \`${PREFIX}whitelistrole add @Role\``
                    );
                }

                const roles =
                    getWhitelistRoles(
                        message.guild.id
                    );

                if (roles.includes(role.id)) {
                    return message.reply(
                        "⚠️ This role is already whitelisted."
                    );
                }

                roles.push(role.id);

                saveDB();

                await message.channel.send(
                    `✅ ${role} has been added to the whitelist.`
                );

                return;
            }


            if (action === "remove") {

                const role =
                    message.mentions.roles.first();

                if (!role) {
                    return message.reply(
                        `Usage: \`${PREFIX}whitelistrole remove @Role\``
                    );
                }

                const roles =
                    getWhitelistRoles(
                        message.guild.id
                    );

                const index =
                    roles.indexOf(role.id);

                if (index === -1) {
                    return message.reply(
                        "⚠️ This role is not whitelisted."
                    );
                }

                roles.splice(index, 1);

                saveDB();

                await message.channel.send(
                    `✅ ${role} has been removed from the whitelist.`
                );

                return;
            }


            if (action === "list") {

                const roles =
                    getWhitelistRoles(
                        message.guild.id
                    );

                if (roles.length === 0) {
                    return message.reply(
                        "📋 No whitelist roles configured."
                    );
                }

                const list =
                    roles.map(id => {

                        const role =
                            message.guild.roles.cache.get(id);

                        return role
                            ? `${role} \`${id}\``
                            : `Unknown Role \`${id}\``;

                    }).join("\n");

                await message.channel.send(
                    `📋 **Whitelist Roles**\n\n${list}`
                );

                return;
            }

            return message.reply(
                [
                    `\`${PREFIX}whitelistrole add @Role\``,
                    `\`${PREFIX}whitelistrole remove @Role\``,
                    `\`${PREFIX}whitelistrole list\``
                ].join("\n")
            );
        }

    } catch (error) {
        console.error("Message handler error:", error);
    }
});

client.login(TOKEN);
