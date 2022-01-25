import { createLogger, format, transports } from 'winston';
import { load } from './config.js';
import { cleanupTrackedMessages } from './stream_manager.js';
import { TwitchAPI } from './twitch/twitch_api.js';
import { startWebserver } from './twitch/webhooks.js';
import { Client, Intents } from 'discord.js';

export const logger = createLogger({
    level: 'info',
    format: format.simple(),
    transports: [
        new transports.Console(),
    ],
});

export const cfg = load();
if (cfg === null) process.exit();

export const client = new Client({ intents: [Intents.FLAGS.GUILDS] });

client.once('ready', async () => {
    logger.info(`StreamAlert loaded in ${client.guilds.cache.size} guilds`);

    await cleanupTrackedMessages();

    const twitchAPI = new TwitchAPI(cfg['twitch_id_client'], cfg['twitch_secret'],
        cfg['webhooks_host'], cfg['webhooks_secret']);

    client['twitchAPI'] = twitchAPI;

    startWebserver(cfg['webhooks_port'], cfg['webhooks_secret'], () => {
        logger.info(`Started Webhooks webserver at '${cfg['webhooks_host']}'`);
        cfg['streams'].forEach(sect => {
            twitchAPI.subscribeToStreamUpdates(sect['broadcaster_username'])
                .then(() => logger.info('Finished subscribing process'));
        });
    });
});

client.login(cfg['token'])
    .then(() => logger.debug('Bot has logged in'));