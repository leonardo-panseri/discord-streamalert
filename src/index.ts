import { createLogger, format, transports } from 'winston';
import { load } from './config.js';
import { cleanupTrackedMessages } from './stream_manager.js';
import { TwitchApi } from './twitch/twitch_api.js';
import { Webhooks } from './twitch/webhooks.js';
import { Client, Intents } from 'discord.js';
import { getPathRelativeToProjectRoot } from './helper.js';
import { existsSync } from 'fs';

const logger = createLogger({
    level: process.env.DEBUG ? 'debug' : 'info',
    format: format.printf(options => {
        if (options.moduleName) {
            return `[${options.moduleName}] ${options.level}: ${options.message}$`;
        } else {
            return `[Main] ${options.level}: ${options.message}$`;
        }
    }),
    transports: [
        new transports.Console(),
    ],
});

export function getLogger(moduleName = undefined) {
    if (moduleName) {
        return logger.child({ moduleName: moduleName });
    } else {
        return logger;
    }
}

export const cfg = load();
if (cfg === null) process.exit();

export const dataFilePath = getPathRelativeToProjectRoot(cfg['database_file']);

if (!existsSync(dataFilePath)) {
    logger.error('Database file not found, check your configuration');
    process.exit(1);
}

export const client = new Client({ intents: [Intents.FLAGS.GUILDS] });

client.once('ready', async () => {
    logger.info(`StreamAlert loaded in ${client.guilds.cache.size} guilds`);

    await cleanupTrackedMessages();

    const twitchAPI = new TwitchApi(cfg['twitch_id_client'], cfg['twitch_secret'],
        cfg['webhooks_host'], cfg['webhooks_secret']);
    client['twitchAPI'] = twitchAPI;

    const webhooks = new Webhooks(cfg['webhooks_port'], cfg['webhooks_secret'], () => {
        logger.info(`Started Webhooks webserver at '${cfg['webhooks_host']}'`);
        cfg['streams'].forEach(sect => {
            const username = sect['broadcaster_username'];
            twitchAPI.subscribeToStreamUpdates(username)
                .then(() => logger.info('Finished subscribing process'));
        });
    });
    webhooks.startWebserver();
});

client.login(cfg['token'])
    .then(() => logger.debug('Bot has logged in'));