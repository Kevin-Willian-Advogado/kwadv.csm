import { Component } from '@angular/core';
import { ArticlesCardsPanel } from '../../componentes/articles-cards-panel/articles-cards-panel';
import { ArticlesCardsHighlights } from '../../componentes/articles-cards-highlights/articles-cards-highlights';
import { ArticlesListTable } from '../../componentes/articles-list-table/articles-list-table';

@Component({
  selector: 'app-articles-list',
  imports: [ ArticlesCardsPanel, ArticlesCardsHighlights, ArticlesListTable ],
  templateUrl: './articles-list.html',
  styleUrl: './articles-list.css',
})
export class ArticlesList {

}
