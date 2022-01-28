import log from './log.js';
import { Config } from './config.js';
import { StreamManager } from './stream_manager.js';
import { TwitchApi } from './twitch/twitch_api.js';
import { Webhooks } from './twitch/webhooks.js';
import { Client, CommandInteraction, Intents } from 'discord.js';
import { getPathRelativeToProjectRoot } from './helper.js';
import { existsSync } from 'fs';
import { CommandManager } from './commands/command_manager.js';
import * as url from 'url';

const logger = log();

let bot: Bot | undefined = undefined;

export class Bot {
    readonly cfg;
    private readonly _dataFilePath;

    private readonly _client;
    private readonly _cmdManager;

    twitchApi?: TwitchApi;
    streamManager?: StreamManager;

    constructor() {
        this.cfg = new Config();
        if (this.cfg === undefined) process.exit(1);

        this._dataFilePath = getPathRelativeToProjectRoot(this.cfg.getString('database_file'));
        if (!existsSync(this._dataFilePath)) {
            logger.error('Database file not found, check your configuration');
            process.exit(1);
        }

        this._client = new Client({ intents: [Intents.FLAGS.GUILDS] });
        this._cmdManager = new CommandManager();

        this.registerEventListeners();
    }

    private registerEventListeners() {
        this._client.on('interactionCreate', interaction => {
            if (!interaction.isCommand()) return;
            if (!bot) return;

            bot._cmdManager.handleCommandInteraction(bot, interaction as CommandInteraction);
        });

        this._client.once('ready', this.onReady);
    }

    private async onReady() {
        if (!bot) {
            logger.error('Bot is null');
            return;
        }
        const guildsNum = bot._client.guilds.cache.size;
        logger.info(`StreamAlert loaded in ${guildsNum} guild`);
        if (guildsNum) logger.warn('This bot is meant to be used on a single server only');

        bot.twitchApi = new TwitchApi(
            bot.cfg.getString('twitch_id_client'), bot.cfg.getString('twitch_secret'),
            bot.cfg.getString('webhooks_host'), bot.cfg.getString('webhooks_secret'),
            bot._dataFilePath);

        bot.streamManager = new StreamManager(bot._client, bot.twitchApi, bot._dataFilePath, bot.cfg);

        const webhooks = new Webhooks(bot.streamManager, bot.cfg.getNumber('webhooks_port'), bot.cfg.getString('webhooks_secret'), () => {
            if (!bot) return;
            logger.info(`Started Webhooks webserver at '${bot.cfg.getString('webhooks_host')}'`);
            for (const login of bot.cfg.getSection('streams')) {
                if (login) {
                    bot.twitchApi?.subscribeToStreamUpdates(login)
                        .then(() => logger.info('Finished subscribing process'));
                }
            }
        });
        webhooks.startWebserver();
    }

    start() {
        this._client.login(this.cfg.getString('token'))
            .then(() => logger.debug('Bot has logged in'));
    }
}

if (import.meta.url.replace('/dist/index.js', '') === url.pathToFileURL(process.argv[1]).href) {
    bot = new Bot();
    bot.start();
}