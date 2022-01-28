import log from './log.js';
import { format, JsonPayload } from './helper.js';
import { TwitchApi } from './twitch/twitch_api.js';
import { Client, ColorResolvable, GuildMember, MessageEmbed, Snowflake, TextChannel } from 'discord.js';
import Keyv from 'keyv';
import Database from 'better-sqlite3';
import { Config } from './config.js';

const logger = log('StreamManager');

interface StreamEvent {
    broadcasterName: string;
    category: string;
    messageId?: Snowflake;
}

export class StreamManager {
    private readonly _client: Client;
    private readonly _twitchApi: TwitchApi;

    /** Maps broadcasterId to the object representing his online stream */
    private readonly _onlineStreams: Record<string, StreamEvent>;
    /** Key/Value store containing all sent alert message ids */
    private readonly _cache: Keyv;

    private readonly _dataFilePath;
    private readonly _cfg: Config;

    constructor(client: Client, twitchApi: TwitchApi, dataFilePath: string, cfg: Config) {
        this._client = client;
        this._twitchApi = twitchApi;

        this._onlineStreams = {};
        this._cache = new Keyv('sqlite://' + dataFilePath, { namespace: 'streamManager' });

        this._dataFilePath = dataFilePath;
        this._cfg = cfg;

        this.cleanupMessagesAndRoles().then(() => logger.debug('Finished cleaning up tracked messages'));
    }

    /**
     * Fetches the channel where to send alerts from the id specified in the config, if an error occurs returns undefined.
     * @private
     */
    private async fetchNotificationChannel(): Promise<TextChannel | undefined> {
        try {
            const channel = await this._client.channels.fetch(this._cfg.getString('notification_channel'));
            if (!channel || !(channel instanceof TextChannel)) {
                logger.error('Invalid id for "notification_channel", check config');
                return undefined;
            }
            return channel;
        } catch (e) {
            logger.error(`Error while retrieving notification channel: ${e}`);
            return undefined;
        }
    }

    /**
     * Creates an embed for a stream online alert.
     * @param broadcasterLogin the username of the broadcaster
     * @param broadcasterName the display name of the broadcaster
     * @param title the title of the stream
     * @param thumbnailUrl the url for the thumbnail of the stream
     * @private
     */
    private createStreamEmbed(broadcasterLogin: string, broadcasterName: string, title: string, thumbnailUrl: string): MessageEmbed {
        const sect = this._cfg.getSection('embed');
        return new MessageEmbed()
            .setColor(sect.getString('color') as ColorResolvable)
            .setTitle(format(sect.getString('title'), { 'name': broadcasterName }))
            .setDescription(format(sect.getString('description'), { 'streamTitle': title }))
            .setURL(`https://www.twitch.tv/${broadcasterLogin}`)
            .setImage(thumbnailUrl)
            .setTimestamp();
    }

    /**
     * Sends an embed containing stream info to the notification channel specified in the config.
     * @param streamInfo
     * @private
     */
    private async sendStreamEmbed(streamInfo: JsonPayload): Promise<string | undefined> {
        const broadcasterLogin = streamInfo['user_login'] as string;
        const broadcasterName = streamInfo['user_name'] as string;
        const title = streamInfo['title'] as string;
        const thumbnailUrl = (streamInfo['thumbnail_url'] as string)
            .replace('{width}', '440')
            .replace('{height}', '248');
        const embed = this.createStreamEmbed(broadcasterLogin, broadcasterName, title, thumbnailUrl);
        const channel = await this.fetchNotificationChannel();
        if (!channel) return undefined;
        const msg = await channel.send({ embeds: [embed] });
        await this._cache.set(msg.id, broadcasterLogin);
        return msg.id;
    }

    /**
     * Deletes an alert message.
     * @param broadcasterId the id of the broadcaster for this alert, can be undefined
     * @param messageId the id of the message
     * @param save if the deletion should be saved to cache (default: true)
     * @private
     */
    private async deleteMessage(messageId: string, broadcasterId?: string, save = true): Promise<void> {
        const channel = await this.fetchNotificationChannel();
        if (channel) {
            try {
                await channel.messages.delete(messageId);
            } catch (e) {
                logger.debug('Trying to delete a message that does not exists');
            }
        }
        if (save) {
            if (broadcasterId && this._onlineStreams[broadcasterId]) this._onlineStreams[broadcasterId].messageId = undefined;
            await this._cache.delete(messageId);
        }
    }

    /**
     * Fetches the guild member with the id specified in the config for this broadcasterLogin.
     * @param broadcasterLogin the login of the broadcaster
     * @private
     */
    private async fetchDiscordUser(broadcasterLogin: string): Promise<GuildMember | undefined> {
        try {
            const guild = this._client.guilds.cache.first();
            if (!guild) return undefined;
            return await guild.members.fetch(
                this._cfg.getStringIn(['streams', broadcasterLogin, 'discord_user_id']));
        } catch (e) {
            logger.error(`Error while fetching user: ${e}`);
        }
        return undefined;
    }

