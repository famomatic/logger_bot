import { ThumbnailBuilder } from 'discord.js';

import { getInteractionLocale, t } from '../deps.js';
import { str } from '../formatters.js';
import { isJsonData } from '../types.js';

import type { GroupRendererInput, GroupRendererResult } from '../deps.js';

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
 * userUpdate 로그의 변경 요약 텍스트와 썸네일을 생성합니다.
 */
export async function renderUserEvent(input: GroupRendererInput): Promise<GroupRendererResult> {
    const locale = getInteractionLocale(input.interaction);
    const details: string[] = [];
    const oldUser = isJsonData(input.eventData.oldUser) ? input.eventData.oldUser : undefined;
    const newUserCandidate = input.eventData.newUser ?? input.eventData.user;
    const newUser = isJsonData(newUserCandidate) ? newUserCandidate : undefined;

    if (newUser) {
        details.push(
            `${t(locale, 'logSearchShared.legacy.userLabel')} ${str(newUser.tag) || str(newUser.username)} (<@${str(newUser.id)}>)`,
        );
        if (oldUser) {
            if (oldUser.username !== newUser.username) {
                details.push(
                    `${t(locale, 'logSearchShared.user.usernameChangedLabel')} \\\`${str(oldUser.username)}\\\` -> \\\`${str(newUser.username)}\\\``,
                );
            }
            if (oldUser.discriminator !== newUser.discriminator) {
                details.push(
                    `${t(locale, 'logSearchShared.user.tagChangedLabel')} #${str(oldUser.discriminator)} -> #${str(newUser.discriminator)}`,
                );
            }
            if (oldUser.avatar !== newUser.avatar) {
                details.push(t(locale, 'logSearchShared.user.avatarChanged'));
            }
            if (oldUser.globalName !== newUser.globalName) {
                details.push(
                    `${t(locale, 'logSearchShared.user.displayNameChangedLabel')} \\\`${str(oldUser.globalName, t(locale, 'logSearchShared.legacy.none'))}\\\` -> \\\`${str(newUser.globalName, t(locale, 'logSearchShared.legacy.none'))}\\\``,
                );
            }
        }
    } else {
        details.push(t(locale, 'logSearchShared.user.noInfo'));
    }

    const userIdForThumbnail = str(newUser?.id);
    const thumbnailComponent = userIdForThumbnail
        ? await buildUserThumbnail(input, userIdForThumbnail)
        : undefined;

    return {
        eventSpecificsText:
            details.length > 0
                ? details.join('\n')
                : t(locale, 'logSearchShared.user.updateNoInfo'),
        thumbnailComponent,
    };
}
