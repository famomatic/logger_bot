import {
    Events,
    GuildMember,
    PartialGuildMember,
    AuditLogEvent,
    Role,
    User,
    AuditLogChange,
    Collection,
    GuildAuditLogsEntry,
} from 'discord.js';
import { logger } from '../utils/logger.js';
import { logEventIfAuthorized as logEvent, shouldLogForGuild } from '../utils/eventLog.js';

// --- Helper Function for Nickname Update (받은 로그 사용) ---
async function handleNicknameUpdate(
    oldMember: GuildMember,
    newMember: GuildMember,
    guildId: string,
    targetUser: User,
    targetId: string,
    nickLog: GuildAuditLogsEntry | undefined,
) {
    const eventType = 'guildMemberNicknameUpdate';
    const timestamp = new Date();
    const oldNickname = oldMember.nickname ?? '(none)';
    const newNickname = newMember.nickname ?? '(none)';
    const executorId = nickLog?.executor?.id ?? null;

    const dataToStore = {
        targetUserId: targetId,
        targetUserTag: targetUser.tag,
        oldNickname: oldNickname,
        newNickname: newNickname,
        executorUserId: executorId,
    };
    try {
        await logEvent(eventType, guildId, executorId, null, targetId, dataToStore, timestamp);
        logger.debug(
            `Logged ${eventType} for user ${targetUser.tag} (${targetId}) in guild ${guildId}`,
        );
    } catch (error) {
        logger.error(
            `Error occurred while trying to log ${eventType} for user ${targetId}:`,
            error,
        );
    }
}

// --- Helper Function for Role Update (받은 로그 사용) ---
async function handleRoleUpdate(
    oldMember: GuildMember,
    newMember: GuildMember,
    guildId: string,
    targetUser: User,
    targetId: string,
    roleLog: GuildAuditLogsEntry | undefined,
) {
    const eventType = 'guildMemberRoleUpdate';
    const timestamp = new Date();
    const oldRoles = oldMember.roles.cache;
    const newRoles = newMember.roles.cache;

    const addedRoles: Role[] = [];
    const removedRoles: Role[] = [];

    newRoles.forEach((role) => {
        if (!oldRoles.has(role.id)) addedRoles.push(role);
    });
    oldRoles.forEach((role) => {
        if (!newRoles.has(role.id)) removedRoles.push(role);
    });

    if (addedRoles.length === 0 && removedRoles.length === 0) return;

    const executorId = roleLog?.executor?.id ?? null;

    const dataToStore = {
        targetUserId: targetId,
        targetUserTag: targetUser.tag,
        addedRoles: addedRoles.map((r) => ({ id: r.id, name: r.name })),
        removedRoles: removedRoles.map((r) => ({ id: r.id, name: r.name })),
        executorUserId: executorId,
    };
    try {
        await logEvent(eventType, guildId, executorId, null, targetId, dataToStore, timestamp);
        logger.debug(
            `Logged ${eventType} for user ${targetUser.tag} (${targetId}) in guild ${guildId}`,
        );
    } catch (error) {
        logger.error(
            `Error occurred while trying to log ${eventType} for user ${targetId}:`,
            error,
        );
    }
}

// --- Helper Function for Avatar Update (받은 로그 사용) ---
async function handleAvatarUpdate(
    oldMember: GuildMember,
    newMember: GuildMember,
    guildId: string,
    targetUser: User,
    targetId: string,
    avatarLog: GuildAuditLogsEntry | undefined,
) {
    const eventType = 'guildMemberAvatarUpdate';
    const timestamp = new Date();
    const oldAvatarURL = oldMember.displayAvatarURL();
    const newAvatarURL = newMember.displayAvatarURL();
    const executorId = avatarLog?.executor?.id ?? null;

    const dataToStore = {
        targetUserId: targetId,
        targetUserTag: targetUser.tag,
        oldAvatarURL: oldAvatarURL,
        newAvatarURL: newAvatarURL,
        executorUserId: executorId,
    };
    try {
        await logEvent(eventType, guildId, executorId, null, targetId, dataToStore, timestamp);
        logger.debug(
            `Logged ${eventType} for user ${targetUser.tag} (${targetId}) in guild ${guildId}`,
        );
    } catch (error) {
        logger.error(
            `Error occurred while trying to log ${eventType} for user ${targetId}:`,
            error,
        );
    }
}

