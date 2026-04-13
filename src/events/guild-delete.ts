import { GatewayDispatchEvents } from "discord-api-types/v10";
import type { EventHandler } from "./events";
import { invalidateGuildInfoCache, removeGuildHoneypotChannelCache } from "../utils/cache";

const handler: EventHandler<GatewayDispatchEvents.GuildDelete> = {
    event: GatewayDispatchEvents.GuildDelete,
    handler: async ({ data: guild, api, applicationId, redis, db }) => {
        try {
            // The bot didnt actually leave the guild, discord itself merely is having some issues there
            if (guild.unavailable === true) return;
            await db.deleteConfig(guild.id);
            invalidateGuildInfoCache(guild.id, redis);
            if (redis) removeGuildHoneypotChannelCache(guild.id, redis);
        } catch (err) {
            console.error(`Failed to delete honeypot config for guild ${guild.id}:`, err);
        }
    }
};

export default handler;
