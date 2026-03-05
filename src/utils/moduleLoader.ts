import fs from 'fs';
import path from 'path';
import { fileURLToPath, URL } from 'url';
import type {
    LoadModulesFromDirectoryOptions,
    ModuleLoadContext,
    ModuleLoadResult,
} from '../types/moduleLoader.js';

export function resolveRuntimeSubdirectory(importMetaUrl: string, subdirectory: string): string {
    const filePath = fileURLToPath(importMetaUrl);
    const dirname = path.dirname(filePath);
    return path.join(dirname, '..', subdirectory);
}

function toFileUrl(filePath: string, bustImportCache: boolean): string {
    const resolvedPath = path.resolve(filePath);
    const fileUrl = new URL(`file:///${resolvedPath.replace(/\\/g, '/')}`);
    if (bustImportCache) {
        fileUrl.searchParams.set('update', Date.now().toString());
    }
    return fileUrl.href;
}

export async function loadModulesFromDirectory<TModule>(
    options: LoadModulesFromDirectoryOptions<TModule>,
): Promise<ModuleLoadResult> {
    const extension = options.fileExtension ?? '.js';
    const directoryPath = options.directoryPath;

    if (!fs.existsSync(directoryPath) || !fs.lstatSync(directoryPath).isDirectory()) {
        return {
            directoryExists: false,
            totalFiles: 0,
            loadedCount: 0,
        };
    }

    const fileNames = fs
        .readdirSync(directoryPath)
        .filter((fileName) => fileName.endsWith(extension));
    options.onDiscoveredFiles?.(fileNames.length);

    let loadedCount = 0;
    const bustImportCache = options.bustImportCache === true;

    for (const fileName of fileNames) {
        const filePath = path.join(directoryPath, fileName);
        const context: ModuleLoadContext = {
            fileName,
            filePath,
            fileUrl: toFileUrl(filePath, bustImportCache),
        };

        try {
            const moduleExports: unknown = await import(context.fileUrl);
            const moduleValue = options.resolveModule(moduleExports, context);
            if (!moduleValue) {
                options.onInvalidModule?.(context);
                continue;
            }

            await options.onModule(moduleValue, context);
            loadedCount++;
        } catch (error) {
            options.onModuleLoadError?.(context, error);
        }
    }

    return {
        directoryExists: true,
        totalFiles: fileNames.length,
        loadedCount,
    };
}
