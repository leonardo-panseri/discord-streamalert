import logger from './log.js';
import { Config } from './config.js';
import { StreamManager } from './stream_manager.js';
import { TwitchApi } from './twitch/twitch_api.js';
import { Webhooks } from './twitch/webhooks.js';
import { Client, Intents } from 'discord.js';
import { getPathRelativeToProjectRoot } from './helper.js';
import { existsSync } from 'fs';

export function getLogger(moduleName?: string) {
    if (moduleName) {
        return logger.child({ moduleName: moduleName });
    } else {
        return logger;
    }
}

export const cfg = new Config();
if (cfg === undefined) process.exit(1);

export const dataFilePath = getPathRelativeToProjectRoot(cfg.getString('database_file'));
if (!existsSync(dataFilePath)) {
    logger.error('Database file not found, check your configuration');
    process.exit(1);
}

const client = new Client({ intents: [Intents.FLAGS.GUILDS] });

client.once('ready', async () => {
    logger.info(`StreamAlert loaded in ${client.guilds.cache.size} guild`);
    if (client.guilds.cache.size > 1) logger.warn('This bot is meant to be used on a single server only');

    const twitchApi = new TwitchApi(
        cfg.getString('twitch_id_client'), cfg.getString('twitch_secret'),
        cfg.getString('webhooks_host'), cfg.getString('webhooks_secret'));

    const streamManager = new StreamManager(client, twitchApi);

    const webhooks = new Webhooks(streamManager, cfg.getNumber('webhooks_port'), cfg.getString('webhooks_secret'), () => {
        logger.info(`Started Webhooks webserver at '${cfg.getString('webhooks_host')}'`);
        for (const login in cfg.getSection('streams')) {
            twitchApi.subscribeToStreamUpdates(login)
                .then(() => logger.info('Finished subscribing process'));
        }
    });
    webhooks.startWebserver();
});

client.login(cfg.getString('token'))
    .then(() => logger.debug('Bot has logged in'));