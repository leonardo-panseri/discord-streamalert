import { Command } from './command_manager.js';
import { SlashCommandBuilder } from '@discordjs/builders';
import { CommandInteraction, MessageEmbed, User } from 'discord.js';
import log from '../log.js';

const logger = log('AdminCommands');

const errorHandler = (interaction: CommandInteraction, e: Error) => {
    logger.error(e);
    interaction.reply({ content: 'An error has occurred', ephemeral: true }).then();
};

export const listStreamers: Command = {
    data: new SlashCommandBuilder()
        .setName('liststreamers')
        .setDescription('Prints a list of all registered streamers'),
    execute: async (bot, interaction) => {
        if (!bot) return;

        await interaction.deferReply();

        const subs = await bot.twitchApi?.getAllSubscriptions(true, true);
        if (!subs) return;

        const descriptions: string[] = [];
        let currentPage = 0;
        descriptions[currentPage] = '';
        let count = 0;
        for (const id in subs) {
            const name = subs[id].name as string;
            if (!name) return;
            let valid = true;
            for (const type of ['stream.online', 'stream.offline', 'channel.update', 'channel.raid']) {
                const sect = subs[id][type];
                if (typeof sect !== 'string') {
                    const status = sect.status;
                    if (status !== 'enabled') valid = false;
                }
            }

            let discordUser = undefined;
            try {
                const discordUserId = bot.cfg.getStringIn(['streams', name, 'discord_user_id']);
                discordUser = await interaction.guild?.members.fetch(discordUserId);
            } catch (e) {
                logger.warn(`Twitch user ${name} has invalid discord_user_id`);
            }

            const newLine = `- ${discordUser ? discordUser : 'not_valid'} / https://www.twitch.tv/${name}: ${valid && discordUser ? 'valid' : 'invalid'}\n`;
            if (descriptions[currentPage].length + newLine.length > 4096) {
                currentPage++;
                descriptions[currentPage] = '';
            }
            descriptions[currentPage] += newLine;
            count++;
        }

        const embeds: MessageEmbed[] = [];
        for (const description of descriptions) {
            const embed = new MessageEmbed().setColor('GREEN').setFooter({ text: `Total: ${count}` });
            embed.setDescription(description);
            embeds.push(embed);
        }
        interaction.editReply({ embeds: embeds }).then();
    },
};

export const addStreamer: Command = {
    data: new SlashCommandBuilder()
        .setName('addstreamer')
        .setDescription('Adds a new streamer')
        .addUserOption(option => option.setName('user').setDescription('The Discord user').setRequired(true))
        .addStringOption(option => option.setName('twitch_login').setDescription('The login of the streamer on twitch').setRequired(true)) as SlashCommandBuilder,
    execute: async (bot, interaction) => {
        if (!bot) return;

        const user = interaction.options.getUser('user') as User;
        const login = interaction.options.getString('twitch_login') as string;
        bot.twitchApi?.subscribeToStreamUpdates(login).then(() => {
            bot?.cfg.add(['streams', login], {
                discord_user_id: user.id,
            });

            interaction.guild?.members.fetch(user)
                .then(member => member.roles.add(bot.cfg.getString('streamer_role'))
                    .catch(e => errorHandler(interaction, e)))
                .catch(e => errorHandler(interaction, e));

            interaction.reply({ content: 'Done!', ephemeral: true });
        }).catch((e) => errorHandler(interaction, e));
    },
};

export const removeStreamer: Command = {
    data: new SlashCommandBuilder()
        .setName('removestreamer')
        .setDescription('Removes a registered streamer')
        .addStringOption(option => option.setName('twitch_login').setDescription('The streamer to remove').setRequired(true)) as SlashCommandBuilder,
    execute: async (bot, interaction) => {
        if (!bot) return;

        const login = interaction.options.getString('twitch_login');
        if (!login) return;

        bot.twitchApi?.deleteSubscriptions(login).then(() => {
            if (!login) return;
            const memberId = bot?.cfg.getStringIn(['streams', login, 'discord_user_id']);
            bot.cfg.remove(['streams', login]);

            interaction.guild?.members.fetch(memberId)
                .then(member => member.roles.remove(bot.cfg.getString('streamer_role'))
                    .catch(e => errorHandler(interaction, e)))
                .catch(e => errorHandler(interaction, e));

            interaction.reply({ content: 'Done!', ephemeral: true });
        }).catch((e) => errorHandler(interaction, e));
    },
};