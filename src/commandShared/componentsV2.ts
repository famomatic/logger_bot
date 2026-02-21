import {
    ComponentType,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
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
    const components: (TextDisplayBuilder | SeparatorBuilder | MediaGalleryBuilder)[] = [];

    const headerContent = options.description
        ? `## ${options.title}\n${options.description}`
        : `## ${options.title}`;
    components.push(new TextDisplayBuilder().setContent(headerContent));

    if (options.mediaGalleryItems && options.mediaGalleryItems.length > 0) {
        const gallery = new MediaGalleryBuilder();
        for (const item of options.mediaGalleryItems) {
            const mediaItem = new MediaGalleryItemBuilder().setURL(item.url);
            if (item.description) {
                mediaItem.setDescription(item.description);
            }
            if (item.spoiler) {
                mediaItem.setSpoiler(true);
            }
            gallery.addItems(mediaItem);
        }

        components.push(new SeparatorBuilder());
        components.push(gallery);
    }

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
