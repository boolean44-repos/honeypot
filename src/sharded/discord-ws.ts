import { WebSocketManager, WebSocketShardEvents, CompressionMethod, type SessionInfo } from '@discordjs/ws';
import { REST } from '@discordjs/rest';
import { GatewayDispatchEvents, GatewayIntentBits, Routes, type GatewayDispatchPayload, type RESTGetAPIGatewayBotResult } from 'discord-api-types/v10';
import initialPresence from '../utils/initial-presence';

if (!process.env.DISCORD_TOKEN) throw new Error("DISCORD_TOKEN environment variable not set.");
if (!process.env.REDIS_URL) throw new Error("REDIS_URL environment variable not set.");
const token = process.env.DISCORD_TOKEN;


process.title = "Honeypot Bot (riskymh.dev) - Websocket Shard Worker";

process.on('uncaughtException', (err) => {
    console.error(`Unhandled Exception: ${err}`);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
});

const getRedis = () => new Bun.RedisClient(process.env.REDIS_URL!)
const redis = getRedis();
const redisBlocking = getRedis(); // separate connection for blocking so it doesnt interfere with the main one
const rest = new REST().setToken(token!);

const getShards = async () => (await rest.get(Routes.gatewayBot()) as RESTGetAPIGatewayBotResult).shards;
const getManager = (shards: number, sessionCache: Map<number, SessionInfo> = new Map()) => new WebSocketManager({
    token: token,
    intents: GatewayIntentBits.Guilds | GatewayIntentBits.GuildMessages,
    rest,
    compression: process.env.COMPRESS_WEBSOCKETS === "true" ? CompressionMethod.ZlibNative : null,
    shardCount: shards,
    initialPresence,
    retrieveSessionInfo: (shardId) => sessionCache.get(shardId) ?? null,
    updateSessionInfo: (shardId, sessionInfo) => sessionInfo
        ? void sessionCache.set(shardId, sessionInfo)
        : void sessionCache.delete(shardId),
});
const managerState = "a" // update this when initial presense or intents changes (ie require shards to reconnect)

const sessionInfoCache: Record<number, Map<number, SessionInfo>> = {};
async function getSessionStorageFromRedis(shardCount: number) {
    const _raw = await redis.hmget("discord_ws_sessions", `${managerState}_${shardCount}`, shardCount.toString());
    const raw = _raw[0] || _raw[1];
    if (raw) {
        const data = JSON.parse(raw) as Record<string, SessionInfo>;
        return new Map(Object.entries(data).map(([k, v]) => [parseInt(k), v]));
    }
    return null;
}
async function saveSessionStorageToRedis(shardCount: number, sessionStorage: Map<number, SessionInfo>) {
    const obj = Object.fromEntries(sessionStorage);
    const threeMinSecs = 3 * 60;
    await redis.hsetex("discord_ws_sessions", "EX", threeMinSecs, "FIELDS", 1, `${managerState}_${shardCount}`, JSON.stringify(obj));
}

let shardCount = await getShards();
sessionInfoCache[shardCount] = await getSessionStorageFromRedis(shardCount) ?? new Map();
let manager = getManager(shardCount, sessionInfoCache[shardCount]);
let isResharding = null as null | [WebSocketManager, number /* shard count */];
let reshardedId = 0;

const onExit = async (type: string) => {
    console.log(`Received ${type}, shutting down...`);
    const possibleSessionCache = sessionInfoCache[shardCount];
    if (possibleSessionCache) await saveSessionStorageToRedis(shardCount, possibleSessionCache).catch((err) => {
        console.error(`Error saving session storage to Redis on shutdown: ${err}`);
    });
    process.exit(0);
}
process.on('SIGTERM', onExit.bind(null, "SIGTERM"));
process.on('SIGINT', onExit.bind(null, "SIGINT"));

const dispatchEvent = (id: number, event: GatewayDispatchPayload, shardId: number) => {
    if (event.t === GatewayDispatchEvents.Ready) {
        console.info(`[Shard ${shardId}] ${event.d.user.username}#${event.d.user.discriminator} is ready!`);
    }

    // only send events from one ws manager - checking manually is safer than assuming listener is 100% destroyed
    if (reshardedId !== id) return;

    if (shouldBroadcastEvent(event)) {
        // interactions are more important that we respond on time
        if (event.t === GatewayDispatchEvents.InteractionCreate) {
            redis.lpush("discord_events", JSON.stringify(event));
        } else {
            redis.rpush("discord_events", JSON.stringify(event));
        }
    }
}

