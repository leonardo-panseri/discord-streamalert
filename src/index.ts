import logger from './log.js';
import { load } from './config.js';
import { StreamManager } from './stream_manager.js';
import { TwitchApi } from './twitch/twitch_api.js';
import { Webhooks } from './twitch/webhooks.js';
import { Client, Intents } from 'discord.js';
import { getPathRelativeToProjectRoot } from './helper.js';
import { existsSync } from 'fs';

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

const client = new Client({ intents: [Intents.FLAGS.GUILDS] });

client.once('ready', async () => {
    logger.info(`StreamAlert loaded in ${client.guilds.cache.size} guild`);
    if (client.guilds.cache.size > 1) logger.warn('This bot is meant to be used on a single server only');

    const twitchApi = new TwitchApi(cfg['twitch_id_client'], cfg['twitch_secret'],
        cfg['webhooks_host'], cfg['webhooks_secret']);

    const streamManager = new StreamManager(client, twitchApi);

    const webhooks = new Webhooks(streamManager, cfg['webhooks_port'], cfg['webhooks_secret'], () => {
        logger.info(`Started Webhooks webserver at '${cfg['webhooks_host']}'`);
        cfg['streams'].forEach(sect => {
            const username = sect['broadcaster_username'];
            twitchApi.subscribeToStreamUpdates(username)
                .then(() => logger.info('Finished subscribing process'));
        });
    });
    webhooks.startWebserver();
});

client.login(cfg['token'])
    .then(() => logger.debug('Bot has logged in'));