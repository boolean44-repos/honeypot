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
