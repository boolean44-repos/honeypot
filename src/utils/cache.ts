import type { API } from "@discordjs/core";
import type { API as API2 } from "@discordjs/core/http-only";

const yearSeconds = 365 * 24 * 60 * 60;

const guildCache = new Map<string, { name: string, ownerId: string, vanityInviteCode: string | null }>();

export const getGuildInfo = async (api: API | API2, guildId: string, signal?: AbortSignal, redis?: Bun.RedisClient) => {
  if (redis) {
    const cached = await redis.get(`guild_info:${guildId}`);
    if (cached) return JSON.parse(cached);
    const guild = await api.guilds.get(guildId, undefined, { signal });
    const info = { name: guild.name, ownerId: guild.owner_id, vanityInviteCode: guild.vanity_url_code || null };
    await redis.set(`guild_info:${guildId}`, JSON.stringify(info), "EX", yearSeconds);
    return info;
  } else {
    if (guildCache.has(guildId)) return guildCache.get(guildId)!;
    const guild = await api.guilds.get(guildId, undefined, { signal });
    const info = { name: guild.name, ownerId: guild.owner_id, vanityInviteCode: guild.vanity_url_code || null };
    guildCache.set(guildId, info);
    return info;
  }
};
export const setGuildInfoCache = (guildId: string, info: { name: string, ownerId: string, vanityInviteCode: string | null }, redis?: Bun.RedisClient) => {
  if (redis) {
    redis.set(`guild_info:${guildId}`, JSON.stringify(info), "EX", yearSeconds);
  } else {
    guildCache.set(guildId, info);
  }
  return info;
}
export const invalidateGuildInfoCache = (guildId: string, redis?: Bun.RedisClient) => {
  if (redis) {
    redis.del(`guild_info:${guildId}`);
  } else {
    guildCache.delete(guildId);
  }
}

const daySeconds = 24 * 60 * 60;

const faildToDmUsers = [] as string[];
export const addFailedToDmUser = (userId: string, redis?: Bun.RedisClient) => {
  if (redis) {
    redis.set(`failed_to_dm:${userId}`, '1', "EX", daySeconds);
  } else {
    if (!faildToDmUsers.includes(userId)) {
      faildToDmUsers.unshift(userId);
      if (faildToDmUsers.length > 100) {
        faildToDmUsers.pop();
      }
    }
  }
}
export const hasFailedToDmUser = async (userId: string, redis?: Bun.RedisClient) => {
  if (redis) {
    const val = await redis.get(`failed_to_dm:${userId}`);
    return val === '1';
  } else {
    return faildToDmUsers.includes(userId);
  }
}

export const setHoneypotChannel = (guildId: string, channelId: string, redis: Bun.RedisClient) => {
  redis.set(`honeypot_channel:${guildId}`, channelId, "EX", daySeconds);
}
/** Returns `true`/`false` if cache hit and is/isnt honeypot channel, `null` if not cached  */
export const couldBeHoneypotChannel = async (guildId: string, channelId: string, redis: Bun.RedisClient) => {
  const cached = await redis.get(`honeypot_channel:${guildId}`);
  if (cached === channelId) return true;
  if (cached && cached !== channelId) return false;
  return null;

}
export const removeGuildHoneypotChannel = (guildId: string, redis: Bun.RedisClient) => {
  redis.del(`honeypot_channel:${guildId}`);
}
