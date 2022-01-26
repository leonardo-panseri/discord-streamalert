import { createLogger, format, transports } from 'winston';
import { load } from './config.js';
import { cleanupTrackedMessages } from './stream_manager.js';
import { TwitchApi } from './twitch/twitch_api.js';
import { startWebserver } from './twitch/webhooks.js';
import { Client, Intents } from 'discord.js';
import { getPathRelativeToProjectRoot } from './helper.js';
import { existsSync } from 'fs';

export const logger = createLogger({
    level: 'info',
    format: format.simple(),
    transports: [
        new transports.Console(),
    ],
});

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

    startWebserver(cfg['webhooks_port'], cfg['webhooks_secret'], () => {
        logger.info(`Started Webhooks webserver at '${cfg['webhooks_host']}'`);
        cfg['streams'].forEach(sect => {
            const username = sect['broadcaster_username'];
            twitchAPI.subscribeToStreamUpdates(username)
                .then(() => logger.info('Finished subscribing process'));
        });
    });
});

client.login(cfg['token'])
    .then(() => logger.debug('Bot has logged in'));