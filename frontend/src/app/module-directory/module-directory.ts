import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

interface DirectoryTool {
  number: string;
  code: string;
  eyebrow: string;
  title: string;
  description: string;
  action: string;
  route: string;
  tone: 'forest' | 'blue' | 'gold' | 'plum';
}

interface DirectoryData {
  eyebrow: string;
  title: string;
  description: string;
  tools: DirectoryTool[];
}

@Component({
  selector: 'app-module-directory',
  imports: [CommonModule, RouterLink],
  templateUrl: './module-directory.html',
  styleUrl: './module-directory.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModuleDirectory {
  private readonly route = inject(ActivatedRoute);
  readonly data = this.route.snapshot.data as DirectoryData;
}
