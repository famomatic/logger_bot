export interface ModuleLoadContext {
    fileName: string;
    filePath: string;
    fileUrl: string;
}

export interface LoadModulesFromDirectoryOptions<TModule> {
    directoryPath: string;
    fileExtension?: string;
    bustImportCache?: boolean;
    onDiscoveredFiles?: (totalFiles: number) => void;
    resolveModule: (moduleExports: unknown, context: ModuleLoadContext) => TModule | null;
    onModule: (moduleValue: TModule, context: ModuleLoadContext) => Promise<void> | void;
    onInvalidModule?: (context: ModuleLoadContext) => void;
    onModuleLoadError?: (context: ModuleLoadContext, error: unknown) => void;
}

export interface ModuleLoadResult {
    directoryExists: boolean;
    totalFiles: number;
    loadedCount: number;
}
