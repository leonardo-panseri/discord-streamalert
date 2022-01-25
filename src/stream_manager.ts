import { logger, client, cfg } from './index.js';
import { MessageEmbed, Snowflake, TextChannel } from 'discord.js';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { getPathRelativeToProjectRoot } from './helper.js';

const onlineStreams: Record<string, StreamEvent> = {};

const trackedMessagesFile = getPathRelativeToProjectRoot('tracked_messages.json');
const trackedMessages: Record<string, number> = {};

export async function onStreamOnline(broadcasterID, broadcasterName) {
    logger.debug(`Stream online for ${broadcasterID}`);

    if (onlineStreams[broadcasterID] !== undefined) {
        logger.warn(`Received online notification for ${broadcasterName} stream that was already cached as online`);
        const msgID = onlineStreams[broadcasterID].messageID;
        if (msgID !== undefined) {
            await deleteMessage(msgID);
        }
        delete onlineStreams[broadcasterID];
    }

    const streamInfo = await client['twitchAPI'].getStreamInfo(broadcasterID);
    const category = streamInfo['game_name'];

    const stream: StreamEvent = {
        'broadcasterName': broadcasterName,
        'category': category,
        'messageID': undefined };

    if (category.toLowerCase() === cfg['stream_category'].toLowerCase()) {
        onlineStreams[broadcasterID].messageID = await sendStreamEmbed(streamInfo);
    }

    onlineStreams[broadcasterID] = stream;
}

export async function onStreamOffline(broadcasterID) {
    logger.debug(`Stream online for ${broadcasterID}`);

    if (onlineStreams[broadcasterID] !== undefined) {
        const msgID = onlineStreams[broadcasterID].messageID;
        if (msgID !== undefined) {
            await deleteMessage(msgID);
        }
        delete onlineStreams[broadcasterID];
    }
}

export async function onChannelUpdate(broadcasterID, category) {
    logger.debug(`Channel update for ${broadcasterID}`);

    if (onlineStreams[broadcasterID] !== undefined) {
        const msgID = onlineStreams[broadcasterID].messageID;
        if (msgID !== undefined) {
            if (category.toLowerCase() !== cfg['stream_category'].toLowerCase()) {
                await deleteMessage(msgID);
            }
        } else if (category.toLowerCase() === cfg['stream_category'].toLowerCase()) {
            const streamInfo = await client['twitchAPI'].getStreamInfo(broadcasterID);
            onlineStreams[broadcasterID].messageID = await sendStreamEmbed(streamInfo);
        }
    }
}

function createStreamEmbed(broadcasterLogin, broadcasterName, title, thumbnailUrl) {
    const format = (templ, obj) => templ.replace(/\${([^}]*)}/g, (r, k) => obj[k]);
    return new MessageEmbed()
        .setColor(cfg['embed']['color'])
        .setTitle(format(cfg['embed']['title'], broadcasterName))
        .setDescription(format(cfg['embed']['description'], title))
        .setURL(`https://www.twitch.tv/${broadcasterLogin}`)
        .setImage(thumbnailUrl)
        .setTimestamp();
}

async function deleteMessage(id, save = true) {
    const channel = await fetchNotificationChannel();
    await channel.messages.delete(id);
    if (save) {
        delete trackedMessages[id];
        saveTrackedMessages();
    }
}

async function sendStreamEmbed(streamInfo): Promise<string> {
    const broadcasterLogin = streamInfo['user_login'];
    const broadcasterName = streamInfo['user_name'];
    const title = streamInfo['title'];
    const thumbnailUrl = streamInfo['thumbnail_url'];
    const embed = createStreamEmbed(broadcasterLogin, broadcasterName, title, thumbnailUrl);
    const channel = await fetchNotificationChannel();
    const msg = await channel.send({ embeds: [embed] });
    trackedMessages[msg.id] = 1;
    saveTrackedMessages();
    return msg.id;
}

async function fetchNotificationChannel(): Promise<TextChannel> {
    const channel = await client.channels.fetch(cfg['notification_channel']);
    if (!channel || !(channel instanceof TextChannel)) {
        logger.error('Invalid id for "notification_channel", check config');
        process.exit(1);
    }
    return channel;
}

export async function cleanupTrackedMessages() {
    if (existsSync(trackedMessagesFile)) {
        const toCleanup = JSON.parse(readFileSync(trackedMessagesFile, 'utf8'));
        for (const msgID in toCleanup) {
            await deleteMessage(msgID, false);
        }
    }
}

function saveTrackedMessages() {
    writeFileSync(trackedMessagesFile, JSON.stringify(trackedMessages), 'utf8');
}

interface StreamEvent {
    broadcasterName: string;
    category: string;
    messageID: Snowflake;
}