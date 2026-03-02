import { ThumbnailBuilder } from 'discord.js';
import { getInteractionLocale, t } from '../../../i18n/index.js';
import { num, str } from '../formatters.js';
import { isJsonData } from '../types.js';
import type { GroupRendererInput, GroupRendererResult } from '../../../types/logSearchRenderers.js';

const buildUserThumbnail = async (
    input: GroupRendererInput,
    userId: string,
): Promise<ThumbnailBuilder | undefined> => {
    try {
        const user = await input.interaction.client.users.fetch(userId);
        return new ThumbnailBuilder({
            media: {
                url: user.displayAvatarURL({
                    forceStatic: false,
                    size: 64,
                }),
            },
        });
    } catch {
        return undefined;
    }
};

/**
 * 현재 길드 아이콘을 썸네일 컴포넌트로 생성합니다.
 */
const buildGuildIconThumbnail = (input: GroupRendererInput): ThumbnailBuilder | undefined => {
    const guildIconUrl = input.interaction.guild?.iconURL({ forceStatic: false, size: 64 });
    if (!guildIconUrl) {
        return undefined;
    }

    return new ThumbnailBuilder({
        media: {
            url: guildIconUrl,
        },
    });
};

/**
 * invite payload에서 표준 invite 데이터 객체를 추출합니다.
 */
const getInviteData = (input: GroupRendererInput) =>
    isJsonData(input.eventData.invite) ? input.eventData.invite : input.eventData;

/**
 * inviteCreate 로그의 표시 텍스트와 썸네일을 생성합니다.
 */
const renderInviteCreate = async (input: GroupRendererInput): Promise<GroupRendererResult> => {
    const locale = getInteractionLocale(input.interaction);
    const inviteDetails: string[] = [];
    const invite = getInviteData(input);
    const inviter = isJsonData(invite.inviter) ? invite.inviter : undefined;

    if (invite) {
        if (invite.code) {
            inviteDetails.push(
                `${t(locale, 'logSearchShared.invite.codeLabel')} ${str(invite.code)}`,
            );
        }
        if (invite.url) {
            inviteDetails.push(`**URL:** ${str(invite.url)}`);
        }

        const inviterId = str(invite.inviterId ?? inviter?.id);
        const inviterTag = str(inviter?.tag) || (inviterId ? `<@${inviterId}>` : null);
        if (inviterId) {
            try {
                const inviterUser = await input.interaction.client.users.fetch(inviterId);
                inviteDetails.push(
                    `${t(locale, 'logSearchShared.legacy.creatorLabel')} ${inviterUser.tag} (<@${inviterId}>)`,
                );
            } catch {
                inviteDetails.push(
                    `${t(locale, 'logSearchShared.legacy.creatorLabel')} ${inviterTag ?? inviterId}`,
                );
            }
        }

        const inviteChannel = isJsonData(invite.channel) ? invite.channel : undefined;
        const channelId = str(invite.channelId ?? inviteChannel?.id);
        if (channelId) {
            inviteDetails.push(
                `${t(locale, 'logSearchShared.legacy.channelLabel')} <#${channelId}>`,
            );
        }
        if (invite.uses !== undefined) {
            inviteDetails.push(
                `${t(locale, 'logSearchShared.invite.usesLabel')} ${num(invite.uses)}`,
            );
        }
        if (invite.maxUses !== undefined) {
            inviteDetails.push(
                `${t(locale, 'logSearchShared.invite.maxUsesLabel')} ${num(invite.maxUses) === 0 ? t(locale, 'logSearchShared.invite.unlimited') : num(invite.maxUses)}`,
            );
        }
        if (invite.maxAge !== undefined) {
            inviteDetails.push(
                `${t(locale, 'logSearchShared.invite.expiresLabel')} ${num(invite.maxAge) === 0 ? t(locale, 'logSearchShared.legacy.none') : t(locale, 'logSearchShared.invite.hours', { hours: num(invite.maxAge) / 60 / 60 })}`,
            );
        }
        if (invite.temporary !== undefined) {
            inviteDetails.push(
                `${t(locale, 'logSearchShared.invite.temporaryLabel')} ${invite.temporary ? t(locale, 'logSearchShared.legacy.yes') : t(locale, 'logSearchShared.legacy.no')}`,
            );
        }
        if (invite.createdAt) {
            inviteDetails.push(
                `${t(locale, 'logSearchShared.invite.createdAtLabel')} <t:${Math.floor(new Date(str(invite.createdAt)).getTime() / 1000)}:R>`,
            );
        }
    }

    const inviterIdForThumbnail = str(invite.inviterId ?? inviter?.id);
    const thumbnailFromInviter = inviterIdForThumbnail
        ? await buildUserThumbnail(input, inviterIdForThumbnail)
        : undefined;
    const thumbnailComponent = thumbnailFromInviter ?? buildGuildIconThumbnail(input);

    return {
        eventSpecificsText:
            inviteDetails.length > 0
                ? inviteDetails.join('\n')
                : t(locale, 'logSearchShared.invite.createNoInfo'),
        thumbnailComponent,
    };
};

/**
 * inviteDelete 로그의 표시 텍스트와 썸네일을 생성합니다.
 */
const renderInviteDelete = async (input: GroupRendererInput): Promise<GroupRendererResult> => {
    const locale = getInteractionLocale(input.interaction);
    const inviteDetails: string[] = [];
    const invite = getInviteData(input);
    const inviteChannel = isJsonData(invite.channel) ? invite.channel : undefined;

    if (invite) {
        if (invite.code) {
            inviteDetails.push(
                `${t(locale, 'logSearchShared.invite.deletedCodeLabel')} ${str(invite.code)}`,
            );
        }
        const channelId = str(invite.channelId ?? inviteChannel?.id);
        if (channelId) {
            inviteDetails.push(
                `${t(locale, 'logSearchShared.legacy.channelLabel')} <#${channelId}>`,
            );
        }
    }

    const thumbnailFromExecutor = input.logUserId
        ? await buildUserThumbnail(input, input.logUserId)
        : undefined;
    const thumbnailComponent = thumbnailFromExecutor ?? buildGuildIconThumbnail(input);

    return {
        eventSpecificsText:
            inviteDetails.length > 0
                ? inviteDetails.join('\n')
                : t(locale, 'logSearchShared.invite.deleteNoInfo'),
        thumbnailComponent,
    };
};

/**
 * 초대 이벤트 타입별 렌더러를 분기 호출합니다.
 */
export async function renderInviteEvent(input: GroupRendererInput): Promise<GroupRendererResult> {
    switch (input.eventType) {
        case 'inviteCreate':
            return renderInviteCreate(input);
        case 'inviteDelete':
            return renderInviteDelete(input);
        default:
            return {
                eventSpecificsText: t(
                    getInteractionLocale(input.interaction),
                    'logSearchShared.legacy.noRecordedDetails',
                ),
            };
    }
}
