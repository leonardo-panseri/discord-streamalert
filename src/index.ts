import { createLogger, format, transports } from 'winston';
import { load } from './config.js';
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

const cfg = load();
if (cfg === null) process.exit();

const client = new Client({ intents: [Intents.FLAGS.GUILDS] });

client.once('ready', () => {
    logger.info(`StreamAlert loaded in ${client.guilds.cache.size} guilds`);

    const webhooksUrl = cfg['webhooks_host'] + ':' + cfg['webhooks_port'];
    const twitchAPI = new TwitchAPI(cfg['twitch_id_client'], cfg['twitch_secret'],
        webhooksUrl, cfg['webhooks_secret']);

    startWebserver(cfg['webhooks_port'], cfg['webhooks_secret'], () => {
        logger.info(`Started Webhooks webserver at '${webhooksUrl}'`);
        cfg['streams'].forEach(sect => {
            twitchAPI.subscribeToStreamUpdates(sect['broadcaster_username'])
                .then(() => logger.info('Finished subscribing process'));
        });
    });
});

client.login(cfg['token'])
    .then(() => logger.debug('Bot has logged in'));