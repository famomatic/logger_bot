import { Events, AuditLogEvent, PermissionsBitField } from 'discord.js';

import { logEventIfAuthorized as logEvent } from '../utils/eventLog.js';
import { logger } from '../utils/logger.js';

import type { Role, AuditLogChange } from 'discord.js';

// 변경된 내용을 사람이 읽기 쉬운 형태로 변환하는 헬퍼 함수 (선택적)
function formatChange(change: AuditLogChange): string {
    const keyMap: Record<string, string> = {
        name: '이름',
        color: '색상',
        permissions: '권한',
        hoist: '멤버 목록과 분리 표시',
        mentionable: '언급 가능 여부',
        // 필요한 다른 키 추가
    };
    const keyName = keyMap[change.key] ?? change.key;

    let oldValue: string;
    let newValue: string;

    // 권한 변경은 비트필드로 표시될 수 있음
    if (change.key === 'permissions') {
        oldValue =
            new PermissionsBitField(BigInt(change.old as string | number)).toArray().join(', ') ||
            '없음';
        newValue =
            new PermissionsBitField(BigInt(change.new as string | number)).toArray().join(', ') ||
            '없음';
    } else if (
        change.key === 'color' &&
        typeof change.old === 'number' &&
        typeof change.new === 'number'
    ) {
        // 색상 변경은 숫자에서 HEX 코드로 변환
        oldValue = `#${change.old.toString(16).padStart(6, '0')}`;
        newValue = `#${change.new.toString(16).padStart(6, '0')}`;
    } else {
        oldValue =
            typeof change.old === 'object'
                ? JSON.stringify(change.old)
                : String(change.old ?? '없음');
        newValue =
            typeof change.new === 'object'
                ? JSON.stringify(change.new)
                : String(change.new ?? '없음');
    }

    return `${keyName}: '${oldValue}' -> '${newValue}'`;
}

const event = {
    name: Events.GuildRoleUpdate,
    async execute(oldRole: Role, newRole: Role) {
        const eventType = 'roleUpdate';
        const guildId = newRole.guild.id;
        const targetId = newRole.id; // 변경된 역할 ID
        const timestamp = new Date();
        let executorId: string | null;
        let changesDescription: string; // 변경 내용 요약 문자열

        const significantChange =
            oldRole.name !== newRole.name ||
            oldRole.hexColor !== newRole.hexColor ||
            oldRole.permissions.bitfield !== newRole.permissions.bitfield ||
            oldRole.hoist !== newRole.hoist ||
            oldRole.mentionable !== newRole.mentionable;
        if (!significantChange) {
            // 위치 변경 등 Audit Log가 남지 않는 변경은 무시
            return;
        }

        // Audit Log 조회 시도
        try {
            const fetchedLogs = await newRole.guild.fetchAuditLogs({
                limit: 5, // 여러 변경이 동시에 발생할 수 있으므로 조금 더 확인
                type: AuditLogEvent.RoleUpdate, // 31
            });
            // 가장 최근 RoleUpdate 로그 중 대상이 일치하는 로그 찾기
            const updateLog = fetchedLogs.entries.find(
                (entry) =>
                    entry.target.id === targetId &&
                    Math.abs(Date.now() - entry.createdTimestamp) < 5000,
            );

            if (updateLog) {
                executorId = updateLog.executor?.id ?? null;
                // timestamp = updateLog.createdAt;
                // Audit Log에서 실제 변경 내용 가져오기
                changesDescription = updateLog.changes.map(formatChange).join('\n');
                if (!changesDescription) {
                    changesDescription = '변경 내역을 Audit Log에서 찾을 수 없음';
                }
            } else {
                executorId = null;
                logger.warn(
                    `Could not find exact Audit Log entry for ${eventType} (role ${targetId}) in guild ${guildId}. Executor and precise changes might be missing.`,
                );
                // Audit Log를 못 찾으면 직접 비교 (단, 어떤 변경이 있었는지 정확히 모를 수 있음)
                const detectedChanges: string[] = [];
                if (oldRole.name !== newRole.name)
                    detectedChanges.push(`이름: '${oldRole.name}' -> '${newRole.name}'`);
                if (oldRole.hexColor !== newRole.hexColor)
                    detectedChanges.push(`색상: '${oldRole.hexColor}' -> '${newRole.hexColor}'`);
                if (oldRole.permissions.bitfield !== newRole.permissions.bitfield)
                    detectedChanges.push(`권한 변경됨 (상세 내역은 Audit Log 확인 필요)`);
                if (oldRole.hoist !== newRole.hoist)
                    detectedChanges.push(`분리 표시: ${oldRole.hoist} -> ${newRole.hoist}`);
                if (oldRole.mentionable !== newRole.mentionable)
                    detectedChanges.push(
                        `언급 가능: ${oldRole.mentionable} -> ${newRole.mentionable}`,
                    );
                // TODO: position 등 다른 변경 사항 비교 추가 가능
                changesDescription = detectedChanges.join('\n');
                if (!changesDescription) return; // 감지된 변경 사항 없으면 종료
            }
        } catch (error) {
            executorId = null;
            logger.error(`Failed to fetch Audit Logs for ${eventType} in guild ${guildId}:`, error);
            // 에러 발생 시에도 직접 비교 시도
            const detectedChanges: string[] = [];
            if (oldRole.name !== newRole.name)
                detectedChanges.push(`이름: '${oldRole.name}' -> '${newRole.name}'`);
            if (oldRole.hexColor !== newRole.hexColor)
                detectedChanges.push(`색상: '${oldRole.hexColor}' -> '${newRole.hexColor}'`);
            if (oldRole.permissions.bitfield !== newRole.permissions.bitfield)
                detectedChanges.push(`권한 변경됨 (상세 내역은 Audit Log 확인 필요)`);
            if (oldRole.hoist !== newRole.hoist)
                detectedChanges.push(`분리 표시: ${oldRole.hoist} -> ${newRole.hoist}`);
            if (oldRole.mentionable !== newRole.mentionable)
                detectedChanges.push(`언급 가능: ${oldRole.mentionable} -> ${newRole.mentionable}`);
            changesDescription = detectedChanges.join('\n');
            if (!changesDescription) return;
        }

        // 데이터베이스에 저장할 JSON 데이터
        const dataToStore = {
            roleId: targetId,
            roleName: newRole.name, // 변경 후 이름
            changes: changesDescription, // 변경 내용 요약
            executorUserId: executorId,
            // 필요시 oldRole의 모든 정보 또는 newRole의 모든 정보 저장 가능
        };

        try {
            await logEvent(
                eventType,
                guildId,
                executorId,
                null, // channel_id is null for role events
                targetId, // target_id: 변경된 역할 ID
                dataToStore,
                timestamp,
            );
            logger.debug(
                `Logged ${eventType} event for role ${newRole.name} (${targetId}) in guild ${guildId}`,
            );
        } catch (error) {
            logger.error(
                `Error occurred while trying to log ${eventType} event for role ${targetId}:`,
                error,
            );
        }
    },
} as const;

/**
 * 이벤트 로더가 참조하는 기본 export 이벤트 핸들러입니다.
 */
export { event };
