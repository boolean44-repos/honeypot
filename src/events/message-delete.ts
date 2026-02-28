import { GatewayDispatchEvents } from "discord-api-types/v10";
import type { EventHandler } from "./events";

const handler: EventHandler<GatewayDispatchEvents.MessageDelete> = {
    event: GatewayDispatchEvents.MessageDelete,
    handler: async ({ data: message, api, applicationId, redis, db }) => {
        if (!message.guild_id) return;
        try {
            await db.unsetHoneypotMsg(message.guild_id, message.id);
        } catch (err) {
            console.error(`Error with MessageDelete handler: ${err}`);
        }
    }
};

export default handler;
