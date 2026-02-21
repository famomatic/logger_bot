export interface ContainerSection {
    title: string;
    body: string;
}

export interface BuildContainerMessageOptions {
    title: string;
    description?: string;
    sections?: ContainerSection[];
    footer?: string;
    accentColor?: number;
}
