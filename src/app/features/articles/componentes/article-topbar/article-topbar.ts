import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ActionConfirmationModal,
  ActionConfirmationModalConfig,
} from '../../../../shared/modal/action-confirmation-modal/action-confirmation-modal';
import {
  ARTICLE_STATUS_ARCHIVED,
  ARTICLE_STATUS_DRAFT,
  ARTICLE_STATUS_PROCESSING,
  ARTICLE_STATUS_PUBLISHED,
} from '../../article-editor.models';

export type ArticleSaveAction = 'draft' | 'publish' | 'unpublish';
export type ArticlePipelineAction = Extract<ArticleSaveAction, 'publish' | 'unpublish'>;

@Component({
  selector: 'app-article-topbar',
  imports: [CommonModule, RouterLink, ActionConfirmationModal],
  templateUrl: './article-topbar.html',
  styleUrl: './article-topbar.css',
})
export class ArticleTopbar {
  @Input() status = 2;
  @Input() isSaving = false;
  @Input() isLoading = false;
  @Input() isCreating = true;
  @Input() articleTitle = '';
  @Input() articleSlug = '';
  @Input() categoryName = '';
  @Input() publishedAt: string | null = null;
  @Input() lastSavedAt: string | null = null;
  @Input() pendingPipelineAction: ArticlePipelineAction | null = null;
  @Input() pipelineQueuedAt: string | null = null;
  @Input() isDirty = false;
  @Output() save = new EventEmitter<ArticleSaveAction>();

  pendingAction: ArticleSaveAction | null = null;

  private readonly processingStatus = ARTICLE_STATUS_PROCESSING;
  private readonly publishedStatus = ARTICLE_STATUS_PUBLISHED;
  private readonly draftStatus = ARTICLE_STATUS_DRAFT;
  private readonly archivedStatus = ARTICLE_STATUS_ARCHIVED;

  get isBusy(): boolean {
    return this.isSaving || this.isLoading;
  }

  get isProcessing(): boolean {
    return this.status === this.processingStatus;
  }

  get isPublished(): boolean {
    return this.status === this.publishedStatus;
  }

  get isDraft(): boolean {
    return this.status === this.draftStatus;
  }

  get isArchived(): boolean {
    return this.status === this.archivedStatus;
  }

  get showDeleteButton(): boolean {
    return !this.isCreating && !this.isProcessing && (this.isDraft || this.isArchived);
  }

  get showSaveDraftButton(): boolean {
    return !this.isPublished && !this.isProcessing;
  }

  get showPublishButton(): boolean {
    return !this.isPublished && !this.isProcessing;
  }

  get showUnpublishButton(): boolean {
    return !this.isCreating && this.isPublished && !this.isProcessing;
  }

  get showRepublishButton(): boolean {
    return !this.isCreating && this.isPublished && !this.isProcessing;
  }

  get titleLabel(): string {
    const title = this.articleTitle.trim();
    if (title) {
      return title;
    }

    return this.isCreating ? 'Novo Artigo' : 'Artigo sem titulo';
  }

  get slugLabel(): string {
    const slug = this.articleSlug.trim();
    return slug || 'slug-pendente';
  }

  get categoryLabel(): string {
    const category = this.categoryName.trim();
    return category || 'Sem categoria';
  }

  get syncLabel(): string {
    if (this.isLoading) {
      return 'Carregando artigo';
    }

    if (this.isSaving) {
      return 'Salvando alteracoes';
    }

    if (this.isDirty) {
      return 'Alteracoes nao salvas';
    }

    if (this.pendingPipelineAction === 'publish') {
      return 'Publicacao em processamento';
    }

    if (this.pendingPipelineAction === 'unpublish') {
      return 'Remocao da publicacao em processamento';
    }

    if (this.isProcessing) {
      return 'Processamento em andamento';
    }

    return 'Tudo salvo';
  }

  get hasPendingPipeline(): boolean {
    return this.pendingPipelineAction !== null;
  }

