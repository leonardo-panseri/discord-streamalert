import { SlashCommandBuilder } from '@discordjs/builders';
import { CommandInteraction } from 'discord.js';
import log from '../log.js';
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v9';
import { Config } from '../config.js';
import { addStreamer, listStreamers, removeStreamer } from './admin.js';
import { Bot } from '../index.js';

const logger = log('CommandManager');

export interface Command {
    readonly data: SlashCommandBuilder;
    readonly execute: (bot: Bot, interaction: CommandInteraction) => Promise<void>;
}

export class CommandManager {
    private readonly _commands: Record<string, Command> = {};

    constructor() {
        this.addCommand(listStreamers);
        this.addCommand(addStreamer);
        this.addCommand(removeStreamer);
    }

    handleCommandInteraction(bot: Bot, interaction: CommandInteraction): void {
        const command = this._commands[interaction.commandName];
        if (!command) return;

        command.execute(bot, interaction).catch(e => {
            logger.error(`Interaction '${interaction.commandName}': ${e}`);
            interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true })
                .then();
        });
    }

    private addCommand(command: Command) {
        this._commands[command.data.name] = command;
    }

    registerAllCommands() {
        const toRegister: object[] = [];
        for (const cmd in this._commands) {
            toRegister.push(this._commands[cmd].data.toJSON());
        }

        const cfg = new Config();
        const rest = new REST({ version: '9' }).setToken(cfg.getString('token'));

        const clientId = cfg.getString('client_id');
        const guildId = cfg.getString('guild_id');
        rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: toRegister })
            .then(() => logger.info('Successfully registered application commands.'))
            .catch(logger.error);
    }
}