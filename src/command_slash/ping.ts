import { SlashCommandBuilder } from 'discord.js';

import {
    createPendingPingReply,
    createPingResultReply,
    resolvePingMetrics,
} from '../commandShared/pingCore.js';
import { getInteractionLocale, localizations } from '../i18n/index.js';
import { logger } from '../utils/logger.js';

import type { ChatInputCommandInteraction } from 'discord.js';

// 일반 사용자도 사용 가능하므로 별도 권한 확인 없음

/**
 * 슬래시 커맨드 모듈 계약(`export const command = { data, execute }`)입니다.
 */
export const command = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription(localizations('command.pingDescription').ko)
        .setDescriptionLocalizations(localizations('command.pingDescription')),
    permission: {
        public: true,
        listable: false,
    },
    async execute(interaction: ChatInputCommandInteraction) {
        const locale = getInteractionLocale(interaction);
        logger.info(`/ping command executed by ${interaction.user.tag}`);
        const sentReply = await interaction.reply({
            ...createPendingPingReply(locale),
            fetchReply: true,
        });
        const metrics = await resolvePingMetrics(
            interaction.createdTimestamp,
            sentReply.createdTimestamp,
            interaction.client,
        );

        await interaction.editReply(createPingResultReply(metrics, locale));
    },
};
