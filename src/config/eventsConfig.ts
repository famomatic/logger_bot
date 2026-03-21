import type { EventConfig } from '../types/eventsConfig.js';
import type { SupportedLocale } from '../types/i18n.js';

/**
 * Discord 이벤트별 로깅 메타데이터(이름/카테고리/검색 필드/선택지 노출 여부) 정의입니다.
 */
export const eventConfigurations: Record<string, EventConfig> = {
    messageCreate: {
        eventName: 'MessageCreate',
        friendlyName: '메시지 생성',
        dbEventType: 'messageCreate',
        category: 'message',
        searchableFields: [
            'content',
            'authorTag',
            'authorUsername',
            // processedAttachments는 배열, 각 요소의 filename 검색
            'attachments.filename',
            // stickers는 배열, 각 요소의 name 검색
            'stickers.name',
            // embeds는 배열, 각 요소의 title, description, fields 내부 검색
            'embeds.title',
            'embeds.description',
            'embeds.fields.name',
            'embeds.fields.value',
            'embeds.footer.text',
            'embeds.author.name',
            // forwardedContentList는 배열, 각 요소의 content, author.username 등 검색
            'forwardedContentList.content',
            'forwardedContentList.author.username',
            'forwardedContentList.author.tag',
            // referencedMessage는 단일 객체
            'referencedMessage.content',
            'referencedMessage.author.tag',
            'referencedMessage.author.username',
        ],
        includeInChoices: true,
    },
    messageUpdate: {
        eventName: 'MessageUpdate',
        friendlyName: '메시지 수정',
        dbEventType: 'messageUpdate',
        category: 'message',
        // dataToStore: { messageId, channelId, authorId, authorTag, oldContent, newContent, messageUrl }
        searchableFields: ['oldContent', 'newContent', 'authorTag'],
        includeInChoices: true,
    },
    messageDelete: {
        eventName: 'MessageDelete',
        friendlyName: '메시지 삭제',
        dbEventType: 'messageDelete',
        category: 'message',
        // dataToStore: { messageId, channelId, content, authorId, authorTag, executorUserId }
        searchableFields: ['content', 'authorTag', 'executorUserId'], // executorUserId는 삭제 실행자 ID
        includeInChoices: true,
    },
    messageDeleteBulk: {
        eventName: 'MessageDeleteBulk',
        friendlyName: '메시지 대량 삭제',
        dbEventType: 'messageDeleteBulk',
        category: 'message',
        searchableFields: ['channelId', 'messageIds', 'executorUserId'], // messageIds는 배열
        includeInChoices: true,
    },
    messageReactionAdd: {
        eventName: 'MessageReactionAdd',
        friendlyName: '메시지 반응 추가',
        dbEventType: 'messageReactionAdd',
        category: 'message',
        searchableFields: ['messageId', 'channelId', 'userId', 'userTag', 'emojiName', 'emojiId'],
        includeInChoices: true,
    },
    messageReactionRemove: {
        eventName: 'MessageReactionRemove',
        friendlyName: '메시지 반응 삭제',
        dbEventType: 'messageReactionRemove',
        category: 'message',
        searchableFields: ['messageId', 'channelId', 'userId', 'userTag', 'emojiName', 'emojiId'],
        includeInChoices: true,
    },

    // --- Member Events ---
    guildMemberAdd: {
        eventName: 'GuildMemberAdd',
        friendlyName: '멤버 서버 참가',
        dbEventType: 'guildMemberAdd',
        category: 'member',
        searchableFields: ['memberId', 'memberTag', 'inviterId', 'inviteCode'],
        includeInChoices: true,
    },
    guildMemberRemove: {
        eventName: 'GuildMemberRemove',
        friendlyName: '멤버 서버 이탈 (퇴장/추방)',
        dbEventType: 'guildMemberRemove',
        category: 'member',
        searchableFields: ['memberId', 'memberTag', 'reason', 'executorId'],
        includeInChoices: true,
    },
    guildMemberUpdate: {
        eventName: 'GuildMemberUpdate',
        friendlyName: '멤버 정보 수정',
        dbEventType: 'guildMemberUpdate',
        category: 'member',
        searchableFields: [
            'memberId',
            'memberTag',
            'changes.nickname.old',
            'changes.nickname.new',
            'changes.roles.added',
            'changes.roles.removed', // Array of role IDs/names
            'changes.avatar.old',
            'changes.avatar.new',
            'executorId',
        ],
        includeInChoices: true,
    },
    guildMemberNicknameUpdate: {
        eventName: 'GuildMemberUpdate',
        friendlyName: '멤버 닉네임 변경',
        dbEventType: 'guildMemberNicknameUpdate',
        category: 'member',
        searchableFields: ['targetUserId', 'targetUserTag', 'oldNickname', 'newNickname', 'executorUserId'],
        includeInChoices: false,
    },
    guildMemberRoleUpdate: {
        eventName: 'GuildMemberUpdate',
        friendlyName: '멤버 역할 변경',
        dbEventType: 'guildMemberRoleUpdate',
        category: 'member',
        searchableFields: ['targetUserId', 'targetUserTag', 'addedRoles', 'removedRoles', 'executorUserId'],
        includeInChoices: false,
    },
    guildMemberAvatarUpdate: {
        eventName: 'GuildMemberUpdate',
        friendlyName: '멤버 아바타 변경',
        dbEventType: 'guildMemberAvatarUpdate',
        category: 'member',
        searchableFields: ['targetUserId', 'targetUserTag', 'oldAvatarURL', 'newAvatarURL', 'executorUserId'],
        includeInChoices: false,
    },
    guildMemberTimeoutAdd: {
        eventName: 'GuildMemberUpdate',
        friendlyName: '멤버 타임아웃 설정',
        dbEventType: 'guildMemberTimeoutAdd',
        category: 'member',
        searchableFields: ['targetUserId', 'targetUserTag', 'executorUserId', 'timeoutUntil', 'reason'],
        includeInChoices: false,
    },
    guildMemberTimeoutRemove: {
        eventName: 'GuildMemberUpdate',
        friendlyName: '멤버 타임아웃 해제',
        dbEventType: 'guildMemberTimeoutRemove',
        category: 'member',
        searchableFields: ['targetUserId', 'targetUserTag', 'executorUserId', 'reason'],
        includeInChoices: false,
    },
    guildBanAdd: {
        eventName: 'GuildBanAdd',
        friendlyName: '멤버 차단',
        dbEventType: 'guildBanAdd',
        category: 'member',
        searchableFields: ['userId', 'userTag', 'reason', 'executorId'],
        includeInChoices: true,
    },
    guildBanRemove: {
        eventName: 'GuildBanRemove',
        friendlyName: '멤버 차단 해제',
        dbEventType: 'guildBanRemove',
        category: 'member',
        searchableFields: ['userId', 'userTag', 'executorId'],
        includeInChoices: true,
    },
    userUpdate: {
        eventName: 'UserUpdate',
        friendlyName: '사용자 정보 수정 (봇이 인식하는 모든 유저)',
        dbEventType: 'userUpdate',
        category: 'user',
        searchableFields: [
            'userId',
            'oldUsername',
            'newUsername',
            'oldDiscriminator',
            'newDiscriminator',
            'oldAvatar',
            'newAvatar',
        ],
        includeInChoices: false, // 자주 사용되지 않을 수 있으므로 기본 선택지에서 제외
    },

    // --- Voice State Events ---
    voiceStateUpdate: {
        eventName: 'VoiceStateUpdate',
        friendlyName: '음성 상태 변경',
        dbEventType: 'voiceStateUpdate',
        category: 'voice',
        searchableFields: [
            'memberId',
            'memberTag',
            'oldChannelId',
            'newChannelId',
            'currentChannelId',
            'action', // e.g., 'joined', 'left', 'moved', 'muted', 'unmuted', 'deafened', 'undeafened', 'stream_started', 'stream_stopped'
            'executorId', // If an admin mutes/moves someone
        ],
        includeInChoices: true,
    },
    voiceChannelJoin: {
        eventName: 'VoiceStateUpdate',
        friendlyName: '음성 채널 입장',
        dbEventType: 'voiceChannelJoin',
        category: 'voice',
        searchableFields: ['userId', 'userTag', 'channelId', 'channelName'],
        includeInChoices: true,
    },
    voiceChannelLeave: {
        eventName: 'VoiceStateUpdate',
        friendlyName: '음성 채널 퇴장',
        dbEventType: 'voiceChannelLeave',
        category: 'voice',
        searchableFields: ['userId', 'userTag', 'channelId', 'channelName'],
        includeInChoices: true,
    },
    voiceChannelMove: {
        eventName: 'VoiceStateUpdate',
        friendlyName: '음성 채널 이동',
        dbEventType: 'voiceChannelMove',
        category: 'voice',
        searchableFields: ['userId', 'userTag', 'oldChannelId', 'newChannelId', 'oldChannelName', 'newChannelName'],
        includeInChoices: true,
    },
    voiceStateUpdateServerMute: {
        eventName: 'VoiceStateUpdate',
        friendlyName: '서버 음소거 변경',
        dbEventType: 'voiceStateUpdateServerMute',
        category: 'voice',
        searchableFields: ['userId', 'userTag', 'channelId', 'oldStatus', 'newStatus', 'executorUserId'],
        includeInChoices: false,
    },
    voiceStateUpdateServerDeaf: {
        eventName: 'VoiceStateUpdate',
        friendlyName: '서버 청각차단 변경',
        dbEventType: 'voiceStateUpdateServerDeaf',
        category: 'voice',
        searchableFields: ['userId', 'userTag', 'channelId', 'oldStatus', 'newStatus', 'executorUserId'],
        includeInChoices: false,
    },
    voiceStateUpdateSelfMute: {
        eventName: 'VoiceStateUpdate',
        friendlyName: '자체 음소거 변경',
        dbEventType: 'voiceStateUpdateSelfMute',
        category: 'voice',
        searchableFields: ['userId', 'userTag', 'channelId', 'muted'],
        includeInChoices: false,
    },
    voiceStateUpdateSelfDeaf: {
        eventName: 'VoiceStateUpdate',
        friendlyName: '자체 청각차단 변경',
        dbEventType: 'voiceStateUpdateSelfDeaf',
        category: 'voice',
        searchableFields: ['userId', 'userTag', 'channelId', 'deafened'],
        includeInChoices: false,
    },
    voiceStateUpdateStreaming: {
        eventName: 'VoiceStateUpdate',
        friendlyName: '스트리밍 상태 변경',
        dbEventType: 'voiceStateUpdateStreaming',
        category: 'voice',
        searchableFields: ['userId', 'userTag', 'channelId', 'streaming'],
        includeInChoices: false,
    },
    voiceStateUpdateVideo: {
        eventName: 'VoiceStateUpdate',
        friendlyName: '비디오 상태 변경',
        dbEventType: 'voiceStateUpdateVideo',
        category: 'voice',
        searchableFields: ['userId', 'userTag', 'channelId', 'video'],
        includeInChoices: false,
    },

    // --- Channel Events ---
    channelCreate: {
        eventName: 'ChannelCreate',
        friendlyName: '채널 생성',
        dbEventType: 'channelCreate',
        category: 'channel',
        searchableFields: ['channelId', 'channelName', 'channelType', 'parentId', 'creatorId'],
        includeInChoices: true,
    },
    channelDelete: {
        eventName: 'ChannelDelete',
        friendlyName: '채널 삭제',
        dbEventType: 'channelDelete',
        category: 'channel',
        searchableFields: ['channelId', 'channelName', 'channelType', 'parentId', 'deleterId'],
        includeInChoices: true,
    },
    channelUpdate: {
        eventName: 'ChannelUpdate',
        friendlyName: '채널 정보 수정',
        dbEventType: 'channelUpdate',
        category: 'channel',
        searchableFields: [
            'channelId',
            'channelName',
            'changedProperty', // e.g., 'name', 'topic', 'nsfw', 'position', 'permissions'
            'oldValue',
            'newValue',
            'updaterId',
        ],
        includeInChoices: true,
    },
    channelPinsUpdate: {
        eventName: 'ChannelPinsUpdate',
        friendlyName: '채널 고정 메시지 변경',
        dbEventType: 'channelPinsUpdate',
        category: 'channel',
        searchableFields: ['channelId', 'pinnedMessageIds', 'updaterId'], // pinnedMessageIds는 배열
        includeInChoices: true,
    },

    // --- Role Events ---
    roleCreate: {
        eventName: 'RoleCreate',
        friendlyName: '역할 생성',
        dbEventType: 'roleCreate',
        category: 'role',
        searchableFields: ['roleId', 'roleName', 'color', 'permissions', 'creatorId'],
        includeInChoices: true,
    },
    roleDelete: {
        eventName: 'RoleDelete',
        friendlyName: '역할 삭제',
        dbEventType: 'roleDelete',
        category: 'role',
        searchableFields: ['roleId', 'roleName', 'deleterId'],
        includeInChoices: true,
    },
    roleUpdate: {
        eventName: 'RoleUpdate',
        friendlyName: '역할 정보 수정',
        dbEventType: 'roleUpdate',
        category: 'role',
        searchableFields: [
            'roleId',
            'roleName',
            'changedProperty', // e.g., 'name', 'color', 'permissions', 'mentionable', 'hoisted'
            'oldValue',
            'newValue',
            'updaterId',
        ],
        includeInChoices: true,
    },

    // --- Thread Events ---
    threadCreate: {
        eventName: 'ThreadCreate',
        friendlyName: '스레드 생성',
        dbEventType: 'threadCreate',
        category: 'thread',
        searchableFields: ['threadId', 'threadName', 'parentId', 'creatorId', 'appliedTags'],
        includeInChoices: true,
    },
    threadDelete: {
        eventName: 'ThreadDelete',
        friendlyName: '스레드 삭제',
        dbEventType: 'threadDelete',
        category: 'thread',
        searchableFields: ['threadId', 'threadName', 'parentId', 'deleterId'],
        includeInChoices: true,
    },
    threadUpdate: {
        eventName: 'ThreadUpdate',
        friendlyName: '스레드 정보 수정',
        dbEventType: 'threadUpdate',
        category: 'thread',
        searchableFields: [
            'threadId',
            'threadName',
            'parentId',
            'changedProperty', // e.g., 'name', 'archived', 'locked', 'appliedTags', 'autoArchiveDuration'
            'oldValue',
            'newValue',
            'updaterId',
        ],
        includeInChoices: false,
    },

    // --- Server (Guild) Events ---
    guildUpdate: {
        eventName: 'GuildUpdate',
        friendlyName: '서버 정보 수정',
        dbEventType: 'guildUpdate',
        category: 'guild',
        searchableFields: [
            'guildId',
            'changedProperty', // e.g., 'name', 'icon', 'region', 'ownerId', 'afkChannelId', 'systemChannelId'
            'oldValue',
            'newValue',
            'updaterId',
        ],
        includeInChoices: true,
    },
    guildNameUpdate: {
        eventName: 'GuildNameUpdate',
        friendlyName: '서버 이름 변경',
        dbEventType: 'guildNameUpdate',
        category: 'guild',
        searchableFields: ['oldName', 'newName', 'executorUserId'],
        includeInChoices: false,
    },
    guildIconUpdate: {
        eventName: 'GuildIconUpdate',
        friendlyName: '서버 아이콘 변경',
        dbEventType: 'guildIconUpdate',
        category: 'guild',
        searchableFields: ['oldIconURL', 'newIconURL', 'executorUserId'],
        includeInChoices: false,
    },
    guildOwnerUpdate: {
        eventName: 'GuildOwnerUpdate',
        friendlyName: '서버 소유자 변경',
        dbEventType: 'guildOwnerUpdate',
        category: 'guild',
        searchableFields: ['oldOwnerId', 'newOwnerId', 'executorUserId'],
        includeInChoices: false,
    },

    // --- Invite Events ---
    inviteCreate: {
        eventName: 'InviteCreate',
        friendlyName: '초대 링크 생성',
        dbEventType: 'inviteCreate',
        category: 'invite',
        searchableFields: ['code', 'channelId', 'inviterId', 'maxUses', 'maxAge', 'temporary'],
        includeInChoices: true,
    },
    inviteDelete: {
        eventName: 'InviteDelete',
        friendlyName: '초대 링크 삭제',
        dbEventType: 'inviteDelete',
        category: 'invite',
        searchableFields: ['code', 'channelId', 'deleterId'],
        includeInChoices: false,
    },

    // --- Emoji Events ---
    emojiCreate: {
        eventName: 'GuildEmojiCreate',
        friendlyName: '이모지 생성',
        dbEventType: 'emojiCreate',
        category: 'emoji',
        searchableFields: ['emojiId', 'emojiName', 'creatorId'],
        includeInChoices: false,
    },
    emojiDelete: {
        eventName: 'GuildEmojiDelete',
        friendlyName: '이모지 삭제',
        dbEventType: 'emojiDelete',
        category: 'emoji',
        searchableFields: ['emojiId', 'emojiName', 'deleterId'],
        includeInChoices: false,
    },
    emojiUpdate: {
        eventName: 'GuildEmojiUpdate',
        friendlyName: '이모지 수정',
        dbEventType: 'emojiUpdate',
        category: 'emoji',
        searchableFields: ['emojiId', 'oldName', 'newName', 'updaterId'],
        includeInChoices: false,
    },

    // --- Sticker Events ---
    stickerCreate: {
        eventName: 'GuildStickerCreate',
        friendlyName: '스티커 생성',
        dbEventType: 'stickerCreate',
        category: 'sticker',
        searchableFields: ['stickerId', 'stickerName', 'tags', 'creatorId'],
        includeInChoices: false,
    },
    stickerDelete: {
        eventName: 'GuildStickerDelete',
        friendlyName: '스티커 삭제',
        dbEventType: 'stickerDelete',
        category: 'sticker',
        searchableFields: ['stickerId', 'stickerName', 'deleterId'],
        includeInChoices: false,
    },
    stickerUpdate: {
        eventName: 'GuildStickerUpdate',
        friendlyName: '스티커 수정',
        dbEventType: 'stickerUpdate',
        category: 'sticker',
        searchableFields: ['stickerId', 'oldName', 'newName', 'oldTags', 'newTags', 'updaterId'],
        includeInChoices: false,
    },

    // --- Scheduled Event Events ---
    guildScheduledEventCreate: {
        eventName: 'GuildScheduledEventCreate',
        friendlyName: '예약 이벤트 생성',
        dbEventType: 'guildScheduledEventCreate',
        category: 'scheduledEvent',
        searchableFields: [
            'eventId',
            'eventName',
            'channelId',
            'creatorId',
            'description',
            'scheduledStartTime',
            'entityType',
        ],
        includeInChoices: false,
    },
    guildScheduledEventDelete: {
        eventName: 'GuildScheduledEventDelete',
        friendlyName: '예약 이벤트 삭제',
        dbEventType: 'guildScheduledEventDelete',
        category: 'scheduledEvent',
        searchableFields: ['eventId', 'eventName', 'deleterId'],
        includeInChoices: false,
    },
    guildScheduledEventUpdate: {
        eventName: 'GuildScheduledEventUpdate',
        friendlyName: '예약 이벤트 수정',
        dbEventType: 'guildScheduledEventUpdate',
        category: 'scheduledEvent',
        searchableFields: [
            'eventId',
            'eventName',
            'changedProperty',
            'oldValue',
            'newValue',
            'updaterId',
        ],
        includeInChoices: false,
    },
};

/**
 * 슬래시 옵션에 노출할 이벤트 타입 선택지 목록을 생성합니다.
 */
export function getEventTypeChoices() {
    return Object.values(eventConfigurations)
        .filter((config) => config.includeInChoices)
        .map((config) => ({
            name: `${config.friendlyName} (${config.dbEventType})`,
            value: config.dbEventType,
        }));
}

/**
 * 입력된 이벤트 타입 문자열이 설정 목록에 존재하는지 검증합니다.
 */
export function isValidEventType(eventType: string): boolean {
    return Object.values(eventConfigurations).some((config) => config.dbEventType === eventType);
}

/**
 * 이벤트 타입의 사용자 표시용 이름을 locale 기준으로 반환합니다.
 */
export function getFriendlyEventName(eventType: string, locale: SupportedLocale): string {
    const config = Object.values(eventConfigurations).find(
        (item) => item.dbEventType === eventType,
    );
    if (!config) {
        return eventType;
    }
    if (locale === 'ko') {
        return config.friendlyName;
    }
    return config.dbEventType;
}
