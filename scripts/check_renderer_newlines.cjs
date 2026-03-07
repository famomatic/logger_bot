const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const TARGET_DIRS = [
    {
        name: 'src renderers',
        dir: path.join(ROOT_DIR, 'src', 'commandShared', 'logSearchShared', 'renderers'),
        required: true,
    },
    {
        name: 'dist renderers',
        dir: path.join(ROOT_DIR, 'dist', 'commandShared', 'logSearchShared', 'renderers'),
        required: false,
    },
];

const BAD_PATTERNS = [
    { label: "join('\\\\n')", regex: /join\('\\\\n'\)/g },
    { label: 'join("\\\\n")', regex: /join\("\\\\n"\)/g },
];

function collectFilesRecursively(dirPath) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectFilesRecursively(fullPath));
            continue;
        }
        if (entry.isFile() && /\.(ts|js)$/.test(entry.name)) {
            files.push(fullPath);
        }
    }

    return files;
}

function findIssuesInFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const issues = [];

    for (const pattern of BAD_PATTERNS) {
        const matches = content.match(pattern.regex);
        if (matches) {
            issues.push({ pattern: pattern.label, count: matches.length });
        }
    }

    return issues;
}

const failures = [];

for (const target of TARGET_DIRS) {
    if (!fs.existsSync(target.dir)) {
        if (target.required) {
            failures.push({
                scope: target.name,
                filePath: target.dir,
                issues: [{ pattern: 'missing directory', count: 1 }],
            });
        }
        continue;
    }

    const files = collectFilesRecursively(target.dir);
    for (const filePath of files) {
        const issues = findIssuesInFile(filePath);
        if (issues.length > 0) {
            failures.push({
                scope: target.name,
                filePath: path.relative(ROOT_DIR, filePath),
                issues,
            });
        }
    }
}

if (failures.length > 0) {
    console.error('Renderer newline check failed. Found literal \\\\n joins:');
    for (const failure of failures) {
        for (const issue of failure.issues) {
            console.error(
                `- [${failure.scope}] ${failure.filePath}: ${issue.pattern} x${issue.count}`,
            );
        }
    }
    throw new Error('Renderer newline check failed.');
}

console.log('Renderer newline check passed.');
