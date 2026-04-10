import type { API } from "@discordjs/core";
import type { API as API2 } from "@discordjs/core/http-only";

export interface Cron {
    name: string;
    frequency: Bun.CronWithAutocomplete | "once" & {};
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
        if (cron.frequency === "once") {
            cron.run(api, db, redis).catch(err => {
                console.log(`Error running cron ${cron.name}: ${err}`);
            });
        } else {
            Bun.cron(cron.frequency, () => {
                cron.run(api, db, redis).catch(err => {
                    console.log(`Error running cron ${cron.name}: ${err}`);
                });
            });
        }
    }
}
