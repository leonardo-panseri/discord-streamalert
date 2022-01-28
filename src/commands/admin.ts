import { Command } from './command_manager.js';
import { SlashCommandBuilder } from '@discordjs/builders';
import { MessageEmbed, Role, User } from 'discord.js';
import log from '../log.js';

const logger = log('AdminCommands');

export const listStreamers: Command = {
    data: new SlashCommandBuilder()
        .setName('liststreamers')
        .setDescription('Prints a list of all registered streamers'),
    execute: async (bot, interaction) => {
        if (!bot) return;

        const subs = await bot.twitchApi?.getAllSubscriptions(true, true);
        if (!subs) return;

        const embed = new MessageEmbed().setColor('GREEN');
        let description = '';
        for (const id in subs) {
            const name = subs[id].name;
            let valid = true;
            for (const type of ['stream.online', 'stream.offline', 'channel.update']) {
                const sect = subs[id][type];
                if (typeof sect !== 'string') {
                    const status = sect.status;
                    if (status !== 'enabled') valid = false;
                }
            }
            description += `- ${name}: ${valid ? 'valid' : 'invalid'}\n`;
        }
        embed.setDescription(description);
        interaction.reply({ embeds: [embed] }).then();
    },
};

export const addStreamer: Command = {
    data: new SlashCommandBuilder()
        .setName('addstreamer')
        .setDescription('Adds a new streamer')
        .addUserOption(option => option.setName('user').setDescription('The Discord user').setRequired(true))
        .addStringOption(option => option.setName('twitch_login').setDescription('The login of the streamer on twitch').setRequired(true))
        .addRoleOption(option => option.setName('role').setDescription('The role to grant to the streamer while he is streaming').setRequired(true)) as SlashCommandBuilder,
    execute: async (bot, interaction) => {
        if (!bot) return;

        const user = interaction.options.getUser('user') as User;
        const login = interaction.options.getString('twitch_login') as string;
        const role = interaction.options.getRole('role') as Role;
        bot.twitchApi?.subscribeToStreamUpdates(login).then(() => {
            bot?.cfg.add(['streams', login], {
                discord_user_id: user.id,
                role_id: role.id,
            });
            interaction.reply({ content: 'Done!', ephemeral: true });
        }).catch((e) => {
            logger.error(e);
            interaction.reply({ content: 'An error has occurred', ephemeral: true });
        });
    },
};

export const removeStreamer: Command = {
    data: new SlashCommandBuilder()
        .setName('removestreamer')
        .setDescription('Removes a registered streamer')
        .addUserOption(option => option.setName('user').setDescription('The Discord user to remove').setRequired(true)) as SlashCommandBuilder,
    execute: async (bot, interaction) => {
        if (!bot) return;

        const user = interaction.options.getUser('user');
        if (!user) return;
        let login: string | undefined = undefined;

        const streams = bot.cfg.getSection('streams');
        for (const key of streams) {
            if (!key) continue;
            if (streams.getStringIn(['streams', key, 'discord_user_id']) === user.id) {
                login = key;
            }
        }
        if (!login) return;

        bot.twitchApi?.deleteSubscriptions(login).then(() => {
            if (!login) return;
            bot?.cfg.remove(['streams', login]);
            interaction.reply({ content: 'Done!', ephemeral: true });
        }).catch((e) => {
            logger.error(e);
            interaction.reply({ content: 'An error has occurred', ephemeral: true });
        });
    },
};