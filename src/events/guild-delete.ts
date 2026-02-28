import { GatewayDispatchEvents } from "discord-api-types/v10";
import type { EventHandler } from "./events";
import { invalidateGuildInfoCache, removeGuildHoneypotChannel } from "../utils/cache";

const handler: EventHandler<GatewayDispatchEvents.GuildDelete> = {
    event: GatewayDispatchEvents.GuildDelete,
    handler: async ({ data: guild, api, applicationId, redis, db }) => {
        try {
            if (guild.unavailable === true) return;
            await db.deleteConfig(guild.id);
            invalidateGuildInfoCache(guild.id, redis);
            if (redis) removeGuildHoneypotChannel(guild.id, redis);
        } catch (err) {
            console.error(`Failed to delete honeypot config for guild ${guild.id}:`, err);
        }
    }
};

export default handler;
