import type { API } from "@discordjs/core";
import type { API as API2 } from "@discordjs/core/http-only";

export interface Cron {
    name: string;
    frequency: "daily" | "hourly" | "once";
    run: (api: API | API2, db: typeof import("../utils/db"), redis?: Bun.RedisClient) => Promise<void>;
}


import experimentCron from "./experiments";
import oneOffCron from "./one-off";

export const runCrons = (api: API | API2, db: typeof import("../utils/db"), redis?: Bun.RedisClient) => {
    const crons = [
        experimentCron,
        oneOffCron,
    ];

    for (const cron of crons) {
        if (cron.frequency === "daily") {
            const now = new Date();
            const millisUntilMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime();
            setTimeout(() => {
                cron.run(api, db, redis).catch(err => {
                    console.log(`Error running cron ${cron.name}: ${err}`);
                });
                setInterval(() => {
                    cron.run(api, db, redis).catch(err => {
                        console.log(`Error running cron ${cron.name}: ${err}`);
                    });
                }, 24 * 60 * 60 * 1000); // every 24 hours
            }, millisUntilMidnight);
        } else if (cron.frequency === "hourly") {
            setInterval(() => {
                cron.run(api, db, redis).catch(err => {
                    console.log(`Error running cron ${cron.name}: ${err}`);
                });
            }, 60 * 60 * 1000); // every hour
        } else if (cron.frequency === "once") {
            cron.run(api, db, redis).catch(err => {
                console.log(`Error running cron ${cron.name}: ${err}`);
            });
        }
    }
}
