import type { API } from "@discordjs/core";
import type { API as API2 } from "@discordjs/core/http-only";

const yearSeconds = 365 * 24 * 60 * 60;

interface GuildInfo { name: string, ownerId: string, vanityInviteCode?: string | null }
const guildCache = new Map<string, GuildInfo>();

export const getGuildInfo = async (api: API | API2, guildId: string, signal?: AbortSignal, redis?: Bun.RedisClient): Promise<GuildInfo> => {
  if (redis) {
    const cached = await redis.hget("guild_info", guildId);
    if (cached) return JSON.parse(cached);
    const guild = await api.guilds.get(guildId, undefined, { signal });
    const info: GuildInfo = { name: guild.name, ownerId: guild.owner_id, vanityInviteCode: guild.vanity_url_code || undefined };
    await redis.hsetex("guild_info", "EX", yearSeconds, "FIELDS", 1, guildId, JSON.stringify(info));
    return info;
  } else {
    if (guildCache.has(guildId)) return guildCache.get(guildId)!;
    const guild = await api.guilds.get(guildId, undefined, { signal });
    const info: GuildInfo = { name: guild.name, ownerId: guild.owner_id, vanityInviteCode: guild.vanity_url_code || undefined };
    guildCache.set(guildId, info);
    return info;
  }
};
export const setGuildInfoCache = (guildId: string, info: GuildInfo, redis?: Bun.RedisClient) => {
  if (redis) {
    const cacheStr = JSON.stringify({ name: info.name, ownerId: info.ownerId, vanityInviteCode: info.vanityInviteCode || undefined })
    redis.hsetex("guild_info", "EX", yearSeconds, "FIELDS", 1, guildId, cacheStr);
  } else {
    guildCache.set(guildId, info);
  }
  return info;
}
export const invalidateGuildInfoCache = (guildId: string, redis?: Bun.RedisClient) => {
  if (redis) {
    redis.hdel("guild_info", guildId);
  } else {
    guildCache.delete(guildId);
  }
}

const weekSeconds = 7 * 24 * 60 * 60;

export const setDmChannelCache = (userId: string, channelId: string, redis: Bun.RedisClient) => {
  redis.hsetex("user_dm_channel", "EX", weekSeconds, "FIELDS", 1, userId, channelId);
}
export const getDmChannelCache = (userId: string, redis: Bun.RedisClient) => {
  return redis.hget("user_dm_channel", userId);
}

const daySeconds = 24 * 60 * 60;

export const setHoneypotChannelCache = (guildId: string, channelId: string, redis: Bun.RedisClient) => {
  redis.hsetex("honeypot_channel", "EX", daySeconds, "FIELDS", 1, guildId, channelId);
}
/** Returns `true`/`false` if cache hit and is/isnt honeypot channel, `null` if not cached  */
export const couldBeHoneypotChannel = async (guildId: string, channelId: string, redis: Bun.RedisClient) => {
  const cached = await redis.hget("honeypot_channel", guildId);
  if (cached === channelId) return true;
  if (cached && cached !== channelId) return false;
  return null;
}
export const removeGuildHoneypotChannelCache = (guildId: string, redis: Bun.RedisClient) => {
  redis.hdel("honeypot_channel", guildId);
}


// to delete messages (from sending nice into msg in honeypot channel) to ensure its cleaned up even cross-restarts
export const addToDeleteMessageCache = (channelId: string, messageId: string, redis: Bun.RedisClient) => {
  return redis.sadd("delete_message", `${channelId}:${messageId}`);
}
export const getDeleteMessageCache = async (redis: Bun.RedisClient) => {
  const entries = await redis.smembers("delete_message");
  return entries.map(e => {
    const [channelId, messageId] = e.split(":");
    return { channelId, messageId };
  });
}
export const removeFromDeleteMessageCache = (channelId: string, messageId: string, redis: Bun.RedisClient) => {
  return redis.srem("delete_message", `${channelId}:${messageId}`);
}

// set command cache
let commandIdMapCache = null as null | Record<string, string>;
export const setCommandIdCache = (commandIdMap: Record<string, string>, redis?: Bun.RedisClient | null) => {
  if (redis) {
    redis.set("command_id_map", JSON.stringify(commandIdMap));
  } else {
    commandIdMapCache = commandIdMap;
  }
}
export const getCommandIdCache = async (redis?: Bun.RedisClient | null) => {
  if (!redis) return commandIdMapCache;
  const raw = await redis.get("command_id_map");
  if (!raw) return null;
  return JSON.parse(raw) as Record<string, string>;
}
export const invalidateCommandIdCache = (redis: Bun.RedisClient | null) => {
  redis?.del("command_id_map");
  commandIdMapCache = null;
}
