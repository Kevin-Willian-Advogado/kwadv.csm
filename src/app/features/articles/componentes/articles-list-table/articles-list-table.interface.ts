export type ArticleStatusFilter = 'all' | 'published' | 'draft';

export interface ArticlesListTableInterface {
    id: number
    title: string
    subtitle: string
    slug: string
    category: string
    views: number
    status: number
    publishedAt: string
    updatedAt:string
}
