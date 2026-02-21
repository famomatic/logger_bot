import {
    ComponentType,
    MessageFlags,
    SeparatorBuilder,
    TextDisplayBuilder,
    type TopLevelComponentData,
} from 'discord.js';
import type { BuildContainerMessageOptions } from '../types/components.js';

export function buildContainerMessage(options: BuildContainerMessageOptions): {
    flags: MessageFlags.IsComponentsV2;
    components: TopLevelComponentData[];
    allowedMentions: { parse: [] };
} {
    const components: (TextDisplayBuilder | SeparatorBuilder)[] = [];

    const headerContent = options.description
        ? `## ${options.title}\n${options.description}`
        : `## ${options.title}`;
    components.push(new TextDisplayBuilder().setContent(headerContent));

    for (const section of options.sections ?? []) {
        components.push(new SeparatorBuilder());
        components.push(
            new TextDisplayBuilder().setContent(`### ${section.title}\n${section.body}`),
        );
    }

    if (options.footer) {
        components.push(new SeparatorBuilder());
        components.push(new TextDisplayBuilder().setContent(options.footer));
    }

    const container = {
        type: ComponentType.Container,
        accentColor: options.accentColor,
        components,
    };

    return {
        flags: MessageFlags.IsComponentsV2,
        components: [container as TopLevelComponentData],
        allowedMentions: { parse: [] },
    };
}
