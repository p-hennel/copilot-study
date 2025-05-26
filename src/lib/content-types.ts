import * as icons from "@lucide/svelte";

export enum ContentType {
  Markdown,
  Alert
}

export interface AlertContent extends ContentBase {
  icon?: keyof typeof icons;
  title: string;
  content: string;
}

export interface ContentBase {
  type: ContentType;
}

export interface MarkdownContent extends ContentBase {
  type: ContentType.Markdown;
  content: string;
}

export type Content = MarkdownContent | AlertContent;