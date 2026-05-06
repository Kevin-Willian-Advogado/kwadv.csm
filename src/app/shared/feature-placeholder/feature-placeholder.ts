import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

interface FeaturePlaceholderData {
  title?: string;
  description?: string;
}

@Component({
  selector: 'app-feature-placeholder',
  imports: [],
  templateUrl: './feature-placeholder.html',
  styleUrl: './feature-placeholder.css',
})
export class FeaturePlaceholder {
  private readonly route = inject(ActivatedRoute);
  private readonly routeData = (this.route.snapshot.data ?? {}) as FeaturePlaceholderData;

  readonly title = this.routeData.title ?? 'Modulo em construcao';
  readonly description =
    this.routeData.description ?? 'A interface visual foi isolada ate a integracao real do modulo.';
}
