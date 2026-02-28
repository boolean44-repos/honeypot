import { GatewayDispatchEvents } from "discord-api-types/v10";
import type { EventHandler } from "./events";
import { setGuildInfoCache } from "../utils/cache";

const handler: EventHandler<GatewayDispatchEvents.GuildUpdate> = {
    event: GatewayDispatchEvents.GuildUpdate,
    handler: async ({ data: guild, api, applicationId, redis, db }) => {
        setGuildInfoCache(guild.id, { name: guild.name, ownerId: guild.owner_id, vanityInviteCode: guild.vanity_url_code }, redis);
    }
};

export default handler;
