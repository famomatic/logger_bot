import { ThumbnailBuilder } from 'discord.js';
import { str } from '../formatters.js';
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

export async function renderUserEvent(input: GroupRendererInput): Promise<GroupRendererResult> {
    const details: string[] = [];
    const oldUser = isJsonData(input.eventData.oldUser) ? input.eventData.oldUser : undefined;
    const newUserCandidate = input.eventData.newUser ?? input.eventData.user;
    const newUser = isJsonData(newUserCandidate) ? newUserCandidate : undefined;

    if (newUser) {
        details.push(
            `**사용자:** ${str(newUser.tag) || str(newUser.username)} (<@${str(newUser.id)}>)`,
        );
        if (oldUser) {
            if (oldUser.username !== newUser.username) {
                details.push(
                    `**사용자명 변경:** \\\`${str(oldUser.username)}\\\` -> \\\`${str(newUser.username)}\\\``,
                );
            }
            if (oldUser.discriminator !== newUser.discriminator) {
                details.push(
                    `**태그 변경:** #${str(oldUser.discriminator)} -> #${str(newUser.discriminator)}`,
                );
            }
            if (oldUser.avatar !== newUser.avatar) {
                details.push('**아바타 변경됨**');
            }
            if (oldUser.globalName !== newUser.globalName) {
                details.push(
                    `**표시 이름 변경:** \\\`${str(oldUser.globalName, '(없음)')}\\\` -> \\\`${str(newUser.globalName, '(없음)')}\\\``,
                );
            }
        }
    } else {
        details.push('사용자 정보 없음');
    }

    const userIdForThumbnail = str(newUser?.id);
    const thumbnailComponent = userIdForThumbnail
        ? await buildUserThumbnail(input, userIdForThumbnail)
        : undefined;

    return {
        eventSpecificsText: details.length > 0 ? details.join('\n') : '사용자 업데이트 정보 없음',
        thumbnailComponent,
    };
}
