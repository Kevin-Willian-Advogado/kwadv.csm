import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

export interface HighlightsArticleModalItem {
  id: number;
  title: string;
  subtitle: string;
  categoryName: string;
  coverImageUrl: string;
}

@Component({
  selector: 'app-highlights-article-modal',
  imports: [CommonModule],
  templateUrl: './highlights-article-modal.html',
  styleUrl: './highlights-article-modal.css',
})
export class HighlightsArticleModal {
  @Input() public isOpen = false;
  @Input() public isSaving = false;
  @Input() public searchTerm = '';
  @Input() public modalErrorMessage = '';
  @Input() public modalArticles: HighlightsArticleModalItem[] = [];

  @Output() public closeModal = new EventEmitter<void>();
  @Output() public searchChange = new EventEmitter<string>();
  @Output() public articleSelected = new EventEmitter<HighlightsArticleModalItem>();

  public onSearchChange(value: string): void {
    this.searchChange.emit(value);
  }

  public onArticleSelected(article: HighlightsArticleModalItem): void {
    this.articleSelected.emit(article);
  }
}