  get pipelineBadgeLabel(): string {
    if (this.pendingPipelineAction === null) {
      return 'Processando';
    }

    return this.pendingPipelineAction === 'unpublish'
      ? 'Remocao em andamento'
      : 'Enviando para publicacao';
  }

  get pipelineTimestampLabel(): string {
    if (this.pendingPipelineAction === null) {
      return 'Processamento iniciado';
    }

    return this.pendingPipelineAction === 'unpublish' ? 'Remocao iniciada' : 'Envio iniciado';
  }

  get actionModalConfig(): ActionConfirmationModalConfig | null {
    if (!this.pendingAction) {
      return null;
    }

    const articleReference = this.articleTitle.trim() ? `"${this.articleTitle.trim()}"` : 'este artigo';

    if (this.pendingAction === 'draft') {
      return {
        title: this.isCreating ? 'Salvar novo rascunho?' : 'Salvar alteracoes do rascunho?',
        description: this.isCreating
          ? 'O artigo sera criado como rascunho para voce continuar a edicao depois.'
          : `As alteracoes atuais de ${articleReference} serao salvas sem publicar o conteudo.`,
        confirmLabel: 'Salvar rascunho',
        highlights: [
          'O status do artigo continuara como Rascunho.',
          'O conteudo permanecera disponivel para novas edicoes.',
        ],
        hint: this.isDirty
          ? 'Depois de salvar, o indicador de sincronizacao volta para Tudo salvo.'
          : 'Nenhuma alteracao pendente foi detectada, mas o salvamento pode ser confirmado mesmo assim.',
      };
    }

    if (this.pendingAction === 'publish') {
      return this.isPublished
        ? {
            title: 'Salvar e reenviar para publicacao?',
            description: `As alteracoes atuais de ${articleReference} serao salvas no CMS e um novo fluxo de publicacao sera iniciado.`,
            confirmLabel: 'Salvar e reenviar',
            highlights: [
              'O artigo passara para o status Processando no painel.',
              'O rebuild e o deploy da nova versao seguem em segundo plano.',
            ],
            hint: this.isDirty
              ? 'Use esta acao para enfileirar a versao mais recente sem tirar o artigo do ar.'
              : 'Mesmo sem alteracoes pendentes, a acao pode ser usada para reiniciar a publicacao da versao atual.',
          }
        : {
            title: 'Salvar e iniciar publicacao?',
            description: `O conteudo atual de ${articleReference} sera salvo no CMS e enviado para o fluxo de publicacao.`,
            confirmLabel: 'Salvar e publicar',
            highlights: [
              'O artigo passara para o status Processando no painel.',
              'O rebuild e o deploy da nova versao seguem em segundo plano.',
            ],
            hint: 'Depois de confirmar, o painel indica que o envio foi iniciado, sem assumir que o site ja terminou de publicar.',
          };
    }

    return {
      title: 'Salvar e iniciar remocao da publicacao?',
      description: `O conteudo atual de ${articleReference} sera salvo no CMS e enviado para o fluxo de remocao da publicacao.`,
      confirmLabel: 'Remover publicacao',
      tone: 'danger',
      highlights: [
        'O artigo passara para o status Processando no painel.',
        'A retirada do site segue em segundo plano ate o rebuild e o deploy terminarem.',
      ],
      hint: 'Depois de confirmar, o painel indica que a remocao foi iniciada, sem assumir que o site ja terminou de atualizar.',
    };
  }

  get isActionModalOpen(): boolean {
    return this.pendingAction !== null;
  }

  onSaveDraft(): void {
    this.openActionModal('draft');
  }

  onSaveAndPublish(): void {
    this.openActionModal('publish');
  }

  onUnpublish(): void {
    this.openActionModal('unpublish');
  }

  closeActionModal(): void {
    if (this.isBusy) {
      return;
    }

    this.pendingAction = null;
  }

  confirmPendingAction(): void {
    if (this.isBusy || !this.pendingAction) {
      return;
    }

    const action = this.pendingAction;
    this.pendingAction = null;
    this.save.emit(action);
  }

  private openActionModal(action: ArticleSaveAction): void {
    if (this.isBusy) {
      return;
    }

    this.pendingAction = action;
  }
}