// --- Helper Function for Timeout Update ---
async function handleTimeoutUpdate(
    oldMember: GuildMember | PartialGuildMember,
    newMember: GuildMember,
    guildId: string,
    targetUser: User,
    targetId: string,
    timeoutLog: GuildAuditLogsEntry | undefined,
) {
    const oldTimeoutEnd = oldMember.communicationDisabledUntilTimestamp;
    const newTimeoutEnd = newMember.communicationDisabledUntilTimestamp;
    const now = Date.now();

    let eventType: string | null = null;

    if ((!oldTimeoutEnd || oldTimeoutEnd < now) && newTimeoutEnd && newTimeoutEnd > now) {
        eventType = 'guildMemberTimeoutAdd';
    } else if (oldTimeoutEnd && oldTimeoutEnd > now && (!newTimeoutEnd || newTimeoutEnd < now)) {
        eventType = 'guildMemberTimeoutRemove';
    }

    if (!eventType) {
        return;
    }

    const timestamp = new Date();
    const executorId = timeoutLog?.executor?.id ?? null;
    const reason = timeoutLog?.reason ?? null;

    const dataToStore: Record<string, unknown> = {
        targetUserId: targetId,
        targetUserTag: targetUser.tag,
        executorUserId: executorId,
        reason: reason,
    };
    if (eventType === 'guildMemberTimeoutAdd' && newTimeoutEnd) {
        dataToStore.timeoutUntil = new Date(newTimeoutEnd).toISOString();
    }

    try {
        await logEvent(eventType, guildId, executorId, null, targetId, dataToStore, timestamp);
        logger.debug(
            `Logged ${eventType} for user ${targetUser.tag} (${targetId}) in guild ${guildId}`,
        );
    } catch (error) {
        logger.error(
            `Error occurred while trying to log ${eventType} for user ${targetId}:`,
            error,
        );
    }
}

// --- Main Event Handler (Optimized) ---
const event = {
    name: Events.GuildMemberUpdate,
    async execute(oldMember: GuildMember | PartialGuildMember, newMember: GuildMember) {
        const eventType = 'guildMemberUpdate';
        const guild = newMember.guild;
        const guildId = guild.id;
        const targetUser = newMember.user;
        const targetId = targetUser.id;

        if (!shouldLogForGuild(guildId, eventType)) {
            return;
        }

        let memberUpdateLogs = new Collection<string, GuildAuditLogsEntry>();
        let memberRoleUpdateLogs = new Collection<string, GuildAuditLogsEntry>();

        try {
            const fetchedMemberUpdates = await guild.fetchAuditLogs({
                limit: 10,
                type: AuditLogEvent.MemberUpdate,
            });
            memberUpdateLogs = fetchedMemberUpdates.entries.filter(
                (entry: GuildAuditLogsEntry) =>
                    entry.target instanceof User &&
                    entry.target.id === targetId &&
                    Math.abs(Date.now() - entry.createdTimestamp) < 5000,
            );
            const fetchedRoleUpdates = await guild.fetchAuditLogs({
                limit: 5,
                type: AuditLogEvent.MemberRoleUpdate,
            });
            memberRoleUpdateLogs = fetchedRoleUpdates.entries.filter(
                (entry: GuildAuditLogsEntry) =>
                    entry.target instanceof User &&
                    entry.target.id === targetId &&
                    Math.abs(Date.now() - entry.createdTimestamp) < 5000,
            );
        } catch (error) {
            logger.error(
                `Failed to fetch initial Audit Logs for GuildMemberUpdate (user ${targetId}) in guild ${guildId}:`,
                error,
            );
        }

        if (oldMember instanceof GuildMember) {
            if (oldMember.nickname !== newMember.nickname) {
                const nickLog = memberUpdateLogs.find((entry: GuildAuditLogsEntry) =>
                    entry.changes?.some((change: AuditLogChange) => change.key === 'nick'),
                );
                await handleNicknameUpdate(
                    oldMember,
                    newMember,
                    guildId,
                    targetUser,
                    targetId,
                    nickLog,
                );
            }
            if (!oldMember.roles.cache.equals(newMember.roles.cache)) {
                const roleLog = memberRoleUpdateLogs.first();
                await handleRoleUpdate(
                    oldMember,
                    newMember,
                    guildId,
                    targetUser,
                    targetId,
                    roleLog,
                );
            }
            if (oldMember.avatar !== newMember.avatar) {
                const avatarLog = memberUpdateLogs.find((entry: GuildAuditLogsEntry) =>
                    entry.changes?.some((change: AuditLogChange) => change.key === 'avatar_hash'),
                );
                await handleAvatarUpdate(
                    oldMember,
                    newMember,
                    guildId,
                    targetUser,
                    targetId,
                    avatarLog,
                );
            }
        }

        if (
            oldMember.communicationDisabledUntilTimestamp !==
            newMember.communicationDisabledUntilTimestamp
        ) {
            const timeoutLog = memberUpdateLogs.find((entry: GuildAuditLogsEntry) =>
                entry.changes?.some(
                    (change: AuditLogChange) => change.key === 'communication_disabled_until',
                ),
            );
            await handleTimeoutUpdate(
                oldMember,
                newMember,
                guildId,
                targetUser,
                targetId,
                timeoutLog,
            );
        }
    },
} as const;

/**
 * 이벤트 로더가 참조하는 기본 export 이벤트 핸들러입니다.
 */
export default event;
