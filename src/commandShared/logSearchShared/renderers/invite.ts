import { ThumbnailBuilder } from 'discord.js';
import { num, str } from '../formatters.js';
import { isJsonData } from '../types.js';
import type { GroupRendererInput, GroupRendererResult } from './types.js';

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

const getInviteData = (input: GroupRendererInput) =>
    isJsonData(input.eventData.invite) ? input.eventData.invite : input.eventData;

const renderInviteCreate = async (input: GroupRendererInput): Promise<GroupRendererResult> => {
    const inviteDetails: string[] = [];
    const invite = getInviteData(input);
    const inviter = isJsonData(invite.inviter) ? invite.inviter : undefined;

    if (invite) {
        if (invite.code) {
            inviteDetails.push(`**초대 코드:** ${str(invite.code)}`);
        }
        if (invite.url) {
            inviteDetails.push(`**URL:** ${str(invite.url)}`);
        }

        const inviterId = str(invite.inviterId ?? inviter?.id);
        const inviterTag = str(inviter?.tag) || (inviterId ? `<@${inviterId}>` : null);
        if (inviterId) {
            try {
                const inviterUser = await input.interaction.client.users.fetch(inviterId);
                inviteDetails.push(`**생성자:** ${inviterUser.tag} (<@${inviterId}>)`);
            } catch {
                inviteDetails.push(`**생성자:** ${inviterTag ?? inviterId}`);
            }
        }

        const inviteChannel = isJsonData(invite.channel) ? invite.channel : undefined;
        const channelId = str(invite.channelId ?? inviteChannel?.id);
        if (channelId) {
            inviteDetails.push(`**채널:** <#${channelId}>`);
        }
        if (invite.uses !== undefined) {
            inviteDetails.push(`**사용 횟수:** ${num(invite.uses)}`);
        }
        if (invite.maxUses !== undefined) {
            inviteDetails.push(
                `**최대 사용:** ${num(invite.maxUses) === 0 ? '무제한' : num(invite.maxUses)}`,
            );
        }
        if (invite.maxAge !== undefined) {
            inviteDetails.push(
                `**만료:** ${num(invite.maxAge) === 0 ? '없음' : `${num(invite.maxAge) / 60 / 60}시간`}`,
            );
        }
        if (invite.temporary !== undefined) {
            inviteDetails.push(`**임시 멤버십:** ${invite.temporary ? '예' : '아니오'}`);
        }
        if (invite.createdAt) {
            inviteDetails.push(
                `**생성일:** <t:${Math.floor(new Date(str(invite.createdAt)).getTime() / 1000)}:R>`,
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
            inviteDetails.length > 0 ? inviteDetails.join('\n') : '초대 생성 정보 없음',
        thumbnailComponent,
    };
};

const renderInviteDelete = async (input: GroupRendererInput): Promise<GroupRendererResult> => {
    const inviteDetails: string[] = [];
    const invite = getInviteData(input);
    const inviteChannel = isJsonData(invite.channel) ? invite.channel : undefined;

    if (invite) {
        if (invite.code) {
            inviteDetails.push(`**삭제된 초대 코드:** ${str(invite.code)}`);
        }
        const channelId = str(invite.channelId ?? inviteChannel?.id);
        if (channelId) {
            inviteDetails.push(`**채널:** <#${channelId}>`);
        }
    }

    const thumbnailFromExecutor = input.logUserId
        ? await buildUserThumbnail(input, input.logUserId)
        : undefined;
    const thumbnailComponent = thumbnailFromExecutor ?? buildGuildIconThumbnail(input);

    return {
        eventSpecificsText:
            inviteDetails.length > 0 ? inviteDetails.join('\n') : '초대 삭제 정보 없음',
        thumbnailComponent,
    };
};

export async function renderInviteEvent(input: GroupRendererInput): Promise<GroupRendererResult> {
    switch (input.eventType) {
        case 'inviteCreate':
            return renderInviteCreate(input);
        case 'inviteDelete':
            return renderInviteDelete(input);
        default:
            return { eventSpecificsText: '(기록된 세부 정보 없음)' };
    }
}