    /**
     * Grants the streamer role in the discord guild to the broadcaster.
     * @param broadcasterLogin the login of the broadcaster
     * @private
     */
    private async grantStreamerRole(broadcasterLogin: string) {
        const member = await this.fetchDiscordUser(broadcasterLogin);
        if (!member) return;
        member.roles.add(this._cfg.getStringIn(['streams', broadcasterLogin, 'role_id']))
            .catch(logger.error);
    }

    /**
     * Removes the streamer role in the discord guild from the broadcaster.
     * @param broadcasterLogin the login of the broadcaster
     * @private
     */
    private async removeStreamerRole(broadcasterLogin: string) {
        const member = await this.fetchDiscordUser(broadcasterLogin);
        if (!member) return;
        member.roles.remove(this._cfg.getStringIn(['streams', broadcasterLogin, 'role_id']))
            .catch(logger.error);
    }

    /**
     * Deletes all messages which id is present in cache and removes the roles from the discord guild member.
     * @private
     */
    private async cleanupMessagesAndRoles(): Promise<void> {
        const db = new Database(this._dataFilePath);
        const rows = db.prepare('SELECT \'key\',\'value\' from keyv WHERE \'key\' LIKE \'streamManager:%\'').all();
        logger.debug(JSON.stringify(rows));
        rows.forEach(row => {
            this.deleteMessage(row.key, undefined, false);
            const login = JSON.parse(row.value)['value'];
            this.removeStreamerRole(login);
        });
        await this._cache.clear();
    }

    /**
     * Handles a stream.online notification, sending an alert in the channel specified in the config if the stream
     * is in the category specified in the config.
     * @param broadcasterId the id of the broadcaster that started streaming
     * @param broadcasterLogin the login of the broadcaster that started streaming
     * @param broadcasterName the display name of the broadcaster that started streaming
     */
    async onStreamOnline(broadcasterId: string, broadcasterLogin: string, broadcasterName: string): Promise<void> {
        logger.debug(`Stream online for ${broadcasterId}`);

        if (this._onlineStreams[broadcasterId] !== undefined) {
            logger.warn(`Received online notification for ${broadcasterName} stream that was already cached as online`);
            const msgID = this._onlineStreams[broadcasterId].messageId;
            if (msgID !== undefined) {
                await this.deleteMessage(msgID, broadcasterId);
            }
            delete this._onlineStreams[broadcasterId];
        }

        const streamInfo = await this._twitchApi.getStreamInfo(broadcasterId);
        if (!streamInfo) return;
        const category = streamInfo['game_name'] as string;

        const stream: StreamEvent = {
            'broadcasterName': broadcasterName,
            'category': category,
            'messageId': undefined };

        if (category.toLowerCase() === this._cfg.getString('stream_category').toLowerCase()) {
            stream.messageId = await this.sendStreamEmbed(streamInfo);
            this.grantStreamerRole(broadcasterLogin).then();
        }

        this._onlineStreams[broadcasterId] = stream;
    }

    /**
     * Handles a stream.offline notification, removing the alert if it is present.
     * @param broadcasterId the id of the broadcaster that stopped streaming
     * @param broadcasterLogin the login of the broadcaster that stopped streaming
     */
    async onStreamOffline(broadcasterId: string, broadcasterLogin: string): Promise<void> {
        logger.debug(`Stream offline for ${broadcasterId}`);

        if (this._onlineStreams[broadcasterId] !== undefined) {
            const msgID = this._onlineStreams[broadcasterId].messageId;
            if (msgID !== undefined) {
                await this.deleteMessage(msgID, broadcasterId);
            }
            this.removeStreamerRole(broadcasterLogin).then();
            delete this._onlineStreams[broadcasterId];
        }
    }

    /**
     * Handles a channel.update notification, removing the alert if the category is no longer the one
     * specified in the config or sending an alert if it has just changed to it.
     * @param broadcasterId the id of the broadcaster that updated his channel
     * @param broadcasterLogin the login of the broadcaster that update his channel
     * @param category the new category for the channel
     */
    async onChannelUpdate(broadcasterId: string, broadcasterLogin: string, category: string): Promise<void> {
        logger.debug(`Channel update for ${broadcasterId}`);

        if (this._onlineStreams[broadcasterId] !== undefined) {
            const msgID = this._onlineStreams[broadcasterId].messageId;
            if (msgID !== undefined) {
                if (category.toLowerCase() !== this._cfg.getString('stream_category').toLowerCase()) {
                    await this.deleteMessage(msgID, broadcasterId);
                    this.removeStreamerRole(broadcasterLogin).then();
                }
            } else if (category.toLowerCase() === this._cfg.getString('stream_category').toLowerCase()) {
                const streamInfo = await this._twitchApi.getStreamInfo(broadcasterId);
                if (!streamInfo) return;
                this._onlineStreams[broadcasterId].messageId = await this.sendStreamEmbed(streamInfo);
                this.grantStreamerRole(broadcasterLogin).then();
            }
        }
    }
}