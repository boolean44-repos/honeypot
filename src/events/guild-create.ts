import { ButtonStyle, ChannelType, GatewayDispatchEvents, MessageFlags, ComponentType, type GatewayGuildCreateDispatchData } from "discord-api-types/v10";
import type { EventHandler } from "./events";
import type { API } from "@discordjs/core";
import type { API as API2 } from "@discordjs/core/http-only";
import { honeypotWarningMessage } from "../utils/messages";
import { addToDeleteMessageCache, getCommandIdCache, removeFromDeleteMessageCache, setGuildInfoCache, setHoneypotChannelCache } from "../utils/cache";

const handler: EventHandler<GatewayDispatchEvents.GuildCreate> = {
    event: GatewayDispatchEvents.GuildCreate,
    handler: async ({ data: guild, api, applicationId, redis, db }) => {
        try {
            setGuildInfoCache(guild.id, { name: guild.name, ownerId: guild.owner_id, vanityInviteCode: guild.vanity_url_code }, redis);

            let config = await db.getConfig(guild.id);
            if (config?.action === "disabled" || config) return;

            let channelId = null as null | string;
            let msgId = null as null | string;
            let setupSuccess = false;
            try {
                const { id: channId, new: isNewChannel } = await findOrCreateHoneypotChannel(api, guild);
                channelId = channId;
                msgId = await postWarning(api, channelId, applicationId!, (config as any | undefined)?.action || "softban", await db.getModeratedCount(guild.id));
                setupSuccess = true;
                if (isNewChannel) sendIntoMessage(api, redis, channelId).catch((err) => {
                    console.log(`Failed to send intro message: ${err}`);
                });
            } catch (err) {
                console.log(`Failed to create/send honeypot message: ${err}`);
            }
            await db.setConfig({
                guild_id: guild.id,
                honeypot_channel_id: channelId,
                honeypot_msg_id: msgId,
                log_channel_id: null,
                action: 'softban',
                experiments: [],
            });
            if (redis) channelId && setHoneypotChannelCache(guild.id, channelId, redis);
            if (!setupSuccess && !config && guild.system_channel_id) {
                try {
                    await api.channels.createMessage(guild.system_channel_id, {
                        content: `👋 Thanks for adding the honeypot bot! Please run /honeypot to finish setup.\n-# The bot couldn’t create or send the warning message automatically.`,
                        allowed_mentions: {}
                    });
                } catch (err) {
                    console.log(`Failed to send welcome/setup message: ${err}`);
                }
            }
        } catch (err) {
            console.log(`Error with GuildCreate handler: ${err}`);
        }
    }
};

async function findOrCreateHoneypotChannel(api: API | API2, guild: GatewayGuildCreateDispatchData): Promise<{ id: string, new?: true | undefined }> {
    const channel = guild.channels.find((c) => c.name === "honeypot" && c.type === ChannelType.GuildText);
    if (channel) return { id: channel.id };

    const newChannel = await api.guilds.createChannel(guild.id, {
        name: "honeypot",
        type: ChannelType.GuildText,
        position: guild.channels.length + 1,
    }, {
        reason: "Honeypot channel for bot",
    });
    return { id: newChannel.id, new: true };
}


async function postWarning(api: API | API2, channelId: string, applicationId: string, action = "softban" as const, moderatedCount = 0) {
    const messages = await api.channels.getMessages(channelId, { limit: 100 }).catch(() => []);
    const botMessages = messages.filter(m => m.author?.id === applicationId);

    if (botMessages.length > 0) {
        const [first, ...rest] = botMessages;
        if (!first) {
            const msg = await api.channels.createMessage(channelId, honeypotWarningMessage(moderatedCount, action));
            return msg.id;
        }
        try {
            await api.channels.editMessage(channelId, first.id, honeypotWarningMessage(moderatedCount, action));
            await Promise.allSettled(rest.map(msg => api.channels.deleteMessage(channelId, msg.id, { reason: "Removing duplicate honeypot messages" })));
            return first.id;
        } catch (err) {
            const msg = await api.channels.createMessage(channelId, honeypotWarningMessage(moderatedCount, action));
            await Promise.allSettled(botMessages.map(msg => api.channels.deleteMessage(channelId, msg.id, { reason: "Removing duplicate honeypot messages" })));
            return msg.id;
        }
    } else {
        const msg = await api.channels.createMessage(channelId, honeypotWarningMessage(moderatedCount, action));
        return msg.id;
    }
}

async function sendIntoMessage(api: API | API2, redis: Bun.RedisClient | undefined, channelId: string) {
    const commands = redis ? await getCommandIdCache(redis) : null;
    function getCommandMention(commandName: string) {
        const commandId = commands?.[commandName];
        if (!commandId) return `\`/${commandName}\``;
        return `</${commandName}:${commandId}>`;
    }

    const removalTime = 2.5 * 60 * 1000;
    const inDiscordTimeString = `<t:${Math.floor((Date.now() + removalTime) / 1000)}:R>`;
    const { id: msgId } = await api.channels.createMessage(channelId, {
        flags: MessageFlags.SuppressNotifications | MessageFlags.IsComponentsV2,
        components: [
            {
                type: ComponentType.TextDisplay,
                content: `
## 👋 Welcome to the honeypot channel! 
- By default, any user that sends a message in this channel will be **automatically softbanned** (banned and instantly unbanned to delete last 1hr messages)
- You can customise this and more with the ${getCommandMention("honeypot")} command and the custom messages it sends with ${getCommandMention("honeypot-messages")}!
- **Tips for maximum effectiveness:**
  - Rename this channel to something unique (e.g., \`dont-type-here\`) so bots can’t easily guess and blacklist it, but keep it clear for real members
  - Keep it near the top of your channel list - bots often target the first few channels
  - Make sure the bot’s highest role is set above any self-assignable roles, so it can act on all users
- If you have feedback or notice bots bypassing the honeypot, join our [support server](https://discord.gg/BanFeVWyFP) or checkout out the open source [github repo](https://github.com/riskymh/honeypot)!
`.trim()
            },
            {
                type: ComponentType.Section,
                components: [
                    {
                        type: ComponentType.TextDisplay,
                        content: `-# This message will delete ${inDiscordTimeString}`
                    }
                ],
                accessory: {
                    type: ComponentType.Button,
                    style: ButtonStyle.Secondary,
                    label: "Delete message now",
                    custom_id: "delete_into_message",
                }
            },
        ]
    });
    if (redis) await addToDeleteMessageCache(channelId, msgId, redis);
    setTimeout(async () => {
        await api.channels.deleteMessage(channelId, msgId, { reason: "Cleaning up welcome message" }).catch(() => { });
        if (redis) await removeFromDeleteMessageCache(channelId, msgId, redis);
    }, removalTime);
}


export default handler;