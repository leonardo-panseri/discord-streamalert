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

class Bot {
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

            this._cmdManager.handleCommandInteraction(interaction as CommandInteraction);
        });

        this._client.once('ready', this.onReady);
    }

    private async onReady() {
        const guildsNum = this._client.guilds.cache.size;
        logger.info(`StreamAlert loaded in ${guildsNum} guild`);
        if (guildsNum) logger.warn('This bot is meant to be used on a single server only');

        this.twitchApi = new TwitchApi(
            this.cfg.getString('twitch_id_client'), this.cfg.getString('twitch_secret'),
            this.cfg.getString('webhooks_host'), this.cfg.getString('webhooks_secret'),
            this._dataFilePath);

        this.streamManager = new StreamManager(this._client, this.twitchApi, this._dataFilePath, this.cfg);

        const webhooks = new Webhooks(this.streamManager, this.cfg.getNumber('webhooks_port'), this.cfg.getString('webhooks_secret'), () => {
            logger.info(`Started Webhooks webserver at '${this.cfg.getString('webhooks_host')}'`);
            for (const login of this.cfg.getSection('streams')) {
                if (login) {
                    this.twitchApi?.subscribeToStreamUpdates(login)
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

export default bot;

if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
    bot = new Bot();
    bot.start();
}