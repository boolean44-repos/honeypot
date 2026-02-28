import type { API } from "@discordjs/core";
import type { API as API2 } from "@discordjs/core/http-only";

export const enum CronFrequency {
    Hourly,
    Daily,
}

export interface Cron {
    name: string;
    frequency: CronFrequency;
    run: (api: API | API2, db: typeof import("../utils/db")) => Promise<void>;
}


import experimentCron from "./experiments";

export const runCrons = (api: API | API2, db: typeof import("../utils/db")) => {
    const crons = [
        experimentCron,
    ];

    for (const cron of crons) {
        if (cron.frequency === CronFrequency.Daily) {
            const now = new Date();
            const millisUntilMidnight = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1).getTime() - now.getTime();
            setTimeout(() => {
                cron.run(api, db).catch(err => {
                    console.log(`Error running cron ${cron.name}: ${err}`);
                });
                setInterval(() => {
                    cron.run(api, db).catch(err => {
                        console.log(`Error running cron ${cron.name}: ${err}`);
                    });
                }, 24 * 60 * 60 * 1000); // every 24 hours
            }, millisUntilMidnight);
        } else if (cron.frequency === CronFrequency.Hourly) {
            setInterval(() => {
                cron.run(api, db).catch(err => {
                    console.log(`Error running cron ${cron.name}: ${err}`);
                });
            }, 60 * 60 * 1000); // every hour
        }
    }
}
