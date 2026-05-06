import { ArticleEditorAuthor, ArticleEditorRelatedArticle } from '../../core/articles.service';

export const ARTICLE_STATUS_PUBLISHED = 1;
export const ARTICLE_STATUS_DRAFT = 2;
export const ARTICLE_STATUS_PROCESSING = 0;
export const ARTICLE_STATUS_ARCHIVED = 3;

export interface ArticleEditorValidationErrors {
  title?: string;
  subtitle?: string;
  categoryId?: string;
  coverImageUrl?: string;
  slug?: string;
  metaDescription?: string;
  authors?: string;
}

export interface ArticleEditorFormData {
  id: number | null;
  title: string;
  subtitle: string;
  slug: string;
  coverImageUrl: string;
  content: string;
  metaDescription: string;
  status: number;
  highlights: boolean;
  categoryId: number | null;
  categoryName: string;
  publishedAt: string | null;
  updatedAt: string | null;
  authors: ArticleEditorAuthor[];
  relatedArticles: ArticleEditorRelatedArticle[];
}

export function createEmptyArticleEditorFormData(): ArticleEditorFormData {
  return {
    id: null,
    title: '',
    subtitle: '',
    slug: '',
    coverImageUrl: '',
    content: '',
    metaDescription: '',
    status: ARTICLE_STATUS_DRAFT,
    highlights: false,
    categoryId: null,
    categoryName: '',
    publishedAt: null,
    updatedAt: null,
    authors: [],
    relatedArticles: [],
  };
}