manager.addListener(WebSocketShardEvents.Dispatch, dispatchEvent.bind(null, reshardedId));

let wsConfig = {} as { events?: Set<string>, messageEvents?: { sendBotEvents?: boolean } };
(async () => {
    const raw = await redis.get("discord_ws_config")
    if (raw) {
        const _wsConfig = JSON.parse(raw)
        wsConfig = {
            events: new Set(_wsConfig.events),
            messageEvents: _wsConfig.messageEvents
        };
    }

    while (1) {
        const raw = await redisBlocking.blpop("discord_ws_config_", 0)
        if (raw) {
            const _wsConfig = JSON.parse(raw[1])
            wsConfig = {
                events: new Set(_wsConfig.events),
                messageEvents: _wsConfig.messageEvents
            };
        }
    }
})();


function shouldBroadcastEvent(event: GatewayDispatchPayload): boolean {
    if (!wsConfig.events) return true;
    else if (!wsConfig.events.has(event.t)) return false;
    // TODO: the better solution to this is to have a redis list of "subscribed" channels instead of arbitrarily removing high trafic events
    else if (wsConfig.messageEvents?.sendBotEvents === false) {
        // deletes dont contain any info other than ids, so we can allow them to go through even for bot messages without worrying about extra bot events getting through
        // at least bot msg deletes aren't as common and also we need it to know if someone removed out honeypot warning msg anyway
        if (event.t === GatewayDispatchEvents.MessageCreate || event.t === GatewayDispatchEvents.MessageUpdate) {
            // bot messages are somewhat often from logging so we limit it, but if it was slash command type we want as we associate the msg with the user who ran
            if (event.d?.author?.bot && !event.d?.interaction_metadata) return false;
        }
        // else if ((event.t === GatewayDispatchEvents.TypingStart) && event.d?.member?.user?.bot) return false;
    }
    return true;
}

// every day recheck if shard count has increased, if so make them run both at same time for a bit to hopefully avoid downtime, then kill old one
const checkForResharding = async () => {
    try {
        const newShardCount = (await getShards());
        if (newShardCount > shardCount) {
            console.info(`\nShard count increased from ${shardCount} to ${newShardCount}, resharding...`);

            if (isResharding) {
                if (isResharding[1] === newShardCount) {
                    console.warn(`Already resharding to ${isResharding[1]} shards, will wait for that to complete instead...`);
                    return;
                } else {
                    console.warn(`Already resharding to ${isResharding[1]} shards, but now need to reshard to ${newShardCount} shards. Restarting the resharding process with the new shard count...`);
                    isResharding[0].destroy();
                }
            }

            let shardsConnected = new Set<number>();
            const newManager = getManager(newShardCount, (sessionInfoCache[newShardCount] ??= new Map()));
            isResharding = [newManager, newShardCount];
            function dispatchEvent2(event: GatewayDispatchPayload, shardId: number) {
                if (event.t === GatewayDispatchEvents.Ready) {
                    console.info(`[Shard ${shardId}] ${event.d.user.username}#${event.d.user.discriminator} is ready! (resharded)`);
                    shardsConnected.add(shardId);
                }
            }
            newManager.addListener(WebSocketShardEvents.Dispatch, dispatchEvent2);
            await newManager.connect();

            // wait for all new shards to be ready, then kill old manager
            const checkInterval = setInterval(() => {
                if (shardsConnected.size === newShardCount) {
                    clearInterval(checkInterval);

                    console.info(`All ${newShardCount} shards connected, transfering over managers...`);
                    const newReshardedId = reshardedId + 1;
                    newManager.addListener(WebSocketShardEvents.Dispatch, dispatchEvent.bind(null, newReshardedId));
                    newManager.removeListener(WebSocketShardEvents.Dispatch, dispatchEvent2);
                    reshardedId = newReshardedId;
                    manager.removeAllListeners(WebSocketShardEvents.Dispatch);
                    manager.destroy();
                    manager = newManager;
                    delete sessionInfoCache[shardCount]
                    shardCount = newShardCount;
                    isResharding = null;
                }
            }, 1000);
        }
    } catch (err) {
        console.error(`Error checking shard count: ${err}`);
    }
};

console.log(`Starting WebSocket Manager with ${shardCount} shards...`);
if (sessionInfoCache[shardCount]?.size) {
    console.log("Found existing session info in Redis, attempting to resume sessions...");
}
await manager.connect();


setInterval(checkForResharding, 12 * 60 * 60 * 1000); // twice every day


