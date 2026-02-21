export interface ContainerSection {
    title: string;
    body: string;
}

export interface ContainerMediaGalleryItem {
    url: string;
    description?: string;
    spoiler?: boolean;
}

export interface BuildContainerMessageOptions {
    title: string;
    description?: string;
    mediaGalleryItems?: ContainerMediaGalleryItem[];
    sections?: ContainerSection[];
    footer?: string;
    accentColor?: number;
}
