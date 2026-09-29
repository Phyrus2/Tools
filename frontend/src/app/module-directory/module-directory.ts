import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService, PermissionKey } from '../auth/auth.service';

interface DirectoryTool {
  number: string;
  code: string;
  eyebrow: string;
  title: string;
  description: string;
  action: string;
  route: string;
  tone: 'forest' | 'blue' | 'gold' | 'plum';
  permission: PermissionKey;
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
  private readonly auth = inject(AuthService);
  private readonly routeData = this.route.snapshot.data as DirectoryData;
  readonly data: DirectoryData = {
    ...this.routeData,
    tools: this.routeData.tools.filter((tool) => this.auth.hasPermission(tool.permission)),
  };
}
