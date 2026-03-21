export { pool } from './pool.js';

export {
    authorizeGuildId,
    grantCommandPermission,
    hasCommandPermission,
    isAuthorizedGuildCacheReady,
    isGuildAuthorized,
    listCommandPermissionsByCommand,
    listCommandPermissionsByUser,
    loadAuthorizedGuildIds,
    revokeCommandPermission,
    unauthorizeGuildId,
} from './accessControl.js';

export {
    addAlertSubscription,
    fetchAlertSubscriptions,
    fetchLatestMessageCreateTargetIdsByChannel,
    removeAlertSubscription,
} from './alertSubscriptions.js';

export {
    insertLogEventDirectNow,
    insertLogEventsBatch,
    logEvent,
    setLogEventDispatcher,
} from './logWrites.js';

export {
    destroyDatabase,
    migrate,
    testDatabaseConnection,
    verifyEventLogsSchemaStrict,
} from './schema.js';

export type { CommandPermissionRow } from './accessControl.js';
